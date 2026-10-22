/**
 * AnchorPopover — a floating dropdown anchored to a trigger element.
 *
 * Why a portal:
 *   The chat composer (and several panels around it) clip their own content
 *   with `overflow: hidden` so their rounded surfaces stay clean. A dropdown
 *   rendered inside such a container is cut off by it, and a larger
 *   `z-index` cannot fix that — an ancestor's overflow always wins over
 *   stacking. `AnchorPopover` therefore renders into `document.body` with
 *   `position: fixed`, which makes it immune to ancestor clipping and to the
 *   panel's stacking context.
 *
 * Placement:
 *   • the trigger rectangle is measured when the popover opens and re-measured
 *     on scroll / resize, so the panel stays anchored to its trigger;
 *   • `placement="auto"` opens below the trigger and flips above it when the
 *     space below is too small;
 *   • the panel is clamped to the viewport on both axes, and squeezed (so its
 *     content scrolls) when the available room is smaller than the content.
 *
 * Dismissal:
 *   click-outside and Escape are handled here so every dropdown behaves the
 *   same way. Consumers that need different behaviour can opt out.
 *
 * Layout contract:
 *   the panel is a column flex box. Give the scrollable region `min-h-0`
 *   (and `overflow-y-auto`) so it can shrink when the panel is squeezed.
 */

import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import ReactDOM from 'react-dom';
import {
    computePopoverPlacement,
    POPOVER_DEFAULT_OFFSET,
    POPOVER_VIEWPORT_MARGIN,
    type PopoverAlign,
    type PopoverPlacement,
    type ViewportRect,
} from './popoverPosition';

/**
 * Layer for portaled dropdowns.
 *
 * Application chrome (panels, headers, navs) tops out at z-50 and the
 * blocking dialogs live at z-200 / z-300, so dropdowns sit at z-150: above
 * the chrome, below the dialogs.
 */
export const POPOVER_LAYER_Z = 150;

/** `useLayoutEffect` warns during server rendering — fall back to `useEffect`. */
const useIsomorphicLayoutEffect =
    typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface AnchorPopoverProps {
    /** Whether the popover is visible. */
    open: boolean;
    /** The trigger element the popover is anchored to. */
    anchorRef: React.RefObject<HTMLElement | null>;
    /** Called when the popover should close. */
    onClose: () => void;
    /** Preferred side. `auto` opens on the side with more room. */
    placement?: PopoverPlacement;
    /** Horizontal alignment against the trigger. */
    align?: PopoverAlign;
    /** Gap between the trigger and the panel, in pixels. */
    offset?: number;
    /** Extra class names for the panel. */
    className?: string;
    /** Extra inline styles for the panel (width, maxWidth, …). */
    style?: React.CSSProperties;
    /** ARIA role of the panel. */
    role?: string;
    /** Accessible name of the panel. */
    ariaLabel?: string;
    /** Close when the user clicks outside the trigger and the panel. */
    dismissOnOutsideClick?: boolean;
    /** Close when the user presses Escape. */
    dismissOnEscape?: boolean;
    children: React.ReactNode;
}

interface PopoverBox {
    top: number;
    left: number;
    maxHeight: number;
}

export const AnchorPopover: React.FC<AnchorPopoverProps> = ({
    open,
    anchorRef,
    onClose,
    placement = 'auto',
    align = 'start',
    offset = POPOVER_DEFAULT_OFFSET,
    className,
    style,
    role,
    ariaLabel,
    dismissOnOutsideClick = true,
    dismissOnEscape = true,
    children,
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const [box, setBox] = useState<PopoverBox | null>(null);

    /** Measure the trigger and the panel, then place the panel in the viewport. */
    const place = useCallback(() => {
        const anchor = anchorRef.current;
        const panel = panelRef.current;
        if (!anchor || !panel) return;

        const a = anchor.getBoundingClientRect();
        const anchorRect: ViewportRect = {
            top: a.top,
            left: a.left,
            width: a.width,
            height: a.height,
            bottom: a.bottom,
            right: a.right,
        };
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // 1. Measure the natural size of the panel.
        panel.style.maxHeight = 'none';
        const natural = panel.getBoundingClientRect();

        // 2. Work out which side it opens on and how tall it may become.
        const first = computePopoverPlacement({
            anchor: anchorRect,
            panelWidth: natural.width,
            panelHeight: natural.height,
            viewportWidth,
            viewportHeight,
            placement,
            align,
            offset,
            margin: POPOVER_VIEWPORT_MARGIN,
        });

        // 3. Squeeze the panel into the room that is actually available.
        panel.style.maxHeight = `${first.maxHeight}px`;
        const clamped = panel.getBoundingClientRect();

        // 4. Place it with its real size so it sits exactly inside the viewport.
        const final = computePopoverPlacement({
            anchor: anchorRect,
            panelWidth: clamped.width,
            panelHeight: clamped.height,
            viewportWidth,
            viewportHeight,
            placement,
            align,
            offset,
            margin: POPOVER_VIEWPORT_MARGIN,
        });

        setBox(prev => {
            if (
                prev &&
                prev.top === final.top &&
                prev.left === final.left &&
                prev.maxHeight === final.maxHeight
            ) {
                return prev;
            }
            return { top: final.top, left: final.left, maxHeight: final.maxHeight };
        });
    }, [align, anchorRef, offset, placement]);

    // Position before the browser paints, so the panel never flashes at the
    // wrong place.
    useIsomorphicLayoutEffect(() => {
        if (!open) {
            setBox(null);
            return;
        }
        place();
    }, [open, place]);

    // Stay anchored to the trigger while the page scrolls or the window resizes.
    useEffect(() => {
        if (!open) return;
        let frame = 0;
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(place);
        };
        // `capture` catches scrolls of every scrollable ancestor.
        window.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('scroll', schedule, true);
            window.removeEventListener('resize', schedule);
        };
    }, [open, place]);

    // Click-outside and Escape dismissal.
    useEffect(() => {
        if (!open) return;

        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node;
            // The trigger counts as "inside" — clicking it toggles instead of
            // dismissing.
            if (anchorRef.current?.contains(target)) return;
            if (panelRef.current?.contains(target)) return;
            onClose();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        if (dismissOnOutsideClick) {
            document.addEventListener('mousedown', onMouseDown);
        }
        if (dismissOnEscape) {
            document.addEventListener('keydown', onKeyDown, true);
        }
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [open, anchorRef, onClose, dismissOnOutsideClick, dismissOnEscape]);

    if (!open) return null;

    const panelStyle: React.CSSProperties = {
        ...style,
        position: 'fixed',
        top: box?.top ?? 0,
        left: box?.left ?? 0,
        zIndex: POPOVER_LAYER_Z,
        maxHeight: box?.maxHeight,
        // Hidden until it has been measured and placed.
        visibility: box ? 'visible' : 'hidden',
    };

    return ReactDOM.createPortal(
        <div
            ref={panelRef}
            role={role}
            aria-label={ariaLabel}
            className={`az-layer-floating flex flex-col overflow-hidden animate-fade-in${className ? ` ${className}` : ''}`}
            style={panelStyle}
        >
            {children}
        </div>,
        document.body,
    );
};

export default AnchorPopover;
