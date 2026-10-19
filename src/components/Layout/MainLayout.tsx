import React, { lazy, useEffect } from 'react';
import { Layers, BookOpen, Settings, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from '../Sidebar/Sidebar';
import { SettingsSidebar } from '../Sidebar/SettingsSidebar';
import { CodeEditor } from '../Editor/CodeEditor';
import { AIAssistant } from '../Panels/AIAssistant';
import { BottomPanel } from '../Panels/BottomPanel';
import { PerformanceBudgetMonitor } from '../PerformanceBudgetMonitor';
import { getSettings } from '../../settings/settingsStore';
import { useAuth } from '../../context/AuthContext';
import { navigate } from '../../utils/appRouter';
import { useSettingsSelector } from '../../settings/settingsStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useMobileViewport } from '../../hooks/useMobileViewport';
import { useProjectFile } from '../../context/ProjectContext';
import { useWorkspaceState } from '../../context/ProjectContext';
import { MobileHeader } from './MobileHeader';
import { MobileBottomNav, type MobileTab } from './MobileBottomNav';
import { MobileSearchModal } from '../UI/MobileSearchModal';
import { FileTabs } from '../Editor/FileTabs';

import { AzemaxLogo } from '../UI/AzemaxLogo';
import { BackendStatusIndicator } from '../UI/BackendStatusIndicator';
import { OnboardingScreen } from '../OnboardingScreen';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const ExplanationSidebar = lazy(() =>
    import('../Sidebar/ExplanationSidebar').then(m => ({ default: m.ExplanationSidebar }))
);

const SidebarFallback = () => (
    <div className="h-full flex items-center justify-center text-xs text-white/30 perf-content-visibility-auto">
        <BookOpen size={16} className="mr-2" />
        Loading explanation...
    </div>
);

export const MainLayout: React.FC = () => {
    const { user } = useAuth();
    // Workspace state drives onboarding vs. IDE. The hook itself is
    // unconditional; the early return lives AFTER every hook call (just below)
    // so hook order is identical on every render.
    const { state } = useWorkspaceState();
    const hasProject = state !== 'no-project';

    // Prevent indexing of private workspace routes
    useEffect(() => {
        const head = document.head;
        let robots = head.querySelector('meta[name="robots"]');
        if (!robots) {
            robots = document.createElement('meta');
            robots.setAttribute('name', 'robots');
            head.appendChild(robots);
        }
        robots.setAttribute('content', 'noindex, nofollow');
        return () => {
            robots.setAttribute('content', 'index, follow');
        };
    }, []);

    // Developer diagnostics overlay (gated by the Advanced setting)
    const developerDiagnostics = useSettingsSelector((s) => s.advanced.developerDiagnostics);

    // Below 1024px the app switches to an overlay-drawer layout: the side panels
    // slide over the editor instead of stealing inline width. The media query is
    // tracked via matchMedia (no resize listeners / polling).
    const isDesktop = useMediaQuery('(min-width: 1024px)');
    const isMobile = useMediaQuery('(max-width: 767px)');
    const { isKeyboardOpen, viewportHeight } = useMobileViewport();

    // Mobile state management
    const [mobileTab, setMobileTab] = React.useState<MobileTab>('editor');
    const [isMobileSearchOpen, setIsMobileSearchOpen] = React.useState(false);
    const [mobileSearchTab, setMobileSearchTab] = React.useState<'files' | 'commands'>('files');
    /**
     * Terminal sheet state (mobile only), sized against the workspace:
     * - collapsed: 44px compact strip (12px handle + 32px tab bar)
     * - half: 45% of the workspace, editor stays visible above
     * - expanded: 80% of the workspace (editor strip stays visible)
     * The sheet stays mounted in all states so xterm.js is never remounted.
     */
    const [mobileSheet, setMobileSheet] = React.useState<'collapsed' | 'half' | 'expanded'>('collapsed');

    // Mobile IDE helpers (hooks only — consumed by the mobile branch below)
    const { activeFile: mobileActiveFile } = useProjectFile();
    const autoOpenTerminalOnRun = useSettingsSelector(s => s.terminal.autoOpenTerminal);
    const mobileSheetRef = React.useRef<HTMLDivElement>(null);
    const mobileSheetDragRef = React.useRef<{ startY: number; startHeight: number } | null>(null);

    // Height of the on-screen keyboard (px) so the terminal sheet and AI
    // composer stay above it instead of being buried underneath.
    const mobileKeyboardHeight = isKeyboardOpen && viewportHeight != null
        ? Math.max(0, window.innerHeight - viewportHeight)
        : 0;

    // Mobile: pressing Run raises the sheet to half height (never maximum)
    // so output is visible — honouring the existing auto-open-terminal setting.
    // A specific sheet tab can be requested via `mobile-open-terminal`.
    // The tab is persisted first so BottomPanel initializes on it.
    React.useEffect(() => {
        const persistTab = (tab: unknown) => {
            if (tab === 'terminal' || tab === 'problems' || tab === 'output') {
                try { localStorage.setItem('bottomPanel_activeTab', tab as string); } catch { /* ignore */ }
            }
        };
        const onRun = () => {
            if (autoOpenTerminalOnRun) setMobileSheet(prev => (prev === 'collapsed' ? 'half' : prev));
        };
        const onOpenSheet = (e: Event) => {
            persistTab((e as CustomEvent).detail?.tab);
            setMobileSheet(prev => (prev === 'collapsed' ? 'half' : prev));
        };
        window.addEventListener('run-button-clicked', onRun);
        window.addEventListener('mobile-open-terminal', onOpenSheet);
        return () => {
            window.removeEventListener('run-button-clicked', onRun);
            window.removeEventListener('mobile-open-terminal', onOpenSheet);
        };
    }, [autoOpenTerminalOnRun]);

    // Mobile: picking a file in Explorer returns to the Editor with that
    // file active. Same file state — only the presentation tab changes.
    const mobilePrevFileIdRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        const currentId = mobileActiveFile?.id ?? null;
        if (mobileTab !== 'explorer') {
            mobilePrevFileIdRef.current = currentId;
        } else if (currentId && mobilePrevFileIdRef.current !== currentId) {
            mobilePrevFileIdRef.current = currentId;
            setMobileTab('editor');
        }
    }, [mobileActiveFile?.id, mobileTab]);

    // Mobile sheet drag: vertical drag on the grabber resizes live (direct
    // DOM write, zero re-renders); release snaps to the nearest of the
    // three states (collapsed / half / expanded). All measurements are
    // relative to the workspace container (editor-root), never the viewport.
    const onMobileSheetDragStart = React.useCallback((e: React.PointerEvent) => {
        const el = mobileSheetRef.current;
        if (!el) return;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        mobileSheetDragRef.current = { startY: e.clientY, startHeight: el.offsetHeight };
    }, []);
    const onMobileSheetDragMove = React.useCallback((e: React.PointerEvent) => {
        const drag = mobileSheetDragRef.current;
        const el = mobileSheetRef.current;
        if (!drag || !el) return;
        const space = el.parentElement?.clientHeight ?? window.innerHeight;
        const next = Math.min(space, Math.max(44, drag.startHeight + (drag.startY - e.clientY)));
        el.style.height = `${next}px`;
    }, []);
    const onMobileSheetDragEnd = React.useCallback((e: React.PointerEvent) => {
        const drag = mobileSheetDragRef.current;
        const el = mobileSheetRef.current;
        mobileSheetDragRef.current = null;
        if (!drag || !el) return;
        try { (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
        const space = el.parentElement?.clientHeight ?? window.innerHeight;
        const ratio = space > 0 ? el.offsetHeight / space : 0;
        el.style.height = '';
        // Snap: <25% → collapsed, <72% → half, else expanded.
        setMobileSheet(ratio < 0.25 ? 'collapsed' : ratio < 0.72 ? 'half' : 'expanded');
    }, []);
    // Tap on the grabber cycles collapsed → half → expanded → half.
    const onMobileSheetGrabberTap = React.useCallback(() => {
        setMobileSheet(prev => (prev === 'collapsed' ? 'half' : prev === 'half' ? 'expanded' : 'half'));
    }, []);

    // Helper to load from storage or default
    const loadState = (key: string, defaultVal: number) => {
        try {
            const saved = localStorage.getItem(key);
            if (saved !== null) {
                const parsed = parseInt(saved, 10);
                return isNaN(parsed) ? defaultVal : parsed;
            }
        } catch (e) {
            console.warn('Failed to load layout state', e);
        }
        return defaultVal;
    };

    const [aiPanelWidth, setAiPanelWidth] = React.useState(() => {
        const width = loadState('layout-ai-panel-width', 350);
        return Math.max(200, Math.min(width, 800)); // Enforce constraints
    });
    const [leftSidebarWidth, setLeftSidebarWidth] = React.useState(() => loadState('layout-left-sidebar-width', 256));
    const [bottomPanelHeight, setBottomPanelHeight] = React.useState(() => loadState('layout-bottom-panel-height', 256));
    const [isAiSidebarOpen, setIsAiSidebarOpen] = React.useState(() => loadState('layout-ai-sidebar-open', 1) === 1);
    const [isLeftSidebarOpen, setIsLeftSidebarOpen] = React.useState(() => {
        const stored = localStorage.getItem('layout-left-sidebar-open');
        if (stored !== null) return stored === '1';
        return getSettings().general.sidebarDefault;
    });
    const [leftSidebarView, setLeftSidebarView] = React.useState<'explorer' | 'explanation' | 'settings'>(() => {
        try {
            const v = localStorage.getItem('layout-left-sidebar-view');
            return (v === 'explanation' ? 'explanation' : v === 'settings' ? 'settings' : 'explorer') as 'explorer' | 'explanation' | 'settings';
        } catch { return 'explorer'; }
    });
    const [resizingSide, setResizingSide] = React.useState<'left' | 'right' | 'bottom' | null>(null);

    // Refs for the resizable panels so the drag loop can mutate the DOM directly
    // (zero React re-renders while dragging) and commit once on release.
    const leftSidebarRef = React.useRef<HTMLDivElement>(null);
    const rightSidebarRef = React.useRef<HTMLDivElement>(null);
    const rightInnerRef = React.useRef<HTMLDivElement>(null);
    const bottomPanelRef = React.useRef<HTMLDivElement>(null);
    const dragStateRef = React.useRef<{
        side: 'left' | 'right' | 'bottom';
        startX: number;
        startY: number;
        startWidth: number;
        startHeight: number;
    } | null>(null);

    // Persistence effects
    React.useEffect(() => {
        localStorage.setItem('layout-ai-panel-width', aiPanelWidth.toString());
    }, [aiPanelWidth]);

    React.useEffect(() => {
        localStorage.setItem('layout-left-sidebar-width', leftSidebarWidth.toString());
    }, [leftSidebarWidth]);

    React.useEffect(() => {
        localStorage.setItem('layout-bottom-panel-height', bottomPanelHeight.toString());
    }, [bottomPanelHeight]);

    React.useEffect(() => {
        localStorage.setItem('layout-ai-sidebar-open', isAiSidebarOpen ? '1' : '0');
    }, [isAiSidebarOpen]);

    React.useEffect(() => {
        localStorage.setItem('layout-left-sidebar-open', isLeftSidebarOpen ? '1' : '0');
    }, [isLeftSidebarOpen]);

    React.useEffect(() => {
        localStorage.setItem('layout-left-sidebar-view', leftSidebarView);
    }, [leftSidebarView]);

    // Clean up any leftover Lookout localStorage entries
    React.useEffect(() => {
        try {
            const savedView = localStorage.getItem('layout-left-sidebar-view');
            if (savedView === 'lookout') {
                localStorage.setItem('layout-left-sidebar-view', 'explorer');
                setLeftSidebarView('explorer');
            }
        } catch (e) {
            console.warn('Failed to clean up Lookout references:', e);
        }
    }, []);

    const toggleAiSidebar = React.useCallback(() => {
        setIsAiSidebarOpen(prev => {
            if (!prev && !isDesktop) {
                setIsLeftSidebarOpen(false);
                setMobileSheet('collapsed');
            }
            return !prev;
        });
    }, [isDesktop]);

    const openExplanation = React.useCallback(() => {
        if (!isLeftSidebarOpen) {
            if (!isDesktop) {
                setIsAiSidebarOpen(false);
                setMobileSheet('collapsed');
            }
            setIsLeftSidebarOpen(true);
            setLeftSidebarView('explanation');
        } else if (leftSidebarView === 'explanation') {
            setIsLeftSidebarOpen(false);
        } else {
            setLeftSidebarView('explanation');
        }
    }, [isLeftSidebarOpen, leftSidebarView, isDesktop]);

    const openExplorer = React.useCallback(() => {
        if (!isLeftSidebarOpen) {
            if (!isDesktop) {
                setIsAiSidebarOpen(false);
                setMobileSheet('collapsed');
            }
            setIsLeftSidebarOpen(true);
            setLeftSidebarView('explorer');
        } else if (leftSidebarView === 'explorer') {
            setIsLeftSidebarOpen(false);
        } else {
            setLeftSidebarView('explorer');
        }
    }, [isLeftSidebarOpen, leftSidebarView, isDesktop]);

    const openSettings = React.useCallback(() => {
        if (!isLeftSidebarOpen) {
            if (!isDesktop) {
                setIsAiSidebarOpen(false);
                setMobileSheet('collapsed');
            }
            setIsLeftSidebarOpen(true);
            setLeftSidebarView('settings');
        } else if (leftSidebarView === 'settings') {
            setIsLeftSidebarOpen(false);
        } else {
            setLeftSidebarView('settings');
        }
    }, [isLeftSidebarOpen, leftSidebarView, isDesktop]);


    const startResizingRight = React.useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        dragStateRef.current = {
            side: 'right',
            startX: e.clientX,
            startY: 0,
            startWidth: rightSidebarRef.current?.offsetWidth ?? 0,
            startHeight: 0,
        };
        setResizingSide('right');
    }, []);

    const startResizingLeft = React.useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        dragStateRef.current = {
            side: 'left',
            startX: e.clientX,
            startY: 0,
            startWidth: leftSidebarRef.current?.offsetWidth ?? 0,
            startHeight: 0,
        };
        setResizingSide('left');
    }, []);

    const startResizingBottom = React.useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        dragStateRef.current = {
            side: 'bottom',
            startX: 0,
            startY: e.clientY,
            startWidth: 0,
            startHeight: bottomPanelRef.current?.offsetHeight ?? 0,
        };
        setResizingSide('bottom');
    }, []);

    // Smooth resizing: during the drag we write directly to the panel's style
    // (no React state update per mousemove) so Monaco's automaticLayout and the
    // surrounding flex layout track the pointer with zero re-render cost. The
    // final size is committed to state once on release (which persists it).
    React.useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            const drag = dragStateRef.current;
            if (!drag) return;

            if (drag.side === 'left') {
                const width = clamp(drag.startWidth + (e.clientX - drag.startX), 150, 600);
                if (leftSidebarRef.current) leftSidebarRef.current.style.width = `${width}px`;
            } else if (drag.side === 'right') {
                const width = clamp(drag.startWidth + (drag.startX - e.clientX), 200, 800);
                if (rightSidebarRef.current) rightSidebarRef.current.style.width = `${width}px`;
                if (rightInnerRef.current) rightInnerRef.current.style.width = `${width}px`;
            } else if (drag.side === 'bottom') {
                const height = clamp(drag.startHeight + (drag.startY - e.clientY), 100, 600);
                if (bottomPanelRef.current) bottomPanelRef.current.style.height = `${height}px`;
            }
        };

        const handleMouseUp = () => {
            const drag = dragStateRef.current;
            if (!drag) return;
            dragStateRef.current = null;
            setResizingSide(null);

            if (drag.side === 'left') {
                const width = leftSidebarRef.current ? parseFloat(leftSidebarRef.current.style.width) : 0;
                if (width > 0) setLeftSidebarWidth(width);
            } else if (drag.side === 'right') {
                const width = rightSidebarRef.current ? parseFloat(rightSidebarRef.current.style.width) : 0;
                if (width > 0) setAiPanelWidth(width);
            } else if (drag.side === 'bottom') {
                const height = bottomPanelRef.current ? parseFloat(bottomPanelRef.current.style.height) : 0;
                if (height > 0) setBottomPanelHeight(height);
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    // Prevent global Select All (Ctrl+A / Cmd+A) unless in an input
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                const target = e.target as HTMLElement;
                const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

                // If not in an input/textarea, prevent browser "Select All"
                if (!isInput) {
                    e.preventDefault();
                    // Optional: Try to focus the code editor if possible, but blocking is sufficient
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                // H8: don't toggle the sidebar while typing in an input.
                const t = e.target as HTMLElement;
                if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
                e.preventDefault();
                setIsLeftSidebarOpen(prev => !prev);
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l' && !e.shiftKey && !e.altKey) {
                // AI toggle — primary premium shortcut
                const target = e.target as HTMLElement;
                const isTextInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
                // Allow in inputs but still dispatch if not composing; keep lightweight
                if (!isTextInput) {
                    e.preventDefault();
                    toggleAiSidebar();
                } else if (target.getAttribute('aria-label') !== 'Search' && target.getAttribute('placeholder') !== 'Search') {
                    // Even in editor-adjacent inputs, allow Cmd+L to toggle AI (VS Code parity)
                    // Monaco handles its own keybindings, so global is safe
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [toggleAiSidebar]);

    // Mobile event listeners
    React.useEffect(() => {
        const onSwitchEditor = () => setMobileTab('editor');
        const onOpenAi = () => {
            if (isMobile) setMobileTab('ai');
            else setIsAiSidebarOpen(true);
        };
        const onOpenExplorer = () => {
            if (isMobile) setMobileTab('explorer');
        };
        const onOpenSettings = () => {
            if (isMobile) setMobileTab('settings');
        };
        window.addEventListener('mobile-switch-to-editor', onSwitchEditor);
        window.addEventListener('ai-panel-open', onOpenAi);
        window.addEventListener('mobile-open-explorer', onOpenExplorer);
        window.addEventListener('mobile-open-settings', onOpenSettings);
        return () => {
            window.removeEventListener('mobile-switch-to-editor', onSwitchEditor);
            window.removeEventListener('ai-panel-open', onOpenAi);
            window.removeEventListener('mobile-open-explorer', onOpenExplorer);
            window.removeEventListener('mobile-open-settings', onOpenSettings);
        };
    }, [isMobile]);

    // Disable native browser context menu globally
    React.useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
        };

        document.addEventListener('contextmenu', handleContextMenu);
        return () => document.removeEventListener('contextmenu', handleContextMenu);
    }, []);

    // No project yet → dedicated welcome experience instead of an empty IDE.
    // Placed after ALL hooks so hook order never changes between renders.
    if (!hasProject) {
        return <OnboardingScreen />;
    }

    // Dedicated Mobile IDE presentation (under 768px).
    // Vertical budget: header 56px + tabs 40px + editor strip 40px +
    // workspace (flex: editor + sheet) + bottom nav 60px. No duplicated Run.
    if (isMobile) {
        return (
            <div
                className="flex flex-col app-viewport w-full overflow-hidden relative select-none"
                style={{ background: 'var(--az-bg)', color: 'var(--az-text)' }}
            >
                {/* Compact IDE header: logo · file · Run/Stop · Search · More */}
                <MobileHeader
                    onOpenSearch={(tab) => {
                        setMobileSearchTab(tab ?? 'files');
                        setIsMobileSearchOpen(true);
                    }}
                    onToggleTerminal={() => setMobileSheet(prev => (prev === 'collapsed' ? 'half' : 'collapsed'))}
                    isTerminalOpen={mobileSheet !== 'collapsed'}
                    onOpenSettings={() => setMobileTab('settings')}
                />

                {/* Compact horizontal file tabs */}
                <FileTabs isMobile={true} />

                {/* Editor — receives all remaining space */}
                <div data-testid="editor-root" className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
                    <div data-testid="editor" className="flex-1 min-w-0 overflow-hidden" style={{ background: 'var(--az-editor-bg)' }}>
                        <CodeEditor
                            isMobile={true}
                            isAiOpen={mobileTab === 'ai'}
                            onToggleAi={() => setMobileTab(prev => prev === 'ai' ? 'editor' : 'ai')}
                        />
                    </div>

                    {/* Backend warm-up status: subtle overlay, never blocks input. */}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                        <BackendStatusIndicator />
                    </div>

                    {/* Terminal / Problems / Output bottom sheet.
                        Always mounted (xterm.js never remounts); three states
                        sized against the workspace container (editor-root):
                        collapsed 44px strip · half 45% · expanded 80%.
                        Expanded fills exactly the editor area — header, tabs
                        and bottom nav stay visible and the handle is never
                        clipped. Collapsed shows only handle + tab selector. */}
                    <div
                        ref={mobileSheetRef}
                        className="absolute left-0 right-0 z-40 flex flex-col shadow-2xl border-t rounded-t-xl overflow-hidden"
                        style={{
                            bottom: mobileKeyboardHeight,
                            height: mobileSheet === 'collapsed' ? '44px' : mobileSheet === 'half' ? '45%' : '80%',
                            // When lifted above the keyboard, cap height so the
                            // handle is never clipped by the workspace bounds.
                            maxHeight: mobileKeyboardHeight > 0 ? `calc(100% - ${mobileKeyboardHeight}px)` : '100%',
                            background: 'var(--az-surface-2)',
                            borderColor: 'var(--az-border-strong)',
                        }}
                    >
                        {/* Slim drag handle — tap cycles states, drag snaps */}
                        <div
                            className="shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none"
                            style={{ height: '12px', touchAction: 'none' }}
                            onPointerDown={onMobileSheetDragStart}
                            onPointerMove={onMobileSheetDragMove}
                            onPointerUp={onMobileSheetDragEnd}
                            onPointerCancel={onMobileSheetDragEnd}
                            onClick={onMobileSheetGrabberTap}
                            role="separator"
                            aria-label="Drag to resize terminal panel, tap to cycle size"
                            title="Drag to resize · tap to cycle size"
                        >
                            <div className="w-10 h-1 rounded-full bg-white/20" />
                        </div>
                        <div className="flex-1 min-h-0 flex flex-col">
                                <BottomPanel
                                    isMobile={true}
                                    isOverlay={false}
                                    isOpen={true}
                                    isExpanded={mobileSheet === 'expanded'}
                                    onToggleExpand={() => setMobileSheet(prev => (prev === 'expanded' ? 'half' : 'expanded'))}
                                    onClose={() => setMobileSheet('collapsed')}
                                    onTabSelect={() => setMobileSheet(prev => (prev === 'collapsed' ? 'half' : prev))}
                                    isCollapsed={mobileSheet === 'collapsed'}
                                />
                            </div>
                        </div>
                </div>

                {/* Bottom navigation (hidden when the virtual keyboard is open) */}
                {!isKeyboardOpen && (
                    <MobileBottomNav
                        activeTab={mobileTab}
                        onTabChange={(tab) => {
                            setMobileTab(tab);
                        }}
                        showActiveIndicator={mobileSheet !== 'collapsed'}
                    />
                )}

                {/* Full-screen mobile workspaces — reuse the desktop components */}
                {mobileTab === 'explorer' && (
                    <div
                        data-testid="sidebar"
                        className="absolute inset-0 z-50 flex flex-col"
                        style={{
                            background: 'var(--az-surface)',
                            paddingTop: 'max(env(safe-area-inset-top, 0px), 0px)',
                        }}
                    >
                        <Sidebar onClose={() => setMobileTab('editor')} />
                    </div>
                )}

                {mobileTab === 'ai' && (
                    <div
                        className="absolute inset-x-0 top-0 z-50 flex flex-col"
                        style={{
                            bottom: mobileKeyboardHeight,
                            background: 'var(--az-surface)',
                            paddingTop: 'max(env(safe-area-inset-top, 0px), 0px)',
                        }}
                    >
                        <AIAssistant isVisible={true} onClose={() => setMobileTab('editor')} />
                    </div>
                )}

                {mobileTab === 'settings' && (
                    <div
                        className="absolute inset-0 z-50 flex flex-col"
                        style={{
                            background: 'var(--az-surface)',
                            paddingTop: 'max(env(safe-area-inset-top, 0px), 0px)',
                        }}
                    >
                        <SettingsSidebar onClose={() => setMobileTab('editor')} />
                    </div>
                )}

                {/* Search / command palette modal */}
                <MobileSearchModal
                    isOpen={isMobileSearchOpen}
                    initialTab={mobileSearchTab}
                    onClose={() => setIsMobileSearchOpen(false)}
                />

                <PerformanceBudgetMonitor enabled={process.env.NODE_ENV === 'development' && developerDiagnostics} />
            </div>
        );
    }

    return (
        <div className={`flex app-viewport w-full overflow-hidden relative ${resizingSide ? 'select-none' : ''}`} style={{ background: 'var(--az-bg)', color: 'var(--az-text)' }}>
            {resizingSide && (
                <div className={`absolute inset-0 z-[100] ${resizingSide === 'bottom' ? 'cursor-row-resize' : 'cursor-col-resize'}`} />
            )}

            {/* Activity Bar — neutral, quiet, optically centered */}
            <div data-testid="activity-bar" className={`shrink-0 flex flex-col items-center gap-1.5 py-2.5 w-[48px] border-r ${isDesktop ? 'z-20' : 'z-40'}`} style={{ background: 'var(--az-bg)', borderColor: 'var(--az-border)' }}>
                <div className="h-10 w-full flex items-center justify-center shrink-0" title="Azemax">
                    <AzemaxLogo size={20} />
                </div>
                <div className="w-6 h-px mb-0.5 shrink-0" style={{ background: 'var(--az-divider)' }} />

                <button
                    data-testid="activity-explorer"
                    onClick={openExplorer}
                    className="az-activity-btn"
                    data-active={isLeftSidebarOpen && leftSidebarView === 'explorer' ? 'true' : 'false'}
                    title="Explorer (⌘B)"
                    aria-label="Explorer"
                    aria-pressed={isLeftSidebarOpen && leftSidebarView === 'explorer'}
                >
                    {isLeftSidebarOpen && leftSidebarView === 'explorer' && (
                        <span className="az-activity-indicator" />
                    )}
                    <Layers size={16} strokeWidth={1.75} className="shrink-0" />
                </button>
                <button
                    onClick={openExplanation}
                    className="az-activity-btn"
                    data-active={isLeftSidebarOpen && leftSidebarView === 'explanation' ? 'true' : 'false'}
                    title="Code Explanation"
                    aria-label="Code Explanation"
                    aria-pressed={isLeftSidebarOpen && leftSidebarView === 'explanation'}
                >
                    {isLeftSidebarOpen && leftSidebarView === 'explanation' && (
                        <span className="az-activity-indicator" />
                    )}
                    <BookOpen size={16} strokeWidth={1.75} className="shrink-0" />
                </button>

                <div className="flex-1" />

                <button
                    onClick={() => {
                        if (!user) {
                            navigate('/login?redirect=/app');
                        } else {
                            openSettings();
                        }
                    }}
                    className="az-activity-btn"
                    title={user ? (user.displayName || user.email) : 'Sign In'}
                    aria-label="Account"
                >
                    {user && user.photoUrl ? (
                        <img src={user.photoUrl} alt="" className="w-4 h-4 rounded-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                        <div className="relative flex items-center justify-center">
                            {user ? (
                                <span className="w-4 h-4 rounded-full bg-[var(--az-accent)]/25 border border-[var(--az-accent)]/40 flex items-center justify-center text-[9px] font-semibold text-[var(--az-accent-bright)]">
                                    {(user.displayName || user.email || '?').charAt(0).toUpperCase()}
                                </span>
                            ) : (
                                <User size={16} strokeWidth={1.75} className="shrink-0" />
                            )}
                            {user && !user.emailVerified && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[var(--az-warning)] border border-[var(--az-bg)]" />
                            )}
                        </div>
                    )}
                </button>

                <button
                    onClick={openSettings}
                    className="az-activity-btn"
                    data-active={isLeftSidebarOpen && leftSidebarView === 'settings' ? 'true' : 'false'}
                    title="Settings"
                    aria-label="Settings"
                    aria-pressed={isLeftSidebarOpen && leftSidebarView === 'settings'}
                >
                    {isLeftSidebarOpen && leftSidebarView === 'settings' && (
                        <span className="az-activity-indicator" />
                    )}
                    <Settings size={16} strokeWidth={1.75} className="shrink-0" />
                </button>
            </div>

            {/* Overlay backdrop — only for the two true drawers (side panels).
                The bottom panel is a docked sheet, not a modal drawer, so it
                must not dim the editor behind it. */}
            {!isDesktop && (isLeftSidebarOpen || isAiSidebarOpen) && (
                <div
                    className="absolute inset-0 z-30 bg-black/50 backdrop-blur-[1px]"
                    style={{ willChange: 'opacity' }}
                    onClick={() => {
                        if (isLeftSidebarOpen) setIsLeftSidebarOpen(false);
                        if (isAiSidebarOpen) setIsAiSidebarOpen(false);
                    }}
                    aria-hidden="true"
                />
            )}

            <div
                data-testid="sidebar"
                ref={leftSidebarRef}
                style={{
                    width: isLeftSidebarOpen ? (isDesktop ? `${Math.max(150, leftSidebarWidth)}px` : `min(${Math.max(150, leftSidebarWidth)}px, calc(100vw - 72px))`) : '0px',
                    background: 'var(--az-surface)',
                    borderColor: 'var(--az-border)'
                }}
                className={`flex flex-col shrink-0 overflow-hidden
                    ${isDesktop
                        ? `relative z-10 ${resizingSide === 'left' ? 'transition-none' : 'transition-[width] duration-200 ease-out' }`
                        : 'absolute top-0 bottom-0 left-[48px] z-40 transition-[width] duration-200 ease-out'}
                    ${isLeftSidebarOpen ? 'border-r' : 'border-0'}`}
            >
                <AnimatePresence mode="wait" initial={false}>
                    {leftSidebarView === 'explorer' ? (
                        <motion.div
                            key="explorer"
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -8 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="h-full flex flex-col min-w-0 min-h-0"
                        >
                            <Sidebar />
                        </motion.div>
                    ) : leftSidebarView === 'settings' ? (
                        <motion.div
                            key="settings"
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -8 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="h-full flex flex-col min-w-0 min-h-0"
                        >
                            <SettingsSidebar />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="explanation"
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -8 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="h-full flex flex-col min-w-0 min-h-0"
                        >
                            <React.Suspense fallback={<SidebarFallback />}>
                                <ExplanationSidebar />
                            </React.Suspense>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div
                style={{ display: isDesktop && isLeftSidebarOpen ? 'flex' : 'none' }}
                className="w-[4px] -mx-[1.5px] cursor-col-resize z-20 shrink-0 group flex justify-center"
                onMouseDown={startResizingLeft}
                aria-hidden="true"
            >
                <div className="h-full w-px group-hover:w-[2px] transition-all" style={{ background: 'var(--az-border)' }} />
            </div>

            {/* Main Content Area (Row) */}
            <div className="flex-1 flex min-w-0 relative z-10">

                {/* Center Column (Editor + Bottom Panel) */}
                <div className="flex-1 flex flex-col min-w-0">
                    {/* Editor Area */}
                    <div data-testid="editor-root" className="flex-1 flex min-h-0 relative">
                        <div data-testid="editor" className="flex-1 min-w-0 overflow-hidden" style={{ background: 'var(--az-editor-bg)', border: 'none' }}>
                            <CodeEditor
                                isAiOpen={isAiSidebarOpen}
                                onToggleAi={toggleAiSidebar}
                            />
                        </div>
                        {/* Backend warm-up status: subtle overlay, never blocks input. */}
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                            <BackendStatusIndicator />
                        </div>
                    </div>

                    {isDesktop && (
                        <div
                            className="h-[4px] -my-[1.5px] cursor-row-resize z-20 shrink-0 group flex flex-col justify-center"
                            onMouseDown={startResizingBottom}
                            aria-hidden="true"
                        >
                            <div className="w-full h-px group-hover:h-[2px] transition-all" style={{ background: 'var(--az-border)' }} />
                        </div>
                    )}

                    {isDesktop && (
                        <div
                            ref={bottomPanelRef}
                            style={{ height: bottomPanelHeight, background: 'var(--az-surface)', borderColor: 'var(--az-border)' }}
                            className="shrink-0 border-t"
                        >
                            <BottomPanel />
                        </div>
                    )}
                </div>

                <div
                    style={{ display: isDesktop && isAiSidebarOpen ? 'flex' : 'none' }}
                    className="w-[4px] -mx-[1.5px] cursor-col-resize z-20 shrink-0 group flex justify-center"
                    onMouseDown={startResizingRight}
                    aria-hidden="true"
                >
                    <div className="h-full w-px group-hover:w-[2px] transition-all" style={{ background: 'var(--az-border)' }} />
                </div>

                <div
                    ref={rightSidebarRef}
                    style={{
                        width: isAiSidebarOpen ? (isDesktop ? `${aiPanelWidth}px` : `min(${Math.max(200, aiPanelWidth)}px, 92vw)`) : '0px',
                        background: 'var(--az-surface)',
                        borderColor: 'var(--az-border)'
                    }}
                    className={`flex flex-col shrink-0 overflow-hidden
                        ${isDesktop
                            ? `relative z-10 ${resizingSide === 'right' ? 'transition-none' : 'transition-[width] duration-200 ease-out'}`
                            : 'absolute top-0 bottom-0 right-0 z-40 transition-[width] duration-200 ease-out'}
                        ${isAiSidebarOpen ? 'border-l' : 'border-0'}`}
                >
                    <div className="flex-1 min-h-0 flex flex-col" ref={rightInnerRef} style={isDesktop ? { width: aiPanelWidth } : undefined}>
                        <AIAssistant isVisible={isAiSidebarOpen} />
                    </div>
                </div>
            </div>
            <PerformanceBudgetMonitor enabled={process.env.NODE_ENV === 'development' && developerDiagnostics} />
        </div>
    );
};
