const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { RUNTIMES } = require('./runtimeDetection.cjs');
const { getLanguageConfig } = require('./languageConfig.cjs');
const { resolveFileName } = require('./fileNaming.cjs');
const { EXECUTION_TIMEOUT_MS, COMPILE_TIMEOUT_MS } = require('./constants.cjs');

const MAX_OUTPUT_BYTES = Number(process.env.MAX_OUTPUT_BYTES) || 512 * 1024; // 512KB cap

function runCommand(cmd, args, { cwd, stdin, timeout = EXECUTION_TIMEOUT_MS }) {
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let truncated = false;
        const proc = spawn(cmd, args, { cwd });

        const timer = setTimeout(() => {
            if (!proc.killed) proc.kill('SIGKILL');
            stderr += '\nExecution timed out';
        }, timeout);

        function append(target, chunk) {
            const str = chunk.toString();
            if (target === 'stdout') {
                if (Buffer.byteLength(stdout, 'utf8') + Buffer.byteLength(str, 'utf8') > MAX_OUTPUT_BYTES) {
                    if (!truncated) {
                        stdout += '\n[output truncated — exceeds limit]';
                        truncated = true;
                    }
                    return;
                }
                stdout += str;
            } else {
                if (Buffer.byteLength(stderr, 'utf8') + Buffer.byteLength(str, 'utf8') > MAX_OUTPUT_BYTES) {
                    if (!truncated) {
                        stderr += '\n[output truncated — exceeds limit]';
                        truncated = true;
                    }
                    return;
                }
                stderr += str;
            }
        }
        proc.stdout.on('data', (d) => append('stdout', d));
        proc.stderr.on('data', (d) => append('stderr', d));

        proc.on('error', (err) => {
            clearTimeout(timer);
            resolve({ stdout, stderr: `${stderr}\nSpawn error: ${err.message}`, code: 1 });
        });

        if (stdin && proc.stdin) {
            proc.stdin.write(stdin);
            proc.stdin.end();
        }

        proc.on('close', (code) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, code: code || 0 });
        });
    });
}

async function executeLocally({ language, code, stdin = '', filename = null }) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderun-http-'));

    const cleanup = () => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    };

    try {
        const initialConfig = getLanguageConfig(language, path.join(tmpDir, 'main'), tmpDir);
        if (!initialConfig) {
            throw new Error(`Unsupported language: ${language}`);
        }

        const fileName = resolveFileName(language, code, initialConfig.ext, filename);
        const filePath = path.join(tmpDir, fileName);
        fs.writeFileSync(filePath, code);

        const config = getLanguageConfig(language, filePath, tmpDir);

        if (config.compile) {
            if (!config.compile.cmd) {
                throw new Error('Compiler not installed locally');
            }
            const compileResult = await runCommand(
                config.compile.cmd,
                config.compile.args(filePath),
                { cwd: tmpDir, timeout: COMPILE_TIMEOUT_MS },
            );
            if (compileResult.code !== 0) {
                return compileResult;
            }
        }

        const runCmd = config.compile ? (config.cmd || config.args()[0]) : config.cmd;
        const runArgs = config.compile && !config.cmd
            ? config.args().slice(1)
            : (config.compile ? config.args() : config.args(filePath));

        if (!runCmd) {
            throw new Error('Interpreter not installed locally');
        }

        if (language.toLowerCase() === 'python' && runCmd.includes('python')) {
            runArgs.unshift('-u');
        }

        return await runCommand(runCmd, runArgs, { cwd: tmpDir, stdin });
    } finally {
        cleanup();
    }
}

/** Spawn with optional Python PTY wrapper for line-buffered interactive output */
function spawnWithPty(cmd, args, options) {
    if (RUNTIMES.python) {
        return spawn(
            RUNTIMES.python,
            ['-c', `import pty, sys; sys.exit(pty.spawn(${JSON.stringify([cmd, ...args])}))`],
            options,
        );
    }
    return spawn(cmd, args, options);
}

module.exports = {
    executeLocally,
    runCommand,
    spawnWithPty,
};
