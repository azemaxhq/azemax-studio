import React, { useState } from 'react';
import { 
  Settings, 
  Type, 
  Palette, 
  Bot, 
  Zap, 
  User,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Save
} from 'lucide-react';
import { useSettings } from '../../context/SettingsContext';

interface SectionProps {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const SettingsSection: React.FC<SectionProps> = ({ title, icon: Icon, children, defaultOpen = true }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-white/[0.08] last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon size={16} className="text-white/50" />
          <span className="text-sm font-medium text-white/80">{title}</span>
        </div>
        {isOpen ? <ChevronUp size={14} className="text-white/40" /> : <ChevronDown size={14} className="text-white/40" />}
      </button>
      {isOpen && (
        <div className="px-4 pb-4 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
};

interface SettingItemProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

const SettingItem: React.FC<SettingItemProps> = ({ label, description, children }) => {
  return (
    <div className="flex items-center justify-between">
      <div className="flex-1">
        <div className="text-sm text-white/70">{label}</div>
        {description && <div className="text-xs text-white/40 mt-1">{description}</div>}
      </div>
      <div className="ml-4">
        {children}
      </div>
    </div>
  );
};

const ToggleSwitch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void }> = ({ checked, onChange }) => {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors ${
        checked ? 'bg-blue-500' : 'bg-white/20'
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

const SelectInput: React.FC<{ value: string; onChange: (value: string) => void; options: string[] }> = ({ 
  value, onChange, options 
}) => {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1.5 text-sm bg-white/[0.08] border border-white/[0.15] rounded-md text-white/70 focus:outline-none focus:border-blue-400/50"
    >
      {options.map(option => (
        <option key={option} value={option} className="bg-[#1a1f28]">
          {option}
        </option>
      ))}
    </select>
  );
};

const NumberInput: React.FC<{ value: number; onChange: (value: number) => void; min?: number; max?: number }> = ({ 
  value, onChange, min = 1, max = 100 
}) => {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || 1)))}
      min={min}
      max={max}
      className="w-16 px-2 py-1.5 text-sm bg-white/[0.08] border border-white/[0.15] rounded-md text-white/70 focus:outline-none focus:border-blue-400/50 text-center"
    />
  );
};

const TextInput: React.FC<{ value: string; onChange: (value: string) => void; placeholder?: string; type?: string }> = ({ 
  value, onChange, placeholder, type = 'text' 
}) => {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-32 px-3 py-1.5 text-sm bg-white/[0.08] border border-white/[0.15] rounded-md text-white/70 focus:outline-none focus:border-blue-400/50"
    />
  );
};

export const SettingsSidebar: React.FC = () => {
  const { settings, updateSettings, resetSettings } = useSettings();

  const handleReset = () => {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      resetSettings();
    }
  };

  return (
    <div className="h-full flex flex-col bg-transparent relative overflow-hidden">
      {/* Header */}
      <div className="shrink-0 relative z-10">
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-blue-500/25 to-transparent z-20" />
        
        <div className="h-11 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-white/60" />
            <span className="text-[11px] font-medium tracking-wider text-white/50 uppercase">Settings</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="p-1.5 rounded-md text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all"
              title="Reset to Defaults"
            >
              <RotateCcw size={12} />
            </button>
            <button
              className="p-1.5 rounded-md text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all"
              title="Settings are saved automatically"
            >
              <Save size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Editor Settings */}
        <SettingsSection title="Editor" icon={Type}>
          <SettingItem label="Font Size" description="Text size in the editor">
            <NumberInput 
              value={settings.editor.fontSize} 
              onChange={(value) => updateSettings('editor', { fontSize: value })}
              min={8}
              max={32}
            />
          </SettingItem>
          <SettingItem label="Tab Size" description="Number of spaces for tab">
            <NumberInput 
              value={settings.editor.tabSize} 
              onChange={(value) => updateSettings('editor', { tabSize: value })}
              min={1}
              max={8}
            />
          </SettingItem>
          <SettingItem label="Word Wrap" description="Wrap long lines">
            <ToggleSwitch 
              checked={settings.editor.wordWrap} 
              onChange={(checked) => updateSettings('editor', { wordWrap: checked })}
            />
          </SettingItem>
          <SettingItem label="Line Numbers" description="Show line numbers">
            <ToggleSwitch 
              checked={settings.editor.lineNumbers} 
              onChange={(checked) => updateSettings('editor', { lineNumbers: checked })}
            />
          </SettingItem>
          <SettingItem label="Show Minimap" description="Show code minimap">
            <ToggleSwitch 
              checked={settings.editor.showMinimap} 
              onChange={(checked) => updateSettings('editor', { showMinimap: checked })}
            />
          </SettingItem>
          <SettingItem label="AI Suggestions" description="Enable AI code suggestions">
            <ToggleSwitch 
              checked={settings.editor.isSuggestionsEnabled} 
              onChange={(checked) => updateSettings('editor', { isSuggestionsEnabled: checked })}
            />
          </SettingItem>
        </SettingsSection>

        {/* Appearance Settings */}
        <SettingsSection title="Appearance" icon={Palette}>
          <SettingItem label="Theme" description="Color scheme">
            <SelectInput 
              value={settings.appearance.theme}
              onChange={(value) => updateSettings('appearance', { theme: value as 'dark' | 'light' | 'auto' })}
              options={['dark', 'light', 'auto']}
            />
          </SettingItem>
          <SettingItem label="Font Family" description="Editor font">
            <TextInput 
              value={settings.appearance.fontFamily}
              onChange={(value) => updateSettings('appearance', { fontFamily: value })}
              placeholder="JetBrains Mono, monospace"
            />
          </SettingItem>
        </SettingsSection>

        {/* AI Settings */}
        <SettingsSection title="AI Settings" icon={Bot}>
          <SettingItem label="Mode" description="AI interaction mode">
            <SelectInput 
              value={settings.ai.mode}
              onChange={(value) => updateSettings('ai', { mode: value as 'chat' | 'inline' | 'assistant' })}
              options={['chat', 'inline', 'assistant']}
            />
          </SettingItem>
          <SettingItem label="Response Length" description="AI response verbosity">
            <SelectInput 
              value={settings.ai.responseLength}
              onChange={(value) => updateSettings('ai', { responseLength: value as 'short' | 'medium' | 'long' })}
              options={['short', 'medium', 'long']}
            />
          </SettingItem>
          <SettingItem label="Explain Code" description="Auto-explain generated code">
            <ToggleSwitch 
              checked={settings.ai.explainCode} 
              onChange={(checked) => updateSettings('ai', { explainCode: checked })}
            />
          </SettingItem>
        </SettingsSection>

        {/* Auto Features */}
        <SettingsSection title="Auto Features" icon={Zap}>
          <SettingItem label="Auto Save" description="Save files automatically">
            <ToggleSwitch 
              checked={settings.autoFeatures.autoSave} 
              onChange={(checked) => updateSettings('autoFeatures', { autoSave: checked })}
            />
          </SettingItem>
          <SettingItem label="Auto Format" description="Format code on save">
            <ToggleSwitch 
              checked={settings.autoFeatures.autoFormat} 
              onChange={(checked) => updateSettings('autoFeatures', { autoFormat: checked })}
            />
          </SettingItem>
        </SettingsSection>

        {/* Account Settings */}
        <SettingsSection title="Account" icon={User}>
          <SettingItem label="API Key" description="Your API key for AI services">
            <TextInput 
              value={settings.account.apiKey}
              onChange={(value) => updateSettings('account', { apiKey: value })}
              placeholder="Enter API key"
              type="password"
            />
          </SettingItem>
        </SettingsSection>
      </div>
    </div>
  );
};
