/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "sans-serif"],
      },
      colors: {
        brand: {
          darkRed: "#7A0C0C",
          red: "#9B1B1B",
          brightRed: "#C5221F",
          lightBg: "#F3F5F9",
          cardBg: "#FFFFFF",
          subBlockBg: "#F8FAFC",
          textPrimary: "#0F172A",
          textSecondary: "#64748B",
        },
      },
    },
  },
  plugins: [],
};