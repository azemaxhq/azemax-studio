/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "#0d1117", // Github Dimmed
                surface: "#161b22",
                primary: "#58a6ff",
                secondary: "#238636",
                border: "#30363d",
                text: "#c9d1d9",
                muted: "#8b949e",
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                mono: ['"Fira Code"', 'monospace'],
            },
        },
    },
    plugins: [],
}
