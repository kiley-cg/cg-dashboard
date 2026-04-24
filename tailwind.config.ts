import type { Config } from "tailwindcss";
import { brand } from "./src/styles/brand-tokens";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cg: {
          bg: brand.color.bg,
          surface: brand.color.surface,
          text: brand.color.text,
          muted: brand.color.muted,
          red: brand.color.red,
          border: brand.color.border,
        },
      },
      fontFamily: {
        sans: [...brand.font.sans],
      },
      borderRadius: {
        card: brand.radius.card,
      },
    },
  },
  plugins: [],
};

export default config;
