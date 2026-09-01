const https = require('https');
const { WANDBOX_LANGUAGES } = require('./constants.cjs');

function compileViaWandbox({ language, code, stdin = '' }) {
    const compilerId = WANDBOX_LANGUAGES[language.toLowerCase()];
    if (!compilerId) {
        return Promise.reject(new Error(`Unsupported language for Wandbox: ${language}`));
    }

    const postData = JSON.stringify({
        compiler: compilerId,
        code,
        stdin,
    });

    return new Promise((resolve, reject) => {
        const req = https.request(
            'https://wandbox.org/api/compile.json',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                },
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        resolve({
                            stdout: parsed.program_message || '',
                            stderr: `${parsed.compiler_message || ''}${parsed.program_error || ''}`,
                            code: parseInt(parsed.status, 10) || 0,
                        });
                    } catch (_e) {
                        reject(new Error('Failed to parse Wandbox response'));
                    }
                });
            },
        );

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

function streamViaWandbox({ language, code, stdin = '', onEvent }) {
    const compilerId = WANDBOX_LANGUAGES[language.toLowerCase()];
    if (!compilerId) {
        onEvent({ type: 'error', data: `Unsupported language: ${language}\r\n` });
        onEvent({ type: 'exit', code: 1 });
        return Promise.resolve();
    }

    const postData = JSON.stringify({ compiler: compilerId, code, stdin });

    return new Promise((resolve, reject) => {
        const req = https.request(
            'https://wandbox.org/api/compile.ndjson',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                },
            },
            (res) => {
                let exitCode = 0;
                let buffer = '';

                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
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
                    onEvent({ type: 'exit', code: exitCode });
                    resolve();
                });
            },
        );

        req.on('error', (err) => {
            onEvent({ type: 'error', data: `Wandbox API error: ${err.message}\r\n` });
            onEvent({ type: 'exit', code: 1 });
            reject(err);
        });

        req.write(postData);
        req.end();
    });
}

module.exports = { compileViaWandbox, streamViaWandbox, WANDBOX_LANGUAGES };
