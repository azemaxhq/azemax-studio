import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { SettingDef, SettingValue } from '../../settings/settingsTypes';
import { setSetting, resetSetting, useSetting } from '../../settings/settingsStore';
import { SettingControl } from './SettingControl';
import { ConfirmDialog } from './ConfirmDialog';

interface SettingsCardProps {
  def: SettingDef;
  highlighted?: boolean;
}

/**
 * A single setting rendered as a full-width horizontal card.
 * Left: label + description (which wraps naturally). Right: control (+ reset).
 */
export const SettingsCard: React.FC<SettingsCardProps> = memo(({ def, highlighted }) => {
  const value = useSetting<SettingValue>(def.id);
  const hasDefault = 'default' in def;
  const isModified = hasDefault && value !== def.default;
  const [confirming, setConfirming] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const describedBy = `setting-desc-${def.id}`;

  useEffect(() => {
    if (highlighted) {
      cardRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted]);

  const handleChange = useCallback((next: SettingValue) => {
    setSetting(def.id, next);
  }, [def.id]);

  const handleReset = useCallback(() => {
    resetSetting(def.id);
  }, [def.id]);

  const cardClass = `rounded-xl border px-4 py-3 flex items-center justify-between gap-4 flex-wrap transition-colors ${
    highlighted
      ? 'border-[rgba(91,140,255,0.5)] bg-[var(--az-accent)]/[0.07]'
      : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05] hover:border-white/[0.13]'
  }`;

  if (def.type === 'action') {
    const needsConfirm = Boolean(def.confirmMessage);
    return (
      <>
        <div ref={cardRef} className={cardClass}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium text-white/85">{def.label}</span>
              {def.requiresRestart && (
                <span className="text-[9px] font-medium text-[rgba(240,198,116,0.9)] bg-[rgba(240,198,116,0.1)] border border-[rgba(240,198,116,0.2)] rounded px-1 py-px uppercase tracking-wide">
                  Reload
                </span>
              )}
            </div>
            <div id={describedBy} className="mt-0.5 text-[11px] text-white/40 leading-relaxed">{def.description}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (needsConfirm) setConfirming(true);
              else def.handler();
            }}
            aria-describedby={describedBy}
            className={`shrink-0 px-3 py-1.5 text-[11px] font-medium rounded-lg border focus:outline-none focus-visible:ring-2 transition-colors ${
              needsConfirm
                ? 'bg-[rgba(255,125,139,0.1)] border-[rgba(255,125,139,0.2)] text-[var(--az-error)] hover:bg-[rgba(255,125,139,0.2)] focus-visible:ring-[rgba(255,125,139,0.4)]'
                : 'bg-white/[0.06] border-white/10 text-white/70 hover:text-white hover:bg-white/10 focus-visible:ring-[rgba(91,140,255,0.4)]'
            }`}
          >
            {def.actionLabel}
          </button>
        </div>
        {needsConfirm && (
          <ConfirmDialog
            open={confirming}
            title={def.label}
            message={def.confirmMessage}
            confirmLabel={def.actionLabel}
            onConfirm={() => {
              setConfirming(false);
              def.handler();
            }}
            onCancel={() => setConfirming(false)}
          />
        )}
      </>
    );
  }

  return (
    <div ref={cardRef} className={cardClass}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-white/85">{def.label}</span>
          {def.requiresRestart && (
            <span className="text-[9px] font-medium text-[rgba(240,198,116,0.9)] bg-[rgba(240,198,116,0.1)] border border-[rgba(240,198,116,0.2)] rounded px-1 py-px uppercase tracking-wide">
              Reload
            </span>
          )}
        </div>
        <div id={describedBy} className="mt-0.5 text-[11px] text-white/40 leading-relaxed">{def.description}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isModified && (
          <button
            type="button"
            onClick={handleReset}
            title="Reset to default"
            aria-label={`Reset ${def.label} to default`}
            className="p-1.5 rounded-md text-white/30 hover:text-white/80 hover:bg-white/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,140,255,0.4)] transition-colors"
          >
            <RotateCcw size={12} />
          </button>
        )}
        <SettingControl def={def} value={value} onChange={handleChange} describedBy={describedBy} />
      </div>
    </div>
  );
});