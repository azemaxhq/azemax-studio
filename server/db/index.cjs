/**
 * Azemax persistent storage — SQLite (node:sqlite, zero dependencies).
 *
 * Why SQLite: atomic transactions, real constraints/indexes, crash-safe WAL,
 * single-file backup story, no new npm dependencies, no native builds.
 * The schema uses portable SQL types so a Postgres migration is mechanical
 * (see docs; DATABASE_URL support is the documented scale path).
 *
 * Tables:
 *   users         — id, email (unique), password_hash (scrypt), display_name,.timestamps
 *   sessions      — token_hash PK, user_id FK, expiry, last-used, ip
 *   projects      — id, owner_id FK, name, tree_json, timestamps
 *   project_files — materialized per-file index (project_id, path) for quotas
 *   usage_daily   — per-user per-day counters (ai_requests, ai_tokens, executions)
 *
 * Concurrency: node:sqlite is synchronous; every multi-statement mutation runs
 * inside an explicit transaction. WAL + busy_timeout tolerate concurrent
 * readers/writers from the single Node process.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DATABASE_PATH, DATA_DIR } = require('../config/index.cjs');
const logger = require('../lib/logger.cjs');

const SCHEMA_VERSION = 2;

const MIGRATIONS = [
    // v1: initial schema
    `
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_used_at TEXT,
        ip TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        tree_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CONSTRAINT name_len CHECK (length(name) <= 200)
    );
    CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS project_files (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_files_project ON project_files(project_id);
    CREATE TABLE IF NOT EXISTS usage_daily (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        ai_requests INTEGER NOT NULL DEFAULT 0,
        ai_tokens INTEGER NOT NULL DEFAULT 0,
        executions INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
    );
    `,
    // v2: Firebase Authentication & OAuth integration
    `
    ALTER TABLE users ADD COLUMN firebase_uid TEXT;
    ALTER TABLE users ADD COLUMN provider TEXT DEFAULT 'password';
    ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN photo_url TEXT;
    ALTER TABLE users ADD COLUMN last_login_at TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
    `,
];

let db = null;

function nowIso() {
    return new Date().toISOString();
}

function openDatabase(dbPath = DATABASE_PATH) {
    if (db) return db;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const instance = new DatabaseSync(dbPath);
    // Crash-safe + concurrent-friendly pragmas for a single-process server.
    instance.exec('PRAGMA journal_mode = WAL;');
    instance.exec('PRAGMA foreign_keys = ON;');
    instance.exec('PRAGMA busy_timeout = 5000;');
    instance.exec('PRAGMA synchronous = FULL;');
    runMigrations(instance);
    db = instance;
    logger.info('db opened', { path: dbPath, schemaVersion: SCHEMA_VERSION });
    return db;
}

function currentVersion(instance) {
    try {
        const row = instance.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
        return row && row.v ? row.v : 0;
    } catch {
        return 0; // table itself missing on first boot
    }
}

function runMigrations(instance) {
    const applied = currentVersion(instance);
    for (let i = applied; i < MIGRATIONS.length; i++) {
        const version = i + 1;
        instance.exec('BEGIN;');
        try {
            instance.exec(MIGRATIONS[i]);
            instance.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, nowIso());
            instance.exec('COMMIT;');
            logger.info('db migration applied', { version });
        } catch (err) {
            try { instance.exec('ROLLBACK;'); } catch { /* ignore */ }
            throw err;
        }
    }
}

function getDb() {
    if (!db) return openDatabase();
    return db;
}

/** UTC day bucket for quota accounting. */
function todayUtc() {
    return new Date().toISOString().slice(0, 10);
}

function closeDatabase() {
    if (db) {
        try { db.close(); } catch { /* ignore */ }
        db = null;
    }
}

/**
 * Run fn() inside a SQLite transaction (node:sqlite has no .transaction()
 * helper — BEGIN/COMMIT/ROLLBACK explicitly). Rolls back on throw.
 */
function transaction(fn) {
    const instance = getDb();
    instance.exec('BEGIN IMMEDIATE;');
    try {
        const result = fn(instance);
        instance.exec('COMMIT;');
        return result;
    } catch (err) {
        try { instance.exec('ROLLBACK;'); } catch { /* ignore */ }
        throw err;
    }
}

module.exports = {
    SCHEMA_VERSION,
    openDatabase,
    getDb,
    closeDatabase,
    transaction,
    todayUtc,
    nowIso,
    DATA_DIR,
};
