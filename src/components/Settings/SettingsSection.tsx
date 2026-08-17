import React, { memo } from 'react';
import type { SettingDef } from '../../settings/settingsTypes';
import { SettingsCard } from './SettingsCard';

interface SettingsSectionProps {
  title: string;
  defs: SettingDef[];
  highlightedSetting?: string | null;
}

export const SettingsSection: React.FC<SettingsSectionProps> = memo(({ title, defs, highlightedSetting }) => {
  if (defs.length === 0) return null;
  return (
    <div className="px-4 pt-3">
      <h3 className="pb-1.5 px-1 text-[10px] font-semibold uppercase tracking-widest text-white/35">{title}</h3>
      <div className="space-y-2">
        {defs.map((def) => (
          <SettingsCard key={def.id} def={def} highlighted={highlightedSetting === def.id} />
        ))}
      </div>
    </div>
  );
});