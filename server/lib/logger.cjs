/**
 * Minimal structured JSON logger (zero dependencies).
 *
 * - Emits one JSON object per line: { ts, level, msg, reqId, ...fields }
 * - NEVER logs secret values: keys matching sensitive patterns are redacted,
 *   and long random-looking tokens are masked even under unknown key names.
 * - Request bodies / user code / AI context are never logged wholesale —
 *   pass explicit scalar summaries (lengths, counts) instead.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const ACTIVE_LEVEL = LEVELS[(process.env.LOG_LEVEL || '').toLowerCase()] ?? (process.env.NODE_ENV === 'production' ? 20 : 10);

const SENSITIVE_KEY_RE = /api[_-]?key|apikey|secret|token|password|passwd|pwd|authorization|cookie|session|bearer|private[_-]?key|client[_-]?secret/i;

// ID-shaped values (UUIDs, request ids) are correlation metadata, NOT secrets —
// never redact them, or logs become unjoinable. Only random-looking tokens
// under sensitive key names (or unknown keys) are masked.
const ID_KEY_RE = /^(reqId|requestId|userId|user_id|sessionId|id|projectId|day)$/i;
const ID_VALUE_RE = /^[0-9a-fA-F-]{36}$|^[A-Za-z0-9_-]{8,64}$/;

function redactValue(key, value) {
    if (typeof key === 'string' && SENSITIVE_KEY_RE.test(key)) return '[redacted]';
    if (typeof value !== 'string') return value;
    const v = value.trim();
    if (typeof key === 'string' && ID_KEY_RE.test(key) && ID_VALUE_RE.test(v)) return value;
    if (/^(sk-|gsk_|hf_|nvapi-|eyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9]{40,})$/.test(v)) {
        return '[redacted-token]';
    }
    return value;
}

function sanitize(fields) {
    if (!fields || typeof fields !== 'object') return fields;
    if (Array.isArray(fields)) return fields.map((v) => sanitize(v));
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
        if (v !== null && typeof v === 'object') out[k] = sanitize(v);
        else out[k] = redactValue(k, v);
    }
    return out;
}

function emit(level, msg, fields) {
    if (LEVELS[level] < ACTIVE_LEVEL) return;
    const line = { ts: new Date().toISOString(), level, msg, ...sanitize(fields) };
    const text = JSON.stringify(line);
    if (level === 'error' || level === 'warn') process.stderr.write(text + '\n');
    else process.stdout.write(text + '\n');
}

function child(bindings) {
    return {
        debug: (msg, fields) => emit('debug', msg, { ...bindings, ...fields }),
        info: (msg, fields) => emit('info', msg, { ...bindings, ...fields }),
        warn: (msg, fields) => emit('warn', msg, { ...bindings, ...fields }),
        error: (msg, fields) => emit('error', msg, { ...bindings, ...fields }),
    };
}

module.exports = {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child,
    sanitize,
};
