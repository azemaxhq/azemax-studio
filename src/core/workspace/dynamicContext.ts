/**
 * Dynamic Workspace Context — full context, not single file
 * Builds a token-aware prompt fragment that lets the AI see the whole workspace
 * while staying context-friendly (relevance-scored, budgeted, fresh).
 */

import type { WorkspaceSnapshot } from './workspaceContext';
import { captureLiveIDEContext, getRecentEdits } from './liveIDEContext';
import type { FileNode } from '../../utils/mockFileSystem';

function keywordsFromQuery(query: string): string[] {
    return Array.from(new Set(
        query.toLowerCase()
            .split(/[^a-z0-9_]+/g)
            .filter(w => w.length > 2 && w.length < 24)
            .slice(0, 12)
    ));
}

function langFromPath(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
        py: 'python', java: 'java', js: 'javascript', ts: 'typescript',
        tsx: 'typescript', jsx: 'javascript', html: 'html', css: 'css',
        json: 'json', md: 'markdown', cpp: 'cpp', c: 'c', go: 'go', rs: 'rust',
    };
    return map[ext] ?? ext;
}

export interface DynamicContextResult {
    fragments: string;
    included: Array<{ path: string; content: string; score: number; reason: string }>;
    fileTreeString: string;
}

export function buildDynamicWorkspaceContext(
    snapshot: WorkspaceSnapshot,
    userMessage: string,
    chipPaths: string[],
    opts?: { maxFiles?: number; maxTotalChars?: number; maxPerFileChars?: number }
): DynamicContextResult {
    const maxFiles = opts?.maxFiles ?? 6;
    const maxTotalChars = opts?.maxTotalChars ?? 18000;
    const maxPerFileChars = opts?.maxPerFileChars ?? 4000;

    const live = captureLiveIDEContext(snapshot.fileTree as FileNode[]);
    const keywords = keywordsFromQuery(userMessage);
    const recent = getRecentEdits().slice(0, 8).map(r => r.filePath);
    const chipSet = new Set(chipPaths.map(p => p.toLowerCase()));
    const chipBasenames = new Set(chipPaths.map(p => p.split('/').pop()!.toLowerCase()));

    const candidates: Array<{ path: string; content: string; score: number; reason: string }> = [];

    // Score using full paths list to avoid duplicate bare names
    for (const fullPath of snapshot.allFilePaths) {
        const content = snapshot.fileMap.get(fullPath) ?? '';
        if (!content.trim()) continue;
        if (candidates.some(c => c.path === fullPath)) continue;

        let score = 0;
        const reasons: string[] = [];
        const basename = fullPath.split('/').pop()!.toLowerCase();
        const lowerPath = fullPath.toLowerCase();
        const lowerContent = content.toLowerCase();

        if (chipSet.has(fullPath.toLowerCase()) || chipBasenames.has(basename)) {
            score += 120;
            reasons.push('mentioned');
        }
        if (fullPath === snapshot.fileName || basename === (snapshot.fileName?.split('/').pop()?.toLowerCase() ?? '')) {
            score += 80;
            reasons.push('active');
        }
        if (recent.includes(fullPath) || recent.some(r => r.toLowerCase() === lowerPath || r.split('/').pop()!.toLowerCase() === basename)) {
            score += 30;
            reasons.push('recent');
        }
        // keyword hits in filename
        for (const kw of keywords) {
            if (lowerPath.includes(kw)) { score += 12; reasons.push(`name:${kw}`); break; }
        }
        // keyword hits in content (first early exit per file)
        let contentHit = false;
        for (const kw of keywords) {
            if (lowerContent.includes(kw)) { contentHit = true; break; }
        }
        if (contentHit) { score += 18; reasons.push('content-match'); }

        // language affinity: prefer same language as active
        if (snapshot.language && langFromPath(fullPath) === snapshot.language) {
            score += 4;
        }

        // Tiny files get slight boost for overview
        if (content.length < 1200) score += 2;

        if (score === 0) {
            // Still consider for full workspace overview — low score but keep if we have budget
            score = 1;
            reasons.push('workspace');
        }

        candidates.push({ path: fullPath, content, score, reason: reasons.join(',') });
    }

    // Sort by score desc, then by being active/recent
    candidates.sort((a, b) => b.score - a.score || a.path.length - b.path.length);

    // Always include active + mentioned first, then fill by score
    const included: typeof candidates = [];
    let totalChars = 0;

    const mustInclude = new Set<string>();
    if (snapshot.fileName) mustInclude.add(snapshot.fileName);
    for (const p of chipPaths) mustInclude.add(p);

    // First pass: mustInclude
    for (const p of mustInclude) {
        const c = candidates.find(x => x.path.toLowerCase() === p.toLowerCase() || x.path.split('/').pop()!.toLowerCase() === p.split('/').pop()!.toLowerCase());
        if (c && !included.some(i => i.path === c.path)) {
            const trimmed = c.content.slice(0, maxPerFileChars);
            if (totalChars + trimmed.length > maxTotalChars) break;
            included.push({ ...c, content: trimmed });
            totalChars += trimmed.length;
        } else if (!c && p) {
            // Chip path not in snapshot (maybe unsaved) — try direct lookup
            const direct = snapshot.fileMap.get(p);
            if (direct) {
                const trimmed = direct.slice(0, maxPerFileChars);
                if (totalChars + trimmed.length <= maxTotalChars) {
                    included.push({ path: p, content: trimmed, score: 120, reason: 'mentioned' });
                    totalChars += trimmed.length;
                }
            }
        }
    }

    // Second pass: fill remaining budget with highest scored not yet included
    for (const c of candidates) {
        if (included.length >= maxFiles) break;
        if (included.some(i => i.path === c.path)) continue;
        const trimmed = c.content.slice(0, maxPerFileChars);
        if (totalChars + trimmed.length > maxTotalChars) continue;
        included.push({ ...c, content: trimmed });
        totalChars += trimmed.length;
    }

    // Build fragments
    const lines: string[] = [];
    lines.push(`Workspace: ${snapshot.allFilePaths.length} files | Tree (depth 3):\n${snapshot.fileTreeString.slice(0, 2200)}`);
    if (snapshot.selectionText) {
        lines.push(`Selection [${snapshot.selectionRange?.startLine}-${snapshot.selectionRange?.endLine}] in ${snapshot.fileName}:\n\`\`\`${snapshot.language}\n${snapshot.selectionText.slice(0, 2500)}\n\`\`\``);
    }
    if (live.visibleCode && live.visibleRange) {
        lines.push(`Visible window [${live.visibleRange.startLine}-${live.visibleRange.endLine}] around cursor:\n\`\`\`${snapshot.language}\n${live.visibleCode.slice(0, 3500)}\n\`\`\``);
    }
    if (live.recentEdits.length) {
        lines.push(`Recent edits:\n${live.recentEdits.slice(0, 5).map(e => `- ${e.filePath}: ${e.summary}`).join('\n')}`);
    }
    lines.push(`\n=== FILES (${included.length} included, scored) ===`);
    for (const f of included) {
        const lang = langFromPath(f.path);
        lines.push(`\n--- ${f.path} [score ${f.score}: ${f.reason}] ---\n\`\`\`${lang}\n${f.content}\n\`\`\``);
    }

    return {
        fragments: lines.join('\n\n'),
        included,
        fileTreeString: snapshot.fileTreeString,
    };
}
