const express = require('express');
const cors = require('cors');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// We use python's 'pty' module as a fallback for node-pty to ensure C/C++ stdout is line-buffered

const WANDBOX_LANGUAGES = {
    'python': 'cpython-3.14.0',
    'javascript': 'nodejs-20.17.0',
    'typescript': 'typescript-5.6.2',
    'c': 'gcc-13.2.0-c',
    'cpp': 'gcc-13.2.0',
    'java': 'openjdk-jdk-22+36',
    'ruby': 'ruby-3.4.1',
    'php': 'php-8.3.12',
    'perl': 'perl-5.41.6',
    'rust': 'rust-1.82.0',
    'go': 'go-1.23.2',
    'swift': 'swift-6.0.2',
    'lua': 'lua-5.4.4',
    'bash': 'bash',
    'csharp': 'mono-6.12.0.199',
    'scala': 'scala-3.5.1',
    'r': 'r-4.4.1'
};

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = 3001;

// OpenRouter API configuration
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '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';

const AI_MODELS = [
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'nvidia/nemotron-nano-9b-v2:free',
    'liquid/lfm-2.5-1.2b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'qwen/qwen3-coder:free'
];

// ============================================================================
// Language Runtime Configuration
// ============================================================================

function findCommand(commands) {
    for (const cmd of commands) {
        try {
            const out = execSync(`which ${cmd} 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
            if (out) return out;
        } catch {
            continue;
        }
    }
    return null;
}

// Cache detected runtimes at startup
const PYTHON_CMD = findCommand(['python3', 'python']);
const NODE_CMD = findCommand(['node']);
const GCC_CMD = findCommand(['gcc']);
const GPP_CMD = findCommand(['g++']);
const JAVAC_CMD = findCommand(['javac']);
const JAVA_CMD = findCommand(['java']);
const RUBY_CMD = findCommand(['ruby']);
const PHP_CMD = findCommand(['php']);
const PERL_CMD = findCommand(['perl']);
const RUSTC_CMD = findCommand(['rustc']);
const GO_CMD = findCommand(['go']);
const SWIFT_CMD = findCommand(['swift', 'swiftc']);
const BASH_CMD = findCommand(['bash']);
const ZSH_CMD = findCommand(['zsh']);
const TSC_CMD = findCommand(['npx']); // We'll use npx tsx or ts-node

// Map of language -> execution config
function getLanguageConfig(language, filePath, tmpDir) {
    const baseName = path.basename(filePath, path.extname(filePath));
    const outputBinary = path.join(tmpDir, baseName);

    const configs = {
        'python': {
            ext: '.py',
            cmd: PYTHON_CMD,
            args: (f) => [f],
            compile: null,
        },
        'javascript': {
            ext: '.js',
            cmd: NODE_CMD,
            args: (f) => [f],
            compile: null,
        },
        'typescript': {
            ext: '.ts',
            cmd: TSC_CMD,
            args: (f) => ['tsx', f],
            compile: null,
        },
        'c': {
            ext: '.c',
            cmd: null,
            args: () => [outputBinary],
            compile: {
                cmd: GCC_CMD,
                args: (f) => [f, '-o', outputBinary, '-lm'],
            },
        },
        'cpp': {
            ext: '.cpp',
            cmd: null,
            args: () => [outputBinary],
            compile: {
                cmd: GPP_CMD,
                // Let the compiler link the C++ standard library implicitly to avoid
                // duplicate libc++ / libstdc++ warnings on some platforms.
                args: (f) => [f, '-o', outputBinary, '-lm'],
            },
        },
        'java': {
            ext: '.java',
            cmd: JAVA_CMD,
            args: () => ['-cp', tmpDir, baseName],
            compile: {
                cmd: JAVAC_CMD,
                args: (f) => [f],
            },
        },
        'ruby': {
            ext: '.rb',
            cmd: RUBY_CMD,
            args: (f) => [f],
            compile: null,
        },
        'php': {
            ext: '.php',
            cmd: PHP_CMD,
            args: (f) => [f],
            compile: null,
        },
        'perl': {
            ext: '.pl',
            cmd: PERL_CMD,
            args: (f) => [f],
            compile: null,
        },
        'rust': {
            ext: '.rs',
            cmd: null,
            args: () => [outputBinary],
            compile: {
                cmd: RUSTC_CMD,
                args: (f) => [f, '-o', outputBinary],
            },
        },
        'go': {
            ext: '.go',
            cmd: GO_CMD,
            args: (f) => ['run', f],
            compile: null,
        },
        'swift': {
            ext: '.swift',
            cmd: SWIFT_CMD,
            args: (f) => [f],
            compile: null,
        },
        'bash': {
            ext: '.sh',
            cmd: BASH_CMD,
            args: (f) => [f],
            compile: null,
        },
        'shell': {
            ext: '.sh',
            cmd: BASH_CMD,
            args: (f) => [f],
            compile: null,
        },
        'zsh': {
            ext: '.sh',
            cmd: ZSH_CMD,
            args: (f) => [f],
            compile: null,
        },
    };

    return configs[language] || null;
}

/**
 * Resolve the correct filename for the given language and code content.
 * Handles language-specific naming conventions (e.g. Java class names must match filename).
 */
function resolveFileName(language, code, ext) {
    let fileName = `main${ext || ''}`;

    switch (language) {
        case 'java': {
            // Java: class name must match filename. Match both `public class X` and `class X`
            const classMatch = code.match(/(?:public\s+)?class\s+(\w+)/);
            if (classMatch) fileName = `${classMatch[1]}.java`;
            break;
        }
        case 'kotlin': {
            // Kotlin: similar to Java, public class should match filename
            const ktClassMatch = code.match(/(?:fun\s+main|class\s+(\w+))/);
            if (ktClassMatch && ktClassMatch[1]) {
                fileName = `${ktClassMatch[1]}.kt`;
            } else {
                fileName = 'main.kt';
            }
            break;
        }
        case 'go': {
            // Go source files can be any name, but must have package main & func main
            // Ensure the code has 'package main' — inject it if missing
            if (!code.match(/^\s*package\s+main/m)) {
                // Don't modify the code, just warn — Go won't compile without it
                console.warn('[EXEC] Go code missing "package main" declaration');
            }
            fileName = 'main.go';
            break;
        }
        case 'rust': {
            // Rust: the source file name doesn't matter for single-file compilation
            fileName = 'main.rs';
            break;
        }
        case 'swift': {
            // Swift: single-file scripts can have any name
            fileName = 'main.swift';
            break;
        }
        case 'c': {
            fileName = 'main.c';
            break;
        }
        case 'cpp': {
            fileName = 'main.cpp';
            break;
        }
        case 'python': {
            // Python: filename doesn't affect execution for scripts
            fileName = 'main.py';
            break;
        }
        case 'typescript': {
            fileName = 'main.ts';
            break;
        }
        case 'javascript': {
            fileName = 'main.js';
            break;
        }
        case 'ruby': {
            fileName = 'main.rb';
            break;
        }
        case 'php': {
            fileName = 'main.php';
            break;
        }
        case 'perl': {
            fileName = 'main.pl';
            break;
        }
        case 'bash':
        case 'shell':
        case 'zsh': {
            fileName = 'main.sh';
            break;
        }
        case 'csharp': {
            fileName = 'Program.cs';
            break;
        }
        case 'scala': {
            fileName = 'Main.scala';
            break;
        }
        case 'r': {
            fileName = 'main.r';
            break;
        }
        default: {
            // Fallback: use the extension from config
            if (ext) fileName = `main${ext}`;
            break;
        }
    }

    return fileName;
}

// ============================================================================
// Stdin Detection — detect if code requires user input
// ============================================================================

function codeNeedsStdin(language, code) {
    const patterns = {
        python: /\binput\s*\(/,
        csharp: /Console\.(ReadLine|Read|ReadKey)\s*\(/,
        java: /new\s+Scanner\s*\(|System\.in|BufferedReader/,
        c: /\bscanf\s*\(|\bgets\s*\(|\bgetchar\s*\(|\bfgets\s*\(/,
        cpp: /\bcin\s*>>|\bscanf\s*\(|\bgetline\s*\(.*cin/,
        ruby: /\bgets\b|\breadline\b|\bSTDIN\./,
        go: /fmt\.Scan|bufio\.NewReader.*os\.Stdin/,
        rust: /std::io::stdin|io::stdin/,
        php: /\bfgets\s*\(\s*STDIN|\breadline\s*\(/,
        perl: /<STDIN>/,
        swift: /readLine\s*\(/,
        bash: /\bread\s/,
        scala: /scala\.io\.StdIn|readLine/,
        r: /\breadline\s*\(|\bscan\s*\(/,
        lua: /io\.read\s*\(/,
    };
    const pattern = patterns[language.toLowerCase()];
    return pattern ? pattern.test(code) : false;
}

// ============================================================================
// Code Execution Engine (Interactive WebSocket)
// ============================================================================

const http = require('http');
const WebSocket = require('ws');
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    let activeProcess = null;
    let tmpDir = null;
    let pendingWandbox = null; // Stores pending Wandbox execution waiting for stdin

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());

            if (data.action === 'kill') {
                if (activeProcess && !activeProcess.killed) activeProcess.kill('SIGKILL');
                return;
            }

            if (data.action === 'input' || data.action === 'terminal:data') {
                if (activeProcess) {
                    if (activeProcess.write) {
                        activeProcess.write(data.data);
                    } else if (activeProcess.stdin) {
                        activeProcess.stdin.write(data.data.replace(/\r/g, '\n'));
                    }
                }
                return;
            }

            // Handle stdin collected from frontend for Wandbox execution
            if (data.action === 'stdin-ready') {
                if (pendingWandbox) {
                    const pending = pendingWandbox;
                    pendingWandbox = null;
                    pending.stdinData = data.data || '';
                    pending.execute();
                }
                return;
            }

            if (data.action === 'execute') {
                const { language, files, stdinInput } = data;
                if (!language || !files || !files.length) {
                    ws.send(JSON.stringify({ type: 'error', data: 'Language and files required\r\n' }));
                    ws.send(JSON.stringify({ type: 'exit', code: 1 }));
                    return;
                }

                const code = files[0].content || '';
                tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderun-ws-'));

                // Get initial config to determine if we can run locally at all before parsing names
                let initialConfig = getLanguageConfig(language, path.join(tmpDir, 'main'), tmpDir);

                const cleanup = () => {
                    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { }
                };

                const runViaWandbox = (stdinData = '') => {
                    const langKey = language.toLowerCase();
                    const compilerId = WANDBOX_LANGUAGES[langKey];

                    if (!compilerId) {
                        cleanup();
                        ws.send(JSON.stringify({ type: 'error', data: `Unsupported language: ${language}\r\n` }));
                        ws.send(JSON.stringify({ type: 'exit', code: 1 }));
                        return;
                    }

                    const postData = JSON.stringify({
                        compiler: compilerId,
                        code: code,
                        stdin: stdinData
                    });

                    // Use the streaming ndjson endpoint for real-time output
                    const reqApi = https.request(
                        'https://wandbox.org/api/compile.ndjson',
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength(postData)
                            }
                        },
                        (resApi) => {
                            let exitCode = 0;
                            let buffer = '';

                            resApi.on('data', (chunk) => {
                                buffer += chunk.toString();
                                // Process complete lines (ndjson = one JSON object per line)
                                const lines = buffer.split('\n');
                                buffer = lines.pop() || ''; // Keep incomplete last line in buffer

                                for (const line of lines) {
                                    const trimmed = line.trim();
                                    if (!trimmed) continue;
                                    try {
                                        const obj = JSON.parse(trimmed);
                                        if (obj.type === 'StdOut') {
                                            ws.send(JSON.stringify({ type: 'stdout', data: obj.data }));
                                        } else if (obj.type === 'StdErr') {
                                            ws.send(JSON.stringify({ type: 'stderr', data: obj.data }));
                                        } else if (obj.type === 'CompilerMessageS' || obj.type === 'CompilerMessageE') {
                                            if (obj.data) ws.send(JSON.stringify({ type: 'stderr', data: obj.data }));
                                        } else if (obj.type === 'ExitCode') {
                                            exitCode = parseInt(obj.data) || 0;
                                        } else if (obj.type === 'Signal') {
                                            ws.send(JSON.stringify({ type: 'stderr', data: `Signal: ${obj.data}\r\n` }));
                                        }
                                    } catch (e) { /* skip malformed lines */ }
                                }
                            });

                            resApi.on('end', () => {
                                cleanup();
                                // Process any remaining buffered data
                                if (buffer.trim()) {
                                    try {
                                        const obj = JSON.parse(buffer.trim());
                                        if (obj.type === 'ExitCode') exitCode = parseInt(obj.data) || 0;
                                        else if (obj.type === 'StdOut') ws.send(JSON.stringify({ type: 'stdout', data: obj.data }));
                                        else if (obj.type === 'StdErr') ws.send(JSON.stringify({ type: 'stderr', data: obj.data }));
                                    } catch (e) { }
                                }
                                ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
                            });
                        }
                    );

                    reqApi.on('error', (e) => {
                        cleanup();
                        ws.send(JSON.stringify({ type: 'error', data: `Wandbox API error: ${e.message}\r\n` }));
                        ws.send(JSON.stringify({ type: 'exit', code: 1 }));
                    });

                    reqApi.write(postData);
                    reqApi.end();
                };

                if (!initialConfig || (!initialConfig.cmd && (!initialConfig.compile || !initialConfig.compile.cmd))) {
                    if (stdinInput) {
                        runViaWandbox(stdinInput);
                        return;
                    }

                    // Check if code needs stdin — if so, prompt user first
                    if (codeNeedsStdin(language, code)) {
                        pendingWandbox = {
                            stdinData: '',
                            execute: function () {
                                runViaWandbox(this.stdinData);
                            }
                        };
                        ws.send(JSON.stringify({ type: 'stdin-prompt' }));
                    } else {
                        runViaWandbox();
                    }
                    return;
                }

                let fileName = resolveFileName(language, code, initialConfig.ext);

                const filePath = path.join(tmpDir, fileName);
                fs.writeFileSync(filePath, code);

                // Fetch true config now that we know the exact output name (this fixes java public class loads)
                const config = getLanguageConfig(language, filePath, tmpDir);

                const runWithSpawn = async () => {
                    try {
                        if (config.compile) {
                            if (!config.compile.cmd) {
                                runViaWandbox(stdinInput || '');
                                return;
                            }

                            await new Promise((resolve, reject) => {
                                const compProc = spawn(config.compile.cmd, config.compile.args(filePath), { cwd: tmpDir });

                                const compTimer = setTimeout(() => {
                                    if (!compProc.killed) compProc.kill('SIGKILL');
                                    reject(new Error('Compilation timed out'));
                                }, 30000); // 30 second timeout for compile

                                compProc.stdout.on('data', d => ws.send(JSON.stringify({ type: 'stdout', data: d.toString() })));
                                compProc.stderr.on('data', d => ws.send(JSON.stringify({ type: 'stderr', data: d.toString() })));
                                compProc.on('error', err => {
                                    clearTimeout(compTimer);
                                    reject(err);
                                });
                                compProc.on('close', code => {
                                    clearTimeout(compTimer);
                                    if (code === 0) resolve();
                                    else reject(new Error(`Compilation failed with code ${code}`));
                                });
                            });
                        }

                        const runCmd = config.compile ? (config.cmd || config.args()[0]) : config.cmd;
                        let runArgs = config.compile && !config.cmd ? config.args().slice(1) : (config.compile ? config.args() : config.args(filePath));

                        if (language.toLowerCase() === 'python' && runCmd.includes('python')) {
                            runArgs = ['-u', ...runArgs];
                        }

                        if (!runCmd) {

                            runViaWandbox(stdinInput || '');
                            return;
                        }

                        let timer;
                        let finalCmd = runCmd;
                        let finalArgs = runArgs;

                        // We use python's 'pty' module as a fallback for node-pty to ensure C/C++ stdout is line-buffered.
                        // Standard interactive terminal programs expect the PTY to echo characters back.
                        // Since we removed local echo from the frontend (to prevent duplicate characters),
                        // we must let the backend PTY handle echoing natively for ALL languages.
                        if (PYTHON_CMD) {
                            finalCmd = PYTHON_CMD;
                            finalArgs = ['-c', `import pty, sys; sys.exit(pty.spawn(${JSON.stringify([runCmd, ...runArgs])}))`];
                        }

                        activeProcess = spawn(finalCmd, finalArgs, { cwd: tmpDir });

                        // Pass pre-provided stdin immediately to the local process
                        if (stdinInput && activeProcess.stdin) {
                            activeProcess.stdin.write(stdinInput.endsWith('\n') ? stdinInput : stdinInput + '\n');
                        }

                        activeProcess.stdout.on('data', d => ws.send(JSON.stringify({ type: 'stdout', data: d.toString() })));
                        activeProcess.stderr.on('data', d => ws.send(JSON.stringify({ type: 'stderr', data: d.toString() })));

                        activeProcess.on('error', err => {
                            ws.send(JSON.stringify({ type: 'error', data: `Execution error: ${err.message}\r\n` }));
                        });

                        activeProcess.on('close', code => {
                            clearTimeout(timer);
                            cleanup();
                            ws.send(JSON.stringify({ type: 'exit', code: code || 0 }));
                            activeProcess = null;
                        });

                        timer = setTimeout(() => {
                            if (activeProcess) {
                                if (activeProcess.kill) activeProcess.kill('SIGKILL');
                            }
                            ws.send(JSON.stringify({ type: 'error', data: '\r\nExecution timed out\r\n' }));
                        }, 60000);

                    } catch (e) {
                        console.error('[EXEC][WS] Local execution failed, attempting Wandbox fallback if available:', e);
                        runViaWandbox(stdinInput || '');
                    }
                };

                runWithSpawn();
            }


        } catch (err) {
            console.error('WebSocket message parsing error:', err);
        }
    });

    ws.on('close', () => {
        if (activeProcess && !activeProcess.killed) {
            activeProcess.kill('SIGKILL');
        }
        if (tmpDir) {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { }
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket connection error:', err);
    });
});

// ============================================================================
// API Endpoints
// ============================================================================

// AI Chat endpoint
app.post('/api/ai/chat', async (req, res) => {
    console.log('[AI] /api/ai/chat called');

    const { messages, model } = req.body;

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Messages array is required' });
    }

    const modelsToTry = model ? [model] : AI_MODELS;
    let lastError = null;

    for (const currentModel of modelsToTry) {
        try {
            console.log(`[AI] Trying model: ${currentModel}`);

            const response = await fetch(OPENROUTER_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'HTTP-Referer': 'http://localhost:5173',
                    'X-Title': 'AI Code Editor'
                },
                body: JSON.stringify({
                    model: currentModel,
                    messages: messages,
                    temperature: 0.1,
                    max_tokens: 2000
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[AI] ${currentModel} failed with status ${response.status}:`, errorText);
                lastError = `${currentModel}: ${response.status} - ${errorText}`;
                continue;
            }

            const data = await response.json();
            console.log('[AI] Success! Response received');
            return res.json(data);

        } catch (error) {
            console.error(`[AI] ${currentModel} error:`, error.message);
            lastError = error.message;
            continue;
        }
    }

    console.error('[AI] All models failed. Last error:', lastError);
    res.status(500).json({
        error: 'All AI models failed',
        details: lastError
    });
});

// List available runtimes (detected locally)
app.get('/api/runtimes', (req, res) => {
    const runtimes = [];
    const checks = [
        { language: 'python', cmd: PYTHON_CMD },
        { language: 'javascript', cmd: NODE_CMD },
        { language: 'typescript', cmd: TSC_CMD ? 'npx tsx' : null },
        { language: 'c', cmd: GCC_CMD },
        { language: 'cpp', cmd: GPP_CMD },
        { language: 'java', cmd: JAVAC_CMD && JAVA_CMD ? JAVAC_CMD : null },
        { language: 'ruby', cmd: RUBY_CMD },
        { language: 'php', cmd: PHP_CMD },
        { language: 'perl', cmd: PERL_CMD },
        { language: 'rust', cmd: RUSTC_CMD },
        { language: 'go', cmd: GO_CMD },
        { language: 'swift', cmd: SWIFT_CMD },
        { language: 'bash', cmd: BASH_CMD },
        { language: 'csharp', cmd: 'wandbox' },
        { language: 'scala', cmd: 'wandbox' },
        { language: 'r', cmd: 'wandbox' },
        { language: 'lua', cmd: 'wandbox' },
    ];

    for (const { language, cmd } of checks) {
        if (cmd) {
            runtimes.push({ language, runtime: cmd, version: '*' });
        }
    }

    res.json(runtimes);
});

// HTTP Execution Endpoint
app.post('/execute', async (req, res) => {
    const { language, files, stdin } = req.body;

    if (!language || !files || !files.length) {
        return res.status(400).json({ run: { stdout: '', stderr: 'Language and files required', code: 1 } });
    }

    console.log(`[EXEC] Running ${language} via HTTP Execute...`);
    const code = files[0].content || '';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderun-http-'));

    const cleanup = () => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { }
    };

    let initialConfig = getLanguageConfig(language, path.join(tmpDir, 'main'), tmpDir);
    let useWandbox = false;

    if (!initialConfig || (!initialConfig.cmd && (!initialConfig.compile || !initialConfig.compile.cmd))) {
        if (WANDBOX_LANGUAGES[language.toLowerCase()]) {
            useWandbox = true;
        } else {
            cleanup();
            return res.json({ run: { stdout: '', stderr: `Unsupported language: ${language}`, code: 1 } });
        }
    }

    if (useWandbox) {
        console.log(`[EXEC] Executing via Wandbox API for ${language}...`);
        const postData = JSON.stringify({
            compiler: WANDBOX_LANGUAGES[language.toLowerCase()],
            code: code,
            stdin: stdin || ''
        });

        const reqApi = https.request('https://wandbox.org/api/compile.json', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (resApi) => {
            let responseData = '';
            resApi.on('data', chunk => responseData += chunk);
            resApi.on('end', () => {
                cleanup();
                try {
                    const parsed = JSON.parse(responseData);
                    res.json({
                        run: {
                            stdout: parsed.program_message || '',
                            stderr: (parsed.compiler_message || '') + (parsed.program_error || ''),
                            code: parseInt(parsed.status) || 0
                        }
                    });
                } catch (e) {
                    res.json({ run: { stdout: '', stderr: 'Failed to parse Wandbox response', code: 1 } });
                }
            });
        });

        reqApi.on('error', (e) => {
            cleanup();
            res.json({ run: { stdout: '', stderr: `Wandbox API error: ${e.message}`, code: 1 } });
        });

        reqApi.write(postData);
        reqApi.end();
        return;
    }

    let fileName = resolveFileName(language, code, initialConfig ? initialConfig.ext : '');

    const filePath = path.join(tmpDir, fileName);
    fs.writeFileSync(filePath, code);

    // Fetch config again now with the correct output name parameter for Java
    const config = getLanguageConfig(language, filePath, tmpDir);

    const runCommandWithSpawn = (cmd, args, timeout = 60000) => {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            const proc = spawn(cmd, args, { cwd: tmpDir });

            const timer = setTimeout(() => {
                proc.kill('SIGKILL');
                stderr += '\nExecution timed out';
            }, timeout);

            proc.stdout.on('data', data => stdout += data.toString());
            proc.stderr.on('data', data => stderr += data.toString());

            proc.on('error', err => {
                stderr += `\nSpawn error: ${err.message}`;
                resolve({ stdout, stderr, code: 1 });
            });

            if (stdin) proc.stdin.write(stdin);

            proc.on('close', code => {
                clearTimeout(timer);
                resolve({ stdout, stderr, code: code || 0 });
            });
        });
    };

    try {
        if (config.compile) {
            if (!config.compile.cmd) {
                cleanup();
                return res.json({ run: { stdout: '', stderr: `Compiler not installed.`, code: 1 } });
            }
            const compileResult = await runCommandWithSpawn(config.compile.cmd, config.compile.args(filePath), 30000);
            if (compileResult.code !== 0) {
                cleanup();
                return res.json({ run: compileResult });
            }
        }

        const runCmd = config.compile ? (config.cmd || config.args()[0]) : config.cmd;
        let runArgs = config.compile && !config.cmd ? config.args().slice(1) : (config.compile ? config.args() : config.args(filePath));

        if (!runCmd) {
            cleanup();
            return res.json({ run: { stdout: '', stderr: `Interpreter not installed.`, code: 1 } });
        }

        const result = await runCommandWithSpawn(runCmd, runArgs, 60000);
        cleanup();
        res.json({ run: result });
    } catch (err) {
        cleanup();
        res.json({ run: { stdout: '', stderr: err.message, code: 1 } });
    }
});

// ============================================================================
// Server Startup
// ============================================================================

server.listen(PORT, () => {
    console.log(`\n🚀 Code execution WebSocket & API server running on port ${PORT}\n`);
});
