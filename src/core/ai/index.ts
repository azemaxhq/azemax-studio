/**
 * Central AI runtime — the single source of truth for every AI feature
 * (chat, code generation, modification, autocomplete, /// comments, explain,
 * fix, regenerate, agent/tool workflows).
 *
 * Features route through `AIClient` (one streaming implementation), the
 * request registry (`AIRequestManager`) for cancellation/races, and the
 * parser/sanitizer (`AIResponseParser`) so model output never reaches the
 * editor or chat unvalidated.
 */

export * from './types';
export * from './AIAbortController';
export * from './AIError';
export * from './AIStream';
export * from './AIRequestManager';
export * from './AIMessageStore';
export * from './AIContextBuilder';
export * from './AIResponseParser';
export * from './AICache';
export * from './AIClient';
export * from './AIOutputPolicy';
export * from './languageIndentation';
export * from './AICodeNormalizer';
export * from './AICodeValidator';
export * from './aiPerf';
export * from './modelRouter';
export * from './taskConfigClient';
export * from './commentSyntax';
export * from './AIProviderNormalizer';
export * from './intentResolver';

import { AIRequestManager, aiRequestManager } from './AIRequestManager';
import { AIMessageStore } from './AIMessageStore';

export { aiRequestManager };

export type { AIRequestManager, AIMessageStore };