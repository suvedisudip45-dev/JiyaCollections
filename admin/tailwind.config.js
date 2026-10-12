/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f9f7",
          100: "#d9f1eb",
          200: "#b3e3d7",
          300: "#7fcebf",
          400: "#43b3a0",
          500: "#0d7a68",
          600: "#0b6657",
          700: "#084e42",
          800: "#063b32",
          900: "#042721",
          950: "#021613",
        },
        surface: {
          base: "#f8fafc",
          card: "#ffffff",
          subtle: "#f1f5f9",
          tint: "#effcf9",
        },
        ink: {
          primary: "#0f172a",
          secondary: "#334155",
          muted: "#64748b",
          subtle: "#94a3b8",
          inverted: "#ffffff",
        },
        border: {
          light: "#e2e8f0",
          subtle: "#f1f5f9",
          brand: "#b3e3d7",
        },
        ledger: {
          debit: "#0369a1",
          credit: "#0f766e",
          balanced: "#15803d",
          unbalanced: "#b91c1c",
        },
      },
      fontFamily: {
        sans: ["Outfit", "Inter", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
        display: ["Space Grotesk", "Outfit", "sans-serif"],
      },
      boxShadow: {
        subtle: "0 1px 2px 0 rgba(0, 0, 0, 0.04)",
        card: "0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)",
        elevated: "0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -2px rgba(0, 0, 0, 0.05)",
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "0.875rem" }],
      },
    },
  },
  plugins: [],
};
