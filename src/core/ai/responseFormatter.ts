/**
 * Natural Response Formatter — describes exactly what changed, no JSON leak.
 *
 * Messages are derived from the ACTUAL applied actions and their resolved
 * targets so the user is never told something happened that didn't.
 */

import type { AIAction } from './actionTypes';

interface CommentLike { line: number; text: string; mode?: string }

export function formatNaturalResponse(
    actions: AIAction[],
    appliedCount: number,
    fileName: string | null,
    language?: string | null
): string {
    void language;
    if (appliedCount === 0 || actions.length === 0) {
        if (actions.length === 1 && actions[0].action === 'remove_comments') {
            return `No comments found in \`${actions[0].file || fileName || 'the file'}\` to remove.`;
        }
        return 'The requested state already exists — no changes were needed.';
    }

    // Aggregate comment ops across all add_comments actions for accurate counts
    if (actions.length === 1) {
        const a = actions[0];
        const file = (a as any).file || (a as any).path || fileName || 'the file';
        switch (a.action) {
            case 'add_comments': {
                const comments = a.comments as CommentLike[];
                const removes = comments.filter(c => c.mode === 'remove').length;
                const upserts = comments.length - removes;
                const bits: string[] = [];
                if (upserts > 0) bits.push(upserts === 1 ? `Updated 1 comment in \`${file}\`` : `Updated ${upserts} comments in \`${file}\``);
                if (removes > 0) bits.push(removes === 1 ? 'removed the requested comment' : `removed ${removes} comments`);
                return bits.length > 0 ? `${bits.join(' and ')}.` : `Comment request applied to \`${file}\`.`;
            }
            case 'remove_comments': {
                const preserve = (a as any).preserveLines as number[] | undefined;
                if (preserve && preserve.length > 0) {
                    return `Removed comments from \`${file}\` while preserving the ones you asked to keep.`;
                }
                return `Removed comments from \`${file}\`.`;
            }
            case 'create_file':
                return `Created file \`${a.path}\`.`;
            case 'delete_file':
                return `Deleted file \`${a.path}\`.`;
            case 'rename_file':
                return `Renamed \`${a.path}\` to \`${a.newPath}\`.`;
            case 'update_file':
                return `Updated \`${a.path}\` with the new content.`;
            case 'insert_code':
                return `Inserted code at line ${a.line} in \`${(a as any).path || file}\`.`;
            case 'replace_code':
                return a.startLine === a.endLine
                    ? `Replaced line ${a.startLine} in \`${(a as any).path || file}\`.`
                    : `Replaced lines ${a.startLine}-${a.endLine} in \`${(a as any).path || file}\`.`;
            case 'delete_code':
                return a.startLine === a.endLine
                    ? `Deleted line ${a.startLine} from \`${(a as any).path || file}\`.`
                    : `Deleted lines ${a.startLine}-${a.endLine} from \`${(a as any).path || file}\`.`;
            default:
                return `Applied ${appliedCount} change${appliedCount === 1 ? '' : 's'}.`;
        }
    }

    // Multiple ops — concise per-op summary
    const summary = actions.map(a => {
        switch (a.action) {
            case 'add_comments': return `${a.comments.length} comment${a.comments.length === 1 ? '' : 's'}`;
            case 'remove_comments': return 'comment cleanup';
            case 'create_file': return `created ${(a as any).path}`;
            case 'delete_file': return `deleted ${(a as any).path}`;
            case 'rename_file': return `renamed ${(a as any).path}`;
            case 'update_file': return `updated ${(a as any).path}`;
            case 'insert_code': return `insert at line ${(a as any).line}`;
            case 'replace_code': return `replaced lines ${(a as any).startLine}-${(a as any).endLine}`;
            case 'delete_code': return `deleted lines ${(a as any).startLine}-${(a as any).endLine}`;
            default: return (a as any).action ?? 'change';
        }
    }).join(', ');
    return `Applied ${appliedCount} changes: ${summary}.`;
}
