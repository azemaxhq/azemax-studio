/**
 * Secret redaction for anything that can be logged, surfaced, or persisted.
 *
 * Provider error payloads are the main risk: several providers echo a masked
 * form of the submitted key back in the error body
 * ("Incorrect API key provided: sk-proj-abc***xyz"). That payload must never
 * reach a log line, a diagnostic report, a chat bubble, or an analytics
 * event.
 *
 * The patterns below are deliberately broad. Over-redacting an error message
 * is harmless; leaking a credential is not.
 */

/** Matches common provider key shapes. */
const KEY_PATTERNS: RegExp[] = [
    // OpenAI / OpenRouter style: sk-..., sk-proj-..., sk-or-...
    /\bsk-[A-Za-z0-9_-]{6,}/g,
    // Anthropic: sk-ant-...
    /\bsk-ant-[A-Za-z0-9_-]{6,}/g,
    // Groq: gsk_...
    /\bgsk_[A-Za-z0-9]{6,}/g,
    // NVIDIA: nvapi-...
    /\bnvapi-[A-Za-z0-9_-]{6,}/g,
    // Google: AIza...
    /\bAIza[A-Za-z0-9_-]{10,}/g,
    // Hugging Face: hf_...
    /\bhf_[A-Za-z0-9]{6,}/g,
    // Kilo / generic bearer-ish
    /\bkilo_[A-Za-z0-9]{6,}/g,
];

/** Matches `Authorization: Bearer <token>` / `api_key: <value>` pairs. */
const AUTH_PATTERNS: RegExp[] = [
    /\b(bearer|token|api[-_]?key|authorization)\b\s*[:=]\s*["']?([A-Za-z0-9._~+/-]{8,})["']?/gi,
];

/** Matches a JSON field holding a credential. */
const JSON_KEY_PATTERN = /"(apiKey|api_key|access_token|accessToken|refresh_token|refreshToken|secret|client_secret|password|authorization)"\s*:\s*"[^"]*"/gi;

export const REDACTED = '[redacted]';

/**
 * Remove anything that looks like a credential from a string.
 *
 * Safe to call on any provider-supplied text (error bodies, messages).
 */
export function redactSecrets(input: string): string {
    if (!input) return input;
    let out = input;

    out = out.replace(JSON_KEY_PATTERN, (_m, field: string) => `"${field}":"${REDACTED}"`);

    for (const pattern of AUTH_PATTERNS) {
        out = out.replace(pattern, (_m, label: string) => `${label}=${REDACTED}`);
    }

    for (const pattern of KEY_PATTERNS) {
        out = out.replace(pattern, REDACTED);
    }

    return out;
}

/**
 * Redact a value that may be a string, an object, an Error, or an array.
 *
 * Objects are walked so a nested `{"error":{"message":"... sk-..."}}` is
 * cleaned as well. `Error` instances are preserved as Errors (only their
 * message is redacted) so abort detection and `instanceof` checks keep
 * working. Returns a JSON-safe structure.
 */
export function redactDeep<T>(value: T, depth = 0): T {
    if (depth > 6) return value;
    if (typeof value === 'string') return redactSecrets(value) as unknown as T;
    if (Array.isArray(value)) {
        return value.map((v) => redactDeep(v, depth + 1)) as unknown as T;
    }
    if (value instanceof Error) {
        // Keep the Error identity; only the human-readable text is cleaned.
        // Flattening an Error into a plain object would break abort detection
        // (`cause.name === 'AbortError'`) and `instanceof` checks.
        try {
            value.message = redactSecrets(value.message);
        } catch {
            // A frozen error object: leave it alone rather than throwing.
        }
        return value;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (/(api[-_]?key|token|secret|password|authorization)/i.test(k)) {
                out[k] = REDACTED;
                continue;
            }
            out[k] = redactDeep(v, depth + 1);
        }
        return out as unknown as T;
    }
    return value;
}
