import type { CategoryDefinition, CategoryKey, SettingDef } from './settingsTypes';
import { nsRemoveItem } from '../utils/userStorage';
import {
  loadChatTombstones,
  loadSessions,
  markChatsClearedAt,
  recordChatTombstones,
  saveSessions,
} from '../utils/chatStorage';

// Actions that need to reach the settings store are registered by the store
// itself at startup. This keeps the schema free of circular imports.
export const actionHandlers = new Map<string, () => void>();
export const registerActionHandler = (id: string, handler: () => void): void => {
  actionHandlers.set(id, handler);
};

const APP_STORAGE_KEYS = [
  'azemax-chat-sessions',
  'azemax-current-session-id',
  'azemax-chat-tombstones',
  'azemax-chat-cleared-at',
  'azemax-file-tree',
  'azemax-active-file-id',
  'azemax-bookmarked-files',
  'azemax-active-terminal-id',
  'azemax-terminals-v3',
  'azemax-workspace-record',
  'azemax-cloud-project-id',
  'azemax-workspace-sync-backup',
  'azemax-expanded-folders',
  'azemax-open-files',
  'deepcontext-chat-sessions',
  'deepcontext-current-session-id',
  'deepcontext-file-tree',
  'deepcontext-active-file-id',
  'deepcontext-bookmarked-files',
  'deepcontext-active-terminal-id',
  'deepcontext-terminals-v3',
  'deepcontext-workspace-record',
  'deepcontext-expanded-folders',
  'codeAnalysis_history',
  'layout-ai-panel-width',
  'layout-left-sidebar-width',
  'layout-bottom-panel-height',
  'layout-ai-sidebar-open',
  'layout-left-sidebar-open',
  'layout-left-sidebar-view',
] as const;

export const SETTINGS_CATEGORIES: CategoryDefinition[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Theme, layout and app behavior',
    icon: 'settings',
    settings: [
      {
        id: 'general.theme',
        type: 'select',
        default: 'dark',
        choices: [
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
          { value: 'auto', label: 'Auto' },
        ],
        label: 'Theme',
        description: 'Color scheme for the whole editor.',
        keywords: ['theme', 'dark', 'light', 'color', 'appearance'],
      },
      {
        id: 'general.uiDensity',
        type: 'select',
        default: 'comfortable',
        choices: [
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'compact', label: 'Compact' },
        ],
        label: 'UI Density',
        description: 'Amount of padding around the editor content.',
        keywords: ['density', 'compact', 'padding', 'spacing'],
      },
      {
        id: 'general.sidebarDefault',
        type: 'select',
        default: 'open',
        choices: [
          { value: 'open', label: 'Open' },
          { value: 'collapsed', label: 'Collapsed' },
        ],
        label: 'Sidebar on Launch',
        description: 'Initial state of the activity bar sidebar on startup.',
        keywords: ['sidebar', 'default', 'open', 'collapsed', 'startup', 'launch'],
      },
      {
        id: 'general.restoreSession',
        type: 'boolean',
        default: true,
        label: 'Restore Previous Session',
        description: 'Reopen previous AI conversations when the app loads.',
        keywords: ['session', 'restore', 'history', 'chat', 'startup'],
      },
      {
        id: 'general.showWelcomeScreen',
        type: 'boolean',
        default: true,
        label: 'Show Welcome Screen',
        description: 'Show the greeting and quick actions in a new AI chat.',
        keywords: ['welcome', 'greeting', 'hero', 'start'],
      },
      {
        id: 'general.showStatusBar',
        type: 'boolean',
        default: true,
        label: 'Show Status Bar',
        description: 'Show the editor status bar at the bottom of the editor.',
        keywords: ['status', 'bar', 'statusbar', 'ui'],
      },
      {
        id: 'general.confirmDelete',
        type: 'boolean',
        default: true,
        label: 'Confirm Deletions',
        description: 'Ask for confirmation before deleting files or folders.',
        keywords: ['delete', 'confirm', 'files', 'destructive'],
      },
      {
        id: 'general.largerUiText',
        type: 'boolean',
        default: false,
        label: 'Larger UI Text',
        description: 'Scale up interface text across the app.',
        keywords: ['text', 'size', 'large', 'accessibility', 'zoom'],
      },
      {
        id: 'general.highContrast',
        type: 'boolean',
        default: false,
        label: 'High Contrast',
        description: 'Increase contrast of UI text and borders.',
        keywords: ['contrast', 'accessibility', 'visibility'],
      },
    ],
  },
  {
    id: 'editor',
    label: 'Editor',
    description: 'Monaco editor appearance and behavior',
    icon: 'code',
    settings: [
      {
        id: 'editor.fontSize',
        type: 'number',
        default: 14,
        min: 8,
        max: 32,
        label: 'Font Size',
        description: 'Text size in the editor (px).',
        keywords: ['font', 'size', 'text'],
      },
      {
        id: 'editor.fontFamily',
        type: 'text',
        default: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', ui-monospace, monospace",
        label: 'Font Family',
        description: 'Monospace font stack used in the editor.',
        keywords: ['font', 'family', 'monospace'],
      },
      {
        id: 'editor.tabSize',
        type: 'number',
        default: 4,
        min: 1,
        max: 8,
        label: 'Tab Size',
        description: 'Number of spaces a tab represents.',
        keywords: ['tab', 'indent', 'spaces', 'width'],
      },
      {
        id: 'editor.insertSpaces',
        type: 'boolean',
        default: true,
        label: 'Insert Spaces',
        description: 'Use spaces instead of tab characters for indentation.',
        keywords: ['tab', 'indent', 'spaces'],
      },
      {
        id: 'editor.wordWrap',
        type: 'boolean',
        default: true,
        label: 'Word Wrap',
        description: 'Wrap long lines to the viewport width.',
        keywords: ['wrap', 'lines', 'overflow'],
      },
      {
        id: 'editor.showMinimap',
        type: 'boolean',
        default: true,
        label: 'Show Minimap',
        description: 'Show the code minimap on the right edge.',
        keywords: ['minimap', 'map', 'overview'],
      },
      {
        id: 'editor.lineNumbers',
        type: 'boolean',
        default: true,
        label: 'Line Numbers',
        description: 'Show line numbers in the editor gutter.',
        keywords: ['line', 'numbers', 'gutter'],
      },
      {
        id: 'editor.bracketPairColorization',
        type: 'boolean',
        default: true,
        label: 'Bracket Pair Colorization',
        description: 'Colorize matching bracket pairs.',
        keywords: ['bracket', 'color', 'highlight', 'guides'],
      },
      {
        id: 'editor.smoothScrolling',
        type: 'boolean',
        default: true,
        label: 'Smooth Scrolling',
        description: 'Smoothly animate scrolling and cursor movement.',
        keywords: ['smooth', 'scroll', 'animation', 'cursor'],
      },
      {
        id: 'editor.cursorBlinking',
        type: 'select',
        default: 'smooth',
        choices: [
          { value: 'blink', label: 'Blink' },
          { value: 'smooth', label: 'Smooth' },
          { value: 'phase', label: 'Phase' },
          { value: 'expand', label: 'Expand' },
          { value: 'solid', label: 'Solid' },
        ],
        label: 'Cursor Blinking',
        description: 'How the editor cursor animates.',
        keywords: ['cursor', 'blink', 'animation'],
      },
      {
        id: 'editor.cursorStyle',
        type: 'select',
        default: 'line',
        choices: [
          { value: 'line', label: 'Line' },
          { value: 'block', label: 'Block' },
          { value: 'underline', label: 'Underline' },
        ],
        label: 'Cursor Style',
        description: 'Shape of the editor cursor.',
        keywords: ['cursor', 'shape', 'style'],
      },
      {
        id: 'editor.renderWhitespace',
        type: 'select',
        default: 'selection',
        choices: [
          { value: 'none', label: 'None' },
          { value: 'boundary', label: 'Boundary' },
          { value: 'selection', label: 'Selection' },
          { value: 'trailing', label: 'Trailing' },
          { value: 'all', label: 'All' },
        ],
        label: 'Render Whitespace',
        description: 'When whitespace characters are rendered.',
        keywords: ['whitespace', 'space', 'render'],
      },
      {
        id: 'editor.stickyScroll',
        type: 'boolean',
        default: true,
        label: 'Sticky Scroll',
        description: 'Keep enclosing scopes visible while scrolling.',
        keywords: ['sticky', 'scroll', 'scope'],
      },
      {
        id: 'editor.codeFolding',
        type: 'boolean',
        default: true,
        label: 'Code Folding',
        description: 'Enable folding of code blocks.',
        keywords: ['fold', 'folding', 'collapse'],
      },
      {
        id: 'editor.autoSave',
        type: 'boolean',
        default: true,
        label: 'Auto Save',
        description: 'Automatically save file changes to the project.',
        keywords: ['save', 'autosave', 'write', 'persist'],
      },
      {
        id: 'editor.autoSaveDelay',
        type: 'slider',
        default: 500,
        min: 100,
        max: 5000,
        step: 100,
        label: 'Auto Save Delay',
        description: 'Debounce interval (ms) before auto-save writes the file.',
        keywords: ['save', 'debounce', 'delay', 'ms'],
      },
      {
        id: 'editor.showHiddenFiles',
        type: 'boolean',
        default: true,
        label: 'Show Hidden Files',
        description: 'Show dotfiles (e.g. .env, .gitignore) in the explorer.',
        keywords: ['hidden', 'dotfiles', 'files', 'explorer'],
      },
    ],
  },
  {
    id: 'code',
    label: 'Code',
    description: 'Formatting, diagnostics and intelligence',
    icon: 'braces',
    settings: [
      {
        id: 'code.formatOnSave',
        type: 'boolean',
        default: false,
        label: 'Format on Save',
        description: 'Run the document formatter when saving.',
        keywords: ['format', 'prettier', 'save'],
      },
      {
        id: 'code.formatOnPaste',
        type: 'boolean',
        default: false,
        label: 'Format on Paste',
        description: 'Automatically format code that is pasted into the editor.',
        keywords: ['format', 'paste', 'prettier'],
      },
      {
        id: 'code.formatOnType',
        type: 'boolean',
        default: false,
        label: 'Format on Type',
        description: 'Format the line as you type in the editor.',
        keywords: ['format', 'type', 'prettier', 'as-you-type'],
      },
      {
        id: 'code.diagnostics',
        type: 'boolean',
        default: true,
        label: 'Code Diagnostics',
        description: 'Enable syntax checking and error diagnostics in the editor.',
        keywords: ['diagnostics', 'syntax', 'check', 'errors', 'lint'],
      },
      {
        id: 'code.quickSuggestions',
        type: 'boolean',
        default: true,
        label: 'Quick Suggestions',
        description: 'Show IntelliSense suggestions while typing.',
        keywords: ['intellisense', 'suggestions', 'autocomplete', 'completion'],
      },
    ],
  },
  {
    id: 'terminal',
    label: 'Terminal',
    description: 'xterm.js appearance, input and execution',
    icon: 'terminal',
    settings: [
      {
        id: 'terminal.fontSize',
        type: 'number',
        default: 14,
        min: 10,
        max: 24,
        label: 'Font Size',
        description: 'Text size in the terminal (px).',
        keywords: ['terminal', 'font', 'size'],
      },
      {
        id: 'terminal.fontFamily',
        type: 'text',
        default: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Geist Mono", Menlo, Consolas, monospace',
        label: 'Font Family',
        description: 'Font stack used by the terminal. VS Code appends ", monospace, AppleBraille" (macOS) as fallbacks.',
        keywords: ['terminal', 'font', 'family', 'monospace'],
      },
      {
        id: 'terminal.letterSpacing',
        type: 'number',
        default: 0,
        min: -5,
        max: 20,
        label: 'Letter Spacing',
        description: 'Extra pixels between characters. Matches VS Code terminal.integrated.letterSpacing (default 0, min -5).',
        keywords: ['terminal', 'letter', 'spacing', 'tracking'],
      },
      {
        id: 'terminal.lineHeight',
        type: 'number',
        default: 1,
        min: 1,
        max: 3,
        label: 'Line Height',
        description: 'Multiplier for line height (fontSize × value). VS Code default 1 (1.1 on Linux for underline hack).',
        keywords: ['terminal', 'line', 'height', 'leading'],
      },
      {
        id: 'terminal.fontWeight',
        type: 'select',
        default: 'normal',
        choices: [
          { value: 'normal', label: 'Normal' },
          { value: 'bold', label: 'Bold' },
          { value: '100', label: '100' },
          { value: '200', label: '200' },
          { value: '300', label: '300' },
          { value: '400', label: '400' },
          { value: '500', label: '500' },
          { value: '600', label: '600' },
          { value: '700', label: '700' },
          { value: '800', label: '800' },
          { value: '900', label: '900' },
        ],
        label: 'Font Weight',
        description: 'Weight for non-bold text. Accepts "normal"/"bold" or 1-1000 (VS Code terminal.integrated.fontWeight).',
        keywords: ['terminal', 'font', 'weight'],
      },
      {
        id: 'terminal.fontWeightBold',
        type: 'select',
        default: 'bold',
        choices: [
          { value: 'normal', label: 'Normal' },
          { value: 'bold', label: 'Bold' },
          { value: '100', label: '100' },
          { value: '200', label: '200' },
          { value: '300', label: '300' },
          { value: '400', label: '400' },
          { value: '500', label: '500' },
          { value: '600', label: '600' },
          { value: '700', label: '700' },
          { value: '800', label: '800' },
          { value: '900', label: '900' },
        ],
        label: 'Font Weight Bold',
        description: 'Weight for bold text. Accepts "normal"/"bold" or 1-1000 (VS Code terminal.integrated.fontWeightBold).',
        keywords: ['terminal', 'font', 'weight', 'bold'],
      },
      {
        id: 'terminal.cursorStyle',
        type: 'select',
        default: 'block',
        choices: [
          { value: 'block', label: 'Block' },
          { value: 'underline', label: 'Underline' },
          { value: 'bar', label: 'Bar' },
        ],
        label: 'Cursor Style',
        description: 'Shape of the terminal cursor.',
        keywords: ['terminal', 'cursor', 'style'],
      },
      {
        id: 'terminal.cursorBlink',
        type: 'boolean',
        default: true,
        label: 'Cursor Blink',
        description: 'Blink the terminal cursor.',
        keywords: ['terminal', 'cursor', 'blink'],
      },
      {
        id: 'terminal.allowTransparency',
        type: 'boolean',
        default: true,
        label: 'Allow Transparency',
        description: 'Let the terminal background blend with the panel.',
        keywords: ['terminal', 'transparency', 'background'],
      },
      {
        id: 'terminal.scrollback',
        type: 'slider',
        default: 1000,
        min: 500,
        max: 10000,
        step: 500,
        label: 'Scrollback',
        description: 'Number of lines kept in the scrollback buffer.',
        keywords: ['terminal', 'scrollback', 'history', 'lines'],
      },
      {
        id: 'terminal.copyOnSelect',
        type: 'boolean',
        default: true,
        label: 'Copy on Selection',
        description: 'Copy the selected text to the clipboard automatically.',
        keywords: ['terminal', 'copy', 'select', 'clipboard'],
      },
      {
        id: 'terminal.rightClickSelectsWord',
        type: 'boolean',
        default: false,
        label: 'Right-click Selects Word',
        description: 'Right-click selects the word under the cursor.',
        keywords: ['terminal', 'right', 'click', 'select', 'word'],
      },
      {
        id: 'terminal.pasteProtection',
        type: 'boolean',
        default: true,
        label: 'Paste Protection',
        description: 'Confirm before pasting multi-line text into a running shell.',
        keywords: ['terminal', 'paste', 'protect', 'confirm', 'multi-line'],
      },
      {
        id: 'terminal.confirmBeforeKill',
        type: 'boolean',
        default: true,
        label: 'Confirm Before Kill',
        description: 'Confirm before stopping a running terminal process.',
        keywords: ['terminal', 'kill', 'stop', 'process', 'confirm'],
      },
      {
        id: 'terminal.autoOpenTerminal',
        type: 'boolean',
        default: true,
        label: 'Auto-open Terminal',
        description: 'Switch to the terminal panel automatically when running code.',
        keywords: ['terminal', 'run', 'open', 'execute'],
      },
      {
        id: 'terminal.clearBeforeRun',
        type: 'boolean',
        default: false,
        label: 'Clear Before Run',
        description: 'Clear the terminal output before each run.',
        keywords: ['clear', 'terminal', 'run', 'execute'],
      },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    description: 'Assistant and code generation behavior',
    icon: 'bot',
    settings: [
      {
        id: 'ai.enabled',
        type: 'boolean',
        default: true,
        label: 'Enable AI Features',
        description: 'Enable the AI assistant and code generation features.',
        keywords: ['ai', 'assistant', 'enable', 'disable', 'code', 'generation'],
      },
      {
        id: 'ai.streaming',
        type: 'boolean',
        default: true,
        label: 'Streaming Responses',
        description: 'Stream AI responses token-by-token as they arrive.',
        keywords: ['streaming', 'stream', 'responses', 'token'],
      },
      {
        id: 'ai.autoScroll',
        type: 'boolean',
        default: true,
        label: 'Auto-scroll Chat',
        description: 'Automatically scroll to the latest message in chat.',
        keywords: ['scroll', 'chat', 'messages', 'sticky'],
      },
      {
        id: 'ai.inlineSuggestions',
        type: 'boolean',
        default: true,
        label: 'Inline Suggestions',
        description: 'Enable AI inline code suggestions in the editor.',
        keywords: ['ai', 'suggestions', 'inline', 'completion'],
      },
      {
        id: 'ai.responseLength',
        type: 'select',
        default: 'medium',
        choices: [
          { value: 'short', label: 'Short' },
          { value: 'medium', label: 'Medium' },
          { value: 'long', label: 'Long' },
        ],
        label: 'Response Length',
        description: 'Maximum verbosity of AI responses.',
        keywords: ['response', 'length', 'tokens', 'verbosity'],
      },
      {
        id: 'ai.confirmClearConversation',
        type: 'boolean',
        default: true,
        label: 'Confirm Clearing Chats',
        description: 'Ask for confirmation before clearing all conversations.',
        keywords: ['chat', 'clear', 'conversation', 'confirm', 'destructive'],
      },
    ],
  },
  {
    id: 'privacy',
    label: 'Privacy & Data',
    description: 'Saved data, export and import',
    icon: 'lock',
    settings: [
      {
        id: 'privacy.localPersistence',
        type: 'boolean',
        default: true,
        label: 'Local Persistence',
        description: 'Save chat history and workspace state on this device.',
        keywords: ['persistence', 'local', 'storage', 'save', 'device'],
      },
      {
        id: 'privacy.saveChatHistory',
        type: 'boolean',
        default: true,
        label: 'Save Chat History',
        description: 'Keep AI conversations saved between sessions.',
        keywords: ['chat', 'history', 'sessions', 'save'],
      },
      {
        id: 'privacy.saveWorkspaceState',
        type: 'boolean',
        default: true,
        label: 'Save Workspace State',
        description: 'Remember the file tree and active file between sessions.',
        keywords: ['workspace', 'file', 'tree', 'state', 'save'],
      },
      {
        id: 'privacy.clearChatHistory',
        type: 'action',
        actionLabel: 'Clear Chat History',
        confirmMessage: 'Delete all saved AI conversations? This cannot be undone.',
        label: 'Clear Chat History',
        description: 'Delete all saved AI conversations from this device and your account.',
        keywords: ['clear', 'chat', 'sessions', 'history', 'delete', 'data'],
        handler: () => {
          // Record deletion markers before dropping the local history. They
          // survive the reload, so if the immediate cloud write fails (offline
          // or a cold backend) the next sync still deletes the conversations
          // instead of restoring them from another device.
          const deletedIds = loadSessions().map((session) => session.id);
          const clearedAt = markChatsClearedAt();
          recordChatTombstones(deletedIds, clearedAt);

          nsRemoveItem('azemax-chat-sessions');
          nsRemoveItem('azemax-current-session-id');
          localStorage.removeItem('azemax-chat-sessions');
          localStorage.removeItem('azemax-current-session-id');
          localStorage.removeItem('deepcontext-chat-sessions');
          localStorage.removeItem('deepcontext-current-session-id');
          // Neutralize any debounced chat write that may already be queued by
          // an in-flight response; the unload flush then writes an empty list
          // instead of restoring the conversations we just deleted.
          saveSessions([]);

          // Push an empty document with the tombstones (rather than deleting
          // the whole section) so other devices learn which conversations were
          // removed and cannot resurrect them. This is best-effort: the local
          // tombstones finish the deletion on the next successful sync even if
          // the reload aborts this request.
          const tombstones = loadChatTombstones();
          void import('../core/sync/accountApi')
            .then(({ putAccountSection }) => putAccountSection('chats', {
              sessions: [],
              currentSessionId: null,
              tombstones,
              clearedAt,
            }))
            .catch(() => {});
          window.location.reload();
        },
      },
      {
        id: 'privacy.clearCachedData',
        type: 'action',
        actionLabel: 'Clear Cached Data',
        confirmMessage: 'Clear cached bookmarks, layout and analysis data? This cannot be undone.',
        label: 'Clear Cached Data',
        description: 'Remove bookmarks, layout preferences and analysis history.',
        keywords: ['clear', 'cache', 'bookmarks', 'layout', 'analysis', 'data'],
        handler: () => {
          nsRemoveItem('azemax-bookmarked-files');
          nsRemoveItem('codeAnalysis_history');
          localStorage.removeItem('azemax-bookmarked-files');
          localStorage.removeItem('deepcontext-bookmarked-files');
          localStorage.removeItem('codeAnalysis_history');
          for (const key of APP_STORAGE_KEYS) {
            if (key.startsWith('layout-')) {
              nsRemoveItem(key);
              localStorage.removeItem(key);
            }
          }
          window.location.reload();
        },
      },
      {
        id: 'privacy.exportSettings',
        type: 'action',
        actionLabel: 'Export Settings',
        confirmMessage: '',
        label: 'Export Settings',
        description: 'Download all settings as a JSON file.',
        keywords: ['export', 'settings', 'backup', 'json', 'file'],
        handler: () => {
          actionHandlers.get('privacy.exportSettings')?.();
        },
      },
      {
        id: 'privacy.importSettings',
        type: 'action',
        actionLabel: 'Import Settings',
        confirmMessage: '',
        label: 'Import Settings',
        description: 'Load settings from a JSON file. Invalid values are rejected.',
        keywords: ['import', 'settings', 'restore', 'json', 'file'],
        handler: () => {
          actionHandlers.get('privacy.importSettings')?.();
        },
      },
    ],
  },
  {
    id: 'performance',
    label: 'Performance',
    description: 'Rendering and animation budgets',
    icon: 'gauge',
    settings: [
      {
        id: 'performance.reducedMotion',
        type: 'boolean',
        default: false,
        label: 'Reduced Motion',
        description: 'Minimize animations and transitions across the app.',
        keywords: ['motion', 'animation', 'reduce', 'accessibility'],
      },
      {
        id: 'performance.disableAnimations',
        type: 'boolean',
        default: false,
        label: 'Disable Decorative Animations',
        description: 'Turn off decorative infinite animations.',
        keywords: ['animation', 'decorative', 'gpu'],
      },
      {
        id: 'performance.performanceMode',
        type: 'boolean',
        default: false,
        label: 'Performance Mode',
        description: 'Prioritize low GPU/CPU usage: disable blur effects and heavy rendering.',
        keywords: ['performance', 'gpu', 'cpu', 'blur', 'effects'],
      },
      {
        id: 'performance.optimizeEditorRendering',
        type: 'boolean',
        default: false,
        label: 'Optimize Editor Rendering',
        description: 'Reduce Monaco rendering overhead for very large files.',
        keywords: ['editor', 'monaco', 'render', 'large', 'files', 'optimize'],
      },
      {
        id: 'performance.terminalOutputBatching',
        type: 'boolean',
        default: true,
        label: 'Batch Terminal Output',
        description: 'Coalesce terminal writes into fewer frames for heavy output.',
        keywords: ['terminal', 'output', 'batch', 'coalesce', 'frames'],
      },
    ],
  },
  {
    id: 'keyboard',
    label: 'Keyboard',
    description: 'Shortcuts and keybindings',
    icon: 'keyboard',
    settings: [
      {
        id: 'keyboard.showShortcuts',
        type: 'boolean',
        default: true,
        label: 'Show Keyboard Shortcuts',
        description: 'Show the reference list of available keyboard shortcuts.',
        keywords: ['keyboard', 'shortcuts', 'keys', 'reference', 'help'],
      },
    ],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    description: 'Diagnostics and application state',
    icon: 'sparkles',
    settings: [
      {
        id: 'advanced.developerDiagnostics',
        type: 'boolean',
        default: false,
        label: 'Developer Diagnostics',
        description: 'Show render/performance diagnostics overlays in development.',
        keywords: ['developer', 'diagnostics', 'performance', 'overlay', 'debug'],
      },
      {
        id: 'advanced.resetApplicationState',
        type: 'action',
        actionLabel: 'Reset App State',
        confirmMessage: 'Reset the application to its initial state? Your settings will be kept.',
        label: 'Reset Application State',
        description: 'Clear chat history, workspace and layout state, then reload.',
        keywords: ['reset', 'clear', 'state', 'factory', 'data'],
        handler: () => {
          const deletedChatIds = loadSessions().map((session) => session.id);
          for (const key of APP_STORAGE_KEYS) {
            nsRemoveItem(key);
            localStorage.removeItem(key);
          }
          // Re-add the chat deletion markers after the sweep; the next sync
          // removes the cloud copies even if this device never pushed them.
          // The clear-all marker also removes conversations this device never
          // downloaded before the reset.
          const clearedAt = markChatsClearedAt();
          recordChatTombstones(deletedChatIds, clearedAt);
          // Override a queued chat save so the unload flush cannot restore the
          // history that this reset just removed.
          saveSessions([]);
          window.location.reload();
        },
      },
      {
        id: 'advanced.clearLocalData',
        type: 'action',
        actionLabel: 'Clear Local Data',
        confirmMessage: 'Delete ALL local application data, including settings? This cannot be undone.',
        label: 'Clear Local Application Data',
        description: 'Erase every locally stored value, including settings, then reload.',
        keywords: ['clear', 'local', 'data', 'delete', 'settings', 'all'],
        handler: () => {
          for (const key of APP_STORAGE_KEYS) {
            nsRemoveItem(key);
            localStorage.removeItem(key);
          }
          nsRemoveItem('azemax-settings-v3');
          nsRemoveItem('azemax-settings-updated-at');
          localStorage.removeItem('azemax-settings-v3');
          localStorage.removeItem('azemax-settings-updated-at');
          localStorage.removeItem('deepcontext-settings-v3');
          // A debounced chat write may be queued; make the unload flush write
          // an empty list instead of recreating the removed history.
          saveSessions([]);
          window.location.reload();
        },
      },
    ],
  },
];

const ALL_SETTING_DEFS: SettingDef[] = SETTINGS_CATEGORIES.flatMap((c) => c.settings);

const DEF_BY_ID = new Map<string, SettingDef>(ALL_SETTING_DEFS.map((d) => [d.id, d]));

const CATEGORY_BY_ID = new Map<CategoryKey, CategoryDefinition>(
  SETTINGS_CATEGORIES.map((c) => [c.id, c]),
);

export const getCategoryDefinition = (category: CategoryKey): CategoryDefinition => {
  const def = CATEGORY_BY_ID.get(category);
  if (!def) throw new Error(`Unknown settings category: ${category}`);
  return def;
};

export const getSettingDefinition = (id: string): SettingDef | undefined => DEF_BY_ID.get(id);

export const getCategoryOfSetting = (id: string): CategoryKey | undefined => {
  const dot = id.indexOf('.');
  if (dot === -1) return undefined;
  const key = id.slice(0, dot) as CategoryKey;
  return CATEGORY_BY_ID.has(key) ? key : undefined;
};