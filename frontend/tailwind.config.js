/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { navy: "#25233f", ink: "#252640", muted: "#737b91", canvas: "#f5f6fc", accent: "#625bd0", "accent-strong": "#5048b8" } } },
  plugins: [],
};
