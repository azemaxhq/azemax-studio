const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { getLanguageConfig, canRunLocally } = require('../services/execution/languageConfig.cjs');
const { resolveFileName, codeNeedsStdin } = require('../services/execution/fileNaming.cjs');
const { spawnWithPty } = require('../services/execution/localExecutor.cjs');
const { streamViaWandbox, WANDBOX_LANGUAGES } = require('../services/execution/wandboxExecutor.cjs');
const { EXECUTION_TIMEOUT_MS, COMPILE_TIMEOUT_MS } = require('../services/execution/constants.cjs');

function attachExecutionWebSocket(wss) {
    wss.on('connection', (ws) => {
        let activeProcess = null;
        let tmpDir = null;
        let pendingWandbox = null;

        const send = (payload) => {
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify(payload));
            }
        };

        const cleanup = () => {
            if (tmpDir) {
                try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
                tmpDir = null;
            }
        };

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

                if (data.action === 'stdin-ready') {
                    if (pendingWandbox) {
                        const pending = pendingWandbox;
                        pendingWandbox = null;
                        pending.stdinData = data.data || '';
                        pending.execute();
                    }
                    return;
                }

                if (data.action !== 'execute') return;

                const { language, files, stdinInput } = data;
                if (!language || !files?.length) {
                    send({ type: 'error', data: 'Language and files required\r\n' });
                    send({ type: 'exit', code: 1 });
                    return;
                }

                const code = files[0].content || '';
                const lang = language.toLowerCase();
                tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderun-ws-'));

                const runViaWandbox = (stdinData = '') => {
                    if (!WANDBOX_LANGUAGES[lang]) {
                        cleanup();
                        send({ type: 'error', data: `Unsupported language: ${language}\r\n` });
                        send({ type: 'exit', code: 1 });
                        return;
                    }

                    streamViaWandbox({
                        language: lang,
                        code,
                        stdin: stdinData,
                        onEvent: (event) => {
                            if (event.type === 'exit') {
                                cleanup();
                            }
                            send(event);
                        },
                    }).catch(() => {
                        cleanup();
                    });
                };

                const initialConfig = getLanguageConfig(lang, path.join(tmpDir, 'main'), tmpDir);

                if (!canRunLocally(initialConfig)) {
                    if (stdinInput) {
                        runViaWandbox(stdinInput);
                        return;
                    }
                    if (codeNeedsStdin(lang, code)) {
                        pendingWandbox = {
                            stdinData: '',
                            execute() { runViaWandbox(this.stdinData); },
                        };
                        send({ type: 'stdin-prompt' });
                    } else {
                        runViaWandbox();
                    }
                    return;
                }

                const fileName = resolveFileName(lang, code, initialConfig.ext);
                const filePath = path.join(tmpDir, fileName);
                fs.writeFileSync(filePath, code);
                const config = getLanguageConfig(lang, filePath, tmpDir);

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
                            }, COMPILE_TIMEOUT_MS);

                            compProc.stdout.on('data', (d) => send({ type: 'stdout', data: d.toString() }));
                            compProc.stderr.on('data', (d) => send({ type: 'stderr', data: d.toString() }));
                            compProc.on('error', (err) => {
                                clearTimeout(compTimer);
                                reject(err);
                            });
                            compProc.on('close', (exitCode) => {
                                clearTimeout(compTimer);
                                if (exitCode === 0) resolve();
                                else reject(new Error(`Compilation failed with code ${exitCode}`));
                            });
                        });
                    }

                    const runCmd = config.compile ? (config.cmd || config.args()[0]) : config.cmd;
                    let runArgs = config.compile && !config.cmd
                        ? config.args().slice(1)
                        : (config.compile ? config.args() : config.args(filePath));

                    if (!runCmd) {
                        runViaWandbox(stdinInput || '');
                        return;
                    }

                    if (lang === 'python' && runCmd.includes('python')) {
                        runArgs = ['-u', ...runArgs];
                    }

                    activeProcess = spawnWithPty(runCmd, runArgs, { cwd: tmpDir });

                    if (stdinInput && activeProcess.stdin) {
                        const input = stdinInput.endsWith('\n') ? stdinInput : `${stdinInput}\n`;
                        activeProcess.stdin.write(input);
                    }

                    activeProcess.stdout.on('data', (d) => send({ type: 'stdout', data: d.toString() }));
                    activeProcess.stderr.on('data', (d) => send({ type: 'stderr', data: d.toString() }));

                    activeProcess.on('error', (err) => {
                        send({ type: 'error', data: `Execution error: ${err.message}\r\n` });
                    });

                    const timer = setTimeout(() => {
                        if (activeProcess?.kill) activeProcess.kill('SIGKILL');
                        send({ type: 'error', data: '\r\nExecution timed out\r\n' });
                    }, EXECUTION_TIMEOUT_MS);

                    activeProcess.on('close', (exitCode) => {
                        clearTimeout(timer);
                        cleanup();
                        send({ type: 'exit', code: exitCode || 0 });
                        activeProcess = null;
                    });
                } catch (err) {
                    console.error('[EXEC][WS] Local execution failed, using Wandbox:', err.message);
                    runViaWandbox(stdinInput || '');
                }
            } catch (err) {
                console.error('WebSocket message error:', err);
            }
        });

        ws.on('close', () => {
            if (activeProcess && !activeProcess.killed) {
                activeProcess.kill('SIGKILL');
            }
            cleanup();
        });

        ws.on('error', (err) => {
            console.error('WebSocket connection error:', err);
        });
    });
}

module.exports = { attachExecutionWebSocket };
