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

// Core AI types and utilities
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
// Re-export modelRouter but avoid conflicts with byokTypes
export {
  OR_PREFIX,
  HF_PREFIX,
  KILO_PREFIX,
  stripPrefixes,
  inferProvider,
  configuredDirectProviders,
  defaultModelFor,
  buildDirectChain,
  resolveModel,
  PROVIDER_CAPABILITIES as MODEL_ROUTER_PROVIDER_CAPABILITIES,
  type ProviderId as ModelRouterProviderId,
  type ProviderCapabilities as ModelRouterProviderCapabilities,
  type ResolvedModel,
} from './modelRouter';
export * from './taskConfigClient';
export * from './commentSyntax';
export * from './AIProviderNormalizer';
export * from './intentResolver';
export * from './agentTaskContext';
export * from './agentTools';
export * from './agentLoop';
export * from './agentController';
export * from './intentUnderstanding';

// BYOK Provider Architecture
export { providerRegistry } from './providers/registry';
export * from './credentialStore';
export * from './providerContext';
// Note: byokTypes re-exports types from './types' and './AIError', so we don't re-export them here to avoid conflicts

import { AIRequestManager, aiRequestManager } from './AIRequestManager';
import { AIMessageStore } from './AIMessageStore';

export { aiRequestManager };

export type { AIRequestManager, AIMessageStore };