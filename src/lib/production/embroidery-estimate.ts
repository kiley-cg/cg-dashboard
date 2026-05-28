// Embroidery time estimator. Multiplies (stitches × pieces) against a
// per-head, per-minute throughput, parallelizes across heads, and adds
// a flat setup time per design.
//
// Constants are industry defaults (Kiley confirmed 2026-05-28). They
// should become tunable via an admin UI once Kristen has shop-floor
// numbers — see TUNING note below.
//
// Formula:
//   run_time_min = (stitches_per_piece × pieces) / (stitches_per_minute × heads)
//   setup_time   = setup_min_per_design × designs
//   total_min    = run_time_min + setup_time
//
// Returns null when either input is missing — callers should render
// "—" rather than a fake number.

export const EMBROIDERY_STITCHES_PER_MIN_PER_HEAD = 800;
export const EMBROIDERY_HEADS = 12;
export const EMBROIDERY_SETUP_MIN_PER_DESIGN = 10;

export interface EmbroideryEstimateInput {
  stitchesPerPiece: number | null | undefined;
  pieces: number | null | undefined;
  designs?: number; // defaults to 1 — most jobs are single-design
}

export interface EmbroideryEstimate {
  totalMinutes: number;
  runMinutes: number;
  setupMinutes: number;
  // Pre-formatted human-readable string ("≈ 22 min", "≈ 1h 54m").
  display: string;
}

export function estimateEmbroidery(
  input: EmbroideryEstimateInput,
): EmbroideryEstimate | null {
  const { stitchesPerPiece, pieces } = input;
  if (
    !stitchesPerPiece ||
    !pieces ||
    stitchesPerPiece <= 0 ||
    pieces <= 0
  ) {
    return null;
  }
  const designs = input.designs ?? 1;
  const totalStitches = stitchesPerPiece * pieces;
  const runMinutes =
    totalStitches /
    (EMBROIDERY_STITCHES_PER_MIN_PER_HEAD * EMBROIDERY_HEADS);
  const setupMinutes = EMBROIDERY_SETUP_MIN_PER_DESIGN * designs;
  const totalMinutes = runMinutes + setupMinutes;
  return {
    totalMinutes,
    runMinutes,
    setupMinutes,
    display: formatMinutes(totalMinutes),
  };
}

// "≈ 22 min" / "≈ 1h 54m" / "≈ 3h"
export function formatMinutes(min: number): string {
  const rounded = Math.round(min);
  if (rounded < 60) return `≈ ${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const remainder = rounded - hours * 60;
  if (remainder === 0) return `≈ ${hours}h`;
  return `≈ ${hours}h ${remainder}m`;
}

// TUNING:
// Industry defaults assume a 12-head Tajima/Barudan-class commercial
// machine running 800 spm/head. Real-world variance: 600–1000 spm
// depending on thread weight + fabric, fewer heads if the design exceeds
// the small embroidery hoop. Once we have CG's actual numbers per
// machine, expose these as DB-backed config so the floor can edit them
// without a deploy.
