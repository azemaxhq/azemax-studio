import React, { memo, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { CategoryDefinition, CategoryKey, SettingDef } from '../../settings/settingsTypes';
import { resetCategory, useSetting } from '../../settings/settingsStore';
import { CATEGORY_ICONS } from './settingsIcons';
import { SettingsSection } from './SettingsSection';
import { KeyboardShortcutsList } from './KeyboardShortcuts';
import { ConfirmDialog } from './ConfirmDialog';
import { getCategorySections } from './settingsSections';
import { ProviderSettingsPanel } from './ProviderSettings';
import { AIModeSelector } from './AIModeSelector';

interface SettingsCategoryProps {
  category: CategoryDefinition;
  highlightedSetting?: string | null;
}

export const SettingsCategory: React.FC<SettingsCategoryProps> = memo(({ category, highlightedSetting }) => {
  const Icon = CATEGORY_ICONS[category.icon] ?? CATEGORY_ICONS.settings;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const sections = getCategorySections(category.id);
  const count = category.settings.length;

  // `ai.mode` is rendered by the dedicated adaptive mode selector (a
  // segmented control + mode-specific view), not by the generic card.
  const isAiCategory = category.id === 'ai';

  // Special handling for aiProviders category
  if (category.id === 'aiProviders') {
    return (
      <div className="pb-6">
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 shrink-0 rounded-lg bg-[rgba(91,140,255,0.1)] border border-[rgba(91,140,255,0.2)] flex items-center justify-center text-[var(--az-text)]">
              <Icon size={16} />
            </div>
            <div className="min-w-0">
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-[15px] font-semibold text-white/95 outline-none"
              >
                {category.label}
              </h2>
              <p className="text-[11px] text-white/40 truncate">{category.description}</p>
            </div>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-white/30 tabular-nums">BYOK</span>
            </div>
          </div>
        </div>

        {/* This category holds no persisted settings, so there is nothing to
            "reset to defaults" — the panel owns its own "remove all
            credentials" action instead. */}
        <ProviderSettingsPanel />

        <ConfirmDialog
          open={confirmingReset}
          title={`Reset ${category.label} settings`}
          message={`Reset all ${category.label} settings to their defaults?`}
          confirmLabel="Reset"
          onConfirm={() => {
            setConfirmingReset(false);
            resetCategory(category.id as CategoryKey);
          }}
          onCancel={() => setConfirmingReset(false)}
        />
      </div>
    );
  }

  return (
    <div className="pb-6">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 shrink-0 rounded-lg bg-[rgba(91,140,255,0.1)] border border-[rgba(91,140,255,0.2)] flex items-center justify-center text-[var(--az-text)]">
            <Icon size={16} />
          </div>
          <div className="min-w-0">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="text-[15px] font-semibold text-white/95 outline-none"
            >
              {category.label}
            </h2>
            <p className="text-[11px] text-white/40 truncate">{category.description}</p>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-white/30 tabular-nums">{count} settings</span>
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              title={`Reset ${category.label} settings`}
              aria-label={`Reset ${category.label} settings to defaults`}
              className="p-1.5 rounded-md text-white/30 hover:text-white/80 hover:bg-white/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,140,255,0.4)] transition-colors"
            >
              <RotateCcw size={12} />
            </button>
          </div>
        </div>
      </div>

      {isAiCategory && <AIModeSelector />}

      {sections.map((section) => (
        <SettingsSection
          key={section.title}
          title={section.title}
          defs={section.settingIds
            .map((id) => category.settings.find((def) => def.id === id))
            .filter((def): def is SettingDef => def !== undefined && !(isAiCategory && def.id === 'ai.mode'))}
          highlightedSetting={highlightedSetting}
        />
      ))}

      {category.id === 'keyboard' && <KeyboardShortcutsGate />}

      <ConfirmDialog
        open={confirmingReset}
        title={`Reset ${category.label} settings`}
        message={`Reset all ${category.label} settings to their defaults?`}
        confirmLabel="Reset"
        onConfirm={() => {
          setConfirmingReset(false);
          resetCategory(category.id as CategoryKey);
        }}
        onCancel={() => setConfirmingReset(false)}
      />
    </div>
  );
});

const KeyboardShortcutsGate: React.FC = () => {
  const enabled = useSetting('keyboard.showShortcuts');
  if (!enabled) return null;
  return <KeyboardShortcutsList />;
};