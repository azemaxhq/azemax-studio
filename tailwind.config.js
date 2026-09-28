import containerQueries from '@tailwindcss/container-queries'

/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // Azemax layered dark-neutral system
                background: "#0B0E13",
                surface: "#10141B",
                "surface-2": "#141923",
                "surface-3": "#181E29",
                "surface-hover": "#1D2430",
                "surface-active": "#222B38",
                terminal: "#0C1118",
                border: "rgba(255,255,255,0.075)",
                "border-strong": "rgba(255,255,255,0.12)",
                text: "#F1F5F9",
                "text-secondary": "#A7B0BF",
                muted: "#727D8E",
                disabled: "#4D5665",
                primary: "#5B8CFF",
                secondary: "#A7B0BF",
                accent: "#5B8CFF",
                "accent-bright": "#78A7FF",
                success: "#35D399",
                warning: "#F5B94C",
                error: "#FF647C",
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
            },
            borderRadius: {
                'az-xs': '4px',
                'az-sm': '6px',
                'az-md': '8px',
                'az-lg': '10px',
                'az-xl': '12px',
            },
            transitionDuration: {
                'az-fast': '140ms',
                'az-base': '180ms',
                'az-slow': '260ms',
            },
        },
    },
    plugins: [containerQueries],
}
