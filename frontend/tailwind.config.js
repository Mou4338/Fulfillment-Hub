/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        // Primary accent: a deep operational teal. Used for actions, active states and focus — nothing else.
        brand: {
          50: "#ecfbf8", 100: "#d0f4ed", 200: "#a3e8dc", 300: "#6dd4c6", 400: "#3bb8aa",
          500: "#1f9c8f", 600: "#157d74", 700: "#14645e", 800: "#15504c", 900: "#15423f",
        },
        // Navigation chrome: a calm navy so the sidebar reads as "frame", content as "work".
        navy: {
          50: "#f2f5f9", 100: "#e3e9f1", 200: "#c5d1e0", 300: "#9aaec6", 400: "#6b84a3",
          500: "#4b6485", 600: "#3a4f6b", 700: "#2c3d54", 800: "#1c2a3d", 900: "#132033", 950: "#0c1624",
        },
        ink: { DEFAULT: "#0f172a", soft: "#334155", muted: "#5b6b82", faint: "#94a3b8" },
        canvas: "#f3f5f9",
        line: "#e3e8ef",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)",
        raised: "0 4px 12px -2px rgba(16, 24, 40, 0.08), 0 2px 4px -2px rgba(16, 24, 40, 0.04)",
        pop: "0 16px 40px -12px rgba(16, 24, 40, 0.28)",
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.1rem" },
      fontSize: { "2xs": ["0.6875rem", { lineHeight: "1rem" }] },
    },
  },
  plugins: [],
};
