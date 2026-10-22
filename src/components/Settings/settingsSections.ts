import type { CategoryKey } from '../../settings/settingsTypes';

export interface SettingsSectionDef {
  title: string;
  settingIds: string[];
}

// Presentational grouping of settings into logical sections per category.
// Every setting id must appear in exactly one section.
export const CATEGORY_SECTIONS: Record<CategoryKey, SettingsSectionDef[]> = {
  general: [
    {
      title: 'Appearance',
      settingIds: ['general.theme', 'general.uiDensity', 'general.largerUiText', 'general.highContrast'],
    },
    {
      title: 'Startup',
      settingIds: ['general.sidebarDefault', 'general.restoreSession', 'general.showWelcomeScreen', 'general.showStatusBar'],
    },
    {
      title: 'Files & Actions',
      settingIds: ['general.confirmDelete'],
    },
  ],
  editor: [
    {
      title: 'Appearance',
      settingIds: ['editor.fontSize', 'editor.fontFamily', 'editor.cursorBlinking', 'editor.cursorStyle', 'editor.renderWhitespace'],
    },
    {
      title: 'Editor Behavior',
      settingIds: ['editor.tabSize', 'editor.insertSpaces', 'editor.wordWrap', 'editor.showMinimap', 'editor.lineNumbers', 'editor.bracketPairColorization', 'editor.smoothScrolling', 'editor.stickyScroll', 'editor.codeFolding'],
    },
    {
      title: 'Saving & Files',
      settingIds: ['editor.autoSave', 'editor.autoSaveDelay', 'editor.showHiddenFiles'],
    },
  ],
  code: [
    {
      title: 'Formatting',
      settingIds: ['code.formatOnSave', 'code.formatOnPaste', 'code.formatOnType'],
    },
    {
      title: 'Intelligence',
      settingIds: ['code.diagnostics', 'code.quickSuggestions'],
    },
  ],
  terminal: [
    {
      title: 'Appearance',
      settingIds: ['terminal.fontSize', 'terminal.fontFamily', 'terminal.cursorStyle', 'terminal.cursorBlink', 'terminal.allowTransparency'],
    },
    {
      title: 'Behavior',
      settingIds: ['terminal.scrollback', 'terminal.copyOnSelect', 'terminal.rightClickSelectsWord'],
    },
    {
      title: 'Input & Execution',
      settingIds: ['terminal.pasteProtection', 'terminal.confirmBeforeKill', 'terminal.autoOpenTerminal', 'terminal.clearBeforeRun'],
    },
  ],
  ai: [
    {
      title: 'Features',
      settingIds: ['ai.enabled', 'ai.streaming', 'ai.inlineSuggestions'],
    },
    {
      title: 'Chat',
      settingIds: ['ai.autoScroll', 'ai.responseLength', 'ai.confirmClearConversation'],
    },
    {
      title: 'Provider',
      settingIds: ['ai.mode', 'ai.azemaxModel', 'ai.activeProvider', 'ai.defaultModel', 'ai.allowServerFallback'],
    },
  ],
  // The AI Providers category renders its own credential panel; it declares
  // no persisted settings, so it has no sections.
  aiProviders: [],
  privacy: [
    {
      title: 'Data Storage',
      settingIds: ['privacy.localPersistence', 'privacy.saveChatHistory', 'privacy.saveWorkspaceState'],
    },
    {
      title: 'Data Actions',
      settingIds: ['privacy.clearChatHistory', 'privacy.clearCachedData', 'privacy.exportSettings', 'privacy.importSettings'],
    },
  ],
  performance: [
    {
      title: 'Rendering',
      settingIds: ['performance.reducedMotion', 'performance.disableAnimations', 'performance.performanceMode', 'performance.optimizeEditorRendering'],
    },
    {
      title: 'Terminal',
      settingIds: ['performance.terminalOutputBatching'],
    },
  ],
  keyboard: [
    {
      title: 'Shortcuts',
      settingIds: ['keyboard.showShortcuts'],
    },
  ],
  advanced: [
    {
      title: 'Diagnostics',
      settingIds: ['advanced.developerDiagnostics'],
    },
    {
      title: 'Application',
      settingIds: ['advanced.resetApplicationState', 'advanced.clearLocalData'],
    },
  ],
};

export const getCategorySections = (category: CategoryKey): SettingsSectionDef[] =>
  CATEGORY_SECTIONS[category] ?? [];