import React from 'react';
import { Search, X } from 'lucide-react';

interface SettingsSearchProps {
  query: string;
  onChange: (query: string) => void;
}

export const SettingsSearch: React.FC<SettingsSearchProps> = ({ query, onChange }) => {
  return (
    <div role="search">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onChange('');
          }}
          placeholder="Search settings..."
          aria-label="Search settings"
          className="w-full pl-8 pr-7 py-1.5 text-[13px] bg-white/[0.05] border border-white/[0.1] rounded-lg text-white/80 placeholder:text-white/30 focus:outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/20 transition-colors"
        />
        {query && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
};