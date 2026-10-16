import React from 'react';
import { Minus, Plus, ChevronDown } from 'lucide-react';
import type { SettingDef, SettingValue } from '../../settings/settingsTypes';

const ToggleSwitch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; label: string; describedBy?: string }> = ({ checked, onChange, label, describedBy }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,140,255,0.4)] focus-visible:ring-offset-0 ${
        checked ? 'bg-[var(--az-accent)]' : 'bg-white/20'
      }`}
    >
      <div
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
};

const SelectControl: React.FC<{ value: string; choices: { value: string; label: string }[]; onChange: (value: string) => void; label: string; describedBy?: string }> = ({ value, choices, onChange, label, describedBy }) => {
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        aria-label={label}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none pl-2.5 pr-7 py-1.5 text-[13px] bg-white/[0.08] border border-white/[0.15] rounded-md text-white/70 focus:outline-none focus:border-[rgba(91,140,255,0.5)] focus:ring-1 focus:ring-[rgba(91,140,255,0.2)]"
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value} className="bg-[#0D192B] text-white/80">
            {choice.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
    </div>
  );
};

const NumberControl: React.FC<{ value: number; min: number; max: number; onChange: (value: number) => void; label: string; describedBy?: string }> = ({ value, min, max, onChange, label, describedBy }) => {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-6 h-6 flex items-center justify-center rounded-md bg-white/[0.06] border border-white/10 text-white/60 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,140,255,0.4)] transition-colors"
      >
        <Minus size={12} />
      </button>
      <input
        type="number"
        aria-label={label}
        aria-describedby={describedBy}
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const parsed = parseInt(e.target.value, 10);
          onChange(Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value);
        }}
        className="w-12 px-1 py-1 text-center text-[13px] bg-white/[0.08] border border-white/[0.15] rounded-md text-white/70 focus:outline-none focus:border-[rgba(91,140,255,0.5)]"
      />
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-6 h-6 flex items-center justify-center rounded-md bg-white/[0.06] border border-white/10 text-white/60 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,140,255,0.4)] transition-colors"
      >
        <Plus size={12} />
      </button>
    </div>
  );
};

const SliderControl: React.FC<{ value: number; min: number; max: number; step: number; onChange: (value: number) => void; label: string; describedBy?: string }> = ({ value, min, max, step, onChange, label, describedBy }) => {
  const display = step < 1 ? value.toFixed(1) : String(value);
  return (
    <div className="flex items-center gap-2 shrink-0">
      <input
        type="range"
        aria-label={label}
        aria-describedby={describedBy}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 accent-blue-500"
      />
      <span className="text-[12px] text-white/60 font-mono tabular-nums w-10 text-right">{display}</span>
    </div>
  );
};

const TextControl: React.FC<{ value: string; placeholder?: string; onChange: (value: string) => void; label: string; describedBy?: string }> = ({ value, placeholder, onChange, label, describedBy }) => {
  return (
    <input
      type="text"
      aria-label={label}
      aria-describedby={describedBy}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-36 px-2.5 py-1.5 text-[13px] bg-white/[0.08] border border-white/[0.15] rounded-md text-white/70 focus:outline-none focus:border-[rgba(91,140,255,0.5)] focus:ring-1 focus:ring-[rgba(91,140,255,0.2)]"
    />
  );
};

export const SettingControl: React.FC<{
  def: SettingDef;
  value: SettingValue;
  onChange: (value: SettingValue) => void;
  describedBy?: string;
}> = ({ def, value, onChange, describedBy }) => {
  switch (def.type) {
    case 'boolean':
      return <ToggleSwitch checked={Boolean(value)} onChange={onChange} label={def.label} describedBy={describedBy} />;
    case 'select':
      return (
        <SelectControl
          value={String(value)}
          choices={def.choices}
          onChange={onChange}
          label={def.label}
          describedBy={describedBy}
        />
      );
    case 'number':
      return (
        <NumberControl
          value={Number(value)}
          min={def.min ?? 0}
          max={def.max ?? 100}
          onChange={onChange}
          label={def.label}
          describedBy={describedBy}
        />
      );
    case 'slider':
      return (
        <SliderControl
          value={Number(value)}
          min={def.min}
          max={def.max}
          step={def.step}
          onChange={onChange}
          label={def.label}
          describedBy={describedBy}
        />
      );
    case 'text':
      return (
        <TextControl
          value={String(value)}
          placeholder={def.placeholder}
          onChange={onChange}
          label={def.label}
          describedBy={describedBy}
        />
      );
    default:
      return null;
  }
};