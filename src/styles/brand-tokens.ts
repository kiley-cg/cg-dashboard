// Color Graphics brand tokens — extracted from the CG Brand Guidelines
// (see docs/brand/CG Brand Guidelines.html). When in doubt, the guidelines
// are the source of truth; this file is the machine-readable mirror.

export const brand = {
  color: {
    // Primary
    red: "#E01B2B", // CG Red · signal / primary actions
    black: "#111111", // CG Black · wordmark / headings
    white: "#FFFFFF",

    // Secondary (approval required before use)
    mdGray: "#B1B3B6",
    teal: "#00A8B0",

    // CG Red scale (UI only)
    redScale: {
      50: "#FDECEE",
      100: "#FAD1D5",
      200: "#F5A5AD",
      300: "#ED6D7B",
      400: "#E94251",
      500: "#E01B2B", // brand
      600: "#B8121F",
      700: "#8F0C17",
      800: "#6B0811",
      900: "#47060B",
      950: "#26050A",
    },

    // Neutrals — surface, border, text
    neutral: {
      0: "#FFFFFF",
      50: "#F7F7F8",
      100: "#EFEFF1",
      200: "#E2E2E5",
      300: "#CACACE",
      400: "#9C9CA2",
      500: "#6E6E76",
      600: "#4F4F56",
      700: "#363639",
      800: "#212124",
      900: "#111114",
    },

    // Status (UI only)
    status: {
      success: "#2B8A4A",
      warning: "#D4881A",
      danger: "#E01B2B", // uses CG Red
      info: "#1E7A90",
    },
  },

  // Typography — Mulish for UI, Kaushan Script for the tagline.
  // Print uses Effra Bold; web substitutes Mulish (near-identical proportions).
  font: {
    sans: ["var(--font-mulish)", "system-ui", "sans-serif"],
    script: ["var(--font-kaushan)", "cursive"],
  },

  // Type scale — size / line-height / letter-spacing / weight
  type: {
    display: { size: 64, lh: 68, tracking: "-0.03em", weight: 900 },
    h1: { size: 44, lh: 48, tracking: "-0.02em", weight: 800 },
    h2: { size: 32, lh: 38, tracking: "-0.02em", weight: 800 },
    h3: { size: 24, lh: 30, tracking: "-0.01em", weight: 800 },
    subhead: { size: 18, lh: 24, tracking: "0", weight: 700 },
    body: { size: 16, lh: 24, tracking: "0", weight: 400 },
    label: { size: 14, lh: 20, tracking: "0", weight: 600 },
    caption: { size: 12, lh: 16, tracking: "0.02em", weight: 300 },
  },

  radius: {
    chip: "9999px",
    button: "9999px",
    card: "12px",
    input: "8px",
  },
} as const;
