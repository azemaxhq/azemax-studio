/**
 * CursorPositionStore
 *
 * A tiny external store that holds the editor cursor position outside React.
 * Monaco's onDidChangeCursorPosition fires on every cursor move; routing that
 * through setState re-rendered the entire CodeEditor tree (toolbar, buttons,
 * status bar) per keystroke/arrow. Only the status-bar line/col readout needs
 * the value, so it subscribes here in isolation and CodeEditor never re-renders.
 *
 * Writes are batched to one animation frame so rapid cursor movement triggers
 * a single store notify (and thus a single tiny subscriber render) per frame.
 */

import { useSyncExternalStore } from 'react';

export interface CursorPosition {
    lineNumber: number;
    column: number;
}

let position: CursorPosition = { lineNumber: 1, column: 1 };
let pending: CursorPosition | null = null;
let frameId: number | null = null;
const subscribers = new Set<() => void>();

const getSnapshot = () => position;
const getServerSnapshot = () => position;

function notify(): void {
    for (const cb of subscribers) cb();
}

function flush(): void {
    frameId = null;
    if (pending) {
        position = pending;
        pending = null;
        notify();
    }
}

/** Write the latest cursor position (frame-coalesced, idempotent). */
export function setCursorPosition(next: CursorPosition): void {
    if (position.lineNumber === next.lineNumber && position.column === next.column) return;
    pending = next;
    if (frameId === null) {
        frameId = requestAnimationFrame(flush);
    }
}

function subscribe(callback: () => void): () => void {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
}

/** Subscribe a React component to the cursor position without re-rendering others. */
export function useCursorPosition(): CursorPosition {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}