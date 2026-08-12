import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, memo } from 'react';
import type { ReactNode } from 'react';
import type { Settings } from '../types/settings';
import { defaultSettings } from '../types/settings';
import { debouncedLocalStorageSet } from '../utils/localStorageDebounce';

interface SettingsContextType {
  settings: Settings;
  updateSettings: (section: keyof Settings, updates: Partial<Settings[keyof Settings]>) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

interface SettingsProviderProps {
  children: ReactNode;
}

export const SettingsProvider: React.FC<SettingsProviderProps> = memo(({ children }) => {
  // Load settings from localStorage synchronously on initial render
  const getInitialSettings = (): Settings => {
    try {
      const savedSettings = localStorage.getItem('editor-settings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        return { ...defaultSettings, ...parsed };
      }
    } catch (error) {
      console.warn('Failed to load settings from localStorage:', error);
    }
    return defaultSettings;
  };

  const [settings, setSettings] = useState<Settings>(getInitialSettings);

  // Save settings to localStorage whenever they change (coalesced writes)
  useEffect(() => {
    try {
      debouncedLocalStorageSet('editor-settings', JSON.stringify(settings));
    } catch (error) {
      console.warn('Failed to save settings to localStorage:', error);
    }
  }, [settings]);

  const updateSettings = useCallback((section: keyof Settings, updates: Partial<Settings[keyof Settings]>) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        ...updates,
      },
    }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(defaultSettings);
  }, []);

  const value = useMemo(() => ({ settings, updateSettings, resetSettings }), [settings, updateSettings, resetSettings]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
});
