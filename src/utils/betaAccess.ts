/**
 * Public-beta access mode — Azemax Studio is usable WITHOUT an account.
 *
 * Flow: Landing page → "Enter Azemax" → /app workspace immediately. No login
 * form blocks the workspace; sign-in/sign-up remain OPTIONAL (e.g. to sync or
 * raise AI/execution quotas).
 *
 * Anonymous workspace model:
 * - Files persist ONLY in the browser (localStorage, `azemax:u:<anonId>:` and
 *   legacy global keys as fallback). Nothing is uploaded to another account.
 * - Clearing browser storage or switching devices loses anonymous work — the
 *   workspace banner says so explicitly.
 * - The anonymous storage namespace (`beta-anon`) is disjoint from every real
 *   user id, so anonymous data can never leak into (or read from) an account.
 *
 * Flags (all build-time, Vite-baked):
 * - VITE_PUBLIC_BETA=false → restores the hard login wall (gate active).
 *   Default is beta-ON: anything but the string "false" enables it.
 * - VITE_DISABLE_AUTH=true (legacy) keeps working: same open workspace, but
 *   backed by the shared `local-dev` server identity. Prefer PUBLIC_BETA.
 */

function readEnvFlag(key: string): string | undefined {
    try {
        // Reference `import.meta.env` literally so Vite injects it (see the note
        // in sessionToken.ts — the optional-chained form breaks env injection).
        const env = import.meta.env as Record<string, string | undefined> | undefined;
        return env?.[key];
    } catch {
        return undefined;
    }
}

/** Open-workspace beta switch. Defaults to true (no login wall). */
export const PUBLIC_BETA: boolean = (() => {
    const raw = readEnvFlag('VITE_PUBLIC_BETA');
    if (raw === undefined) return true;
    return raw !== 'false';
})();

/** Stable storage identity for anonymous beta visitors (never a real user). */
export const ANON_USER_ID = 'beta-anon';

export interface BetaAnonUser {
    id: string;
    email: string;
    displayName: string;
    createdAt: string;
    isAnonymous: true;
}

export const ANON_USER: BetaAnonUser = {
    id: ANON_USER_ID,
    email: 'guest@azemax.local',
    displayName: 'Guest',
    createdAt: new Date(0).toISOString(),
    isAnonymous: true,
};

/** True for the anonymous beta storage identity (never collides with accounts). */
export function isAnonUserId(id: string | null | undefined): boolean {
    return id === ANON_USER_ID;
}

/**
 * Workspace routing predicate (pure, unit-tested): /app and /app/* mount the
 * IDE workspace; everything else renders the landing page. Direct navigation
 * to /app must always reach the workspace — never a login redirect.
 */
export function isAppRoutePath(pathname: string): boolean {
    return pathname === '/app' || pathname.startsWith('/app/');
}

/** localStorage key for the dismissible anonymous-workspace banner. */
export const BETA_BANNER_DISMISSED_KEY = 'azemax:beta-banner-dismissed';

export function isBetaBannerDismissed(): boolean {
    try {
        return localStorage.getItem(BETA_BANNER_DISMISSED_KEY) === '1';
    } catch {
        return false;
    }
}

export function dismissBetaBanner(): void {
    try {
        localStorage.setItem(BETA_BANNER_DISMISSED_KEY, '1');
    } catch {
        /* storage unavailable — banner simply reappears next load */
    }
}
