export type ThemeMode = 'dark' | 'light' | 'auto';
export type UiDensity = 'comfortable' | 'compact';
export type CursorBlinkStyle = 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
export type CursorStyle = 'line' | 'block' | 'underline';
export type RenderWhitespace = 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
export type TerminalCursorStyle = 'block' | 'underline' | 'bar';
export type ResponseLength = 'short' | 'medium' | 'long';
export type SidebarDefault = 'open' | 'collapsed';

export interface GeneralSettings {
  theme: ThemeMode;
  uiDensity: UiDensity;
  sidebarDefault: SidebarDefault;
  showWelcomeScreen: boolean;
  showStatusBar: boolean;
  restoreSession: boolean;
  confirmDelete: boolean;
  largerUiText: boolean;
  highContrast: boolean;
}

export interface EditorSettings {
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  showMinimap: boolean;
  lineNumbers: boolean;
  bracketPairColorization: boolean;
  smoothScrolling: boolean;
  cursorBlinking: CursorBlinkStyle;
  cursorStyle: CursorStyle;
  renderWhitespace: RenderWhitespace;
  stickyScroll: boolean;
  codeFolding: boolean;
  autoSave: boolean;
  autoSaveDelay: number;
  showHiddenFiles: boolean;
}

export interface CodeSettings {
  formatOnSave: boolean;
  formatOnPaste: boolean;
  formatOnType: boolean;
  diagnostics: boolean;
  quickSuggestions: boolean;
}

export interface TerminalSettings {
  fontSize: number;
  fontFamily: string;
  letterSpacing: number;
  lineHeight: number;
  fontWeight: string;
  fontWeightBold: string;
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
  allowTransparency: boolean;
  scrollback: number;
  copyOnSelect: boolean;
  rightClickSelectsWord: boolean;
  autoOpenTerminal: boolean;
  clearBeforeRun: boolean;
  confirmBeforeKill: boolean;
  pasteProtection: boolean;
}

export interface AISettings {
  enabled: boolean;
  streaming: boolean;
  autoScroll: boolean;
  inlineSuggestions: boolean;
  responseLength: ResponseLength;
  confirmClearConversation: boolean;
}

export interface PrivacySettings {
  localPersistence: boolean;
  saveChatHistory: boolean;
  saveWorkspaceState: boolean;
}

export interface PerformanceSettings {
  reducedMotion: boolean;
  disableAnimations: boolean;
  performanceMode: boolean;
  optimizeEditorRendering: boolean;
  terminalOutputBatching: boolean;
}

export interface KeyboardSettings {
  showShortcuts: boolean;
}

export interface AdvancedSettings {
  developerDiagnostics: boolean;
}

export interface Settings {
  general: GeneralSettings;
  editor: EditorSettings;
  code: CodeSettings;
  terminal: TerminalSettings;
  ai: AISettings;
  privacy: PrivacySettings;
  performance: PerformanceSettings;
  keyboard: KeyboardSettings;
  advanced: AdvancedSettings;
}

export type CategoryKey =
  | 'general'
  | 'editor'
  | 'code'
  | 'terminal'
  | 'ai'
  | 'privacy'
  | 'performance'
  | 'keyboard'
  | 'advanced';

export type SettingValue = boolean | number | string;

export interface SettingBase {
  id: string;
  label: string;
  description: string;
  keywords?: string[];
  requiresRestart?: boolean;
}

export interface BooleanSetting extends SettingBase {
  type: 'boolean';
  default: boolean;
}

export interface NumberSetting extends SettingBase {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface SliderSetting extends SettingBase {
  type: 'slider';
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface SelectSetting extends SettingBase {
  type: 'select';
  default: string;
  choices: { value: string; label: string }[];
}

export interface TextSetting extends SettingBase {
  type: 'text';
  default: string;
  placeholder?: string;
  inputType?: 'text' | 'password';
}

export interface ActionSetting extends SettingBase {
  type: 'action';
  actionLabel: string;
  confirmMessage: string;
  handler: () => void;
}

export type SettingDef =
  | BooleanSetting
  | NumberSetting
  | SliderSetting
  | SelectSetting
  | TextSetting
  | ActionSetting;

export interface CategoryDefinition {
  id: CategoryKey;
  label: string;
  description: string;
  icon: string;
  settings: SettingDef[];
}