import { getUpsGroundRate, type RateEstimate } from "./rating";
import { warehouseZip } from "./warehouse-zips";

// Default per-piece weight when we don't yet have it from the vendor product
// data. Most decorated apparel falls between 0.4 lb (lightweight tee) and
// 1.5 lb (hoodie). 0.5 lb biases low for a tee-heavy mix; refine when we
// pull SanMar getProductInfoByStyleColorSize / S&S product weight per SKU.
const DEFAULT_PIECE_WEIGHT_LBS = 0.5;

export type FreightEstimateInput = {
  fromWarehouse: { id: string; name?: string } | null;
  toZip: string | null;
  totalQty: number;
  // Optional per-piece weight in lbs; defaults when null.
  avgPieceWeightLbs?: number | null;
};

export type FreightEstimateResult =
  | { status: "ok"; estimate: RateEstimate; totalWeightLbs: number; fromZip: string }
  | { status: "skipped"; reason: string }
  | { status: "error"; message: string };

const HOME_ZIP = "98512";

export async function estimateFreight(
  input: FreightEstimateInput,
): Promise<FreightEstimateResult> {
  if (!process.env.UPS_CLIENT_ID || !process.env.UPS_CLIENT_SECRET) {
    return { status: "skipped", reason: "UPS credentials not configured" };
  }
  if (!input.fromWarehouse) {
    return { status: "skipped", reason: "Multi-warehouse split — single quote not applicable" };
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

  const perPieceLbs = input.avgPieceWeightLbs ?? DEFAULT_PIECE_WEIGHT_LBS;
  const totalWeightLbs = Math.max(1, Math.ceil(input.totalQty * perPieceLbs));

  try {
    const estimate = await getUpsGroundRate({
      fromZip,
      toZip,
      totalWeightLbs,
    });
    return { status: "ok", estimate, totalWeightLbs, fromZip };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ups] freight estimate failed", {
      fromZip,
      toZip,
      totalWeightLbs,
      message,
    });
    return { status: "error", message };
  }
}
