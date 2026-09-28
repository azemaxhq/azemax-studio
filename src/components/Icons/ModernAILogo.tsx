

export const ModernAILogo = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        {/* Main Star */}
        <path d="M64 12C64 12 76 52 116 64C76 76 64 116 64 116C64 116 52 76 12 64C52 52 64 12 64 12Z" fill="url(#logo-gradient)" filter="url(#glow)" />
        {/* Secondary Star */}
        <path d="M100 20C100 20 106 36 122 42C106 48 100 64 100 64C100 64 94 48 78 42C94 36 100 20 100 20Z" fill="url(#logo-gradient)" opacity="0.7" />
        {/* Small Star */}
        <path d="M30 80C30 80 34 92 46 96C34 100 30 112 30 112C30 112 26 100 14 96C26 92 30 80 30 80Z" fill="url(#logo-gradient)" opacity="0.6" />

        <defs>
            <linearGradient id="logo-gradient" x1="12" y1="12" x2="116" y2="116" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#5B8CFF" />
                <stop offset="100%" stopColor="#78A7FF" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
        </defs>
    </svg>
);
