/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--color-primary-hover)",
          soft: "var(--color-primary-soft)",
          border: "var(--color-primary-border)",
        },
        surface: {
          DEFAULT: "var(--color-surface)",
          raised: "var(--color-surface-raised)",
          sunken: "var(--color-surface-sunken)",
          overlay: "var(--color-surface-overlay)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          subtle: "var(--color-border-subtle)",
          strong: "var(--color-border-strong)",
        },
        text: {
          DEFAULT: "var(--color-text)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
          ghost: "var(--color-text-ghost)",
          disabled: "var(--color-text-disabled)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          soft: "var(--color-danger-soft)",
        },
      },
      boxShadow: {
        card: "var(--shadow-card)",
        float: "var(--shadow-float)",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "fade-slide-up": "fadeSlideUp 0.25s ease-out",
        "breathe": "breathe 3s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", maxHeight: "0" },
          "100%": { opacity: "1", maxHeight: "200px" },
        },
      },
    },
  },
  plugins: [],
};
