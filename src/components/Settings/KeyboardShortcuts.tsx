import React from 'react';

interface Shortcut {
  keys: string;
  action: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: '⌘P / Ctrl+P', action: 'Search files' },
  { keys: '⌘⇧F / Ctrl+Shift+F', action: 'Search code' },
  { keys: '⌘B / Ctrl+B', action: 'Toggle sidebar' },
  { keys: '⌘S / Ctrl+S', action: 'Save file' },
  { keys: '⌘. / Ctrl+.', action: 'Check syntax errors' },
  { keys: '⇧⌥F / Shift+Alt+F', action: 'Format document' },
  { keys: '⌘N / Ctrl+N', action: 'New chat' },
  { keys: '⌘/ / Ctrl+/', action: 'Focus AI input' },
  { keys: 'Esc', action: 'Stop AI response' },
  { keys: '⌘K / Ctrl+K', action: 'Clear terminal' },
  { keys: '⌘⇧C / Ctrl+Shift+C', action: 'Copy terminal output' },
];

export const KeyboardShortcutsList: React.FC = () => {
  return (
    <div className="px-4 pt-3">
      <h3 className="pb-1.5 px-1 text-[10px] font-semibold uppercase tracking-widest text-white/35">Reference</h3>
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
        {SHORTCUTS.map((shortcut, index) => (
          <div
            key={shortcut.keys}
            className={`flex items-center justify-between gap-3 px-4 py-2.5 ${index > 0 ? 'border-t border-white/[0.06]' : ''}`}
          >
            <span className="text-[12px] text-white/70">{shortcut.action}</span>
            <kbd className="text-[11px] font-mono text-white/50 bg-white/[0.07] border border-white/10 rounded px-1.5 py-0.5 whitespace-nowrap">
              {shortcut.keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
};