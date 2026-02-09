import React from 'react';
import { Sidebar } from '../Sidebar/Sidebar';
import { CodeEditor } from '../Editor/CodeEditor';
import { AIAssistant } from '../Panels/AIAssistant';
import { BottomPanel } from '../Panels/BottomPanel';

export const MainLayout: React.FC = () => {
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
    const [resizingSide, setResizingSide] = React.useState<'left' | 'right' | 'bottom' | null>(null);

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

    const toggleAiSidebar = React.useCallback(() => {
        setIsAiSidebarOpen(prev => !prev);
    }, []);

    const startResizingRight = React.useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setResizingSide('right');
    }, []);

    const startResizingLeft = React.useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setResizingSide('left');
    }, []);

    const startResizingBottom = React.useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setResizingSide('bottom');
    }, []);

    const stopResizing = React.useCallback(() => {
        setResizingSide(null);
    }, []);

    const resize = React.useCallback(
        (e: MouseEvent) => {
            if (resizingSide === 'right') {
                const newWidth = window.innerWidth - e.clientX;
                if (newWidth > 200 && newWidth < 800) {
                    setAiPanelWidth(newWidth);
                }
            } else if (resizingSide === 'left') {
                const newWidth = e.clientX;
                if (newWidth > 150 && newWidth < 600) {
                    setLeftSidebarWidth(newWidth);
                }
            } else if (resizingSide === 'bottom') {
                const newHeight = window.innerHeight - e.clientY;
                if (newHeight > 100 && newHeight < 600) {
                    setBottomPanelHeight(newHeight);
                }
            }
        },
        [resizingSide]
    );

    React.useEffect(() => {
        window.addEventListener('mousemove', resize);
        window.addEventListener('mouseup', stopResizing);
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [resize, stopResizing]);

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
        <div className="flex h-screen w-full bg-background text-text overflow-hidden relative">
            {/* Background Glow Effects */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-glass-pulse" />
                <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-purple-500/5 rounded-full blur-3xl animate-glass-pulse" style={{ animationDelay: '1s' }} />
            </div>

            {/* Left Sidebar (File Explorer) */}
            <div
                style={{ width: Math.max(150, leftSidebarWidth) }}
                className="glass-panel flex flex-col shrink-0 relative z-10 border-r border-white/5 shadow-2xl"
            >
                <Sidebar />
            </div>

            {/* Left Resize Handle */}
            <div
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

                    {/* Bottom Resize Handle */}
                    <div
                        className="h-1.5 glass-resize-handle-vertical cursor-row-resize z-20 flex items-center justify-center shrink-0 hover:h-2 transition-all"
                        onMouseDown={startResizingBottom}
                    >
                        <div className="w-20 h-0.5 bg-white/10 rounded-full" />
                    </div>

                    {/* Bottom Panel */}
                    <div
                        style={{ height: bottomPanelHeight }}
                        className="glass-panel shrink-0 border-t border-white/10"
                    >
                        <BottomPanel />
                    </div>
                </div>

                {/* Right Resize Handle */}
                <div
                    className="w-1.5 glass-resize-handle cursor-col-resize z-20 flex items-center justify-center shrink-0 hover:w-2 transition-all"
                    onMouseDown={startResizingRight}
                >
                    <div className="h-8 w-0.5 bg-white/10 rounded-full" />
                </div>

                {/* Right Sidebar (AI Assistant) */}
                <div
                    style={{
                        width: isAiSidebarOpen ? aiPanelWidth : 0,
                        opacity: isAiSidebarOpen ? 1 : 0,
                    }}
                    className={`glass-panel flex flex-col shrink-0 border-l border-white/10 transition-all duration-300 ease-in-out ${!isAiSidebarOpen ? 'border-none overflow-hidden' : ''}`}
                >
                    <div className="flex-1 min-h-0 flex flex-col" style={{ width: aiPanelWidth }}>
                        <AIAssistant />
                    </div>
                </div>
            </div>
        </div>
    );
};
