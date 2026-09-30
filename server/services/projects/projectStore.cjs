/**
 * Project store — SQLite-backed, ownership-enforced, quota-checked.
 *
 * Every operation takes an explicit ownerId (from req.user, never from the
 * client body). Cross-user access is impossible by construction: all queries
 * filter on owner_id, and mutations verify the row belongs to the caller
 * inside a transaction before writing.
 *
 * Quotas (server/services/execution-style LIMITS):
 *   - MAX_WORKSPACES_PER_USER workspaces per user
 *   - MAX_WORKSPACE_BYTES serialized tree bytes per project
 *   - MAX_FILE_BYTES per single file content
 *   - MAX_FILES_PER_WORKSPACE file nodes per project
 *   - MAX_USER_STORAGE_BYTES total across a user's projects
 *
 * The tree itself is stored as versioned JSON (projects.tree_json); the
 * project_files table is a materialized index maintained on every save for
 * quota/count queries without loading full trees.
 */
const crypto = require('crypto');
const { getDb, nowIso, transaction } = require('../../db/index.cjs');
const { LIMITS } = require('../../config/index.cjs');

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

function sanitizeId(id) {
    if (typeof id !== 'string' || !id.trim()) {
        const err = new Error('Invalid project id');
        err.status = 400;
        throw err;
    }
    if (!UUID_RE.test(id) && !ID_RE.test(id)) {
        const err = new Error('Invalid project id');
        err.status = 400;
        throw err;
    }
    if (id.includes('..') || id.includes('/') || id.includes('\\')) {
        const err = new Error('Invalid project id');
        err.status = 400;
        throw err;
    }
    return id;
}

function error(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

/** Walk a tree without recursion (cycle-safe). Returns { files, totalBytes }. */
function summarizeTree(tree) {
    const files = [];
    let totalBytes = 0;
    if (!Array.isArray(tree)) throw error(400, 'Project tree must be an array');
    const stack = [...tree];
    const seen = new Set();
    let nodes = 0;
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        nodes++;
        if (nodes > LIMITS.MAX_FILES_PER_WORKSPACE * 4) {
            throw error(413, 'Project structure too large');
        }
        if (node.type === 'file') {
            const content = typeof node.content === 'string' ? node.content : '';
            const size = Buffer.byteLength(content, 'utf8');
            if (size > LIMITS.MAX_FILE_BYTES) {
                throw error(413, `File "${String(node.name || 'unnamed').slice(0, 80)}" exceeds the ${LIMITS.MAX_FILE_BYTES}-byte file limit`);
            }
            files.push({ name: String(node.name || ''), size });
            totalBytes += size;
        }
        if (Array.isArray(node.children)) {
            for (const child of node.children) stack.push(child);
        }
    }
    if (files.length > LIMITS.MAX_FILES_PER_WORKSPACE) {
        throw error(413, `Project exceeds the ${LIMITS.MAX_FILES_PER_WORKSPACE}-file limit`);
    }
    return { files, totalBytes, fileCount: files.length };
}

function userStorageBytes(ownerId) {
    const db = getDb();
    const row = db.prepare(
        `SELECT COALESCE(SUM(LENGTH(tree_json)), 0) AS bytes, COUNT(*) AS n FROM projects WHERE owner_id = ?`,
    ).get(ownerId);
    return { bytes: Number(row.bytes || 0), count: Number(row.n || 0) };
}

function toPublic(row) {
    let tree = [];
    try {
        tree = JSON.parse(row.tree_json || '[]');
        if (!Array.isArray(tree)) tree = [];
    } catch {
        tree = [];
    }
    return { id: row.id, name: row.name, tree, createdAt: row.created_at, updatedAt: row.updated_at };
}

function toSummary(row) {
    return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

function listProjects(ownerId) {
    const db = getDb();
    const rows = db.prepare(
        'SELECT id, name, created_at, updated_at FROM projects WHERE owner_id = ? ORDER BY updated_at DESC',
    ).all(ownerId);
    return rows.map(toSummary);
}

function getProject(ownerId, id) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').get(sanitizeId(id), ownerId);
    if (!row) throw error(404, 'Project not found');
    return toPublic(row);
}

function createProject(ownerId, { name, tree }) {
    const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : 'New Project';
    const cleanTree = Array.isArray(tree) ? tree : [];
    const serialized = JSON.stringify({ name: cleanName, tree: cleanTree });
    if (Buffer.byteLength(serialized, 'utf8') > LIMITS.MAX_WORKSPACE_BYTES) {
        throw error(413, `Project too large (max ${LIMITS.MAX_WORKSPACE_BYTES} bytes)`);
    }
    const summary = summarizeTree(cleanTree);
    const usage = userStorageBytes(ownerId);
    if (usage.count >= LIMITS.MAX_WORKSPACES_PER_USER) {
        throw error(403, `Project limit reached (${LIMITS.MAX_WORKSPACES_PER_USER})`);
    }
    if (usage.bytes + Buffer.byteLength(serialized, 'utf8') > LIMITS.MAX_USER_STORAGE_BYTES) {
        throw error(403, 'Storage quota exceeded');
    }
    const db = getDb();
    const id = crypto.randomUUID();
    const now = nowIso();
    const treeJson = JSON.stringify(cleanTree);
    const insertProject = db.prepare(
        'INSERT INTO projects (id, owner_id, name, tree_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insertFile = db.prepare(
        'INSERT INTO project_files (project_id, path, size_bytes, updated_at) VALUES (?, ?, ?, ?)',
    );
    const txn = () => transaction(() => {
        insertProject.run(id, ownerId, cleanName, treeJson, now, now);
        for (const f of summary.files) insertFile.run(id, f.name.slice(0, 500), f.size, now);
    });
    txn();
    return { id, name: cleanName, tree: cleanTree, createdAt: now, updatedAt: now };
}

function saveProject(ownerId, id, { name, tree }) {
    const pid = sanitizeId(id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').get(pid, ownerId);
    if (!existing) throw error(404, 'Project not found');
    let existingTree = [];
    try {
        existingTree = JSON.parse(existing.tree_json || '[]');
        if (!Array.isArray(existingTree)) existingTree = [];
    } catch {
        existingTree = [];
    }
    const nextName = typeof name === 'string' ? name.slice(0, 200) : existing.name;
    if (typeof name === 'string' && name.length > 200) throw error(400, 'Project name too long');
    const nextTree = tree === undefined ? existingTree : tree;
    if (!Array.isArray(nextTree)) throw error(400, 'Project tree must be an array');
    const serialized = JSON.stringify({ name: nextName, tree: nextTree });
    if (Buffer.byteLength(serialized, 'utf8') > LIMITS.MAX_WORKSPACE_BYTES) {
        throw error(413, `Project too large (max ${LIMITS.MAX_WORKSPACE_BYTES} bytes)`);
    }
    const summary = summarizeTree(nextTree);
    const usage = userStorageBytes(ownerId);
    const oldSize = Buffer.byteLength(existing.tree_json || '[]', 'utf8');
    if (usage.bytes - oldSize + Buffer.byteLength(serialized, 'utf8') > LIMITS.MAX_USER_STORAGE_BYTES) {
        throw error(403, 'Storage quota exceeded');
    }
    const now = nowIso();
    const treeJson = JSON.stringify(nextTree);
    const updateProject = db.prepare('UPDATE projects SET name = ?, tree_json = ?, updated_at = ? WHERE id = ? AND owner_id = ?');
    const deleteFiles = db.prepare('DELETE FROM project_files WHERE project_id = ?');
    const insertFile = db.prepare('INSERT INTO project_files (project_id, path, size_bytes, updated_at) VALUES (?, ?, ?, ?)');
    const txn = () => transaction(() => {
        const res = updateProject.run(nextName, treeJson, now, pid, ownerId);
        if (res.changes === 0) throw error(404, 'Project not found');
        deleteFiles.run(pid);
        for (const f of summary.files) insertFile.run(pid, f.name.slice(0, 500), f.size, now);
    });
    txn();
    return { id: pid, name: nextName, tree: nextTree, createdAt: existing.created_at, updatedAt: now };
}

function deleteProject(ownerId, id) {
    const pid = sanitizeId(id);
    const db = getDb();
    const res = db.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?').run(pid, ownerId);
    if (res.changes === 0) throw error(404, 'Project not found');
    return { id: pid, deleted: true };
}

module.exports = {
    listProjects,
    getProject,
    createProject,
    saveProject,
    deleteProject,
    sanitizeId,
    summarizeTree,
    userStorageBytes,
};
