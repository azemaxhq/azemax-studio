import React from 'react';

interface PersonAvatarProps {
    name: string;
    initials: string;
    photo: string | null;
    /** Optional responsive candidates, for example "small.webp 512w, large.webp 960w". */
    photoSrcSet?: string;
    photoAlt: string;
    /** Rendered pixel size. Keep square. */
    size?: number;
    className?: string;
}

/**
 * Profile image with a typographic fallback.
 *
 * A monogram is used while no verified photograph is published, so the page
 * never shows a stock photo or a broken image. When a real photograph is added
 * to `LEADERSHIP.photo`, this component and the Person schema both use it.
 */
export const PersonAvatar: React.FC<PersonAvatarProps> = ({
    name,
    initials,
    photo,
    photoSrcSet,
    photoAlt,
    size = 112,
    className = '',
}) => {
    if (photo) {
        return (
            <img
                src={photo}
                srcSet={photoSrcSet}
                sizes={`${size}px`}
                alt={photoAlt}
                width={size}
                height={size}
                loading="lazy"
                decoding="async"
                className={`shrink-0 rounded-[var(--az-radius-md)] border border-[var(--az-border)] bg-[var(--az-surface-2)] object-cover ${className}`}
                style={{ width: size, height: size }}
            />
        );
    }

    return (
        <div
            role="img"
            aria-label={`${name} — ${initials} monogram`}
            className={`flex shrink-0 items-center justify-center rounded-[var(--az-radius-md)] border border-[var(--az-accent-border)] bg-[var(--az-accent-soft)] font-semibold tracking-[-0.02em] text-[var(--az-accent-bright)] ${className}`}
            style={{ width: size, height: size, fontSize: Math.round(size * 0.3) }}
        >
            <span aria-hidden="true">{initials}</span>
        </div>
    );
};
