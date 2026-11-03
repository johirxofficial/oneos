/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        oneos: {
          bg: "#070a10",
          panel: "#0d1219",
          elevated: "#121926",
          border: "#1e2836",
          muted: "#7d8b9e",
          text: "#e8eef7",
          accent: "#4f9dff",
          accent2: "#7b61ff",
          ok: "#37d399",
          warn: "#f5b544",
          danger: "#ff5f6d",
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI Variable", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Code", "Consolas", "monospace"],
      },
      boxShadow: {
        glass: "0 20px 60px -20px rgba(0,0,0,0.75)",
        glow: "0 0 0 1px rgba(79,157,255,0.18), 0 12px 40px -12px rgba(79,157,255,0.45)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "boot-pulse": {
          "0%, 100%": { opacity: "0.35", transform: "scale(0.96)" },
          "50%": { opacity: "1", transform: "scale(1)" },
        },
        "rise": {
          "0%": { opacity: "0", transform: "translateY(14px) scale(0.985)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 320ms ease-out both",
        "boot-pulse": "boot-pulse 1600ms ease-in-out infinite",
        rise: "rise 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
      },
    },
  },
  plugins: [],
};
