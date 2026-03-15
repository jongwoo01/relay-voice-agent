/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./renderer/index.html",
    "./renderer/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Google Sans Text", "Google Sans", "Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
}
