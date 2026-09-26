import type { FileNode } from '../../utils/mockFileSystem';
import { ROOT_NODE_ID } from '../../utils/mockFileSystem';
import { findNodeById, pathOf, rootNode } from '../../utils/safeTree';
import type { Terminal } from '@xterm/xterm';

export interface ShellDeps {
  getFileTree: () => FileNode[];
  localCwdRef: { current: string };
  setLocalCwd: (id: string) => void;
  setSelectedFolder: (id: string) => void;
  syncTerminalToFileExplorer: (id: string) => void;
  createFileInFolder: (parentId: string, name: string) => void;
  ensureFolderUnder: (parentId: string, name: string) => { error?: { message: string } };
  deleteNode: (id: string) => void;
  terminalId: string;
  term: Terminal;
  directoryHistory: { current: string[] };
  historyIndexRef: { current: number };
}

function containerOf(node: FileNode | null, getFileTree: () => FileNode[]): FileNode[] {
  if (!node) return [];
  if (node.id === ROOT_NODE_ID) return getFileTree().filter(n => n.id !== ROOT_NODE_ID);
  return node.children ?? [];
}

function resolveFrom(start: FileNode, pathStr: string, deps: ShellDeps): FileNode | null {
  let cleaned = pathStr.trim();
  let current = start;
  if (cleaned === '~') return rootNode(deps.getFileTree());
  if (cleaned.startsWith('~/')) {
    current = rootNode(deps.getFileTree());
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('/')) {
    current = rootNode(deps.getFileTree());
    cleaned = cleaned.replace(/^\/+/, '');
  }
  if (cleaned === '' || cleaned === '.') return current;
  for (const part of cleaned.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (current.id === ROOT_NODE_ID) continue;
      const parent = current.parentId ? findNodeById(deps.getFileTree(), current.parentId) : null;
      current = parent && parent.type === 'folder' ? parent : rootNode(deps.getFileTree());
      continue;
    }
    const kids = containerOf(current, deps.getFileTree);
    const next = kids.find(n => n.name === part);
    if (!next) return null;
    current = next;
  }
  return current;
}

export function findNode(pathStr: string, deps: ShellDeps): FileNode | null {
  const start = findNodeById(deps.getFileTree(), deps.localCwdRef.current) ?? rootNode(deps.getFileTree());
  return resolveFrom(start, pathStr, deps);
}

function sortFoldersFirst(a: FileNode, b: FileNode): number {
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function handleLs(args: string[], deps: ShellDeps): void {
  const showHidden = args.includes('-a') || args.includes('--all');
  const longFormat = args.includes('-l') || args.includes('--long');
  const targetArg = args.find(arg => !arg.startsWith('-'));
  const targetDir = targetArg ? findNode(targetArg, deps) : findNode('.', deps);
  if (!targetDir || targetDir.type !== 'folder') {
    deps.term.write(`ls: cannot access '${targetArg || '.'}': No such file or directory`);
    return;
  }
  const children = containerOf(targetDir, deps.getFileTree);
  if (longFormat) {
    const sorted = [...children].sort(sortFoldersFirst);
    let out = '';
    for (const child of sorted) {
      if (!showHidden && child.name.startsWith('.')) continue;
      const isFolder = child.type === 'folder';
      const perms = isFolder ? 'drwxr-xr-x' : '-rw-r--r--';
      const size = isFolder ? '0' : (child.content?.length || '0').toString();
      const name = isFolder ? `\x1b[1;34m${child.name}\x1b[0m/` : child.name;
      out += `${perms} 1 guest staff ${size.padStart(8)} ${name}\r\n`;
    }
    if (out) deps.term.write(out);
  } else {
    const sorted = [...children].sort((a, b) => a.name.localeCompare(b.name));
    const visible = showHidden ? sorted : sorted.filter(c => !c.name.startsWith('.'));
    const out = visible.map(c => c.type === 'folder' ? `\x1b[1;34m${c.name}\x1b[0m/` : c.name).join('  ');
    if (out) deps.term.write(out);
  }
}

function handleCd(args: string[], deps: ShellDeps): void {
  const target = args[1] || 'root';
  if (target === '~' || target === '/') {
    deps.setLocalCwd('root'); deps.setSelectedFolder('root'); return;
  }
  if (target === '..') {
    const node = findNode('..', deps);
    const id = node ? node.id : ROOT_NODE_ID;
    deps.setLocalCwd(id); deps.setSelectedFolder(id); return;
  }
  if (target === '-') {
    const h = deps.directoryHistory.current;
    const idx = deps.historyIndexRef.current;
    if (h.length >= 2 && idx > 0) {
      const prev = h[idx - 1];
      deps.setLocalCwd(prev); deps.setSelectedFolder(prev);
      deps.historyIndexRef.current = idx - 1;
      deps.term.write(`\x1b[33mChanged to previous directory: ${prev}\x1b[0m`);
    } else deps.term.write(`cd -: no previous directory in history`);
    return;
  }
  const node = findNode(target, deps);
  if (!node || node.type !== 'folder') {
    deps.term.write(`cd: ${target}: No such file or directory`);
    return;
  }
  const id = node.id === 'root' ? 'root' : node.id;
  deps.setLocalCwd(id); deps.setSelectedFolder(id);
  deps.syncTerminalToFileExplorer(deps.terminalId);
}

function handleTree(args: string[], deps: ShellDeps): void {
  const show = (node: FileNode, prefix = '', isLast = true): string => {
    const conn = isLast ? '└── ' : '├── ';
    const name = node.type === 'folder' ? `\x1b[1;34m${node.name}\x1b[0m/` : node.name;
    let res = prefix + conn + name + '\r\n';
    if (node.children?.length) {
      const sorted = [...node.children].sort(sortFoldersFirst);
      sorted.forEach((child, i) => {
        const last = i === sorted.length - 1;
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        res += show(child, childPrefix, last);
      });
    }
    return res;
  };
  const target = args[1] ? findNode(args[1], deps) : findNode('.', deps);
  if (!target || target.type !== 'folder') deps.term.write(`tree: ${args[1] || '.'}: No such directory`);
  else deps.term.write(show(target));
}

type CommandHandler = (args: string[], deps: ShellDeps) => void | Promise<void>;

const COMMANDS: Record<string, CommandHandler> = {
  ls: handleLs,
  cd: handleCd,
  pwd: (_a, d) => {
    const p = pathOf(d.getFileTree(), d.localCwdRef.current);
    d.term.write(p ? `/${p}` : '/');
  },
  clear: (_a, d) => d.term.clear(),
  echo: (a, d) => d.term.write(a.slice(1).join(' ')),
  cat: (a, d) => {
    if (!a[1]) { d.term.write('cat: missing operand'); return; }
    const f = findNode(a[1], d);
    if (!f || f.type !== 'file') d.term.write(`cat: ${a[1]}: No such file or directory`);
    else d.term.write((f.content || '').replace(/\r?\n/g, '\r\n'));
  },
  touch: (a, d) => {
    if (!a[1]) { d.term.write('touch: missing file operand'); return; }
    const t = a[1]; const idx = t.lastIndexOf('/');
    if (idx === -1) d.createFileInFolder(d.localCwdRef.current, t);
    else {
      const dir = findNode(t.substring(0, idx), d);
      if (!dir || dir.type !== 'folder') d.term.write(`touch: ${t.substring(0, idx)}: No such directory`);
      else d.createFileInFolder(dir.id, t.substring(idx + 1));
    }
  },
  mkdir: (a, d) => {
    if (!a[1]) { d.term.write('mkdir: missing operand'); return; }
    const r = d.ensureFolderUnder(d.localCwdRef.current, a[1]);
    if (r.error) d.term.write(`mkdir: ${a[1]}: ${r.error.message}`);
  },
  rm: (a, d) => {
    // VS Code fileService requires explicit -r/-rf for directories; mirror that to avoid accidental tree loss
    const raw = a.slice(1).filter(x => !x.startsWith('-'));
    const flags = a.slice(1).filter(x => x.startsWith('-'));
    const recursive = flags.some(f => f.includes('r'));
    if (!raw[0]) { d.term.write('rm: missing operand'); return; }
    const n = findNode(raw[0], d);
    if (!n) d.term.write(`rm: ${raw[0]}: No such file or directory`);
    else if (n.id === 'root') d.term.write(`rm: cannot remove root directory`);
    else if (n.type === 'folder' && !recursive) d.term.write(`rm: cannot remove '${raw[0]}': Is a directory (use rm -r)`);
    else d.deleteNode(n.id);
  },
  tree: handleTree,
  help: (_a, d) => {
    d.term.writeln('Azemax - Enhanced Browser Shell');
    d.term.writeln('Available commands: ls [-a] [-l], cd <path>, cd -, pwd, cat, echo, touch, mkdir, rm, find, grep, tree, clear');
    d.term.writeln('Path examples: cd src/components, cd /src, cd .., cd -, cd ~');
  },
};

function handleFind(args: string[], deps: ShellDeps): void {
  const pat = args[1];
  if (!pat) { deps.term.write('find: missing search pattern\r\nUsage: find <pattern>'); return; }
  const dir = args[2] ? findNode(args[2], deps) : findNode('.', deps);
  if (!dir || dir.type !== 'folder') { deps.term.write(`find: ${args[2] || '.'}: No such directory`); return; }
  const results: string[] = []; const visited = new WeakSet<object>();
  const stack: Array<{ node: FileNode; path: string }> = [{ node: dir, path: '' }];
  while (stack.length) {
    const { node, path } = stack.pop()!;
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);
    const cur = path ? `${path}/${node.name}` : node.name;
    if (node.name.toLowerCase().includes(pat.toLowerCase())) results.push(node.type === 'folder' ? `${cur}/` : cur);
    if (Array.isArray(node.children)) for (let i = node.children.length - 1; i >= 0; i--) {
      const c = node.children[i]; if (c && typeof c === 'object') stack.push({ node: c, path: cur });
    }
  }
  if (results.length === 0) deps.term.write(`find: No matches found for "${pat}"`);
  else results.forEach(r => deps.term.write(r + '\r\n'));
}

function handleGrep(args: string[], deps: ShellDeps): void {
  const pat = args[1], fileName = args[2];
  if (!pat || !fileName) { deps.term.write('grep: missing pattern or filename\r\nUsage: grep <pattern> <filename>'); return; }
  const f = findNode(fileName, deps);
  if (!f || f.type !== 'file') { deps.term.write(`grep: ${fileName}: No such file`); return; }
  const lines = (f.content || '').split('\n');
  const matches = lines.map((l, i) => ({ l, i })).filter(x => x.l.toLowerCase().includes(pat.toLowerCase())).map(x => `${x.i + 1}:${x.l}`);
  if (matches.length === 0) deps.term.write(`grep: No matches found for "${pat}" in ${fileName}`);
  else matches.forEach(m => deps.term.write(`\x1b[32m${m}\x1b[0m\r\n`));
}

COMMANDS['find'] = handleFind;
COMMANDS['grep'] = handleGrep;

/**
 * VS Code-like shell tokenization: respects single/double quotes so
 * `echo "hello world"` and `touch "my file.txt"` work. Mirrors the
 * preparePathForShell / shellIntegration tokenization in
 * src/vs/platform/terminal/common/terminalEnvironment.ts (quote-aware).
 */
function splitArgs(input: string): string[] {
  const args: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) { cur += ch; escaped = false; continue; }
    if (ch === '\\' && !inSingle) { escaped = true; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (cur) { args.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur) args.push(cur);
  return args;
}

export function getAvailableCommands(): string[] {
  return Object.keys(COMMANDS);
}

export function createShellExecutor(deps: ShellDeps) {
  return async (cmd: string): Promise<void> => {
    const trimmed = cmd.trim();
    // Preserve empty command feedback (just newline + prompt) like VS Code's shell integration
    deps.term.write('\r\n');
    if (!trimmed) return;
    const args = splitArgs(trimmed);
    const command = args[0];
    if (!command) return;
    const handler = COMMANDS[command];
    if (handler) await handler(args, deps);
    else {
      deps.term.write(`bash: ${command}: command not found\r\nType "help" for available commands.`);
    }
  };
}
