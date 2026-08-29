import { debouncedLocalStorageSet } from '../utils/localStorageDebounce';
import { createDefaultSettings } from './settingsDefaults';
import type { Settings } from './settingsTypes';
import { sanitizeSettings } from './settingsValidation';

export const SETTINGS_STORAGE_KEY = 'azemax-settings-v3';
const LEGACY_V3_STORAGE_KEY = 'deepcontext-settings-v3';
const V2_STORAGE_KEY = 'deepcontext-settings-v2';
const LEGACY_STORAGE_KEY = 'editor-settings';
export const SETTINGS_SCHEMA_VERSION = 3;

const LEGACY_TO_V3: [string, string][] = [
  ['general.autoSave', 'editor.autoSave'],
  ['general.autoSaveDelay', 'editor.autoSaveDelay'],
  ['general.autoFormat', 'code.formatOnSave'],
  ['appearance.theme', 'general.theme'],
  ['appearance.uiDensity', 'general.uiDensity'],
  ['appearance.sidebarDefault', 'general.sidebarDefault'],
  ['appearance.fontFamily', 'editor.fontFamily'],
  ['editor.isSuggestionsEnabled', 'ai.inlineSuggestions'],
  ['execution.autoOpenTerminal', 'terminal.autoOpenTerminal'],
  ['execution.clearBeforeRun', 'terminal.clearBeforeRun'],
  ['files.confirmDelete', 'general.confirmDelete'],
  ['files.showHiddenFiles', 'editor.showHiddenFiles'],
  ['accessibility.largerUiText', 'general.largerUiText'],
  ['accessibility.highContrast', 'general.highContrast'],
];

const DROPPED_KEYS = new Set([
  'ai.model',
  'ai.temperature',
  'privacy.apiKey',
  'general.autoSave',
  'general.autoSaveDelay',
  'general.autoFormat',
  'appearance.theme',
  'appearance.uiDensity',
  'appearance.sidebarDefault',
  'appearance.fontFamily',
  'editor.isSuggestionsEnabled',
  'execution.autoOpenTerminal',
  'execution.clearBeforeRun',
  'files.confirmDelete',
  'files.showHiddenFiles',
  'accessibility.largerUiText',
  'accessibility.highContrast',
]);

const migrateToV3 = (input: unknown): unknown => {
  if (!input || typeof input !== 'object') return undefined;
  const source = input as Record<string, unknown>;
  const out: Record<string, Record<string, unknown>> = {};

  const copyKey = (key: string, value: unknown) => {
    const [section, field] = key.split('.');
    if (!out[section]) out[section] = {};
    out[section][field] = value;
  };

  for (const sectionKey of Object.keys(source)) {
    const section = source[sectionKey];
    if (!section || typeof section !== 'object') continue;
    for (const field of Object.keys(section as Record<string, unknown>)) {
      const fullKey = `${sectionKey}.${field}`;
      if (DROPPED_KEYS.has(fullKey)) continue;
      const mapping = LEGACY_TO_V3.find(([from]) => from === fullKey);
      copyKey(mapping ? mapping[1] : fullKey, (section as Record<string, unknown>)[field]);
    }
  }

  return out;
};

const migrateLegacy = (legacy: unknown): unknown => {
  if (!legacy || typeof legacy !== 'object') return undefined;
  const source = legacy as Record<string, unknown>;

  const mapped: Record<string, unknown> = {};

  if (source.editor && typeof source.editor === 'object') {
    mapped.editor = source.editor;
  }

  if (source.appearance && typeof source.appearance === 'object') {
    mapped.appearance = source.appearance;
  }

  if (source.ai && typeof source.ai === 'object') {
    const ai = source.ai as Record<string, unknown>;
    mapped.ai = {
      responseLength: ai.responseLength,
    };
  }

  if (source.autoFeatures && typeof source.autoFeatures === 'object') {
    const auto = source.autoFeatures as Record<string, unknown>;
    mapped.general = {
      autoSave: auto.autoSave,
      autoFormat: auto.autoFormat,
    };
  }

  if (source.account && typeof source.account === 'object') {
    const account = source.account as Record<string, unknown>;
    mapped.privacy = {
      apiKey: account.apiKey,
    };
  }

  return mapped;
};

const loadRaw = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export const loadSettings = (): Settings => {
  const v3 = loadRaw(SETTINGS_STORAGE_KEY) ?? loadRaw(LEGACY_V3_STORAGE_KEY);
  if (v3 !== undefined) {
    const settings = sanitizeSettings(v3);
    if (settings) return settings;
  }

  const v2 = loadRaw(V2_STORAGE_KEY);
  if (v2 !== undefined) {
    const settings = sanitizeSettings(migrateToV3(v2));
    if (settings) return settings;
  }

  const legacy = loadRaw(LEGACY_STORAGE_KEY);
  if (legacy !== undefined) {
    const settings = sanitizeSettings(migrateToV3(migrateLegacy(legacy)));
    if (settings) return settings;
  }

  return createDefaultSettings();
};

export const saveSettings = (settings: Settings): void => {
  try {
    debouncedLocalStorageSet(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable or full: settings stay in memory only.
  }
};

export const clearSettingsStorage = (): void => {
  try {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    localStorage.removeItem(LEGACY_V3_STORAGE_KEY);
    localStorage.removeItem(V2_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
};