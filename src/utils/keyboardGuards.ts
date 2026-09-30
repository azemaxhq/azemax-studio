/**
 * Shared keyboard guards for global shortcuts (H8/M13).
 *
 * Global window keydown handlers must never hijack keys that belong to a
 * focused surface (Monaco, terminal, text inputs). These helpers give every
 * handler the same focus discipline.
 */

/** True when the event target is a text-editing surface. */
export function isEditableTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
    const tag = (el as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if ((el as HTMLElement).isContentEditable) return true;
    return false;
}

/** True when focus is inside Monaco (its hidden textarea has .inputarea). */
export function isMonacoTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || typeof (el as Element).closest !== 'function') return false;
    return Boolean((el as Element).closest('.monaco-editor'));
}

/** True when focus is inside the given container ref. */
export function isInside(container: { current: HTMLElement | null }, target: EventTarget | null): boolean {
    const root = container.current;
    const el = target as Node | null;
    if (!root || !el) return false;
    try {
        return root.contains(el);
    } catch {
        return false;
    }
}
