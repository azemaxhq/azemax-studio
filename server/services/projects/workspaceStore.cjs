const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WORKSPACES_DIR } = require('../../config/index.cjs');

function ensureDir() {
    if (!fs.existsSync(WORKSPACES_DIR)) {
        fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
    }
}

function workspacePath(id) {
    return path.join(WORKSPACES_DIR, `${id}.json`);
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
