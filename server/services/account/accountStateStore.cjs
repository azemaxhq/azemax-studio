/**
 * Account-scoped synced state — settings, AI chat history, and future small
 * account documents.
 *
 * Security model:
 *  - The owner is ALWAYS supplied by the caller from `req.user.id` (verified
 *    Firebase identity). It is never read from the request body.
 *  - Section names are a closed allowlist; arbitrary keys cannot be created.
 *  - Each section is an opaque JSON object with a hard byte cap. The cap is
 *    enforced after serialization so deeply nested payloads cannot bypass it.
 *
 * Why a separate table instead of reusing `projects`: workspaces are
 * tree-shaped, quota-indexed and have their own API. Settings and chats are
 * small, whole-document values with last-writer-wins semantics. Keeping them
 * out of `projects` avoids polluting workspace quotas and keeps the project
 * store focused.
 */
const { getDb, nowIso } = require('../../db/index.cjs');
const { LIMITS } = require('../../config/index.cjs');

const SECTION_LIMITS = Object.freeze({
    settings: LIMITS.MAX_ACCOUNT_SETTINGS_BYTES,
    chats: LIMITS.MAX_ACCOUNT_CHATS_BYTES,
});

const SECTION_NAMES = Object.freeze(Object.keys(SECTION_LIMITS));

function error(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function validateSection(section) {
    if (typeof section !== 'string' || !Object.prototype.hasOwnProperty.call(SECTION_LIMITS, section)) {
        throw error(400, 'Unknown account state section');
    }
    return section;
}

function serialize(data, section) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw error(400, 'Account state must be a JSON object');
    }
    let json;
    try {
        json = JSON.stringify(data);
    } catch {
        throw error(400, 'Account state is not serializable');
    }
    const bytes = Buffer.byteLength(json, 'utf8');
    if (bytes > SECTION_LIMITS[section]) {
        throw error(413, `Account state exceeds the ${SECTION_LIMITS[section]}-byte limit`);
    }
    return json;
}

function rowToSection(row) {
    if (!row) return null;
    try {
        return { data: JSON.parse(row.data_json), updatedAt: row.updated_at };
    } catch {
        return null;
    }
}

function listState(ownerId) {
    const db = getDb();
    const rows = db.prepare(
        'SELECT section, data_json, updated_at FROM account_state WHERE user_id = ?',
    ).all(ownerId);
    const sections = {};
    for (const row of rows) {
        const parsed = rowToSection(row);
        if (parsed) sections[row.section] = parsed;
    }
    return { sections };
}

function getSection(ownerId, section) {
    const name = validateSection(section);
    const db = getDb();
    const row = db.prepare(
        'SELECT section, data_json, updated_at FROM account_state WHERE user_id = ? AND section = ?',
    ).get(ownerId, name);
    const parsed = rowToSection(row);
    return parsed ? { section: name, ...parsed } : { section: name, data: null, updatedAt: null };
}

function saveSection(ownerId, section, data) {
    const name = validateSection(section);
    const json = serialize(data, name);
    const now = nowIso();
    const db = getDb();
    db.prepare(
        `INSERT INTO account_state (user_id, section, data_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, section) DO UPDATE SET
             data_json = excluded.data_json,
             updated_at = excluded.updated_at`,
    ).run(ownerId, name, json, now);
    return { section: name, data, updatedAt: now };
}

function deleteSection(ownerId, section) {
    const name = validateSection(section);
    const db = getDb();
    const result = db.prepare(
        'DELETE FROM account_state WHERE user_id = ? AND section = ?',
    ).run(ownerId, name);
    return { section: name, deleted: result.changes > 0 };
}

module.exports = {
    SECTION_NAMES,
    validateSection,
    listState,
    getSection,
    saveSection,
    deleteSection,
};
