/**
 * Chat composer dropdown regression tests.
 *
 * The composer used to render its dropdowns *inside* the composer box, which
 * clips its own content (`overflow: hidden`). The model/provider list was
 * therefore cut off, overlapped the composer and looked half hidden. The
 * dropdowns now render through a portal (`AnchorPopover`).
 *
 * This project has no DOM test renderer, so the guarantees are asserted at
 * the level they are actually decided:
 *
 *   • placement geometry  → `computePopoverPlacement` (pure, no DOM)
 *   • the rendered panel  → static rendering of the real components
 *   • the wiring          → the component source (portal target, anchors,
 *                           sizes, preserved composer structure)
 *
 * All provider responses here are MOCKED and every credential is FAKE.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type React from 'react';

// The dropdown is rendered into `document.body` through a portal. There is no
// DOM in the node test environment, so the portal renders its children in
// place — the panel markup is still produced and can be asserted.
vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    const createPortal = (children: unknown) => children;
    const patched = { ...actual, createPortal };
    return {
        ...patched,
        default: { ...(actual.default as object), createPortal },
    };
});

// Minimal DOM stub for the portal target (the portal itself is mocked above).
(globalThis as unknown as { document: { body: object } }).document = { body: {} };

const popoverMock = vi.hoisted(() => ({
    /** Force the dropdown open regardless of the component's own state. */
    forceOpen: false,
    /** Props the dropdown was last rendered with. */
    captured: null as Record<string, unknown> | null,
}));

vi.mock('../src/components/UI/AnchorPopover', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/components/UI/AnchorPopover')>();
    const react = await import('react');
    return {
        ...actual,
        /** The real component stays reachable for direct assertions. */
        __REAL__: actual.AnchorPopover,
        AnchorPopover: (props: Record<string, unknown>) => {
            const effective = {
                ...props,
                open: popoverMock.forceOpen ? true : props.open,
            };
            popoverMock.captured = effective;
            return react.createElement(actual.AnchorPopover as never, effective as never);
        },
    };
});

import {
    computePopoverPlacement,
    POPOVER_DEFAULT_OFFSET,
    POPOVER_VIEWPORT_MARGIN,
    type ViewportRect,
} from '../src/components/UI/popoverPosition';
import { ModelSelector } from '../src/components/Panels/ModelSelector';
import { ProviderProvider } from '../src/core/ai/providerContext';

const SRC = resolvePath(process.cwd(), 'src');
const readSource = (relative: string): string =>
    readFileSync(resolvePath(SRC, relative), 'utf8');

const anchor = (top: number, left: number, width = 120, height = 24): ViewportRect => ({
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
});

beforeEach(() => {
    popoverMock.forceOpen = false;
    popoverMock.captured = null;
});

// ===========================================================================
// 31. Placement geometry — flip, align, clamp
// ===========================================================================

describe('31. dropdown placement geometry', () => {
    it('opens below the trigger when there is more room below', () => {
        const result = computePopoverPlacement({
            anchor: anchor(100, 40),
            panelWidth: 320,
            panelHeight: 420,
            viewportWidth: 1280,
            viewportHeight: 900,
        });
        expect(result.side).toBe('bottom');
        expect(result.top).toBe(124 + POPOVER_DEFAULT_OFFSET);
        expect(result.left).toBe(40);
        // Nothing has to be squeezed — the panel keeps its natural height.
        expect(result.maxHeight).toBe(420);
    });

    it('opens above the trigger when there is more room above', () => {
        // The composer sits at the bottom of the screen, so the dropdown
        // grows upwards instead of over the composer.
        const result = computePopoverPlacement({
            anchor: anchor(600, 40),
            panelWidth: 320,
            panelHeight: 420,
            viewportWidth: 1280,
            viewportHeight: 900,
        });
        expect(result.side).toBe('top');
        expect(result.top).toBe(600 - POPOVER_DEFAULT_OFFSET - result.maxHeight);
        expect(result.maxHeight).toBe(420);
    });

    it('flips above the trigger when the space below is too small', () => {
        const result = computePopoverPlacement({
            anchor: anchor(760, 40),
            panelWidth: 320,
            panelHeight: 420,
            viewportWidth: 1280,
            viewportHeight: 800,
        });
        // Only 800 - 784 - 8 - 8 = 0px of room below, so the panel opens up.
        expect(result.side).toBe('top');
        expect(result.top).toBe(760 - POPOVER_DEFAULT_OFFSET - result.maxHeight);
        expect(result.top).toBeGreaterThanOrEqual(0);
    });

    it('keeps the requested side while it still fits', () => {
        const result = computePopoverPlacement({
            anchor: anchor(500, 40),
            panelWidth: 320,
            panelHeight: 300,
            viewportWidth: 1280,
            viewportHeight: 900,
            placement: 'top',
        });
        expect(result.side).toBe('top');
        expect(result.top).toBe(500 - POPOVER_DEFAULT_OFFSET - 300);
    });

    it('honours the requested side even when the other side is roomier', () => {
        const result = computePopoverPlacement({
            anchor: anchor(700, 40),
            panelWidth: 320,
            panelHeight: 120,
            viewportWidth: 1280,
            viewportHeight: 900,
            placement: 'bottom',
        });
        expect(result.side).toBe('bottom');
    });

    it('aligns the panel with the trigger', () => {
        const base = {
            anchor: anchor(600, 400, 120, 24),
            panelWidth: 320,
            panelHeight: 200,
            viewportWidth: 1280,
            viewportHeight: 900,
        };
        expect(computePopoverPlacement({ ...base, align: 'start' }).left).toBe(400);
        expect(computePopoverPlacement({ ...base, align: 'center' }).left).toBe(300);
        expect(computePopoverPlacement({ ...base, align: 'end' }).left).toBe(200);
    });

    it('never pulls the panel off the viewport edge', () => {
        const result = computePopoverPlacement({
            anchor: anchor(600, 0, 120, 24),
            panelWidth: 320,
            panelHeight: 200,
            viewportWidth: 1280,
            viewportHeight: 900,
            align: 'end',
        });
        // The right edge of the trigger is at 120, so an end-aligned panel
        // would start at -200 — it is clamped to the viewport margin.
        expect(result.left).toBe(POPOVER_VIEWPORT_MARGIN);
    });

    it('clamps the panel inside the viewport on a narrow screen', () => {
        const result = computePopoverPlacement({
            anchor: anchor(700, 280, 26, 26),
            panelWidth: 296,
            panelHeight: 200,
            viewportWidth: 320,
            viewportHeight: 568,
        });
        expect(result.left).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
        expect(result.left + 296).toBeLessThanOrEqual(320 - POPOVER_VIEWPORT_MARGIN);
        expect(result.top).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
        expect(result.top + result.maxHeight).toBeLessThanOrEqual(568 - POPOVER_VIEWPORT_MARGIN);
    });

    it('squeezes the panel instead of letting it overflow a short viewport', () => {
        const result = computePopoverPlacement({
            anchor: anchor(300, 40),
            panelWidth: 320,
            panelHeight: 600,
            viewportWidth: 1280,
            viewportHeight: 500,
        });
        // The panel is capped to the room that is available …
        expect(result.maxHeight).toBeLessThan(600);
        // … and still ends inside the viewport.
        expect(result.top + result.maxHeight).toBeLessThanOrEqual(500 - POPOVER_VIEWPORT_MARGIN);
        expect(result.top).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
    });

    it('never leaves the viewport, whatever the trigger position', () => {
        const viewportWidth = 360;
        const viewportHeight = 640;
        for (let top = 0; top <= viewportHeight; top += 40) {
            for (let left = 0; left <= viewportWidth; left += 40) {
                const result = computePopoverPlacement({
                    anchor: anchor(top, left, 24, 24),
                    panelWidth: 320,
                    panelHeight: 460,
                    viewportWidth,
                    viewportHeight,
                });
                expect(result.left).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
                expect(result.left + 320).toBeLessThanOrEqual(viewportWidth - POPOVER_VIEWPORT_MARGIN + 0.001);
                expect(result.top).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
                expect(result.top + result.maxHeight).toBeLessThanOrEqual(viewportHeight - POPOVER_VIEWPORT_MARGIN + 0.001);
            }
        }
    });
});

// ===========================================================================
// 32. The anchored popover panel itself
// ===========================================================================

describe('32. anchored popover panel', () => {
    it('renders nothing while it is closed', async () => {
        const mod = (await import('../src/components/UI/AnchorPopover')) as unknown as {
            __REAL__: React.FC<Record<string, unknown>>;
        };
        const markup = renderToStaticMarkup(
            createElement(mod.__REAL__, {
                open: false,
                anchorRef: { current: null },
                onClose: () => {},
                children: createElement('span', null, 'panel content'),
            }),
        );
        expect(markup).toBe('');
    });

    it('renders a fixed, portaled panel while it is open', async () => {
        const mod = (await import('../src/components/UI/AnchorPopover')) as unknown as {
            __REAL__: React.FC<Record<string, unknown>>;
            POPOVER_LAYER_Z: number;
        };
        const markup = renderToStaticMarkup(
            createElement(mod.__REAL__, {
                open: true,
                anchorRef: { current: null },
                onClose: () => {},
                role: 'dialog',
                ariaLabel: 'Model selector',
                children: createElement('span', null, 'panel content'),
            }),
        );
        // Fixed positioning — the panel is not laid out inside the composer.
        expect(markup).toContain('position:fixed');
        // The Azemax floating surface (theme tokens, not hardcoded colours).
        expect(markup).toContain('az-layer-floating');
        expect(markup).not.toMatch(/#[0-9a-fA-F]{6}\b/);
        // Accessible naming is preserved.
        expect(markup).toContain('role="dialog"');
        expect(markup).toContain('aria-label="Model selector"');
        expect(markup).toContain('panel content');
    });

    it('stacks above the application chrome but below the blocking dialogs', async () => {
        const { POPOVER_LAYER_Z } = await import('../src/components/UI/AnchorPopover');
        // Chrome (panels, headers, navs) tops out at z-50 …
        expect(POPOVER_LAYER_Z).toBeGreaterThan(50);
        // … and the blocking dialogs live at z-200 / z-300.
        expect(POPOVER_LAYER_Z).toBeLessThan(200);
    });
});

// ===========================================================================
// 33. Model selector dropdown — closed and open
// ===========================================================================

describe('33. model selector dropdown', () => {
    const renderSelector = (): string =>
        renderToStaticMarkup(
            createElement(ProviderProvider, null, createElement(ModelSelector, null)),
        );

    it('renders only the trigger while it is closed', () => {
        const markup = renderSelector();
        expect(markup).toContain('aria-label="Select AI model"');
        expect(markup).toContain('Azemax Default');
        // The dropdown itself is not in the DOM while it is closed.
        expect(markup).not.toContain('Model selector');
        expect(markup).not.toContain('Search models');
        expect(popoverMock.captured?.open).toBe(false);
    });

    it('renders the dropdown with search, Azemax Default and the provider entries while it is open', () => {
        popoverMock.forceOpen = true;
        const markup = renderSelector();
        expect(popoverMock.captured?.open).toBe(true);
        // Header + search.
        expect(markup).toContain('Select Model');
        expect(markup).toContain('Search models');
        expect(markup).toContain('placeholder="Search models…"');
        // Azemax Default stays the first, server-managed entry.
        expect(markup).toContain('Server-managed AI');
        // The provider settings link survives.
        expect(markup).toContain('Manage Providers');
        // The BYOK entry point is rendered once the provider list has loaded
        // (that happens in an effect, which static rendering does not run).
        expect(readSource('components/Panels/ModelSelector.tsx')).toContain(
            'Connect an AI Provider',
        );
    });

    it('anchors the dropdown to the model trigger and caps it to the viewport', () => {
        popoverMock.forceOpen = true;
        renderSelector();
        const captured = popoverMock.captured as {
            anchorRef: { current: unknown };
            align: string;
            placement: string;
            style: Record<string, unknown>;
            dismissOnEscape: boolean;
        };
        // The trigger is the wrapper that holds the model button.
        expect(captured.anchorRef).toBeTruthy();
        expect(captured.align).toBe('start');
        expect(captured.placement).toBe('auto');
        expect(captured.style.width).toBe(320);
        expect(captured.style.maxWidth).toBe('min(320px, calc(100vw - 24px))');
        // Escape is handled by the selector itself (clear search → close).
        expect(captured.dismissOnEscape).toBe(false);
    });
});

// ===========================================================================
// 34. The composer wiring — no clipping ancestor, no hard-coded offsets
// ===========================================================================

describe('34. composer wiring', () => {
    it('renders every composer dropdown through the shared portal popover', () => {
        const composer = readSource('components/Panels/AIComposer.tsx');
        const selector = readSource('components/Panels/ModelSelector.tsx');
        // One shared implementation, used by the composer and the selector.
        expect(composer).toMatch(/from '\.\.\/UI\/AnchorPopover'/);
        expect(selector).toMatch(/from '\.\.\/UI\/AnchorPopover'/);
        // The dropdowns are no longer absolutely positioned inside the
        // composer, which is the container that clips them.
        expect(composer).not.toMatch(/absolute bottom-full[^"]*left-\[/);
        expect(selector).not.toMatch(/absolute bottom-full/);
    });

    it('portals the panel into the document body', () => {
        const popover = readSource('components/UI/AnchorPopover.tsx');
        expect(popover).toMatch(/ReactDOM\.createPortal\(/);
        expect(popover).toMatch(/document\.body/);
        expect(popover).toMatch(/position: 'fixed'/);
    });

    it('anchors the agent dropdown to the agent selector', () => {
        const composer = readSource('components/Panels/AIComposer.tsx');
        // The old hard-coded offset (left-[88px]) could never line up with
        // the Agent button, whose position depends on the model label.
        expect(composer).not.toMatch(/left-\[88px\]/);
        expect(composer).toMatch(/anchorRef=\{agentBtnRef\}/);
        expect(composer).toMatch(/anchorRef=\{attachBtnRef\}/);
    });

    it('keeps the composer structure — attach button, textarea, send button', () => {
        const composer = readSource('components/Panels/AIComposer.tsx');
        expect(composer).toMatch(/aria-label="Attach context"/);
        expect(composer).toMatch(/<textarea/);
        expect(composer).toMatch(/aria-label="Send message"/);
        // The composer keeps its own dimensions.
        expect(composer).toMatch(/min-h-\[40px\] max-h-\[140px\]/);
        expect(composer).toMatch(/height: '40px'/);
        expect(composer).toMatch(/az-composer/);
    });

    it('keeps the model selector and the agent selector on one row', () => {
        const composer = readSource('components/Panels/AIComposer.tsx');
        const bar = composer.slice(
            composer.indexOf('{/* Bottom bar */}'),
            composer.indexOf('{/* collapsed agent mode on mobile'),
        );
        expect(bar).toMatch(/<ModelSelector \/>/);
        expect(bar).toMatch(/aria-label="Select agent mode"/);
        // Both selectors live in the same flex row with one shared gap.
        expect(bar).toMatch(/flex items-center gap-0\.5/);
    });
});
