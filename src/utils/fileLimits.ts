/**
 * Client-side file size policy.
 *
 * LARGE_FILE_BYTES: above this, the editor skips per-keystroke O(n) work
 * (comment-decoration scans, local diagnostics, full-document copies) that
 * would freeze the tab. The file remains editable; heavy features degrade
 * gracefully instead of wedging the UI.
 *
 * Aligned with the server persistence cap (MAX_FILE_BYTES): files near the
 * cap are already expensive to serialize on every autosave.
 */
export const LARGE_FILE_BYTES = 256 * 1024;

export function isLargeFile(content: string | number | null | undefined): boolean {
    if (typeof content === 'number') return content > LARGE_FILE_BYTES;
    return typeof content === 'string' && content.length > LARGE_FILE_BYTES;
}
