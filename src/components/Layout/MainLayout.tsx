import React, { lazy } from 'react';
import { Layers, BookOpen, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from '../Sidebar/Sidebar';
import { SettingsSidebar } from '../Sidebar/SettingsSidebar';
import { CodeEditor } from '../Editor/CodeEditor';
import { AIAssistant } from '../Panels/AIAssistant';
import { BottomPanel } from '../Panels/BottomPanel';
import { PerformanceBudgetMonitor } from '../PerformanceBudgetMonitor';
import { getSettings } from '../../settings/settingsStore';
import { useSettingsSelector } from '../../settings/settingsStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';

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
    // Developer diagnostics overlay (gated by the Advanced setting)
    const developerDiagnostics = useSettingsSelector((s) => s.advanced.developerDiagnostics);

    // Below 1024px the app switches to an overlay-drawer layout: the side panels
    // slide over the editor instead of stealing inline width. The media query is
    // tracked via matchMedia (no resize listeners / polling).
    const isDesktop = useMediaQuery('(min-width: 1024px)');

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
    const [isBottomOpen, setIsBottomOpen] = React.useState(true);
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
                setIsBottomOpen(false);
            }
            return !prev;
        });
    }, [isDesktop]);

    const toggleBottomPanel = React.useCallback(() => {
        setIsBottomOpen(prev => {
            if (!prev && !isDesktop) setIsAiSidebarOpen(false);
            return !prev;
        });
    }, [isDesktop]);

    const openExplanation = React.useCallback(() => {
        if (!isLeftSidebarOpen) {
            if (!isDesktop) {
                setIsAiSidebarOpen(false);
                setIsBottomOpen(false);
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
                setIsBottomOpen(false);
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
                setIsBottomOpen(false);
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
                e.preventDefault();
                setIsLeftSidebarOpen(prev => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Disable native browser context menu globally
    React.useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
        };

        document.addEventListener('contextmenu', handleContextMenu);
        return () => document.removeEventListener('contextmenu', handleContextMenu);
    }, []);

    return (
        <div className={`flex app-viewport w-full bg-background text-text overflow-hidden relative ${resizingSide ? 'select-none' : ''}`}>
            {/* Resizing Overlay to capture mouse events and prevent iframe swallowing */}
            {resizingSide && (
                <div className={`absolute inset-0 z-[100] ${resizingSide === 'bottom' ? 'cursor-row-resize' : 'cursor-col-resize'}`} />
            )}

            {/* Background Glow Effects (static radial gradients, no GPU blur) */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="bg-glow-primary" />
                <div className="bg-glow-purple" />
            </div>

            {/* Activity Bar (Explorer + Explanation) */}
            <div className={`shrink-0 flex flex-col items-center justify-start gap-2 py-3 w-[56px] bg-[#0d1117]/80 border-r border-white/[0.04] ${isDesktop ? 'z-20' : 'z-40'}`}>
                <button
                    onClick={openExplorer}
                    className="relative group/toggle p-1.5 rounded-lg transition-all duration-200 hover:bg-white/[0.06] active:scale-90"
                    title="Explorer (⌘B)"
                >
                    <div className={`w-[32px] h-[32px] rounded-[10px] bg-gradient-to-br from-blue-500/20 via-cyan-500/10 to-blue-600/15 border flex items-center justify-center transition-all duration-200 group-hover/toggle:from-blue-500/30 group-hover/toggle:to-blue-600/25 group-hover/toggle:shadow-[0_2px_12px_rgba(59,130,246,0.25)] group-active/toggle:scale-90 ${isLeftSidebarOpen && leftSidebarView === 'explorer' ? 'border-blue-400/30 shadow-[0_2px_8px_rgba(59,130,246,0.2)]' : 'border-blue-400/15 shadow-[0_2px_8px_rgba(59,130,246,0.12)]'}`}>
                        <Layers size={16} className="text-blue-400 drop-shadow-[0_0_3px_rgba(59,130,246,0.4)] transition-transform duration-200 group-hover/toggle:scale-110" />
                    </div>
                    {isLeftSidebarOpen && leftSidebarView === 'explorer' && (
                        <div className="absolute top-1 right-0.5 w-[7px] h-[7px] rounded-full bg-gradient-to-br from-emerald-400 to-green-500 border-[1.5px] border-[#0d1117] shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
                    )}
                </button>
                <button
                    onClick={openExplanation}
                    className="relative group/toggle p-1.5 rounded-lg transition-all duration-200 hover:bg-white/[0.06] active:scale-90"
                    title="Code Explanation"
                >
                    <div className={`w-[32px] h-[32px] rounded-[10px] bg-gradient-to-br from-[#a371f7]/20 via-[#58a6ff]/10 to-[#a371f7]/15 border flex items-center justify-center transition-all duration-200 group-hover/toggle:from-[#a371f7]/30 group-hover/toggle:to-[#a371f7]/25 group-hover/toggle:shadow-[0_2px_12px_rgba(163,113,247,0.25)] group-active/toggle:scale-90 ${isLeftSidebarOpen && leftSidebarView === 'explanation' ? 'border-[#a371f7]/40 shadow-[0_2px_8px_rgba(163,113,247,0.2)]' : 'border-[#a371f7]/15 shadow-[0_2px_8px_rgba(163,113,247,0.12)]'}`}>
                        <BookOpen size={16} className="text-[#a371f7] drop-shadow-[0_0_3px_rgba(163,113,247,0.4)] transition-transform duration-200 group-hover/toggle:scale-110" />
                    </div>
                    {isLeftSidebarOpen && leftSidebarView === 'explanation' && (
                        <div className="absolute top-1 right-0.5 w-[7px] h-[7px] rounded-full bg-gradient-to-br from-emerald-400 to-green-500 border-[1.5px] border-[#0d1117] shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
                    )}
                </button>
                
                {/* Push settings button to bottom */}
                <div className="flex-1" />
                
                <button
                    onClick={openSettings}
                    className="relative group/toggle p-1.5 rounded-lg transition-all duration-200 hover:bg-white/[0.06] active:scale-90"
                    title="Settings"
                >
                    <div className={`w-[32px] h-[32px] rounded-[10px] bg-gradient-to-br from-gray-500/20 via-gray-500/10 to-gray-600/15 border flex items-center justify-center transition-all duration-200 group-hover/toggle:from-gray-500/30 group-hover/toggle:to-gray-600/25 group-hover/toggle:shadow-[0_2px_12px_rgba(156,163,175,0.25)] group-active/toggle:scale-90 ${isLeftSidebarOpen && leftSidebarView === 'settings' ? 'border-gray-400/30 shadow-[0_2px_8px_rgba(156,163,175,0.2)]' : 'border-gray-400/15 shadow-[0_2px_8px_rgba(156,163,175,0.12)]'}`}>
                        <Settings size={16} className="text-gray-400 drop-shadow-[0_0_3px_rgba(156,163,175,0.4)] transition-transform duration-200 group-hover/toggle:scale-110" />
                    </div>
                    {isLeftSidebarOpen && leftSidebarView === 'settings' && (
                        <div className="absolute top-1 right-0.5 w-[7px] h-[7px] rounded-full bg-gradient-to-br from-emerald-400 to-green-500 border-[1.5px] border-[#0d1117] shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
                    )}
                </button>
            </div>

            {/* Overlay backdrop (only when side panels render as drawers below 1024px) */}
            {!isDesktop && (isLeftSidebarOpen || isAiSidebarOpen || isBottomOpen) && (
                <div
                    className="absolute inset-0 z-30 bg-black/50 backdrop-blur-[2px]"
                    onClick={() => {
                        if (isLeftSidebarOpen) setIsLeftSidebarOpen(false);
                        if (isAiSidebarOpen) setIsAiSidebarOpen(false);
                        if (isBottomOpen) setIsBottomOpen(false);
                    }}
                    aria-hidden="true"
                />
            )}

            {/* Left Sidebar (Explorer or Explanation) - smooth open/close */}
            <div
                ref={leftSidebarRef}
                style={{
                    width: isLeftSidebarOpen ? (isDesktop ? `${Math.max(150, leftSidebarWidth)}px` : `min(${Math.max(150, leftSidebarWidth)}px, calc(100vw - 72px))`) : '0px',
                    opacity: isLeftSidebarOpen ? 1 : 0
                }}
                className={`glass-panel flex flex-col shrink-0 overflow-hidden
                    ${isDesktop
                        ? `relative z-10 ${resizingSide === 'left' ? 'transition-none' : 'transition-all duration-300 ease-in-out'}`
                        : 'absolute top-0 bottom-0 left-[56px] z-40 transition-all duration-300 ease-in-out'}
                    ${isLeftSidebarOpen ? 'border-r border-white/5 shadow-2xl' : 'border-none'}`}
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

            {/* Left Resize Handle */}
            <div
                style={{ display: isDesktop && isLeftSidebarOpen ? 'flex' : 'none' }}
                className="w-1.5 glass-resize-handle cursor-col-resize z-20 flex items-center justify-center shrink-0 hover:w-2 transition-all"
                onMouseDown={startResizingLeft}
            >
                <div className="h-8 w-0.5 bg-white/10 rounded-full group-hover:bg-primary/50" />
            </div>

            {/* Main Content Area (Row) */}
            <div className="flex-1 flex min-w-0 relative z-10">

                {/* Center Column (Editor + Bottom Panel) */}
                <div className="flex-1 flex flex-col min-w-0">
                    {/* Editor Area */}
                    <div className="flex-1 flex min-h-0 relative">
                        <div className="flex-1 min-w-0 glass-panel-light rounded-none border-0 overflow-hidden">

                            <CodeEditor
                                isAiOpen={isAiSidebarOpen}
                                onToggleAi={toggleAiSidebar}
                            />
                        </div>
                    </div>

                    {/* Bottom Resize Handle (desktop only — resizing is mouse-driven) */}
                    {isDesktop && (
                        <div
                            className="h-1.5 glass-resize-handle-vertical cursor-row-resize z-20 flex items-center justify-center shrink-0 hover:h-2 transition-all"
                            onMouseDown={startResizingBottom}
                        >
                            <div className="w-20 h-0.5 bg-white/10 rounded-full" />
                        </div>
                    )}

                    {/* Bottom Panel (desktop: docked inline as today) */}
                    {isDesktop && (
                        <div
                            ref={bottomPanelRef}
                            style={{ height: bottomPanelHeight }}
                            className="glass-panel shrink-0 border-t border-white/10"
                        >
                            <BottomPanel />
                        </div>
                    )}
                </div>

                {/* Right Resize Handle */}
                <div
                    style={{ display: isDesktop && isAiSidebarOpen ? 'flex' : 'none' }}
                    className="w-1.5 glass-resize-handle cursor-col-resize z-20 flex items-center justify-center shrink-0 hover:w-2 transition-all"
                    onMouseDown={startResizingRight}
                >
                    <div className="h-8 w-0.5 bg-white/10 rounded-full" />
                </div>

                {/* Right Sidebar (AI Assistant) */}
                <div
                    ref={rightSidebarRef}
                    style={{
                        width: isAiSidebarOpen ? (isDesktop ? `${aiPanelWidth}px` : `min(${Math.max(200, aiPanelWidth)}px, 92vw)`) : '0px',
                        opacity: isAiSidebarOpen ? 1 : 0,
                    }}
                    className={`glass-panel flex flex-col shrink-0 overflow-hidden
                        ${isDesktop
                            ? `relative z-10 ${resizingSide === 'right' ? 'transition-none' : 'transition-all duration-300 ease-in-out'}`
                            : 'absolute top-0 bottom-0 right-0 z-40 transition-all duration-300 ease-in-out'}
                        ${isAiSidebarOpen ? 'border-l border-white/10' : 'border-none'}`}
                >
                <div className="flex-1 min-h-0 flex flex-col" ref={rightInnerRef} style={isDesktop ? { width: aiPanelWidth } : undefined}>
                    <AIAssistant isVisible={isAiSidebarOpen} />
</div>
            </div>

            {/* Bottom Sheet (mobile/tablet overlay — replaces the docked panel below 1024px) */}
            {!isDesktop && (
                <div
                    className="absolute left-[56px] right-0 bottom-0 z-40 overflow-hidden transition-all duration-300 ease-in-out"
                    style={{ height: isBottomOpen ? `min(${bottomPanelHeight}px, 75dvh)` : '32px' }}
                >
                    <BottomPanel isOverlay isOpen={isBottomOpen} onToggle={toggleBottomPanel} />
                </div>
            )}
        </div>
        <PerformanceBudgetMonitor enabled={process.env.NODE_ENV === 'development' && developerDiagnostics} />
    </div>
    );
};
