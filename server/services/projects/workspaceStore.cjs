const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WORKSPACES_DIR } = require('../../config/index.cjs');

function ensureDir() {
    if (!fs.existsSync(WORKSPACES_DIR)) {
        fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
    }
}

const MAX_WORKSPACE_BYTES = Number(process.env.MAX_WORKSPACE_BYTES) || 2 * 1024 * 1024; // 2MB

function sanitizeId(id) {
    if (typeof id !== 'string' || !id.trim()) {
        const err = new Error('Invalid workspace id');
        err.status = 400;
        throw err;
    }
    // UUIDs and hex ids only — prevent path traversal and special chars
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(id) && !/^[0-9a-fA-F-]{36}$/.test(id)) {
        // Also accept UUID form; otherwise reject
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
            const err = new Error('Invalid workspace id');
            err.status = 400;
            throw err;
        }
    }
    if (id.includes('..') || id.includes('/') || id.includes('\\')) {
        const err = new Error('Invalid workspace id');
        err.status = 400;
        throw err;
    }
    return id;
}

function workspacePath(id) {
    const safeId = sanitizeId(id);
    const p = path.join(WORKSPACES_DIR, `${safeId}.json`);
    // Ensure resolved path stays inside WORKSPACES_DIR
    const resolved = path.resolve(p);
    const base = path.resolve(WORKSPACES_DIR);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
        const err = new Error('Invalid workspace id');
        err.status = 400;
        throw err;
    }
    return p;
}

function listWorkspaces() {
    ensureDir();
    const files = fs.readdirSync(WORKSPACES_DIR).filter((f) => f.endsWith('.json'));

    return files.map((file) => {
        const id = file.replace(/\.json$/, '');
        try {
            const data = JSON.parse(fs.readFileSync(path.join(WORKSPACES_DIR, file), 'utf8'));
            return {
                id,
                name: data.name || 'Untitled',
                updatedAt: data.updatedAt || null,
                createdAt: data.createdAt || null,
            };
        } catch {
            return { id, name: 'Corrupted workspace', updatedAt: null, createdAt: null };
        }
    });
}

function getWorkspace(id) {
    ensureDir();
    const file = workspacePath(id);
    if (!fs.existsSync(file)) {
        const err = new Error('Workspace not found');
        err.status = 404;
        throw err;
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createWorkspace({ name, tree }) {
    ensureDir();
    // Enforce size limit
    const payload = JSON.stringify({ name, tree });
    if (Buffer.byteLength(payload, 'utf8') > MAX_WORKSPACE_BYTES) {
        const err = new Error(`Workspace too large (max ${MAX_WORKSPACE_BYTES} bytes)`);
        err.status = 413;
        throw err;
    }
    if (typeof name === 'string' && name.length > 200) {
        const err = new Error('Workspace name too long');
        err.status = 400;
        throw err;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const workspace = {
        id,
        name: name || 'New Project',
        tree: tree || [],
        createdAt: now,
        updatedAt: now,
    };
    fs.writeFileSync(workspacePath(id), JSON.stringify(workspace, null, 2));
    return workspace;
}

function saveWorkspace(id, { name, tree }) {
    sanitizeId(id);
    const payload = JSON.stringify({ name, tree });
    if (Buffer.byteLength(payload, 'utf8') > MAX_WORKSPACE_BYTES) {
        const err = new Error(`Workspace too large (max ${MAX_WORKSPACE_BYTES} bytes)`);
        err.status = 413;
        throw err;
    }
    if (typeof name === 'string' && name.length > 200) {
        const err = new Error('Workspace name too long');
        err.status = 400;
        throw err;
    }
    ensureDir();
    const file = workspacePath(id);
    const existing = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf8'))
        : { id, createdAt: new Date().toISOString() };

    const workspace = {
        ...existing,
        id,
        name: name ?? existing.name ?? 'Untitled',
        tree: tree ?? existing.tree ?? [],
        updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(file, JSON.stringify(workspace, null, 2));
    return workspace;
}

function deleteWorkspace(id) {
    ensureDir();
    const file = workspacePath(id);
    if (!fs.existsSync(file)) {
        const err = new Error('Workspace not found');
        err.status = 404;
        throw err;
    }
    fs.unlinkSync(file);
    return { id, deleted: true };
}

module.exports = {
    listWorkspaces,
    getWorkspace,
    createWorkspace,
    saveWorkspace,
    deleteWorkspace,
};
