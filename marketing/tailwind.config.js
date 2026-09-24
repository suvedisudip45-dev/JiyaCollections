/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
      },
      colors: {
        brand: {
          50:  '#f0faf8',
          100: '#d4f0eb',
          200: '#aae1d7',
          300: '#72c9bc',
          400: '#40aa9d',
          500: '#248d82',
          600: '#1a7268',
          700: '#175c55',
          800: '#154946',
          900: '#133c3a',
          950: '#082522',
        },
      },
    },
  },
  plugins: [],
}
