/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--color-signal)",
          hover: "var(--color-signal-hover)",
          soft: "var(--color-signal-soft)",
          border: "var(--color-signal-line)",
        },
        surface: {
          DEFAULT: "var(--color-surface)",
          raised: "var(--color-surface-raised)",
          sunken: "var(--color-surface-subtle)",
          overlay: "var(--color-surface-overlay)",
        },
        border: {
          DEFAULT: "var(--color-line)",
          subtle: "var(--color-line)",
          strong: "var(--color-line-strong)",
        },
        text: {
          DEFAULT: "var(--color-ink)",
          secondary: "var(--color-ink-secondary)",
          muted: "var(--color-ink-muted)",
          ghost: "var(--color-ink-faint)",
          disabled: "var(--color-ink-faint)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          soft: "var(--color-danger-soft)",
        },
        success: "var(--color-success)",
        warning: "var(--color-warning)",
      },
      boxShadow: {
        card: "none",
        float: "var(--shadow-popover)",
        window: "var(--shadow-window)",
      },
      animation: {
        "fade-in": "fadeIn var(--duration-fast) var(--ease-standard)",
        "fade-slide-up": "fadeSlideUp var(--duration-normal) var(--ease-standard)",
      },
    },
  },
  plugins: [],
};
