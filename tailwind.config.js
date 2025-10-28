import { heroui } from "@heroui/theme";

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/layouts/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#f3f0ff",
          100: "#e9e5ff",
          200: "#d6ceff",
          300: "#b8a6ff",
          400: "#9575ff",
          500: "#6c5ecf",
          600: "#5a4bb8",
          700: "#4c3d9a",
          800: "#3f347c",
          900: "#352e65",
          950: "#1f1a3a",
          DEFAULT: "#6c5ecf",
          foreground: "#ffffff",
        },
      },
    },
  },
  darkMode: "class",
  plugins: [heroui()],
};
