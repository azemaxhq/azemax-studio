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
                // Azemax neutral-first surfaces
                background: "#0B0D10",
                surface: "#101318",
                "surface-2": "#14171C",
                "surface-3": "#181B21",
                "surface-hover": "#1C2026",
                border: "#242830",
                "border-strong": "#303640",
                text: "#F2F3F5",
                "text-secondary": "#A7ACB5",
                muted: "#707680",
                primary: "#3B82F6",
                secondary: "#A7ACB5",
                accent: "#3B82F6",
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
