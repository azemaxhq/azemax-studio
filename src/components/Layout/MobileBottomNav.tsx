import React from 'react';
import { Code2, Layers, Settings } from 'lucide-react';
import { AzemaxLogo } from '../UI/AzemaxLogo';

export type MobileTab = 'editor' | 'explorer' | 'ai' | 'settings';

interface MobileBottomNavProps {
    activeTab: MobileTab;
    onTabChange: (tab: MobileTab) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
    activeTab,
    onTabChange,
}) => {
    const tabs: Array<{ id: MobileTab; label: string; icon: React.ReactNode }> = [
        {
            id: 'editor',
            label: 'Editor',
            icon: <Code2 size={18} strokeWidth={2} />,
        },
        {
            id: 'explorer',
            label: 'Explorer',
            icon: <Layers size={18} strokeWidth={2} />,
        },
        {
            id: 'ai',
            label: 'AI',
            icon: (
                <div className="flex items-center justify-center">
                    <AzemaxLogo size={16} />
                </div>
            ),
        },
        {
            id: 'settings',
            label: 'Settings',
            icon: <Settings size={18} strokeWidth={2} />,
        },
    ];

    return (
        <nav
            role="navigation"
            aria-label="Mobile navigation"
            className="flex flex-col border-t shrink-0 z-30 select-none"
            style={{
                background: 'var(--az-bg)',
                borderColor: 'var(--az-border)',
                paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0px)',
            }}
        >
            <div className="h-16 flex items-stretch justify-around px-2" style={{ minHeight: '64px' }}>
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => onTabChange(tab.id)}
                            aria-selected={isActive}
                            aria-label={tab.label}
                            role="tab"
                            className={`flex-1 flex flex-col items-center justify-center min-h-[64px] min-w-[48px] py-2 relative transition-colors duration-150 active:opacity-75
                                ${isActive
                                    ? 'text-[var(--az-accent-bright)]'
                                    : 'text-[var(--az-text-muted)] hover:text-[var(--az-text)]'
                                }
                            `}
                        >
                            {/* Active Top Glow Line */}
                            {isActive && (
                                <div
                                    className="absolute top-0 w-8 h-[2px] rounded-full"
                                    style={{ background: 'var(--az-accent)' }}
                                />
                            )}

                            <div className="flex items-center justify-center h-5 w-5 mb-0.5">
                                {tab.icon}
                            </div>
                            <span className="text-[10px] font-medium leading-none tracking-tight">
                                {tab.label}
                            </span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
};
