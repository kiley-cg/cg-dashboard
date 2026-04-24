# Color Graphics brand assets

**Upload the full `brand-guidelines.html` file to this directory** (sibling to this README).

Why here:
- `docs/` is not served by Next.js, so this large reference document is never shipped to users.
- It stays in git history as the canonical source of truth for CG brand tokens.
- A future build step (or a Claude session) can read it via `Read` with offset/limit to extract the exact color, type, spacing, and component tokens without overflowing any prompt.

When the file is in place, update `src/styles/brand-tokens.ts` to match:
- Colors: primary/secondary/neutral/accent/success/warn/danger
- Typography: exact font family, weights, and sizes
- Spacing / radius / shadow scales

Logos (SVG) belong in `public/brand/` so Next.js serves them at runtime.
