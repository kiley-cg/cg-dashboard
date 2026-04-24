// Color Graphics brand tokens.
// Provisional values pulled from the visible portion of the brand guide
// (the full HTML will live at docs/brand/brand-guidelines.html once uploaded).
// Refine once the full guide is in the repo.

export const brand = {
  color: {
    bg: "#111111",
    surface: "#1A1A1A",
    text: "#FFFFFF",
    muted: "#B3B3B3",
    red: "#E01B2B",
    border: "#2A2A2A",
  },
  font: {
    sans: [
      "-apple-system",
      "BlinkMacSystemFont",
      "Segoe UI",
      "Roboto",
      "Helvetica Neue",
      "Arial",
      "sans-serif",
    ],
  },
  radius: {
    card: "12px",
  },
} as const;
