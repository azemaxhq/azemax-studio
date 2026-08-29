import type { AIOperationType } from './aiRequestStore';
import type { AILoadingStatus } from '../../hooks/useAILoading';

/**
 * Legacy operation → status mapping kept for compatibility.
 * New code should use resolveAIActivity / getAIActivityLabel with full context
 * for dynamic, contextual labels. This fallback remains intentionally generic
 * to avoid hardcoded operation-specific sentences.
 */
export type AIUserFacingStatus = string;

export function getUserFacingStatus(
  _operation: AIOperationType | string,
  status: AILoadingStatus,
): string | null {
  if (status === 'idle' || status === 'success' || status === 'error' || status === 'cancelled') return null;
  // Generic fallback only — do not mention comment/code/file unless caller provides that context
  return 'Working';
}

export function getLegacyStatusLabel(status: AILoadingStatus): string | null {
  if (status === 'idle' || status === 'success' || status === 'error' || status === 'cancelled') return null;
  return 'Working';
}
