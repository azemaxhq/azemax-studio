const https = require('https');
const { getWandboxLanguage, WANDBOX_LANGUAGES } = require('./constants.cjs');
const { LIMITS } = require('../../config/index.cjs');

// Hard timeout so a hung third-party API can never hold a socket/promise
// forever (previously: no timeout at all). Response bodies are capped so a
// hostile compiler response cannot exhaust server memory.
const WANDBOX_TIMEOUT_MS = LIMITS.WANDBOX_TIMEOUT_MS;
const WANDBOX_MAX_BODY_BYTES = 2 * 1024 * 1024;
const WANDBOX_MAX_LINE_BYTES = 64 * 1024;

function buildWandboxPayload(compilerId, language, code, stdin, filename) {
    const lang = String(language).toLowerCase();
    if (lang === 'java') {
        // Resolve safe Java filename: public type takes precedence, otherwise sanitized editor filename
        const { resolveJavaFileName } = require('./fileNaming.cjs');
        const effective = resolveJavaFileName(code, filename);
        // Wandbox's main file is prog.java; to support public class filename matching we send
        // the user code as a correctly-named file via `codes` and compile that file explicitly.
        // Empty main `code` avoids public-class mismatch in prog.java.
        return {
            compiler: compilerId,
            code: '',
            codes: [{ file: effective, code }],
            stdin,
            'compiler-option-raw': effective,
        };
    }
    return {
        compiler: compilerId,
        code,
        stdin,
    };
}

function compileViaWandbox({ language, code, stdin = '', filename = null }) {
    const compilerId = getWandboxLanguage(language);
    if (!compilerId) {
        return Promise.reject(new Error(`Unsupported language for Wandbox: ${language}`));
    }

    const payload = buildWandboxPayload(compilerId, language, code, stdin, filename);
    const postData = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (fn, arg) => { if (!settled) { settled = true; clearTimeout(timer); fn(arg); } };
        const timer = setTimeout(() => {
            try { req.destroy(new Error('Wandbox request timed out')); } catch { /* ignore */ }
            done(reject, new Error('Wandbox request timed out'));
        }, WANDBOX_TIMEOUT_MS);
        if (timer.unref) timer.unref();
        const req = https.request(
            'https://wandbox.org/api/compile.json',
            {
                method: 'POST',
                timeout: WANDBOX_TIMEOUT_MS,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                },
            },
            (res) => {
                let body = '';
                let bodyBytes = 0;
                res.on('data', (chunk) => {
                    bodyBytes += chunk.length;
                    if (bodyBytes > WANDBOX_MAX_BODY_BYTES) {
                        try { req.destroy(new Error('Wandbox response too large')); } catch { /* ignore */ }
                        done(reject, new Error('Wandbox response too large'));
                        return;
                    }
                    body += chunk;
                });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        done(resolve, {
                            stdout: parsed.program_message || '',
                            stderr: `${parsed.compiler_message || ''}${parsed.program_error || ''}`,
                            code: parseInt(parsed.status, 10) || 0,
                        });
                    } catch (_e) {
                        done(reject, new Error('Failed to parse Wandbox response'));
                    }
                });
            },
        );

        req.on('timeout', () => {
            try { req.destroy(new Error('Wandbox request timed out')); } catch { /* ignore */ }
            done(reject, new Error('Wandbox request timed out'));
        });
        req.on('error', (err) => done(reject, err));
        req.write(postData);
        req.end();
    });
}

function streamViaWandbox({ language, code, stdin = '', filename = null, onEvent, signal = null }) {
    const compilerId = getWandboxLanguage(language);
    if (!compilerId) {
        onEvent({ type: 'error', data: `Unsupported language: ${language}\r\n` });
        onEvent({ type: 'exit', code: 1 });
        return Promise.resolve();
    }
    if (signal && signal.aborted) {
        onEvent({ type: 'error', data: 'Execution cancelled\r\n' });
        onEvent({ type: 'exit', code: 1 });
        return Promise.resolve();
    }

    const payload = buildWandboxPayload(compilerId, language, code, stdin, filename);
    const postData = JSON.stringify(payload);

    return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        let req = null;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onAbort);
        };

        const finish = (exitCode) => {
            if (settled) return;
            settled = true;
            cleanup();
            onEvent({ type: 'exit', code: exitCode });
            resolve();
        };

        const fail = (message, exitCode = 1) => {
            if (settled) return;
            settled = true;
            cleanup();
            try { if (req) req.destroy(new Error('Wandbox stream ended')); } catch { /* ignore */ }
            onEvent({ type: 'error', data: message });
            onEvent({ type: 'exit', code: exitCode });
            resolve();
        };

        const onAbort = () => fail('Execution cancelled\r\n', 1);
        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        timer = setTimeout(() => fail('Wandbox request timed out\r\n', 1), WANDBOX_TIMEOUT_MS);
        if (timer.unref) timer.unref();

        req = https.request(
            'https://wandbox.org/api/compile.ndjson',
            {
                method: 'POST',
                timeout: WANDBOX_TIMEOUT_MS,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                },
            },
            (res) => {
                let exitCode = 0;
                let buffer = '';
                let bodyBytes = 0;

                res.on('data', (chunk) => {
                    if (settled) return;
                    bodyBytes += chunk.length;
                    if (bodyBytes > WANDBOX_MAX_BODY_BYTES) {
                        fail('Wandbox response too large\r\n', 1);
                        return;
                    }
                    buffer += chunk.toString();
                    // A hostile/broken upstream can send an unterminated line
                    // forever; bound the partial-line buffer too.
                    if (buffer.length > WANDBOX_MAX_LINE_BYTES && !buffer.includes('\n')) {
                        fail('Wandbox response line too long\r\n', 1);
                        return;
                    }
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    if (buffer.length > WANDBOX_MAX_LINE_BYTES) {
                        fail('Wandbox response line too long\r\n', 1);
                        return;
                    }

                    for (const line of lines) {
                        if (line.length > WANDBOX_MAX_LINE_BYTES) {
                            fail('Wandbox response line too long\r\n', 1);
                            return;
                        }
                        const trimmed = line.trim();
                        if (!trimmed) continue;
                        try {
                            const obj = JSON.parse(trimmed);
                            if (obj.type === 'StdOut') onEvent({ type: 'stdout', data: obj.data });
                            else if (obj.type === 'StdErr') onEvent({ type: 'stderr', data: obj.data });
                            else if (obj.type === 'CompilerMessageS' || obj.type === 'CompilerMessageE') {
                                if (obj.data) onEvent({ type: 'stderr', data: obj.data });
                            } else if (obj.type === 'ExitCode') {
                                exitCode = parseInt(obj.data, 10) || 0;
                            } else if (obj.type === 'Signal') {
                                onEvent({ type: 'stderr', data: `Signal: ${obj.data}\r\n` });
                            }
                        } catch {
                            /* skip malformed ndjson line */
                        }
                    }
                });

                res.on('end', () => {
                    if (settled) return;
                    if (buffer.trim()) {
                        try {
                            const obj = JSON.parse(buffer.trim());
                            if (obj.type === 'ExitCode') exitCode = parseInt(obj.data, 10) || 0;
                            else if (obj.type === 'StdOut') onEvent({ type: 'stdout', data: obj.data });
                            else if (obj.type === 'StdErr') onEvent({ type: 'stderr', data: obj.data });
                        } catch {
                            /* ignore */
                        }
                    }
                    finish(exitCode);
                });
            },
        );

        req.on('timeout', () => fail('Wandbox request timed out\r\n', 1));

        req.on('error', (err) => {
            if (settled) return;
            fail(`Wandbox API error: ${err.message}\r\n`, 1);
        });

        req.write(postData);
        req.end();
    });
}

module.exports = { compileViaWandbox, streamViaWandbox, WANDBOX_LANGUAGES };
