/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: "#f8f7f4",
          dim: "#eae8e2",
          bright: "#fcfbf9",
        },
        ink: {
          DEFAULT: "#161714",
          secondary: "#363532",
          muted: "#6f6d68",
          faint: "#a6a49f",
        },
        stone: {
          50: "#fbfbf9",
          100: "#f5f3ef",
          200: "#eae8e2",
          300: "#dedbd3",
          400: "#c5c1b8",
        },
        terracotta: {
          DEFAULT: "#d85b3f",
          hover: "#c24e34",
          subtle: "#faf0ed",
          border: "#f0b8aa",
        },
        status: {
          success: { text: "#215e38", bg: "#edf7f1", border: "#bbe5cc" },
          warning: { text: "#8f5813", bg: "#fdf7ec", border: "#f4dcac" },
          error: { text: "#9e2a2b", bg: "#fdf2f2", border: "#f8c8c8" },
          info: { text: "#2b4c7e", bg: "#eff5fb", border: "#bcd7f4" },
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', "sans-serif"],
        sans: ['"DM Sans"', "sans-serif"],
      },
      borderRadius: {
        fine: "2px",
        subtle: "4px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(22, 23, 20, 0.04)",
        lift: "0 8px 24px -4px rgba(22, 23, 20, 0.08)",
        drawer: "-8px 0 32px rgba(22, 23, 20, 0.12)",
        "floating-bar": "0 -4px 20px rgba(22, 23, 20, 0.06)",
      },
    },
  },
  plugins: [],
};
