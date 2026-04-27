import { getUpsGroundRate, type RateEstimate } from "./rating";
import { warehouseZip } from "./warehouse-zips";

// Default per-piece weight when the vendor didn't return one. Most decorated
// apparel falls between 0.4 lb (lightweight tee) and 1.5 lb (hoodie). 0.5 lb
// biases low for a tee-heavy mix. SanMar (via getProductInfoByStyleColorSize)
// and S&S (via /v2/products) both expose real weights now, so this fallback
// only kicks in when a specific line lacks one.
const DEFAULT_PIECE_WEIGHT_LBS = 0.5;

export type FreightLineInput = {
  qtyOrdered: number;
  pieceWeightLbs: number | null;
};

export type FreightEstimateInput = {
  fromWarehouse: { id: string; name?: string } | null;
  toZip: string | null;
  lines: FreightLineInput[];
};

export type WeightBreakdown = {
  totalQty: number;
  totalWeightLbs: number;
  // Average piece weight across all lines, qty-weighted.
  avgPieceWeightLbs: number;
  // How many of the lines had a real per-piece weight from the vendor; the
  // rest fell back to the default. Surface this in the tooltip so the rep
  // knows how confident the total weight is.
  linesWithRealWeight: number;
  totalLines: number;
};

export type FreightEstimateResult =
  | {
      status: "ok";
      estimate: RateEstimate;
      weight: WeightBreakdown;
      fromZip: string;
      toZip: string;
    }
  | { status: "skipped"; reason: string }
  | { status: "error"; message: string };

const HOME_ZIP = "98512";

function computeWeight(lines: FreightLineInput[]): WeightBreakdown {
  let totalQty = 0;
  let totalWeight = 0;
  let realWeightLines = 0;
  for (const l of lines) {
    if (l.qtyOrdered <= 0) continue;
    totalQty += l.qtyOrdered;
    const perPiece = l.pieceWeightLbs ?? DEFAULT_PIECE_WEIGHT_LBS;
    if (l.pieceWeightLbs != null) realWeightLines += 1;
    totalWeight += l.qtyOrdered * perPiece;
  }
  const totalWeightLbs = Math.max(1, Math.ceil(totalWeight));
  const avgPieceWeightLbs = totalQty > 0 ? totalWeight / totalQty : 0;
  return {
    totalQty,
    totalWeightLbs,
    avgPieceWeightLbs,
    linesWithRealWeight: realWeightLines,
    totalLines: lines.filter((l) => l.qtyOrdered > 0).length,
  };
}

export async function estimateFreight(
  input: FreightEstimateInput,
): Promise<FreightEstimateResult> {
  if (!process.env.UPS_CLIENT_ID || !process.env.UPS_CLIENT_SECRET) {
    return { status: "skipped", reason: "UPS credentials not configured" };
  }
  if (!input.fromWarehouse) {
    return {
      status: "skipped",
      reason: "Multi-warehouse split — single quote not applicable",
    };
  }
  const fromZip = warehouseZip(input.fromWarehouse);
  if (!fromZip) {
    return {
      status: "skipped",
      reason: `Warehouse ${input.fromWarehouse.name ?? input.fromWarehouse.id} has no known zip`,
    };
  }
  const toZip = (input.toZip ?? HOME_ZIP).trim();
  if (!toZip) {
    return { status: "skipped", reason: "No destination zip" };
  }

  const weight = computeWeight(input.lines);
  if (weight.totalQty <= 0) {
    return { status: "skipped", reason: "No quantities to weigh" };
  }

  try {
    const estimate = await getUpsGroundRate({
      fromZip,
      toZip,
      totalWeightLbs: weight.totalWeightLbs,
    });
    console.log("[ups] freight estimate", {
      fromZip,
      toZip,
      totalQty: weight.totalQty,
      avgPieceWeightLbs: Number(weight.avgPieceWeightLbs.toFixed(3)),
      linesWithRealWeight: `${weight.linesWithRealWeight}/${weight.totalLines}`,
      totalWeightLbs: weight.totalWeightLbs,
      packages: estimate.packages,
      service: estimate.serviceName,
      totalCharge: estimate.totalCharge,
      currency: estimate.currency,
      transitDays: estimate.transitDays,
      isNegotiated: estimate.isNegotiated,
    });
    return { status: "ok", estimate, weight, fromZip, toZip };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ups] freight estimate failed", {
      fromZip,
      toZip,
      totalWeightLbs: weight.totalWeightLbs,
      message,
    });
    return { status: "error", message };
  }
}
