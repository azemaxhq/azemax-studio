/**
 * Supported BYOK providers, mirrored from the shipped provider registry
 * (src/core/ai/providers/*). Keep this list in sync when a provider adapter is
 * added or removed. Model names are starter examples; providers control the
 * live catalog.
 */

export interface ProviderInfo {
    id: string;
    name: string;
    models: string;
    credential: string;
    /** Public key-management page. Omitted for the custom provider. */
    keyUrl?: string;
    note: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
    {
        id: 'openai',
        name: 'OpenAI',
        models: 'GPT-4o, GPT-4o Mini, GPT-4 Turbo, GPT-3.5 Turbo',
        credential: 'OpenAI API key',
        keyUrl: 'https://platform.openai.com/api-keys',
        note: 'Starter models are selectable in settings; model discovery is used when available.',
    },
    {
        id: 'anthropic',
        name: 'Anthropic',
        models: 'Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus',
        credential: 'Anthropic API key',
        keyUrl: 'https://console.anthropic.com/settings/keys',
        note: 'Uses the Anthropic messages API through the provider adapter.',
    },
    {
        id: 'google',
        name: 'Google Gemini',
        models: 'Gemini 1.5 Pro, Gemini 1.5 Flash, Gemini 1.0 Pro',
        credential: 'Google AI Studio key',
        keyUrl: 'https://aistudio.google.com/apikey',
        note: 'A Google AI Studio key is separate from a Google account sign-in.',
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        models: 'Model catalog, including free Nemotron endpoints',
        credential: 'OpenRouter key',
        keyUrl: 'https://openrouter.ai/keys',
        note: 'Model availability and free-tier limits are controlled by OpenRouter.',
    },
    {
        id: 'groq',
        name: 'Groq',
        models: 'Llama 3.1 70B/8B, Mixtral 8x7B, Gemma 2 9B',
        credential: 'Groq key',
        keyUrl: 'https://console.groq.com/keys',
        note: 'Fast inference for open models; the live catalog may differ from this starter list.',
    },
    {
        id: 'nvidia',
        name: 'NVIDIA NIM',
        models: 'Nemotron and Llama NIM endpoints',
        credential: 'NVIDIA API key',
        keyUrl: 'https://build.nvidia.com/',
        note: 'Use the model identifier exposed by the NIM endpoint you have access to.',
    },
    {
        id: 'custom',
        name: 'Custom OpenAI-compatible',
        models: 'Any model ID your endpoint exposes',
        credential: 'Endpoint API key',
        note: 'Requires an HTTPS base URL and an OpenAI-compatible chat completions API. Tool calling is required for agent features.',
    },
];
