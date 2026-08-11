export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  showMinimap: boolean;
  isSuggestionsEnabled: boolean;
}

export interface AppearanceSettings {
  theme: 'dark' | 'light' | 'auto';
  fontFamily: string;
}

export interface AISettings {
  mode: 'chat' | 'inline' | 'assistant';
  responseLength: 'short' | 'medium' | 'long';
  explainCode: boolean;
}

export interface AutoFeaturesSettings {
  autoSave: boolean;
  autoFormat: boolean;
}

export interface AccountSettings {
  apiKey: string;
}

export interface Settings {
  editor: EditorSettings;
  appearance: AppearanceSettings;
  ai: AISettings;
  autoFeatures: AutoFeaturesSettings;
  account: AccountSettings;
}

export const defaultSettings: Settings = {
  editor: {
    fontSize: 14,
    tabSize: 4,
    wordWrap: true,
    lineNumbers: true,
    showMinimap: true,
    isSuggestionsEnabled: true,
  },
  appearance: {
    theme: 'dark',
    fontFamily: 'JetBrains Mono, monospace',
  },
  ai: {
    mode: 'assistant',
    responseLength: 'medium',
    explainCode: true,
  },
  autoFeatures: {
    autoSave: true,
    autoFormat: false,
  },
  account: {
    apiKey: '',
  },
};
