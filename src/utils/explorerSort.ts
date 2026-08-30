import type { FileNode } from './mockFileSystem';
import { ROOT_NODE_ID } from './mockFileSystem';

export type SortBy = 'name' | 'type' | 'modified' | 'size';
export type SortDirection = 'asc' | 'desc';

export interface ExplorerSortState {
  by: SortBy;
  direction: SortDirection;
  foldersFirst: boolean;
}

const STORAGE_KEY = 'azemax-explorer-sort';

export const DEFAULT_SORT: ExplorerSortState = {
  by: 'name',
  direction: 'asc',
  foldersFirst: true,
};

const VALID_BY = new Set<SortBy>(['name', 'type', 'modified', 'size']);

export function loadSortState(): ExplorerSortState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const by = VALID_BY.has(parsed?.by) ? parsed.by : DEFAULT_SORT.by;
      const direction = parsed?.direction === 'desc' ? 'desc' : 'asc';
      const foldersFirst = typeof parsed?.foldersFirst === 'boolean' ? parsed.foldersFirst : DEFAULT_SORT.foldersFirst;
      return { by, direction, foldersFirst };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SORT };
}

export function saveSortState(state: ExplorerSortState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

// Natural collator for premium IDE ordering
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1).toLowerCase();
  return '';
}

function sizeOf(node: FileNode): number {
  if (node.type === 'folder') return node.children?.length ?? 0;
  return node.content?.length ?? 0;
}

// Deterministic "modified" proxy — uses content length + id hash so sorting
// is stable even without real timestamps. When real timestamps exist this
// comparator can be swapped without changing call sites.
function modifiedRank(node: FileNode): number {
  // Simple hash of id so order is deterministic but not alphabetical
  let h = 0;
  for (let i = 0; i < node.id.length; i++) h = (h * 31 + node.id.charCodeAt(i)) >>> 0;
  return h + sizeOf(node) * 1000;
}

function compareBy(a: FileNode, b: FileNode, by: SortBy): number {
  switch (by) {
    case 'name':
      return collator.compare(a.name, b.name);
    case 'type': {
      const ea = extOf(a.name);
      const eb = extOf(b.name);
      if (ea !== eb) return collator.compare(ea, eb);
      return collator.compare(a.name, b.name);
    }
    case 'size': {
      const sa = sizeOf(a);
      const sb = sizeOf(b);
      if (sa !== sb) return sa - sb;
      return collator.compare(a.name, b.name);
    }
    case 'modified': {
      const ra = modifiedRank(a);
      const rb = modifiedRank(b);
      if (ra !== rb) return ra - rb;
      return collator.compare(a.name, b.name);
    }
    default:
      return collator.compare(a.name, b.name);
  }
}

export function compareNodesWithSort(a: FileNode, b: FileNode, state: ExplorerSortState): number {
  if (state.foldersFirst && a.type !== b.type) {
    return a.type === 'folder' ? -1 : 1;
  }
  const base = compareBy(a, b, state.by);
  return state.direction === 'desc' ? -base : base;
}

/**
 * Structurally-shared sort — mirrors safeTree.sortTree but respects ExplorerSortState.
 * Levels already sorted keep their identity for memoized subtree bail-outs.
 */
export function sortTreeWithState(nodes: readonly FileNode[] | null | undefined, state: ExplorerSortState): FileNode[] {
  if (!Array.isArray(nodes)) return [];
  const visited = new WeakSet<object>();

  const sortLevel = (level: readonly FileNode[]): FileNode[] => {
    let changed = false;
    const mapped: FileNode[] = [];
    for (const node of level) {
      if (!node || typeof node !== 'object') { changed = true; continue; }
      const n = node as FileNode;
      if (visited.has(n)) { changed = true; continue; }
      visited.add(n);
      if (n.type === 'folder' && Array.isArray(n.children)) {
        const kids = sortLevel(n.children);
        if (kids !== n.children) {
          changed = true;
          mapped.push({ ...n, children: kids });
          continue;
        }
      }
      mapped.push(n);
    }
    const sorted = [...mapped].sort((a, b) => {
      if (a.id === ROOT_NODE_ID) return -1;
      if (b.id === ROOT_NODE_ID) return 1;
      return compareNodesWithSort(a, b, state);
    });
    if (sorted.length !== level.length) changed = true;
    if (!changed) {
      for (let i = 0; i < mapped.length; i++) if (mapped[i] !== sorted[i]) { changed = true; break; }
    }
    return changed ? sorted : (level as FileNode[]);
  };

  return sortLevel(nodes);
}
