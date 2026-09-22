import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // NeuroSentinel semantic tokens
        "bg-primary":       "var(--bg-primary)",
        "bg-secondary":     "var(--bg-secondary)",
        "bg-tertiary":      "var(--bg-tertiary)",
        "bg-card":          "var(--bg-card)",
        "accent-primary":   "var(--accent-primary)",
        "accent-secondary": "var(--accent-secondary)",
        "accent-danger":    "var(--accent-danger)",
        "accent-success":   "var(--accent-success)",
        "accent-warning":   "var(--accent-warning)",
        "text-primary":     "var(--text-primary)",
        "text-secondary":   "var(--text-secondary)",
        "text-muted":       "var(--text-muted)",
      },
      fontFamily: {
        display: ["Outfit", "sans-serif"],
        body:    ["Inter",  "system-ui", "sans-serif"],
      },
      animation: {
        "border-rotate":  "borderRotate 4s linear infinite",
        "pulse-glow":     "pulseGlow 2.5s ease-in-out infinite",
        "fade-in-up":     "fadeInUp 0.5s ease forwards",
        "fade-in-scale":  "fadeInScale 0.4s ease forwards",
        "shimmer":        "shimmer 2.5s linear infinite",
        "float":          "float 4s ease-in-out infinite",
        "ping-slow":      "ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite",
      },
      backgroundImage: {
        "gradient-radial":  "radial-gradient(var(--tw-gradient-stops))",
        "noise":            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E\")",
      },
      boxShadow: {
        "glow-primary": "0 0 20px rgba(0, 240, 255, 0.35), 0 0 60px rgba(0, 240, 255, 0.12)",
        "glow-danger":  "0 0 20px rgba(255, 51, 102, 0.35), 0 0 60px rgba(255, 51, 102, 0.12)",
        "glow-sm":      "0 0 10px rgba(0, 240, 255, 0.25)",
        "card":         "0 8px 32px rgba(0, 0, 0, 0.4)",
      },
    },
  },
  plugins: [],
};
export default config;
