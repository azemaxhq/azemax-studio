import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { useTerminal } from '../../context/TerminalContext';
import { useProjectActions, useProjectUI } from '../../context/ProjectContext';
import { TerminalSessionController } from '../../context/TerminalSessionController';
import { type FileNode } from '../../utils/mockFileSystem';
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

    const { terminalEventEmitter, setIsRunning, setLastExecutionData, updateTerminalCwd, syncTerminalToFileExplorer } = useTerminal();
    const { createFile, createFolder, deleteNode, setSelectedFolder, getFileTree } = useProjectActions();
    const { selectedFolder } = useProjectUI();

    // Manage local CWD state for this specific terminal instance
    const [localCwd, setLocalCwdState] = React.useState(cwd || selectedFolder || 'root');
    const localCwdRef = useRef<string>(localCwd);

    // Directory history for navigation (initialized after localCwd)
    const directoryHistory = useRef<string[]>([localCwd]);
    const historyIndexRef = useRef<number>(0);

    // Latest file tree read lazily on demand inside command handlers; keeps this
    // terminal completely off the per-keystroke file state.
    const fileTreeRef = useRef<FileNode[]>(getFileTree());

    const setLocalCwd = (newCwd: string) => {
        setLocalCwdState(newCwd);
        localCwdRef.current = newCwd;
        
        // Update context with new CWD
        updateTerminalCwd(terminalId, newCwd);
        
        // Add to local directory history (avoid duplicates)
        const currentHistory = directoryHistory.current;
        if (currentHistory[currentHistory.length - 1] !== newCwd) {
            directoryHistory.current = [...currentHistory, newCwd];
            historyIndexRef.current = directoryHistory.current.length - 1;
        }
    };

    useEffect(() => {
        fileTreeRef.current = getFileTree();
    }, [getFileTree]);

    // Sync File Explorer Selection -> Terminal CWD
    useEffect(() => {
        if (selectedFolder && selectedFolder !== localCwd) {
            setLocalCwd(selectedFolder);
            if (xtermRef.current && visible) {
                commandBuffer.current = '';
                const promptName = selectedFolder === 'root' ? '~' : selectedFolder.split('/').pop();
                xtermRef.current.write(`\r\n\x1b[3;33m[Directory changed to /${selectedFolder.replace(/^root\/?/, '')}]\x1b[0m`);
                xtermRef.current.write(`\r\n\x1b[1;32mguest@editor\x1b[0m:\x1b[1;34m${promptName}\x1b[0m$ `);
            }
        }
    }, [selectedFolder, visible]);

    // 1. Initialize XTerm.js
    useEffect(() => {
        if (!containerRef.current) return;

        const term = new Terminal({
            theme: {
                // VS Code Dark+ inspired, tuned to your background
                background: '#0d1117',
                foreground: '#d4d4d4',
                cursor: '#ffffff',
                cursorAccent: '#0d1117',
                selectionBackground: 'rgba(255, 255, 255, 0.18)',
                black: '#000000',
                red: '#cd3131',
                green: '#0dbc79',
                yellow: '#e5e510',
                blue: '#2472c8',
                magenta: '#bc3fbc',
                cyan: '#11a8cd',
                white: '#e5e5e5',
                brightBlack: '#666666',
                brightRed: '#f14c4c',
                brightGreen: '#23d18b',
                brightYellow: '#f5f543',
                brightBlue: '#3b8eea',
                brightMagenta: '#d670d6',
                brightCyan: '#29b8db',
                brightWhite: '#f5f5f5',
            },
            fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Geist Mono", Menlo, Consolas, monospace',
            fontSize: 14,
            lineHeight: 1.45,
            fontWeight: '400',
            fontWeightBold: '600',
            letterSpacing: 0.5,
            cursorBlink: true,
            allowTransparency: true,
            convertEol: true, // Auto convert \n to \r\n
            overviewRuler: { width: 0 },
            scrollback: 1000,
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

        // Slightly delay fit to ensure DOM is ready
        const fitTimeout = setTimeout(() => fitAddon.fit(), 10);

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        return () => {
            clearTimeout(fitTimeout);
            webglAddonRef.current?.dispose();
            webglAddonRef.current = null;
            term.dispose();
            xtermRef.current = null;
            fitAddonRef.current = null;
        };
    }, []);

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
            const promptName = currentCwd === 'root' ? '~' : currentCwd.split('/').pop();
            term.write(`\r\n\x1b[1;32mguest@editor\x1b[0m:\x1b[1;34m${promptName}\x1b[0m$ `);
        };

        const findNode = (pathStr: string): FileNode | null => {
            const currentCwd = localCwdRef.current;
            const currentTree = getFileTree();

            // Enhanced path resolution
            let currentPath: string;
            if (pathStr.startsWith('/')) {
                // Absolute path from root
                currentPath = pathStr.replace(/^\//, '').replace(/^root\/?/, '');
            } else if (pathStr.startsWith('root')) {
                // Path starting with root
                currentPath = pathStr.replace(/^root\/?/, '');
            } else {
                // Relative path from current directory
                currentPath = `${currentCwd.replace(/^root\/?/, '')}/${pathStr}`;
            }
            
            currentPath = currentPath.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');

            // Handle root case
            if (!currentPath) {
                return { id: 'root', name: 'root', type: 'folder', children: currentTree };
            }
            // Enhanced path resolution with proper .. handling
            const parts = currentPath.split('/');
            const resolvedParts: string[] = [];
            
            for (const part of parts) {
                if (part === '..') {
                    if (resolvedParts.length > 0) {
                        resolvedParts.pop();
                    }
                } else if (part === '.' || part === '') {
                    continue;
                } else {
                    resolvedParts.push(part);
                }
            }
            
            // Navigate through resolved path
            let currentNodes: FileNode[] = currentTree;
            let targetNode: FileNode | null = null;
            
            for (let i = 0; i < resolvedParts.length; i++) {
                const part = resolvedParts[i];
                const found = currentNodes.find(n => n.name === part);
                if (!found) return null;
                
                targetNode = found;
                if (i < resolvedParts.length - 1) {
                    if (found.type !== 'folder') return null;
                    currentNodes = found.children || [];
                }
            }
            
            return targetNode;
        };

        const executeCommand = async (cmd: string) => {
            const args = cmd.trim().split(/\s+/);
            const command = args[0];

            term.write('\r\n');

            switch (command) {
                case 'ls': {
                    const showHidden = args.includes('-a') || args.includes('--all');
                    const longFormat = args.includes('-l') || args.includes('--long');
                    const targetDir = args.find(arg => !arg.startsWith('-')) ? findNode(args.find(arg => !arg.startsWith('-'))!) : findNode('.');
                    
                    if (!targetDir || targetDir.type !== 'folder') {
                        term.write(`ls: cannot access '${args.find(arg => !arg.startsWith('-')) || '.'}': No such file or directory`);
                    } else {
                        const children = targetDir.children || [];
                        let output = '';
                        
                        if (longFormat) {
                            // Detailed listing format
                            const sortedChildren = children.sort((a, b) => {
                                // Folders first, then files, both alphabetically
                                if (a.type !== b.type) {
                                    return a.type === 'folder' ? -1 : 1;
                                }
                                return a.name.localeCompare(b.name);
                            });
                            
                            sortedChildren.forEach(child => {
                                if (!showHidden && child.name.startsWith('.')) return;
                                
                                const isFolder = child.type === 'folder';
                                const permissions = isFolder ? 'drwxr-xr-x' : '-rw-r--r--';
                                const size = isFolder ? '0' : (child.content?.length || '0').toString();
                                const name = isFolder ? `\x1b[1;34m${child.name}\x1b[0m/` : child.name;
                                
                                output += `${permissions} 1 guest staff ${size.padStart(8)} ${name}\r\n`;
                            });
                        } else {
                            // Simple listing format
                            const sortedChildren = children.sort((a, b) => a.name.localeCompare(b.name));
                            const visibleChildren = showHidden ? sortedChildren : sortedChildren.filter(c => !c.name.startsWith('.'));
                            output = visibleChildren.map(c => {
                                if (c.type === 'folder') {
                                    return `\x1b[1;34m${c.name}\x1b[0m/`;
                                }
                                return c.name;
                            }).join('  ');
                        }
                        
                        if (output) term.write(output);
                    }
                    break;
                }
                case 'cd': {
                    const target = args[1] || 'root';
                    if (target === '~' || target === '/') {
                        setLocalCwd('root');
                        setSelectedFolder('root');
                    } else if (target === '..') {
                        if (localCwdRef.current !== 'root') {
                            const parts = localCwdRef.current.split('/');
                            parts.pop();
                            const newCwd = parts.length > 0 ? parts.join('/') : 'root';
                            setLocalCwd(newCwd);
                            setSelectedFolder(newCwd);
                        }
                    } else if (target === '-') {
                        // cd - : go to previous directory
                        const history = directoryHistory.current;
                        const currentIndex = historyIndexRef.current;
                        if (history.length >= 2 && currentIndex > 0) {
                            const previousCwd = history[currentIndex - 1];
                            setLocalCwd(previousCwd);
                            setSelectedFolder(previousCwd);
                            historyIndexRef.current = currentIndex - 1;
                            term.write(`\x1b[33mChanged to previous directory: ${previousCwd}\x1b[0m`);
                        } else {
                            term.write(`cd -: no previous directory in history`);
                        }
                    } else {
                        const targetNode = findNode(target);
                        if (!targetNode || targetNode.type !== 'folder') {
                            term.write(`cd: ${target}: No such file or directory`);
                        } else {
                            const newCwd = targetNode.id === 'root' ? 'root' : targetNode.id;
                            setLocalCwd(newCwd);
                            setSelectedFolder(newCwd);
                            // Sync to file explorer when directory changes via terminal
                            syncTerminalToFileExplorer(terminalId);
                        }
                    }
                    break;
                }
                case 'pwd': {
                    const currentPath = localCwdRef.current === 'root' ? '/' : `/${localCwdRef.current.replace(/^root\/?/, '')}`;
                    term.write(currentPath);
                    break;
                }
                case 'clear': {
                    term.clear();
                    break;
                }
                case 'echo': {
                    term.write(args.slice(1).join(' '));
                    break;
                }
                case 'cat': {
                    if (!args[1]) {
                        term.write('cat: missing operand');
                    } else {
                        const file = findNode(args[1]);
                        if (!file || file.type !== 'file') {
                            term.write(`cat: ${args[1]}: No such file or directory`);
                        } else {
                            const content = file.content || '';
                            // Replace newlines with \r\n for xterm
                            term.write(content.replace(/\r?\n/g, '\r\n'));
                        }
                    }
                    break;
                }
                case 'touch': {
                    if (!args[1]) {
                        term.write('touch: missing file operand');
                    } else {
                        const pathId = localCwdRef.current === 'root' ? args[1] : `${localCwdRef.current}/${args[1]}`;
                        createFile(pathId);
                    }
                    break;
                }
                case 'mkdir': {
                    if (!args[1]) {
                        term.write('mkdir: missing operand');
                    } else {
                        const pathId = localCwdRef.current === 'root' ? args[1] : `${localCwdRef.current}/${args[1]}`;
                        createFolder(pathId);
                    }
                    break;
                }
                case 'rm': {
                    if (!args[1]) {
                        term.write('rm: missing operand');
                    } else {
                        const targetNode = findNode(args[1]);
                        if (!targetNode) {
                            term.write(`rm: ${args[1]}: No such file or directory`);
                        } else {
                            if (targetNode.id === 'root') {
                                term.write(`rm: cannot remove root directory`);
                            } else {
                                deleteNode(targetNode.id);
                            }
                        }
                    }
                    break;
                }
                case 'help': {
                    term.writeln('AI Code Editor - Enhanced Browser Shell');
                    term.writeln('Available commands:');
                    term.writeln('  ls [-a] [-l]      List directory contents');
                    term.writeln('  cd <path>         Change the shell working directory');
                    term.writeln('  cd -              Go to previous directory');
                    term.writeln('  pwd               Print name of current/working directory');
                    term.writeln('  cat <file>        Concatenate files and print on the standard output');
                    term.writeln('  echo <text>       Write arguments to the standard output');
                    term.writeln('  touch <file>      Change file timestamps (or create an empty file)');
                    term.writeln('  mkdir <dir>       Make directories');
                    term.writeln('  rm <file/dir>     Remove files or directories');
                    term.writeln('  find <pattern>    Search for files/directories by name');
                    term.writeln('  grep <pattern> <file>  Search for text patterns in files');
                    term.writeln('  tree              Display directory tree structure');
                    term.writeln('  clear             Clear the terminal screen');
                    term.writeln('');
                    term.writeln('Path examples:');
                    term.writeln('  cd src/components  Navigate to relative path');
                    term.writeln('  cd /src           Navigate to absolute path');
                    term.writeln('  cd ..             Go up one directory');
                    term.writeln('  cd -              Go to previous directory');
                    term.writeln('  cd ~              Go to home directory');
                    break;
                }
                case '':
                    break; // Empty Enter hit
                case 'find': {
                    const pattern = args[1];
                    if (!pattern) {
                        term.write('find: missing search pattern');
                        term.write('\r\nUsage: find <pattern>');
                    } else {
                        const searchInDir = args[2] ? findNode(args[2]) : findNode('.');
                        if (!searchInDir || searchInDir.type !== 'folder') {
                            term.write(`find: ${args[2] || '.'}: No such directory`);
                        } else {
                            const results: string[] = [];
                            const searchRecursive = (node: FileNode, path: string = '') => {
                                const currentPath = path ? `${path}/${node.name}` : node.name;
                                if (node.name.toLowerCase().includes(pattern.toLowerCase())) {
                                    results.push(node.type === 'folder' ? `${currentPath}/` : currentPath);
                                }
                                if (node.children) {
                                    node.children.forEach(child => searchRecursive(child, currentPath));
                                }
                            };
                            searchRecursive(searchInDir);
                            
                            if (results.length === 0) {
                                term.write(`find: No matches found for "${pattern}"`);
                            } else {
                                results.forEach(result => {
                                    term.write(result + '\r\n');
                                });
                            }
                        }
                    }
                    break;
                }
                case 'grep': {
                    const pattern = args[1];
                    const filename = args[2];
                    if (!pattern || !filename) {
                        term.write('grep: missing pattern or filename');
                        term.write('\r\nUsage: grep <pattern> <filename>');
                    } else {
                        const file = findNode(filename);
                        if (!file || file.type !== 'file') {
                            term.write(`grep: ${filename}: No such file`);
                        } else {
                            const content = file.content || '';
                            const lines = content.split('\n');
                            const matches: string[] = [];
                            
                            lines.forEach((line, index) => {
                                if (line.toLowerCase().includes(pattern.toLowerCase())) {
                                    matches.push(`${index + 1}:${line}`);
                                }
                            });
                            
                            if (matches.length === 0) {
                                term.write(`grep: No matches found for "${pattern}" in ${filename}`);
                            } else {
                                matches.forEach(match => {
                                    term.write(`\x1b[32m${match}\x1b[0m\r\n`);
                                });
                            }
                        }
                    }
                    break;
                }
                case 'tree': {
                    const showTree = (node: FileNode, prefix: string = '', isLast: boolean = true): string => {
                        const connector = isLast ? '└── ' : '├── ';
                        const displayName = node.type === 'folder' ? `\x1b[1;34m${node.name}\x1b[0m/` : node.name;
                        let result = prefix + connector + displayName + '\r\n';
                        
                        if (node.children && node.children.length > 0) {
                            const sortedChildren = node.children.sort((a, b) => {
                                if (a.type !== b.type) {
                                    return a.type === 'folder' ? -1 : 1;
                                }
                                return a.name.localeCompare(b.name);
                            });
                            
                            sortedChildren.forEach((child, index) => {
                                const isLastChild = index === sortedChildren.length - 1;
                                const childPrefix = prefix + (isLast ? '    ' : '│   ');
                                result += showTree(child, childPrefix, isLastChild);
                            });
                        }
                        
                        return result;
                    };
                    
                    const targetDir = args[1] ? findNode(args[1]) : findNode('.');
                    if (!targetDir || targetDir.type !== 'folder') {
                        term.write(`tree: ${args[1] || '.'}: No such directory`);
                    } else {
                        const treeOutput = showTree(targetDir);
                        term.write(treeOutput);
                    }
                    break;
                }
                default:
                    term.write(`bash: ${command}: command not found`);
                    term.write('\r\nType "help" for available commands.');
            }
        };

        // Welcome message and first prompt
        term.writeln('\x1b[1;36mWelcome to AI Code Editor Terminal\x1b[0m');
        term.writeln('Type \x1b[1;32mhelp\x1b[0m to see available commands.');
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
                    const cmds = ['ls', 'cd', 'pwd', 'cat', 'echo', 'touch', 'mkdir', 'rm', 'clear', 'help', 'find', 'grep', 'tree'];
                    const matches = cmds.filter(c => c.startsWith(lastArg));
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
                        const matches = dirNode.children.map(c => c.name).filter(n => n.startsWith(lastArg));
                        if (matches.length === 1) {
                            let match = matches[0];
                            if (dirNode.children.find(c => c.name === match && c.type === 'folder')) {
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
                }
            }
        };

const handleRunData = (e: Event) => {
            const ce = e as CustomEvent;
            if (ce.detail.id !== terminalId) return;

            const runLanguage: string = ce.detail.language || 'code';
            const rawFilename: string | undefined = ce.detail.filename;
            const preStdin: string = ce.detail.stdinInput || '';
            const runCwd: string = ce.detail.cwd || localCwdRef.current;
            const displayName = rawFilename && typeof rawFilename === 'string'
                ? rawFilename
                : `snippet.${runLanguage === 'javascript' ? 'js' : runLanguage === 'python' ? 'py' : runLanguage}`;

            term.writeln(`\r\n\x1b[3;36m> Running ${displayName} [${runLanguage}]...\x1b[0m`);
            if (preStdin) {
                term.writeln(`\x1b[3;33m  (with pre-provided stdin)\x1b[0m`);
            }
            term.focus();

            // Single source of truth for the session listeners (create + reuse).
            // Output arrives in many small chunks; batch writes and flush on a
            // short timer so a busy stream doesn't force one React/render pass
            // per chunk. The buffer is per-run and force-flushed on exit.
            const buildListeners = () => {
                let pending = '';
                let flushTimer: ReturnType<typeof setTimeout> | null = null;
                // Bound each synchronous xterm.write so a single massive output
                // burst can't block the main thread; oversized buffers are sliced
                // and the remainder is scheduled for the next tick.
                const MAX_WRITE_CHUNK = 32768;
                const flush = (drain = false) => {
                    flushTimer = null;
                    const t = xtermRef.current;
                    if (!t || !pending) return;
                    if (drain || pending.length <= MAX_WRITE_CHUNK) {
                        t.write(pending);
                        pending = '';
                    } else {
                        t.write(pending.slice(0, MAX_WRITE_CHUNK));
                        pending = pending.slice(MAX_WRITE_CHUNK);
                        flushTimer = setTimeout(flush, 0);
                    }
                };
                const scheduleFlush = () => {
                    if (flushTimer === null) {
                        flushTimer = setTimeout(flush, 16);
                    }
                };
                return {
                    onOutput: (data: string) => {
                        pending += data;
                        scheduleFlush();
                    },
                    onState: (state: string) => {
                        if (state === 'EXITED' || state === 'FAILED' || state === 'DISPOSED') {
                            setIsRunning(false);
                        }
                    },
                    onExit: (code: number | null, signal: string | null) => {
                        flush(true);
                        const t = xtermRef.current;
                        if (!t) return;
                    if (signal) {
                        t.writeln(`\r\n\x1b[1;31mProcess terminated by ${signal}\x1b[0m`);
                    } else {
                        const exitColor = code === 0 ? '32' : '31';
                        t.writeln(`\r\n\x1b[1;${exitColor}mProcess finished with exit code ${code ?? 0}\x1b[0m`);
                    }
                    const perf = session!.getPerformanceData();
                    setLastExecutionData({
                        executionTime: perf.executionTime,
                        stdout: perf.stdout,
                        stderr: perf.stderr,
                        exitCode: code ?? 0,
                        timestamp: Date.now(),
                    });
                    const currentCwd = localCwdRef.current;
                    const promptName = currentCwd === 'root' ? '~' : currentCwd.split('/').pop();
                    t.write(`\r\n\x1b[1;32mguest@editor\x1b[0m:\x1b[1;34m${promptName}\x1b[0m$ `);
                },
                onStdinRequired: (interactive: boolean) => {
                    const t = xtermRef.current;
                    if (!t) return;
                    if (interactive) {
                        t.writeln('\r\n\x1b[3;33mProgram is waiting for input — type below (PTY echoes).\x1b[0m');
                    } else {
                        t.writeln('\r\n\x1b[3;33mProgram requires input — type a line and press Enter.\x1b[0m');
                    }
                },
                onError: (message: string) => {
                    const t = xtermRef.current;
                    if (!t) return;
                    t.writeln(`\r\n\x1b[1;31m${message}\x1b[0m`);
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
            setIsRunning(true);

            const termX = xtermRef.current;
            session.startCode(
                ce.detail.code,
                runLanguage,
                preStdin,
                termX ? termX.cols : 120,
                termX ? termX.rows : 30,
                runCwd,
            );
        };

        const handleKill = (e: Event) => {
            const ce = e as CustomEvent;
            if (ce.detail.id === terminalId) {
                const session = sessionRef.current;
                if (session && session.isActive) {
                    session.stop();
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
                    const left = commandBuffer.current.slice(0, cursorPos.current);
                    const right = commandBuffer.current.slice(cursorPos.current);
                    const cleanText = text.replace(/\n/g, ' '); // treat multi-line paste mildly
                    commandBuffer.current = left + cleanText + right;
                    cursorPos.current += cleanText.length;

                    term.write(cleanText + right);
                    if (right.length > 0) {
                        term.write(`\x1b[${right.length}D`);
                    }
                } catch { }
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

            // Terminate the session's process + transport on unmount (no orphans).
            const session = sessionRef.current;
            if (session && session.isActive) {
                session.dispose();
            }
            sessionRef.current = null;
            setIsRunning(false);
        };
    }, [terminalId, terminalEventEmitter, setIsRunning]);

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
