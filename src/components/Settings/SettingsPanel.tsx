import React, { useMemo, useState, useCallback } from 'react';
import { Settings, RotateCcw, ArrowRight, SearchX, ArrowLeft } from 'lucide-react';
import { SETTINGS_CATEGORIES, getCategoryDefinition } from '../../settings/settingsSchema';
import { resetAllSettings } from '../../settings/settingsStore';
import type { CategoryDefinition, CategoryKey, SettingDef } from '../../settings/settingsTypes';
import { SettingsSearch } from './SettingsSearch';
import { SettingsHome } from './SettingsHome';
import { SettingsCategory } from './SettingsCategory';
import { CATEGORY_ICONS } from './settingsIcons';
import { ConfirmDialog } from './ConfirmDialog';

type SearchResults = Map<CategoryKey, SettingDef[]>;

const searchSettings = (query: string): SearchResults | null => {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const results: SearchResults = new Map();
  for (const category of SETTINGS_CATEGORIES) {
    const hits = category.settings.filter((def) =>
      def.label.toLowerCase().includes(q) ||
      def.description.toLowerCase().includes(q) ||
      category.label.toLowerCase().includes(q) ||
      (def.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(q)) ||
      def.id.toLowerCase().includes(q),
    );
    if (hits.length > 0) results.set(category.id, hits);
  }
  return results;
};

const SearchResultRow: React.FC<{ def: SettingDef; onOpen: () => void }> = ({ def, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    aria-label={`Open ${def.label}`}
    className="group w-full flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-left transition-colors hover:bg-white/[0.05] hover:border-white/[0.13] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
  >
    <span className="min-w-0">
      <span className="block text-[13px] font-medium text-white/85 group-hover:text-white">{def.label}</span>
      <span className="block text-[11px] text-white/40 leading-relaxed truncate">{def.description}</span>
    </span>
    <ArrowRight size={14} className="shrink-0 text-white/25 group-hover:text-blue-300 transition-colors" />
  </button>
);

export const SettingsPanel: React.FC = () => {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(null);
  const [focusedSetting, setFocusedSetting] = useState<string | null>(null);
  const [confirmingResetAll, setConfirmingResetAll] = useState(false);

  const results = useMemo(() => searchSettings(query), [query]);
  const searching = query.trim().length > 0;

  const openCategory = useCallback((category: CategoryKey) => {
    setQuery('');
    setActiveCategory(category);
    setFocusedSetting(null);
  }, []);

  const goHome = useCallback(() => {
    setActiveCategory(null);
    setFocusedSetting(null);
  }, []);

  const openSetting = useCallback((category: CategoryKey, settingId: string) => {
    setQuery('');
    setActiveCategory(category);
    setFocusedSetting(settingId);
  }, []);

  const handleResetAll = useCallback(() => {
    setConfirmingResetAll(false);
    resetAllSettings();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (query) {
      setQuery('');
    } else if (activeCategory) {
      goHome();
    }
  }, [query, activeCategory, goHome]);

  const activeCategoryDef: CategoryDefinition | null = activeCategory ? getCategoryDefinition(activeCategory) : null;

  const contentKey = searching ? 'search' : activeCategory ?? 'home';

  return (
    <div
      onKeyDown={handleKeyDown}
      className="h-full flex flex-col bg-transparent relative overflow-hidden"
    >
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-blue-500/25 to-transparent z-20" />

      {/* Header */}
      <div className="shrink-0 px-4 pt-3 pb-2">
        {activeCategory && !searching ? (
          <div className="flex items-center gap-1.5 mb-2">
            <button
              type="button"
              onClick={goHome}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-white/50 hover:text-white hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 transition-colors"
            >
              <ArrowLeft size={13} />
              <span>Settings</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Settings size={15} className="text-white/60 shrink-0" />
              <h1 className="text-[14px] font-semibold text-white/95">Settings</h1>
            </div>
            <button
              type="button"
              onClick={() => setConfirmingResetAll(true)}
              className="p-1.5 rounded-md text-white/30 hover:text-white/70 hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 transition-colors"
              title="Reset all settings to defaults"
              aria-label="Reset all settings to defaults"
            >
              <RotateCcw size={12} />
            </button>
          </div>
        )}

        {searching ? (
          <p className="pb-1.5 text-[11px] text-white/40">
            Search results for &quot;{query.trim()}&quot;
          </p>
        ) : (
          !activeCategory && (
            <p className="pb-1.5 text-[11px] text-white/40">Customize your editor, terminal, AI and workspace.</p>
          )
        )}

        <SettingsSearch query={query} onChange={setQuery} />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div key={contentKey} className="settings-fade-in">
          {searching ? (
            results && results.size === 0 ? (
              <div className="flex flex-col items-center justify-center text-center px-4 py-12">
                <SearchX size={20} className="text-white/25 mb-2" />
                <p className="text-[13px] text-white/50">No settings match &quot;{query.trim()}&quot;</p>
                <p className="text-[11px] text-white/30 mt-1">Try a different keyword.</p>
              </div>
            ) : results && results.size > 0 ? (
              <div className="space-y-3 pb-4">
                {Array.from(results.entries()).map(([categoryId, defs]) => {
                  const category = SETTINGS_CATEGORIES.find((c) => c.id === categoryId)!;
                  const Icon = CATEGORY_ICONS[category.icon] ?? CATEGORY_ICONS.settings;
                  return (
                    <div key={categoryId} className="px-4">
                      <div className="flex items-center gap-2 pb-1.5">
                        <Icon size={12} className="text-white/40 shrink-0" />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-white/45">{category.label}</span>
                        <button
                          type="button"
                          onClick={() => openCategory(categoryId)}
                          className="ml-auto inline-flex items-center gap-1 text-[10px] text-blue-400/70 hover:text-blue-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 rounded"
                        >
                          View category <ArrowRight size={10} />
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {defs.map((def) => (
                          <SearchResultRow key={def.id} def={def} onOpen={() => openSetting(categoryId, def.id)} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null
          ) : activeCategoryDef ? (
            <SettingsCategory key={activeCategoryDef.id} category={activeCategoryDef} highlightedSetting={focusedSetting} />
          ) : (
            <SettingsHome onSelectCategory={openCategory} />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingResetAll}
        title="Reset all settings"
        message="Reset every setting to its default value?"
        confirmLabel="Reset all"
        onConfirm={handleResetAll}
        onCancel={() => setConfirmingResetAll(false)}
      />
    </div>
  );
};