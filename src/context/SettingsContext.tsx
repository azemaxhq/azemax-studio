/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useMemo, useRef, memo } from 'react';
import type { ReactNode } from 'react';
import type { Settings } from '../types/settings';
import { loadSettings, saveSettings } from '../settings/settingsPersistence';
import {
  setSettings,
  getSettings,
  getSetting,
  getAllSettings,
  hydrateSettings,
  setSetting,
  resetSetting,
  resetCategory,
  resetAllSettings,
  subscribe,
  useSettingsStore,
  useSettingsSelector,
} from '../settings/settingsStore';
import type { SettingValue } from '../settings/settingsTypes';
import { useSettingsApplier } from '../hooks/useSettingsApplier';
import { useAuthOptional } from './AuthContext';
import { useAccountSettingsSync } from '../hooks/useAccountSettingsSync';

export interface SettingsContextType {
  settings: Settings;
  updateSettings: (section: keyof Settings, updates: Partial<Settings[keyof Settings]>) => void;
  resetSettings: () => void;
  setSetting: (key: string, value: SettingValue) => void;
  resetSetting: (key: string) => void;
  resetCategory: (category: keyof Settings) => void;
  resetAllSettings: () => void;
  getSetting: (key: string) => unknown;
  getAllSettings: () => Settings;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

export { useSettingsSelector, useSettingsStore };

interface SettingsProviderProps {
  children: ReactNode;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = memo(({ children }) => {
  const auth = useAuthOptional();
  const userId = auth?.user?.id ?? null;
  const hydratedForRef = useRef<string | null | undefined>(undefined);
  // The store is a module singleton created before Firebase resolves identity.
  // Rehydrate synchronously from THIS account's namespace on mount so the first
  // render never shows another account's settings.
  if (hydratedForRef.current !== userId) {
    hydrateSettings(loadSettings(), false);
    hydratedForRef.current = userId;
  }

  useAccountSettingsSync({ userId, enabled: Boolean(userId) });

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      try {
        saveSettings(getSettings());
      } catch {
        // Persistence failures are non-fatal; settings remain in memory.
      }
    });
    return unsubscribe;
  }, []);

  useSettingsApplier();

  const settings = useSettingsStore((s) => s);

  const value = useMemo<SettingsContextType>(() => ({
    settings,
    updateSettings: (section, updates) => {
      const sectionValue = settings[section];
      const merged = sectionValue && typeof sectionValue === 'object'
        ? { ...(sectionValue as unknown as Record<string, unknown>), ...updates }
        : { ...updates };
      setSettings({ ...settings, [section]: merged } as Partial<Settings>);
    },
    resetSettings: resetAllSettings,
    setSetting,
    resetSetting,
    resetCategory,
    resetAllSettings,
    getSetting,
    getAllSettings,
  }), [settings]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
});