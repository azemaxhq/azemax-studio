import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

interface ContextMenuItem {
    label?: string;
    onClick?: () => void;
    icon?: React.ReactNode;
    type?: 'action' | 'separator';
    shortcut?: string;
    danger?: boolean;
}

interface ContextMenuProps {
    x: number;
    y: number;
    onClose: () => void;
    items: ContextMenuItem[];
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, items }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    // Smart positioning state
    const [position, setPosition] = React.useState({ x, y });
    const [isVisible, setIsVisible] = React.useState(false);

    useEffect(() => {
        if (menuRef.current) {
            const menuRect = menuRef.current.getBoundingClientRect();
            let newX = x;
            let newY = y;

            // Check right edge
            if (x + menuRect.width > window.innerWidth) {
                newX = x - menuRect.width;
            }

            // Check bottom edge
            if (y + menuRect.height > window.innerHeight) {
                newY = y - menuRect.height;
            }

            // Allow some padding
            newX = Math.max(10, Math.min(newX, window.innerWidth - menuRect.width - 10));
            newY = Math.max(10, Math.min(newY, window.innerHeight - menuRect.height - 10));

            setPosition({ x: newX, y: newY });
            setIsVisible(true);
        }
    }, [x, y]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    // Portal logic to escape local stacking contexts
    return ReactDOM.createPortal(
        <div
            ref={menuRef}
            style={{
                top: position.y,
                left: position.x,
                opacity: isVisible ? 1 : 0,
                willChange: 'transform, opacity',
                background: 'var(--az-overlay)',
                borderColor: 'var(--az-border)',
                borderWidth: '1px'
            }}
            className="fixed z-[9999] min-w-[200px] max-w-[300px] w-auto max-h-[min(70vh,480px)] overflow-y-auto border shadow-[0_12px_32px_rgba(0,0,0,0.5)] rounded-[8px] py-1 flex flex-col gap-0 transition-opacity antialiased"
        >
            {items.map((item, index) => {
                if (item.type === 'separator') {
                    return <div key={index} className="h-px bg-white/[0.06] my-1 mx-2" />;
                }

                return (
                    <button
                        key={index}
                        onClick={() => {
                            item.onClick?.();
                            onClose();
                        }}
                        className={`w-full text-left px-2.5 h-[28px] text-[12.5px] flex items-center justify-between transition-colors rounded-[5px] mx-1 select-none leading-none
                        ${item.danger
                                ? 'text-red-400 hover:text-white hover:bg-red-500/80'
                                : 'text-white/75 hover:text-white hover:bg-white/[0.07]'
                            }`}
                        style={{ width: 'calc(100% - 8px)' }}
                    >
                        <div className="flex items-center gap-2">
                            {item.icon}
                            <span>{item.label}</span>
                        </div>
                        {item.shortcut && <span className="text-white/25 text-[10px] ml-6 font-mono tracking-tight">{item.shortcut}</span>}
                    </button>
                );
            })}
        </div>,
        document.body
    );
};
