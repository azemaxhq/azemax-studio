/**
 * popoverPosition — pure geometry for anchored dropdowns.
 *
 * The placement rules live here instead of inside the React component so
 * they can be unit tested without a browser. Two guarantees matter for the
 * chat composer:
 *
 *   1. a dropdown flips to the other side of its trigger when there is not
 *      enough room on the preferred side;
 *   2. a dropdown never leaves the viewport — it is clamped on both axes
 *      and squeezed (so its content scrolls) instead of being clipped.
 */

/** A rectangle in viewport coordinates. */
export interface ViewportRect {
    top: number;
    left: number;
    width: number;
    height: number;
    bottom: number;
    right: number;
}

/** Which side of the trigger the panel opens on. `auto` picks the roomier side. */
export type PopoverPlacement = 'bottom' | 'top' | 'auto';

/** Horizontal alignment of the panel against the trigger. */
export type PopoverAlign = 'start' | 'center' | 'end';

export interface PopoverSpace {
    /** The trigger's rectangle, in viewport coordinates. */
    anchor: ViewportRect;
    /** Natural size of the panel. */
    panelWidth: number;
    panelHeight: number;
    viewportWidth: number;
    viewportHeight: number;
    /** Preferred side. `auto` opens on the side with more room. */
    placement?: PopoverPlacement;
    /** Horizontal alignment against the trigger. */
    align?: PopoverAlign;
    /** Gap between the trigger and the panel, in pixels. */
    offset?: number;
    /** Minimum gap between the panel and the viewport edges. */
    margin?: number;
}

export interface PopoverPlacementResult {
    /** Distance from the top of the viewport. */
    top: number;
    /** Distance from the left of the viewport. */
    left: number;
    /** Height the panel may take before its content has to scroll. */
    maxHeight: number;
    /** The side the panel ended up on. */
    side: 'top' | 'bottom';
}

/** Gap between a trigger and the dropdown it opens. */
export const POPOVER_DEFAULT_OFFSET = 8;

/** Minimum gap between a dropdown and the viewport edges. */
export const POPOVER_VIEWPORT_MARGIN = 8;

/**
 * Work out where an anchored panel goes and how tall it may become.
 *
 * The result is always inside the viewport: horizontally it is clamped
 * against the viewport edges, vertically it is clamped and its height is
 * capped to the room that is available on the chosen side.
 */
export function computePopoverPlacement({
    anchor,
    panelWidth,
    panelHeight,
    viewportWidth,
    viewportHeight,
    placement = 'auto',
    align = 'start',
    offset = POPOVER_DEFAULT_OFFSET,
    margin = POPOVER_VIEWPORT_MARGIN,
}: PopoverSpace): PopoverPlacementResult {
    const roomBelow = Math.max(0, viewportHeight - anchor.bottom - offset - margin);
    const roomAbove = Math.max(0, anchor.top - offset - margin);

    const fitsBelow = roomBelow >= panelHeight;
    const fitsAbove = roomAbove >= panelHeight;

    let side: 'top' | 'bottom';
    if (placement === 'bottom') {
        // Keep the requested side unless it does not fit at all.
        side = fitsBelow || !fitsAbove ? 'bottom' : 'top';
    } else if (placement === 'top') {
        side = fitsAbove || !fitsBelow ? 'top' : 'bottom';
    } else {
        side = roomBelow >= roomAbove ? 'bottom' : 'top';
    }

    const room = side === 'bottom' ? roomBelow : roomAbove;
    // The panel is squeezed into the available room and scrolls inside,
    // instead of overflowing the viewport.
    const maxHeight = Math.max(0, Math.min(panelHeight, room));
    const height = Math.min(panelHeight, maxHeight);

    const minTop = margin;
    const maxTop = Math.max(minTop, viewportHeight - height - margin);
    let top = side === 'bottom' ? anchor.bottom + offset : anchor.top - offset - height;
    top = Math.min(Math.max(top, minTop), maxTop);

    const minLeft = margin;
    const maxLeft = Math.max(minLeft, viewportWidth - panelWidth - margin);
    let left: number;
    if (align === 'end') {
        left = anchor.right - panelWidth;
    } else if (align === 'center') {
        left = anchor.left + anchor.width / 2 - panelWidth / 2;
    } else {
        left = anchor.left;
    }
    left = Math.min(Math.max(left, minLeft), maxLeft);

    return { top, left, maxHeight, side };
}
