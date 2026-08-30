import React from 'react';
import { BRAND } from '../../core/branding';

export interface AzemaxLogoProps {
  size?: number;
  className?: string;
  showWordmark?: boolean;
  wordmarkClassName?: string;
  alt?: string;
}

/**
 * Azemax Logo component.
 * Reuses the canonical Azemax logo asset preserving exact proportions and colors.
 */
export const AzemaxLogo: React.FC<AzemaxLogoProps> = ({
  size = 24,
  className = '',
  showWordmark = false,
  wordmarkClassName = '',
  alt = BRAND.name,
}) => {
  return (
    <div className={`flex items-center gap-2 select-none shrink-0 ${className}`}>
      <img
        src={BRAND.logoSrc}
        alt={alt}
        width={size}
        height={size}
        className="object-contain shrink-0 antialiased"
        style={{
          width: size,
          height: size,
          display: 'block',
          imageRendering: 'auto' as const,
        }}
        loading="eager"
        decoding="async"
        draggable={false}
      />
      {showWordmark && (
        <span
          className={`font-semibold tracking-tight text-white/90 text-sm leading-none antialiased ${wordmarkClassName}`}
        >
          {BRAND.name}
        </span>
      )}
    </div>
  );
};
