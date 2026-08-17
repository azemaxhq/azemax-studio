import React, { memo } from 'react';
import { ArrowRight } from 'lucide-react';
import { SETTINGS_CATEGORIES } from '../../settings/settingsSchema';
import type { CategoryDefinition, CategoryKey } from '../../settings/settingsTypes';
import { CATEGORY_ICONS } from './settingsIcons';

interface SettingsHomeProps {
  onSelectCategory: (id: CategoryKey) => void;
}

const CategoryCard: React.FC<{ category: CategoryDefinition; onSelect: (id: CategoryKey) => void }> = memo(({ category, onSelect }) => {
  const Icon = CATEGORY_ICONS[category.icon] ?? CATEGORY_ICONS.settings;
  return (
    <button
      type="button"
      onClick={() => onSelect(category.id)}
      className="group flex flex-col items-start gap-1.5 min-h-[128px] p-4 rounded-xl border border-white/[0.08] bg-white/[0.03] text-left transition-colors hover:bg-white/[0.05] hover:border-white/[0.14] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
    >
      <div className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/70 transition-colors group-hover:text-white group-hover:border-blue-400/30">
        <Icon size={16} />
      </div>
      <span className="mt-1 text-[13px] font-medium text-white/90">{category.label}</span>
      <span className="text-[11px] text-white/40 leading-relaxed">{category.description}</span>
      <span className="mt-auto inline-flex items-center gap-1 pt-1.5 text-[10px] font-medium text-blue-400/70 transition-colors group-hover:text-blue-300">
        Open <ArrowRight size={10} />
      </span>
    </button>
  );
});

export const SettingsHome: React.FC<SettingsHomeProps> = ({ onSelectCategory }) => {
  return (
    <div
      className="grid gap-2.5 p-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 180px), 1fr))' }}
    >
      {SETTINGS_CATEGORIES.map((category) => (
        <CategoryCard key={category.id} category={category} onSelect={onSelectCategory} />
      ))}
    </div>
  );
};