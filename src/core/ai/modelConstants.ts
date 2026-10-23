/**
 * Model Constants — single source of truth for default model identifiers.
 *
 * Extracted to break the circular dependency between AIContextBuilder and modelRouter.
 * Both modules can import from here without creating a cycle.
 */

export const DEFAULT_CHAT_MODEL = 'qwen/qwen3.8-27b';