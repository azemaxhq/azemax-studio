import React, { useEffect, useRef } from 'react';
import { useTerminal } from '../../context/TerminalContext';
import type { LogEntry } from '../../context/TerminalContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Terminal as TerminalIcon } from 'lucide-react';

interface TerminalLogProps {
    id: string;
    visible: boolean;
}

export const TerminalLog: React.FC<TerminalLogProps> = ({ id, visible }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const { terminals, isRunning } = useTerminal();

    const terminal = terminals.find(t => t.id === id);
    const logs = terminal?.logs || [];

    // Smart Auto-scroll
    useEffect(() => {
        if (!visible || !scrollRef.current) return;

        const div = scrollRef.current;
        const isNearBottom = div.scrollHeight - div.scrollTop - div.clientHeight < 120;

        // Priority 1: If execution is active, ALWAYS snap to bottom to follow output
        if (isRunning) {
            div.scrollTop = div.scrollHeight;
            return;
        }

        // Priority 2: Standard auto-scroll if user is already monitoring bottom
        // or if it's a fresh/short log
        if (isNearBottom || logs.length < 10) {
            div.scrollTop = div.scrollHeight;
        }
    }, [logs, visible, isRunning]);

    return (
        <div
            className={`h-full w-full bg-[#0d1117] overflow-y-auto font-mono text-sm relative custom-scrollbar ${visible ? 'block' : 'hidden'}`}
            ref={scrollRef}
            style={{ scrollBehavior: 'smooth' }}
        >
            <div className="p-4 pb-20 min-h-full flex flex-col">
                {logs.length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center text-white/20 gap-4 mt-10">
                        <div className="p-4 rounded-full bg-white/5">
                            <TerminalIcon size={32} />
                        </div>
                        <p className="text-sm italic">Ready to execute code...</p>
                    </div>
                )}

                <AnimatePresence initial={false}>
                    {logs.map((log) => (
                        <LogItem key={log.id} log={log} />
                    ))}
                </AnimatePresence>

                {/* Spacer for bottom scrolling */}
                <div className="h-4" />
            </div>
        </div>
    );
};

const LogItem: React.FC<{ log: LogEntry }> = ({ log }) => {
    const isSystem = log.type === 'system';
    const isError = log.type === 'stderr';

    return (
        <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className={`group flex items-start gap-3 py-0.5 px-2 hover:bg-white/5 transition-colors
                ${isSystem ? 'border-l-2 border-primary/40 bg-primary/5 pl-3 my-1 rounded' : ''}
                ${isError ? 'border-l-2 border-red-500/40 bg-red-500/5 pl-3 my-1 rounded' : ''}
            `}
        >
            {/* Timestamp */}
            <div className={`shrink-0 flex items-center gap-1 select-none opacity-0 group-hover:opacity-100 transition-opacity ${isSystem || isError ? 'mt-0.5' : ''}`}>
                <Clock size={10} className="text-white/30" />
                <span className="text-[10px] text-white/30 font-mono">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 overflow-hidden">
                <span className={`whitespace-pre-wrap break-all
                    ${isError ? 'text-red-400' : ''}
                    ${isSystem ? 'text-blue-400 italic text-[13px] leading-relaxed' : ''}
                    ${log.type === 'stdout' ? 'text-gray-300 leading-normal' : ''}
                `}>
                    {log.content}
                </span>
            </div>
        </motion.div>
    );
};
