import React, { memo } from 'react';
import { ArrowRight, User, LogOut, CheckCircle2, AlertTriangle, LogIn, Cloud, CloudOff, Loader2, RefreshCw } from 'lucide-react';
import { SETTINGS_CATEGORIES } from '../../settings/settingsSchema';
import type { CategoryDefinition, CategoryKey } from '../../settings/settingsTypes';
import { CATEGORY_ICONS } from './settingsIcons';
import { useAuth } from '../../context/AuthContext';
import { useAccountSyncStatus, retryAccountSync } from '../../core/sync/syncStatus';
import { navigate } from '../../utils/appRouter';

import { AzemaxLogo } from '../UI/AzemaxLogo';
import { BRAND } from '../../core/branding';

interface SettingsHomeProps {
  onSelectCategory: (id: CategoryKey) => void;
}

const CategoryCard: React.FC<{ category: CategoryDefinition; onSelect: (id: CategoryKey) => void }> = memo(({ category, onSelect }) => {
  const Icon = CATEGORY_ICONS[category.icon] ?? CATEGORY_ICONS.settings;
  return (
    <button
      type="button"
      onClick={() => onSelect(category.id)}
      className="group flex flex-col items-start gap-1.5 min-h-[128px] p-4 rounded-xl border border-white/[0.08] bg-white/[0.03] text-left transition-colors hover:bg-white/[0.05] hover:border-white/[0.14] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(91,140,255,0.5)]"
    >
      <div className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/70 transition-colors group-hover:text-white group-hover:border-[rgba(91,140,255,0.3)]">
        <Icon size={16} />
      </div>
      <span className="mt-1 text-[13px] font-medium text-white/90">{category.label}</span>
      <span className="text-[11px] text-white/40 leading-relaxed">{category.description}</span>
      <span className="mt-auto inline-flex items-center gap-1 pt-1.5 text-[10px] font-medium text-[rgba(91,140,255,0.7)] transition-colors group-hover:text-[var(--az-text)]">
        Open <ArrowRight size={10} />
      </span>
    </button>
  );
});

const formatSyncLabel = (lastSyncedAt: number | null): string => {
  if (!lastSyncedAt) return 'Account sync ready';
  const seconds = Math.max(0, Math.round((Date.now() - lastSyncedAt) / 1000));
  if (seconds < 10) return 'Synced just now';
  if (seconds < 60) return `Synced ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Synced ${minutes}m ago`;
  return 'Synced';
};

export const SettingsHome: React.FC<SettingsHomeProps> = ({ onSelectCategory }) => {
  const { user, logout } = useAuth();
  const sync = useAccountSyncStatus();
  const syncLabel = sync.phase === 'syncing'
    ? 'Syncing account…'
    : sync.phase === 'error'
      ? 'Account sync failed'
      : formatSyncLabel(sync.lastSyncedAt);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Account Profile Card */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[var(--az-accent)]/20 border border-[var(--az-accent)]/40 flex items-center justify-center text-[var(--az-accent-bright)] font-semibold text-sm shrink-0 overflow-hidden">
              {user ? (
                user.photoUrl ? (
                  <img src={user.photoUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  (user.displayName ? user.displayName.charAt(0) : user.email.charAt(0)).toUpperCase()
                )
              ) : <User size={16} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-white/90 truncate">
                  {user ? (user.displayName || user.email) : 'Not signed in'}
                </span>
                {user ? (
                  user.emailVerified ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--az-success)] bg-[var(--az-success)]/10 px-1.5 py-0.5 rounded border border-[var(--az-success)]/20">
                      <CheckCircle2 size={10} /> Verified
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate('/verify-email')}
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--az-warning)] bg-[var(--az-warning)]/10 px-1.5 py-0.5 rounded border border-[var(--az-warning)]/20 hover:underline cursor-pointer"
                    >
                      <AlertTriangle size={10} /> Unverified
                    </button>
                  )
                ) : null}
              </div>
              <p className="text-[11px] text-white/40 truncate mt-0.5">
                {user ? user.email : 'Sign in to sync your workspace'}
              </p>
              {user && (
                <div
                  className="mt-1.5 flex items-center gap-1.5 text-[10px] min-w-0"
                  aria-live="polite"
                  title={sync.error || undefined}
                >
                  {sync.phase === 'syncing' ? (
                    <Loader2 size={11} className="animate-spin text-[var(--az-accent-bright)] shrink-0" />
                  ) : sync.phase === 'error' ? (
                    <CloudOff size={11} className="text-[var(--az-warning)] shrink-0" />
                  ) : (
                    <Cloud size={11} className="text-[var(--az-success)] shrink-0" />
                  )}
                  <span className={`truncate ${sync.phase === 'error' ? 'text-[var(--az-warning)]' : 'text-white/40'}`}>
                    {syncLabel}
                  </span>
                  {sync.phase === 'error' && (
                    <button
                      type="button"
                      onClick={() => retryAccountSync()}
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--az-accent-bright)] hover:underline cursor-pointer shrink-0"
                    >
                      <RefreshCw size={10} /> Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div>
            {user ? (
              <button
                type="button"
                onClick={() => logout()}
                className="flex items-center gap-1.5 text-xs text-[var(--az-text-muted)] hover:text-white px-2.5 py-1.5 rounded-lg border border-white/[0.08] hover:bg-white/[0.05] transition-colors cursor-pointer"
                title="Sign out"
              >
                <LogOut size={13} />
                <span>Sign out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/login?redirect=/app')}
                className="flex items-center gap-1.5 text-xs font-medium text-white bg-[var(--az-accent)] hover:bg-[var(--az-accent-hover)] px-3 py-1.5 rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                <LogIn size={13} />
                <span>Sign in</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 180px), 1fr))' }}
      >
        {SETTINGS_CATEGORIES.map((category) => (
          <CategoryCard key={category.id} category={category} onSelect={onSelectCategory} />
        ))}
      </div>

      {/* Product Information */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AzemaxLogo size={28} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-white/90">{BRAND.name}</span>
              <span className="text-[10px] font-mono text-white/40 bg-white/[0.06] px-1.5 py-0.5 rounded border border-white/[0.06]">
                v{BRAND.version}
              </span>
            </div>
            <p className="text-[11px] text-white/40 mt-0.5">{BRAND.tagline}</p>
          </div>
        </div>
      </div>
    </div>
  );
};