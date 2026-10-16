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
                // Azemax Midnight Blue layered navy system
                background: "#080F1C",
                surface: "#0A1322",
                "surface-2": "#0D192B",
                "surface-3": "#112039",
                "surface-elevated": "#112039",
                "surface-hover": "#152744",
                "surface-active": "#172D50",
                "surface-input": "#070D17",
                terminal: "#070D17",
                border: "#1B2A42",
                "border-subtle": "#142137",
                "border-strong": "#2A4164",
                text: "#E6EDF8",
                "text-secondary": "#A5B5CD",
                muted: "#72849F",
                disabled: "#53647D",
                primary: "#5B8CFF",
                secondary: "#A5B5CD",
                accent: "#5B8CFF",
                "accent-hover": "#79A3FF",
                "accent-bright": "#8FB0FF",
                "accent-subtle": "#11264A",
                "accent-border": "#294B80",
                success: "#67D6A0",
                warning: "#F0C674",
                error: "#FF7D8B",
                info: "#7FA8F0",
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
