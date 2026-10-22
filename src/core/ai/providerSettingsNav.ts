/**
 * Navigation bridge for the AI Providers settings category.
 *
 * The in-chat model selector needs to be able to send the user to
 * "Settings → AI Providers". The settings panel lives in a different part of
 * the tree, so the two are connected through the application's existing
 * `EventBus` rather than by threading a callback through the layout.
 */

import { EventBus } from '../runtime/EventBus';

export type ProviderSettingsNavEvents = {
    /** Open the "AI Providers" settings category. */
    'open-ai-providers': void;
};

export const providerSettingsNav = new EventBus<ProviderSettingsNavEvents>();

/** Ask the settings panel to open the AI Providers category. */
export function openAIProvidersSettings(): void {
    providerSettingsNav.emit('open-ai-providers', undefined);
}
