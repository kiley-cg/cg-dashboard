import { getUpsGroundRate, type RateEstimate } from "./rating";
import { warehouseZip } from "./warehouse-zips";

const DEFAULT_PIECE_WEIGHT_LBS = 0.5;

export type FreightLineInput = {
  qtyOrdered: number;
  pieceWeightLbs: number | null;
};

export type FreightShipmentInput = {
  fromWarehouse: { id: string; name?: string };
  // Optional explicit origin zip. When provided, bypasses the
  // warehouse-zip lookup — used for non-warehouse origins like contract
  // decorators that aren't in the vendor warehouse table.
  fromZip?: string;
  lines: FreightLineInput[];
};

export type FreightEstimateInput = {
  toZip: string | null;
  shipments: FreightShipmentInput[];
};

export type WeightBreakdown = {
  totalQty: number;
  totalWeightLbs: number;
  avgPieceWeightLbs: number;
  linesWithRealWeight: number;
  totalLines: number;
};

export type FreightShipmentResult = {
  warehouseName: string;
  warehouseId: string;
  fromZip: string;
  weight: WeightBreakdown;
  estimate: RateEstimate;
};

export type FreightEstimateResult =
  | {
      status: "ok";
      totalCharge: number;
      currency: string;
      maxTransitDays: number | null;
      shipments: FreightShipmentResult[];
      // Anything that couldn't be quoted (no zip, no qty, etc.). UI surfaces
      // the count so the rep knows the total may be incomplete.
      skipped: Array<{ warehouseName: string; reason: string }>;
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
  if (input.shipments.length === 0) {
    return { status: "skipped", reason: "No shipments to quote" };
  }
  const toZip = (input.toZip ?? HOME_ZIP).trim();
  if (!toZip) {
    return { status: "skipped", reason: "No destination zip" };
  }

  // Quote each warehouse-grouped shipment in parallel, accumulating partial
  // failures separately so a single warehouse error doesn't kill the total.
  const settled = await Promise.all(
    input.shipments.map(async (s) => {
      const fromZip = s.fromZip ?? warehouseZip(s.fromWarehouse);
      const warehouseName = s.fromWarehouse.name ?? s.fromWarehouse.id;
      if (!fromZip) {
        return {
          ok: false as const,
          warehouseName,
          reason: `No known zip for ${warehouseName}`,
        };
      }
      const weight = computeWeight(s.lines);
      if (weight.totalQty <= 0) {
        return {
          ok: false as const,
          warehouseName,
          reason: "No quantities to weigh",
        };
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
          warehouseName,
          totalQty: weight.totalQty,
          avgPieceWeightLbs: Number(weight.avgPieceWeightLbs.toFixed(3)),
          linesWithRealWeight: `${weight.linesWithRealWeight}/${weight.totalLines}`,
          totalWeightLbs: weight.totalWeightLbs,
          packages: estimate.packages,
          totalCharge: estimate.totalCharge,
          currency: estimate.currency,
          transitDays: estimate.transitDays,
          isNegotiated: estimate.isNegotiated,
        });
        return {
          ok: true as const,
          shipment: {
            warehouseName,
            warehouseId: s.fromWarehouse.id,
            fromZip,
            weight,
            estimate,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[ups] freight estimate failed", {
          fromZip,
          toZip,
          warehouseName,
          totalWeightLbs: weight.totalWeightLbs,
          message,
        });
        return { ok: false as const, warehouseName, reason: message };
      }
    }),
  );

  const shipments = settled
    .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
    .map((r) => r.shipment);
  const skipped = settled
    .filter((r): r is Extract<typeof r, { ok: false }> => !r.ok)
    .map((r) => ({ warehouseName: r.warehouseName, reason: r.reason }));

  if (shipments.length === 0) {
    return {
      status: "error",
      message:
        skipped[0]?.reason ?? "All shipment quotes failed",
    };
  }

  const totalCharge = shipments.reduce(
    (n, s) => n + s.estimate.totalCharge,
    0,
  );
  const currency = shipments[0].estimate.currency;
  const transits = shipments
    .map((s) => s.estimate.transitDays)
    .filter((d): d is number => d != null);
  const maxTransitDays = transits.length ? Math.max(...transits) : null;

  return {
    status: "ok",
    totalCharge,
    currency,
    maxTransitDays,
    shipments,
    skipped,
  };
}
