import React from 'react';
import { BRAND } from '../../core/branding';

interface Props {
  size?: number;
  containerSize?: number;
  showLabel?: boolean;
  label?: string;
  className?: string;
}

/**
 * Single shared Azemax AI identity — locked 28×28 container, 20px logo, 7-8px radius.
 * Used for loading, thinking, streaming, completed, error, tool states — never resized.
 */
export const AzemaxAIIdentity: React.FC<Props> = ({
  containerSize = 28,
  size = 20,
  showLabel = true,
  label = 'Azemax',
  className = '',
}) => {
  return (
    <div className={`inline-flex items-center gap-2 select-none ${className}`} style={{ minHeight: containerSize }}>
      <span
        aria-hidden="true"
        style={{
          flex: '0 0 28px',
          width: 28,
          height: 28,
          borderRadius: 7,
          background: 'var(--az-surface)',
          border: '1px solid var(--az-border)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <img
          src={BRAND.logoSrc}
          alt=""
          width={size}
          height={size}
          loading="eager"
          decoding="async"
          style={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
        />
      </span>
      {showLabel && (
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--az-text-muted)', letterSpacing: '-0.01em', lineHeight: 1 }}>{label}</span>
      )}
    </div>
  );
};

export const AnimatedDots: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <span className={`ai-loading-dots-subtle ${className}`} aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, width: 16, justifyContent: 'flex-start' }}>
      <span className="ai-dot-subtle" />
      <span className="ai-dot-subtle" />
      <span className="ai-dot-subtle" />
    </span>
  );
};
