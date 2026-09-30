import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { useTerminal } from '../../context/TerminalContext';
import { useProjectActions, useProjectUI } from '../../context/ProjectContext';
import { useSettingsSelector } from '../../context/SettingsContext';
import { getSettings } from '../../settings/settingsStore';
import { dialogConfirm } from '../UI/dialogService';
import { TerminalSessionController } from '../../context/TerminalSessionController';
import { type FileNode, ROOT_NODE_ID } from '../../utils/mockFileSystem';
import { findNodeById, pathOf } from '../../utils/safeTree';
import { createShellExecutor, findNode as shellFindNode, getAvailableCommands } from '../../core/shell/inBrowserShell';
import { getTerminalFont, configFontIsMonospace, DEFAULT_LINE_HEIGHT } from '../../core/terminal/terminalFont';
import { getXtermTheme, onDidChangeTheme } from '../../core/terminal/terminalTheme';
import { getDefaultShell, getShellLabel } from '../../core/terminal/terminalProfiles';
import '@xterm/xterm/css/xterm.css';

interface ShellTerminalProps {
    terminalId: string;
    visible: boolean;
    cwd: string;
}

/**
 * ShellTerminal wires one xterm instance to one TerminalSessionController.
 *
 * Architecture:
 *   xterm (owns keyboard input / rendering)
 *     |  onData -> session.sendInput   (no React state in the keystroke path)
 *     |  session -> onOutput -> xterm.write (direct)
 *     v
 *   TerminalSessionController (owns session identity + WebSocket transport)
 *     |  terminal.* protocol frames
 *     v
 *   Backend TerminalManager (owns PTY + process lifecycle)
 *
 * Two modes share this view:
 *   - Shell mode (idle): a lightweight in-browser shell acting on the file tree.
 *   - Program mode (session active): keystrokes stream to the PTY, PTY echoes.
 * The modes are separated by session state, so shell input is never confused
 * with program stdin.
 */
export const ShellTerminal: React.FC<ShellTerminalProps> = ({ terminalId, visible, cwd }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const webglAddonRef = useRef<WebglAddon | null>(null);
    const commandBuffer = useRef<string>('');
    const cursorPos = useRef<number>(0);
    const history = useRef<string[]>([]);
    const historyIndex = useRef<number>(-1);

    // Per-terminal session controller. Stable for the terminal's lifetime;
    // a disposed controller is replaced the next time a run starts.
    const sessionRef = useRef<TerminalSessionController | null>(null);
    // Drains a previous run's batched output buffer (used on re-run + unmount).
    const flushCleanupRef = useRef<(() => void) | null>(null);

    const { terminalEventEmitter, setTerminalRunning, setExecutionData, updateTerminalCwd, syncTerminalToFileExplorer } = useTerminal();
    const { createFileInFolder, ensureFolderUnder, deleteNode, setSelectedFolder, getFileTree } = useProjectActions();
    const { selectedFolder } = useProjectUI();
    const terminalSettings = useSettingsSelector(s => s.terminal);

    // Manage local CWD state for this specific terminal instance
    const [localCwd, setLocalCwdState] = React.useState(cwd || selectedFolder || 'root');
    const localCwdRef = useRef<string>(localCwd);

    // Directory history for navigation (initialized after localCwd)
    const directoryHistory = useRef<string[]>([localCwd]);
    const historyIndexRef = useRef<number>(0);

    // Latest file tree read lazily on demand inside command handlers; keeps this
    // terminal completely off the per-keystroke file state. Updated synchronously
    // each render (vs stale useEffect [getFileTree] which only fires on identity
    // change). Mirrors VS Code's IWorkspaceContextService live view.
    const fileTreeRef = useRef<FileNode[]>(getFileTree());
    fileTreeRef.current = getFileTree();

    const setLocalCwd = (newCwd: string) => {
        setLocalCwdState(newCwd);
        localCwdRef.current = newCwd;
        
        // Update context with new CWD
        updateTerminalCwd(terminalId, newCwd);
        
        // Add to local directory history (avoid duplicates, bounded so a
        // long navigation session can't grow the array without limit)
        const currentHistory = directoryHistory.current;
        if (currentHistory[currentHistory.length - 1] !== newCwd) {
            directoryHistory.current = [...currentHistory, newCwd].slice(-200);
            historyIndexRef.current = directoryHistory.current.length - 1;
        }
    };

    // fileTreeRef is updated synchronously above; no effect needed (kept for HMR safety)
    useEffect(() => {
        fileTreeRef.current = getFileTree();
    });

    // Sync File Explorer Selection -> Terminal CWD (both are node ids now)
    useEffect(() => {
        if (selectedFolder && selectedFolder !== localCwd) {
            setLocalCwd(selectedFolder);
            if (xtermRef.current && visible) {
                commandBuffer.current = '';
                const node = findNodeById(getFileTree(), selectedFolder);
                const promptName = selectedFolder === ROOT_NODE_ID ? '~' : (node?.name ?? '~');
                const dir = pathOf(getFileTree(), selectedFolder);
                xtermRef.current.write(`\r\n\x1b[2;37m[Directory changed to /${dir}]\x1b[0m`);
                const host2 = (() => { try { return getShellLabel(getDefaultShell()); } catch { return 'azemax'; } })();
                xtermRef.current.write(`\r\n\x1b[1;38;2;91;140;255mguest@${host2}\x1b[0m:\x1b[1;38;2;170;180;194m${promptName}\x1b[0m$ `);
            }
        }
    }, [selectedFolder, visible, getFileTree]);

    // 1. Initialize XTerm.js — VS Code-aligned font handling (terminalFont.ts + xtermTerminal.ts)
    useEffect(() => {
        if (!containerRef.current) return;

        // VS Code: TerminalFontMetrics.getFont(window) — family fallback, size clamp, letterSpacing/lineHeight, AppleBraille, devicePixelRatio
        const font = getTerminalFont();
        // Warn if proportional font (VS Code configFontIsMonospace) — prevents mis-aligned columns
        if (!configFontIsMonospace()) {
            console.warn('[Terminal] Configured font appears proportional (i≠w width). Columns may mis-align. Use a monospace family.');
        }

        const term = new Terminal({
            theme: getXtermTheme() as unknown as Record<string, string>,
            fontFamily: font.fontFamily,
            fontSize: font.fontSize,
            lineHeight: font.lineHeight ?? DEFAULT_LINE_HEIGHT,
            // xterm types FontWeight as 'normal'|'bold'|number but runtime accepts string numbers — VS Code passes String(fontWeight)
            fontWeight: String(font.fontWeight) as any,
            fontWeightBold: String(font.fontWeightBold) as any,
            letterSpacing: font.letterSpacing,
            cursorBlink: getSettings().terminal.cursorBlink,
            allowTransparency: getSettings().terminal.allowTransparency,
            cursorStyle: getSettings().terminal.cursorStyle,
            rightClickSelectsWord: getSettings().terminal.rightClickSelectsWord,
            convertEol: true, // Auto convert \n to \r\n
            overviewRuler: { width: 0 },
            scrollback: getSettings().terminal.scrollback,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        const webLinksAddon = new WebLinksAddon();
        term.loadAddon(webLinksAddon);

        term.open(containerRef.current);

        // WebGL renderer for high-throughput output; falls back to the DOM renderer automatically
        try {
            const webglAddon = new WebglAddon();
            webglAddon.onContextLoss(() => {
                webglAddon.dispose();
                webglAddonRef.current = null;
            });
            term.loadAddon(webglAddon);
            webglAddonRef.current = webglAddon;
        } catch {
            webglAddonRef.current = null;
        }

        // VS Code: wait for fonts to load before measuring (document.fonts.ready + re-measure + fit)
        // Mirrors `CodeEditor.tsx:handleEditorMount` remeasureFonts + layout after `document.fonts.ready`
        if (typeof document !== 'undefined' && (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready) {
            (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready.then(() => {
                try { fitAddon.fit(); } catch { /* ignore */ }
                // Notify backend of new cols/rows after font load (devicePixelRatio-aware)
                const s = sessionRef.current;
                if (s && s.isActive && xtermRef.current) s.resize(xtermRef.current.cols, xtermRef.current.rows);
            }).catch(() => {});
        }

        // Slightly delay fit to ensure DOM is ready
        const fitTimeout = setTimeout(() => {
            try { fitAddon.fit(); } catch { /* container may be hidden */ }
        }, 10);

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        return () => {
            clearTimeout(fitTimeout);
            webglAddonRef.current?.dispose();
            webglAddonRef.current = null;
            try { fitAddon.dispose(); } catch { /* ignore */ }
            term.dispose();
            xtermRef.current = null;
            fitAddonRef.current = null;
        };
    }, []);

    // Apply terminal settings changes incrementally without recreating xterm
    // VS Code: TerminalConfigurationService.onConfigChanged → XtermTerminal.updateConfig + setPanelContainer + getFont
    useEffect(() => {
        const term = xtermRef.current;
        if (!term) return;
        // Use VS Code-aligned font pipeline so letterSpacing/lineHeight scaling and clamp are respected
        const f = getTerminalFont();
        term.options.fontSize = f.fontSize;
        term.options.fontFamily = f.fontFamily;
        term.options.letterSpacing = f.letterSpacing;
        term.options.lineHeight = f.lineHeight;
        // VS Code: XtermTerminal.updateConfig applies fontWeight/fontWeightBold via raw.options (xterm supports string|number)
        (term.options as unknown as Record<string, unknown>).fontWeight = String(f.fontWeight);
        (term.options as unknown as Record<string, unknown>).fontWeightBold = String(f.fontWeightBold);
        term.options.cursorBlink = terminalSettings.cursorBlink;
        term.options.cursorStyle = terminalSettings.cursorStyle;
        term.options.allowTransparency = terminalSettings.allowTransparency;
        term.options.rightClickSelectsWord = terminalSettings.rightClickSelectsWord;
        term.options.scrollback = terminalSettings.scrollback;
        // Monospace check on family change — mirrors terminalConfigurationService.configFontIsMonospace()
        if (!configFontIsMonospace()) {
            console.warn('[Terminal] Font change appears proportional; terminal columns may mis-align.');
        }
        // Re-fit after font change — VS Code delays via _resizeDebouncer + document.fonts.ready
        if (visible) {
            // Ensure fonts are ready before measuring (prevents 0-width flash on web-font load)
            const doFit = () => { try { fitAddonRef.current?.fit(); } catch { /* hidden */ } };
            if (typeof document !== 'undefined' && (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready) {
                (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready.then(doFit).catch(doFit);
            } else doFit();
        }
    }, [terminalSettings, visible]);

    // Theme changes — mirrors `XtermTerminal._updateTheme` subscribed to `IThemeService.onDidColorThemeChange`
    useEffect(() => {
        const term = xtermRef.current;
        if (!term) return;
        const unsub = onDidChangeTheme(() => {
            const t = xtermRef.current;
            if (t) {
                try { (t.options as unknown as Record<string, unknown>).theme = getXtermTheme() as unknown as Record<string, string>; } catch { /* ignore */ }
                // VS Code: _decorationAddon.refreshLayouts() on theme change — fit is enough for us
                try { fitAddonRef.current?.fit(); } catch { /* ignore */ }
            }
        });
        return unsub;
    }, []);

    // Copy the current selection to the clipboard automatically when enabled
    // VS Code: clipboardService.writeText only when terminal has focus and selection is in terminal
    useEffect(() => {
        const term = xtermRef.current;
        if (!term || !terminalSettings.copyOnSelect) return;
        const handleSelectionChange = () => {
            if (!term.hasSelection()) return;
            // Only auto-copy if focus is within the terminal element (avoid global selection bleed)
            const active = document.activeElement;
            const termEl = term.element;
            const inTerminal = termEl && active && (termEl.contains(active) || termEl === active);
            // Fallback: if xterm has selection but not focused, still copy (user likely dragged in terminal)
            // Check that document selection actually contains terminal text
            if (!inTerminal && !term.hasSelection()) return;
            navigator.clipboard.writeText(term.getSelection()).catch(() => { /* permission denied */ });
        };
        document.addEventListener('selectionchange', handleSelectionChange);
        return () => document.removeEventListener('selectionchange', handleSelectionChange);
    }, [terminalSettings.copyOnSelect]);

    // Recreate WebGL renderer when the terminal tab becomes visible; dispose it when hidden
    useEffect(() => {
        const term = xtermRef.current;
        if (!term) return;
        if (visible) {
            if (!webglAddonRef.current) {
                try {
                    const webglAddon = new WebglAddon();
                    webglAddon.onContextLoss(() => {
                        webglAddon.dispose();
                        webglAddonRef.current = null;
                    });
                    term.loadAddon(webglAddon);
                    webglAddonRef.current = webglAddon;
                    fitAddonRef.current?.fit();
                } catch {
                    webglAddonRef.current = null;
                }
            }
        } else {
            webglAddonRef.current?.dispose();
            webglAddonRef.current = null;
        }
    }, [visible]);

    // 2. Mock Shell Logic & Input Handling (initialize once after xterm is created)
    useEffect(() => {
        const term = xtermRef.current;
        if (!term) return;

        const writePrompt = () => {
            const currentCwd = localCwdRef.current;
            const node = findNodeById(getFileTree(), currentCwd);
            const promptName = currentCwd === ROOT_NODE_ID ? '~' : (node?.name ?? '~');
            // VS Code: prompt from shell (PS1), not hard-coded "guest@editor" — derive host from profile
            const host = (() => { try { return getShellLabel(getDefaultShell()); } catch { return 'azemax'; } })();
            term.write(`\r\n\x1b[1;38;2;91;140;255mguest@${host}\x1b[0m:\x1b[1;38;2;170;180;194m${promptName}\x1b[0m$ `);
        };

        const shellDeps = {
            getFileTree,
            localCwdRef,
            setLocalCwd,
            setSelectedFolder,
            syncTerminalToFileExplorer,
            createFileInFolder,
            ensureFolderUnder,
            deleteNode,
            terminalId,
            term,
            directoryHistory: directoryHistory,
            historyIndexRef,
        };
        const executeCommand = createShellExecutor(shellDeps);
        const findNode = (path: string) => shellFindNode(path, shellDeps);

        // Welcome banner — not hard-coded "Azemax Terminal" shell name; derive from profile (VS Code shows profile name)
        // The real PTY shell (when kind=='shell') emits its own banner; this is only for the in-browser mock fallback.
        try {
            const sh = getDefaultShell();
            const label = getShellLabel(sh);
            term.writeln(`\x1b[1;38;2;100;149;255m◆ Azemax Terminal\x1b[0m  \x1b[38;2;110;135;165m${label}\x1b[0m`);
        } catch {
            term.writeln('\x1b[1;38;2;100;149;255m◆ Azemax Terminal\x1b[0m');
        }
        term.writeln('\x1b[38;2;105;130;165mtype \x1b[0;38;2;100;155;255mhelp\x1b[38;2;105;130;165m for available commands\x1b[0m');
        writePrompt();

        const updateBuffer = (newCmd: string) => {
            if (cursorPos.current > 0) {
                term.write(`\x1b[${cursorPos.current}D`); // move to start
            }
            term.write('\x1b[K'); // clear to end of line
            term.write(newCmd);
            commandBuffer.current = newCmd;
            cursorPos.current = newCmd.length;
        };

        const onDataDisposable = term.onData((data: string) => {
            // PROGRAM MODE: the active session owns keyboard input. Keystrokes go
            // straight to the session controller -> WebSocket -> PTY/process.
            // The PTY performs echo, so we do NOT print input here (no duplicates,
            // no disappearing input). Ctrl+C is mapped to SIGINT on the process.
            const session = sessionRef.current;
            if (session && session.isActive) {
                const code = data.charCodeAt(0);
                if (code === 3) { // Ctrl+C -> SIGINT (real signal to process group)
                    session.signal('SIGINT');
                    term.write('^C');
                    return;
                }
                session.sendInput(data);
                return;
            }

            const code = data.charCodeAt(0);

            if (code === 13) { // Enter
                const cmd = commandBuffer.current;

                if (cmd.trim()) {
                    history.current.push(cmd);
                    historyIndex.current = history.current.length;
                }

                executeCommand(cmd).then(() => {
                    commandBuffer.current = '';
                    cursorPos.current = 0;
                    writePrompt();
                }).catch((err) => {
                    // H2 fix: a throwing command (e.g. huge cat output into
                    // xterm) must never wedge the shell — reset and reprompt.
                    try {
                        term.writeln(`\r\n\x1b[1;31mcommand failed: ${err instanceof Error ? err.message : 'error'}\x1b[0m`);
                    } catch { /* terminal gone */ }
                    commandBuffer.current = '';
                    cursorPos.current = 0;
                    writePrompt();
                });
            } else if (code === 3) { // Ctrl+C
                term.write('^C\r\n');
                commandBuffer.current = '';
                cursorPos.current = 0;
                writePrompt();
            } else if (code === 12) { // Ctrl+L
                term.clear();
            } else if (code === 9) { // Tab
                const cmd = commandBuffer.current;
                const args = cmd.split(' ');
                const lastArg = args[args.length - 1];

                if (args.length === 1) {
                    // VS Code: completionProviders are registered via extensions, not a hard-coded array — derive from shell registry
                    const cmds = getAvailableCommands();
                    const matches = cmds.filter((c: string) => c.startsWith(lastArg));
                    if (matches.length === 1) {
                        const newData = matches[0].slice(lastArg.length) + ' ';
                        const left = commandBuffer.current.slice(0, cursorPos.current);
                        const right = commandBuffer.current.slice(cursorPos.current);
                        commandBuffer.current = left + newData + right;
                        cursorPos.current += newData.length;
                        term.write(newData + right);
                        if (right.length > 0) term.write(`\x1b[${right.length}D`);
                    }
                } else if (args.length > 1) {
                    const dirNode = findNode('.');
                    if (dirNode && dirNode.children) {
                        const matches = dirNode.children.map((c: { name: string }) => c.name).filter((n: string) => n.startsWith(lastArg));
                        if (matches.length === 1) {
                            let match = matches[0];
                            if (dirNode.children.find((c: { name: string; type: string }) => c.name === match && c.type === 'folder')) {
                                match += '/';
                            } else {
                                match += ' ';
                            }
                            const newData = match.slice(lastArg.length);
                            const left = commandBuffer.current.slice(0, cursorPos.current);
                            const right = commandBuffer.current.slice(cursorPos.current);
                            commandBuffer.current = left + newData + right;
                            cursorPos.current += newData.length;
                            term.write(newData + right);
                            if (right.length > 0) term.write(`\x1b[${right.length}D`);
                        }
                    }
                }
            } else if (code === 127 || data === '\b') { // Backspace
                if (cursorPos.current > 0) {
                    const left = commandBuffer.current.slice(0, cursorPos.current - 1);
                    const right = commandBuffer.current.slice(cursorPos.current);
                    commandBuffer.current = left + right;
                    cursorPos.current--;

                    term.write('\b' + right + ' \b');
                    if (right.length > 0) {
                        term.write(`\x1b[${right.length}D`);
                    }
                }
            } else if (data === '\x1B[3~') { // Delete
                if (cursorPos.current < commandBuffer.current.length) {
                    const left = commandBuffer.current.slice(0, cursorPos.current);
                    const right = commandBuffer.current.slice(cursorPos.current + 1);
                    commandBuffer.current = left + right;

                    term.write(right + ' \b');
                    if (right.length > 0) {
                        term.write(`\x1b[${right.length}D`);
                    }
                }
            } else if (data === '\x1B[D') { // Left arrow
                if (cursorPos.current > 0) {
                    cursorPos.current--;
                    term.write(data);
                }
            } else if (data === '\x1B[C') { // Right arrow
                if (cursorPos.current < commandBuffer.current.length) {
                    cursorPos.current++;
                    term.write(data);
                }
            } else if (data === '\x1B[H' || data === '\x1B[1~' || data === '\x1BOH') { // Home
                if (cursorPos.current > 0) {
                    term.write(`\x1b[${cursorPos.current}D`);
                    cursorPos.current = 0;
                }
            } else if (data === '\x1B[F' || data === '\x1B[4~' || data === '\x1BOF') { // End
                if (cursorPos.current < commandBuffer.current.length) {
                    term.write(`\x1b[${commandBuffer.current.length - cursorPos.current}C`);
                    cursorPos.current = commandBuffer.current.length;
                }
            } else if (data === '\x1B[A') { // Up arrow
                if (historyIndex.current > 0) {
                    historyIndex.current--;
                    updateBuffer(history.current[historyIndex.current]);
                }
            } else if (data === '\x1B[B') { // Down arrow
                if (historyIndex.current < history.current.length) {
                    historyIndex.current++;
                    updateBuffer(historyIndex.current === history.current.length ? '' : history.current[historyIndex.current]);
                }
            } else if (code >= 32 && code <= 126) { // Typable chars
                const left = commandBuffer.current.slice(0, cursorPos.current);
                const right = commandBuffer.current.slice(cursorPos.current);
                commandBuffer.current = left + data + right;
                cursorPos.current += data.length;

                term.write(data + right);
                if (right.length > 0) {
                    term.write(`\x1b[${right.length}D`);
                }
            }
        });

        return () => {
            onDataDisposable.dispose();
        };
    }, []);

    // 3. Dynamic Resize Listener + focus when visible. Size changes are
    //    propagated to the active session's PTY (debounced to one frame).
    useEffect(() => {
        if (!visible) return;

        const handleResize = () => {
            const fit = fitAddonRef.current;
            const term = xtermRef.current;
            if (fit) fit.fit();
            const session = sessionRef.current;
            if (term && session && session.isActive) {
                session.resize(term.cols, term.rows);
            }
        };

        // Debounce: only send meaningful size changes, one per frame.
        let raf: number | null = null;
        const queuedResize = () => {
            if (raf) return;
            raf = window.requestAnimationFrame(() => {
                raf = null;
                handleResize();
            });
        };

        const resizeObserver = new ResizeObserver(() => queuedResize());
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        window.addEventListener('resize', queuedResize);

        // Do an immediate fit and focus when becoming visible
        setTimeout(() => {
            handleResize();
            if (xtermRef.current) {
                xtermRef.current.focus();
            }
        }, 10);

        const isMounted = true;
        return () => {
            if (raf) cancelAnimationFrame(raf);
            window.removeEventListener('resize', queuedResize);
            resizeObserver.disconnect();
            void isMounted;
        };
    }, [visible]);

    // 4. Handle Global Event Emitters (Clear, Code Run, Paste, etc)
    useEffect(() => {
        const term = xtermRef.current;
        if (!term) return;

        const handleClear = (e: Event) => {
            const ce = e as CustomEvent;
            if (ce.detail.id === terminalId) {
                term.clear();
            }
        };

        const handleStop = (e: Event) => {
            const ce = e as CustomEvent;
            if (ce.detail.id === terminalId) {
                const session = sessionRef.current;
                if (session && session.isActive) {
                    session.stop(); // session.kill -> backend process termination -> exit frame -> isRunning cleared
                } else {
                    // No live session (run never started / already gone): clear
                    // the latch directly so Stop always recovers a stuck state.
                    setTerminalRunning(terminalId, false);
                }
            }
        };

const handleRunData = (e: Event) => {
            const ce = e as CustomEvent;
            if (ce.detail.id !== terminalId) return;

            const runLanguage: string = ce.detail.language || 'code';
            const rawFilename: string | undefined = ce.detail.filename;
            const preStdin: string = ce.detail.stdinInput || '';
            const runCwd: string = ce.detail.cwd || pathOf(getFileTree(), localCwdRef.current) || 'root';
            const displayName = rawFilename && typeof rawFilename === 'string'
                ? rawFilename
                : `snippet.${runLanguage === 'javascript' ? 'js' : runLanguage === 'python' ? 'py' : runLanguage}`;

            if (getSettings().terminal.clearBeforeRun) {
                term.clear();
            }
            term.writeln(`\r\n\x1b[1;38;2;91;140;255m▶\x1b[0m \x1b[1;38;2;210;225;245m${displayName}\x1b[0m  \x1b[38;2;120;148;185m${runLanguage}\x1b[0m`);
            if (preStdin) {
                term.writeln(`  \x1b[38;2;200;155;60m⎋\x1b[0m \x1b[38;2;175;145;90mwith pre-provided stdin\x1b[0m`);
            }
            term.focus();

            // Single source of truth for the session listeners (create + reuse).
            // Output arrives in many small chunks; batch writes and flush on a
            // short timer so a busy stream doesn't force one React/render pass
            // per chunk. The buffer is per-run and force-flushed on exit.
            const buildListeners = () => {
                // Drain a previous run's batch buffer before a new one starts so
                // no bytes are silently dropped on rapid re-runs.
                flushCleanupRef.current?.();
                let pending = '';
                let flushTimer: ReturnType<typeof setTimeout> | null = null;
                // Bound each synchronous xterm.write so a single massive output
                // burst can't block the main thread; oversized buffers are sliced
                // and the remainder is scheduled for the next tick.
                const MAX_WRITE_CHUNK = 32768;
                // Absolute ceiling for the pre-parse batch buffer. xterm THROWS
                // past ~50MB of queued-but-unparsed data — without a guard one
                // flooding program would wedge the terminal in an infinite
                // throw loop (C2). Past the ceiling we drop with a notice.
                const MAX_PENDING = MAX_WRITE_CHUNK * 8;
                let droppedNoticeShown = false;
                // Batching can be disabled for lowest-latency writes.
                const batched = getSettings().performance.terminalOutputBatching;
                /** xterm.write that can never throw out of a timer callback. */
                const safeWrite = (text: string) => {
                    const t = xtermRef.current;
                    if (!t || !text) return;
                    try {
                        t.write(text);
                    } catch {
                        // xterm backpressure throw (>50MB queued): drop the chunk
                        // and keep the terminal alive. The truncation notice
                        // below tells the user output was lost.
                        if (!droppedNoticeShown) {
                            droppedNoticeShown = true;
                            try {
                                t.writeln('\r\n\x1b[38;2;220;160;60m⚠\x1b[0m  \x1b[38;2;175;145;90mOutput truncated — producer outran the terminal\x1b[0m');
                            } catch { /* terminal gone — nothing to do */ }
                        }
                    }
                };
                const flush = (drain = false) => {
                    flushTimer = null;
                    const t = xtermRef.current;
                    if (!t || !pending) return;
                    try {
                        if (drain || pending.length <= MAX_WRITE_CHUNK) {
                            safeWrite(pending);
                            pending = '';
                        } else {
                            safeWrite(pending.slice(0, MAX_WRITE_CHUNK));
                            pending = pending.slice(MAX_WRITE_CHUNK);
                            flushTimer = setTimeout(flush, 0);
                        }
                    } finally {
                        // A throw must never leave the poisoned buffer in place
                        // to re-throw on the next tick (infinite exception loop).
                        if (pending.length > MAX_PENDING) {
                            pending = '';
                            if (!droppedNoticeShown) {
                                droppedNoticeShown = true;
                                safeWrite('\r\n\x1b[1;33m[output truncated — producer outran the terminal]\x1b[0m');
                            }
                        }
                    }
                };
                const scheduleFlush = () => {
                    if (flushTimer === null) {
                        flushTimer = setTimeout(flush, batched ? 16 : 0);
                    }
                };
                // Force-drain on unmount / re-run; must be invoked from outside
                // the closure so no buffered bytes are stranded.
                flushCleanupRef.current = () => {
                    if (flushTimer !== null) {
                        clearTimeout(flushTimer);
                        flushTimer = null;
                    }
                    if (pending) {
                        safeWrite(pending);
                    }
                    pending = '';
                };
                return {
                    onOutput: (data: string) => {
                        // Clamp at append time: a single oversized frame is cut
                        // before it can poison the buffer (C2/M8).
                        if (pending.length + data.length > MAX_PENDING) {
                            const room = Math.max(0, MAX_PENDING - pending.length);
                            pending += data.slice(0, room);
                            flush(true);
                            return;
                        }
                        pending += data;
                        // Never let the batch buffer grow without bound — an
                        // oversize burst is force-flushed (chunked) immediately.
                        if (pending.length > MAX_WRITE_CHUNK * 8) {
                            flush(true);
                            return;
                        }
                        scheduleFlush();
                    },
                    onState: (state: string) => {
                        if (state === 'EXITED' || state === 'FAILED' || state === 'DISPOSED') {
                            setTerminalRunning(terminalId, false);
                        }
                    },
                    onExit: (code: number | null, signal: string | null) => {
                        flush(true);
                        const t = xtermRef.current;
                        if (!t) return;
                    if (signal) {
                        t.writeln(`\r\n\x1b[38;2;240;110;120m✗\x1b[0m \x1b[38;2;220;160;165mKilled\x1b[0m  \x1b[38;2;165;110;115m${signal}\x1b[0m`);
                    } else if (code === 0) {
                        t.writeln(`\r\n\x1b[38;2;72;195;145m✓\x1b[0m \x1b[38;2;140;210;175mDone\x1b[0m  \x1b[38;2;100;160;125mexit 0\x1b[0m`);
                    } else {
                        t.writeln(`\r\n\x1b[38;2;240;110;120m✗\x1b[0m \x1b[38;2;220;160;165mFailed\x1b[0m  \x1b[38;2;175;110;115mexit ${code ?? 1}\x1b[0m`);
                    }
                    const perf = session!.getPerformanceData();
                    setExecutionData(terminalId, {
                        executionTime: perf.executionTime,
                        stdout: perf.stdout,
                        stderr: perf.stderr,
                        exitCode: code ?? 0,
                        timestamp: Date.now(),
                    });
                    // also clear running for this terminal (authoritative)
                    setTerminalRunning(terminalId, false);
                    const currentCwd = localCwdRef.current;
                    const node = findNodeById(getFileTree(), currentCwd);
                    const promptName = currentCwd === ROOT_NODE_ID ? '~' : (node?.name ?? '~');
                    const host3 = (() => { try { return getShellLabel(getDefaultShell()); } catch { return 'azemax'; } })();
                    t.write(`\r\n\x1b[1;38;2;91;140;255mguest@${host3}\x1b[0m:\x1b[1;38;2;170;180;194m${promptName}\x1b[0m$ `);
                },
                onStdinRequired: (interactive: boolean) => {
                    const t = xtermRef.current;
                    if (!t) return;
                    if (interactive) {
                        t.writeln('\r\n\x1b[38;2;200;155;60m⎋\x1b[0m \x1b[38;2;175;150;100mWaiting for input  \x1b[38;2;140;120;80mPTY echoes keystrokes\x1b[0m');
                    } else {
                        t.writeln('\r\n\x1b[38;2;200;155;60m⎋\x1b[0m \x1b[38;2;175;150;100mInput required — type a line and press Enter\x1b[0m');
                    }
                },
                onError: (message: string) => {
                    const t = xtermRef.current;
                    if (!t) return;
                    t.writeln(`\r\n\x1b[38;2;240;110;120m✗\x1b[0m \x1b[38;2;210;150;155m${message}\x1b[0m`);
                },
            };
        };

            // Build (or reuse) the session controller for this terminal.
            let session = sessionRef.current;
            if (session && session.state === 'DISPOSED') {
                session = null;
                sessionRef.current = null;
            }
            if (!session) {
                session = new TerminalSessionController(terminalId, buildListeners());
                sessionRef.current = session;
            } else {
                session.setListeners(buildListeners());
            }

            // Notify the context a run is in progress. Authoritative completion
            // comes via the session state (terminal.exit / FAILED / timeout).
            setTerminalRunning(terminalId, true);

            const termX = xtermRef.current;
            // VS Code: Constants.DefaultCols=80 DefaultRows=30, not 120 — and prefer live fit dimensions
            let cols = 80, rows = 30;
            if (termX) { cols = termX.cols; rows = termX.rows; }
            else if (fitAddonRef.current) {
                // Fallback: derive from fit's proposed dimensions if xterm not yet measured (mirrors getXtermScaledDimensions)
                try { const dim = (fitAddonRef.current as unknown as { proposeDimensions?: () => { cols:number; rows:number } | undefined }).proposeDimensions?.(); if (dim) { cols = dim.cols; rows = dim.rows; } } catch { /* ignore */ }
            }
            session.startCode(
                ce.detail.code,
                runLanguage,
                preStdin,
                cols,
                rows,
                runCwd,
                rawFilename,
            );
        };

        const handleKill = (e: Event) => {
            const ce = e as CustomEvent;
            if (ce.detail.id === terminalId) {
                const session = sessionRef.current;
                // Permanent removal (Kill Terminal context action / removeTerminal):
                // fully dispose so the socket and backend process are torn down
                // even while STOPPING or CONNECTING (`isActive` excludes those).
                if (session && session.state !== 'EXITED' && session.state !== 'FAILED' && session.state !== 'DISPOSED') {
                    session.dispose();
                }
            }
        };

        const handleCopySelection = (e: Event) => {
            const ce = e as CustomEvent;
            if (ce.detail.id === terminalId && term.hasSelection()) {
                navigator.clipboard.writeText(term.getSelection());
                term.clearSelection();
            }
        };

        const handleCopyAll = (e: Event) => {
            const ce = e as CustomEvent;
            if (ce.detail.id === terminalId) {
                let allText = '';
                const normalBuffer = term.buffer.normal;
                for (let i = 0; i < normalBuffer.length; i++) {
                    const row = normalBuffer.getLine(i);
                    if (row) {
                        allText += row.translateToString(true).replace(/\s+$/, '') + '\n';
                    }
                }
                navigator.clipboard.writeText(allText.trim());
            }
        };

        const handlePaste = async (e: Event) => {
            const ce = e as CustomEvent;
            if (ce.detail.id === terminalId) {
                try {
                    const text = await navigator.clipboard.readText();
                    const isMultiLine = /\r?\n/.test(text);
                    if (isMultiLine && getSettings().terminal.pasteProtection) {
                        const flattened = text.replace(/\r?\n/g, ' ').trim();
                        const preview = flattened.length > 80 ? flattened.slice(0, 80) + '…' : flattened;
                        const confirmed = await dialogConfirm({
                            title: 'Paste multi-line text?',
                            message: `The pasted text contains line breaks and will be flattened to a single line: "${preview}"`,
                            confirmLabel: 'Paste',
                            cancelLabel: 'Cancel',
                            danger: false,
                        });
                        if (!confirmed) return;
                    }
                    const left = commandBuffer.current.slice(0, cursorPos.current);
                    const right = commandBuffer.current.slice(cursorPos.current);
                    const cleanText = text.replace(/\r?\n/g, ' '); // treat multi-line paste mildly
                    commandBuffer.current = left + cleanText + right;
                    cursorPos.current += cleanText.length;

                    term.write(cleanText + right);
                    if (right.length > 0) {
                        term.write(`\x1b[${right.length}D`);
                    }
                } catch {
                    // clipboard read failed — ignore
                }
            }
        };

        const handleWriteText = (e: Event) => {
            const ce = e as CustomEvent;
            if (ce.detail.id === terminalId) {
                const text = ce.detail.text || '';
                term.writeln('');
                term.write(text.replace(/\r?\n/g, '\r\n'));
                term.writeln('');
            }
        };

        terminalEventEmitter.addEventListener('clear', handleClear);
        terminalEventEmitter.addEventListener('stop', handleStop);
        terminalEventEmitter.addEventListener('runData', handleRunData);
        terminalEventEmitter.addEventListener('kill', handleKill);
        terminalEventEmitter.addEventListener('copySelection', handleCopySelection);
        terminalEventEmitter.addEventListener('copyAll', handleCopyAll);
        terminalEventEmitter.addEventListener('paste', handlePaste);
        terminalEventEmitter.addEventListener('writeText', handleWriteText);

        // Notify the provider that this terminal is mounted & listening so any
        // buffered run (dispatched while the terminal tab was still opening) is flushed.
        terminalEventEmitter.dispatchEvent(new CustomEvent('terminalReady', { detail: { id: terminalId } }));

        return () => {
            terminalEventEmitter.removeEventListener('clear', handleClear);
            terminalEventEmitter.removeEventListener('stop', handleStop);
            terminalEventEmitter.removeEventListener('runData', handleRunData);
            terminalEventEmitter.removeEventListener('kill', handleKill);
            terminalEventEmitter.removeEventListener('copySelection', handleCopySelection);
            terminalEventEmitter.removeEventListener('copyAll', handleCopyAll);
            terminalEventEmitter.removeEventListener('paste', handlePaste);
            terminalEventEmitter.removeEventListener('writeText', handleWriteText);

            terminalEventEmitter.dispatchEvent(new CustomEvent('terminalUnmounted', { detail: { id: terminalId } }));

            // Terminate the session's process + transport on unmount (no
            // orphans). This must also cover STOPPING and CONNECTING states —
            // `isActive` excludes STOPPING, which would otherwise leave the
            // socket open and the backend process alive after unmount.
            const session = sessionRef.current;
            if (session && session.state !== 'EXITED' && session.state !== 'FAILED' && session.state !== 'DISPOSED') {
                session.dispose();
            }
            sessionRef.current = null;
            flushCleanupRef.current?.();
            flushCleanupRef.current = null;
            // Per-terminal: only clear running for this terminal (vs global which killed other terminals' indicator)
            setTerminalRunning(terminalId, false);
        };
    }, [terminalId, terminalEventEmitter, setTerminalRunning]);

    const handleContainerClick = () => {
        if (xtermRef.current) {
            xtermRef.current.focus();
        }
    };

    return (
        <div
            className="w-full h-full relative glass-terminal overflow-hidden"
            style={{
                visibility: visible ? 'visible' : 'hidden',
                position: visible ? 'relative' : 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
            }}
        >
            {/* The wrapper that xterm connects to */}
            <div
                ref={containerRef}
                className="absolute inset-0 px-4 py-3 glass-terminal-body overflow-x-auto overflow-y-auto"
                onMouseDown={handleContainerClick}
                style={{ height: '100%', width: '100%' }}
            />
        </div>
    );
};
