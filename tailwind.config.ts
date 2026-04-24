import type { Config } from "tailwindcss";
import { brand } from "./src/styles/brand-tokens";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cg: {
          red: brand.color.red,
          black: brand.color.black,
          white: brand.color.white,
          "md-gray": brand.color.mdGray,
          teal: brand.color.teal,
          "red-50": brand.color.redScale[50],
          "red-100": brand.color.redScale[100],
          "red-200": brand.color.redScale[200],
          "red-300": brand.color.redScale[300],
          "red-400": brand.color.redScale[400],
          "red-500": brand.color.redScale[500],
          "red-600": brand.color.redScale[600],
          "red-700": brand.color.redScale[700],
          "red-800": brand.color.redScale[800],
          "red-900": brand.color.redScale[900],
          "red-950": brand.color.redScale[950],
          "n-0": brand.color.neutral[0],
          "n-50": brand.color.neutral[50],
          "n-100": brand.color.neutral[100],
          "n-200": brand.color.neutral[200],
          "n-300": brand.color.neutral[300],
          "n-400": brand.color.neutral[400],
          "n-500": brand.color.neutral[500],
          "n-600": brand.color.neutral[600],
          "n-700": brand.color.neutral[700],
          "n-800": brand.color.neutral[800],
          "n-900": brand.color.neutral[900],
          success: brand.color.status.success,
          warning: brand.color.status.warning,
          danger: brand.color.status.danger,
          info: brand.color.status.info,
        },
      },
      fontFamily: {
        sans: [...brand.font.sans],
        script: [...brand.font.script],
      },
      borderRadius: {
        chip: brand.radius.chip,
        btn: brand.radius.button,
        card: brand.radius.card,
        input: brand.radius.input,
      },
    },
  },
  plugins: [],
};

export default config;
