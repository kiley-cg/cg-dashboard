export type VendorCode = "sanmar" | "ss" | "cb" | "unknown";

// Human-readable label for a vendor — used in tooltips, audit notes, etc.
export const vendorLabel: Record<VendorCode, string> = {
  sanmar: "SanMar",
  ss: "S&S Activewear",
  cb: "Cutter & Buck",
  unknown: "unknown vendor",
};

export type InventoryLine = {
  color: string | null;
  size: string | null;
  quantityAvailable: number;
  // Contracted / customer-specific price per piece. SanMar = "mySpecialPrice",
  // S&S = "yourPrice". Null when the vendor didn't return one.
  yourCost: number | null;
  // Suggested retail price (MSRP) — what an end customer would pay buying
  // single pieces. Both vendors expose this as `piecePrice`.
  msrp: number | null;
  // Per-piece price when buying a full case. Both vendors expose this.
  casePrice: number | null;
  // Promo / sale price when one is active. Surface a badge when below
  // yourCost. Null when not on sale.
  salePrice: number | null;
  // Per-piece weight in pounds. SanMar = `pieceWeight` from the standard
  // product info service; S&S = `weight` from /v2/products/. Used to
  // compute accurate freight totals; null falls back to a default.
  pieceWeightLbs: number | null;
  warehouses?: Array<{
    id: string;
    name?: string;
    quantity: number;
  }>;
  asOf: string; // ISO timestamp
};

export type InventoryLookupOk = {
  status: "ok";
  vendor: VendorCode;
  productId: string;
  lines: InventoryLine[];
};

export type InventoryLookupError = {
  status: "vendor-error" | "unsupported" | "no-style";
  vendor: VendorCode;
  productId: string | null;
  message: string;
};

// Style number resolved to more than one product in the vendor catalog
// (S&S allows this — e.g. style "220" → Richardson cap, SoftShirts tee,
// Paragon hoodie). Surfaces the brand candidates so the rep can fix the
// Syncore line by switching to a brand-prefixed style code.
export type InventoryLookupAmbiguous = {
  status: "ambiguous";
  vendor: VendorCode;
  productId: string;
  message: string;
  candidates: Array<{ brand: string; styleId: number }>;
};

export type InventoryLookup =
  | InventoryLookupOk
  | InventoryLookupError
  | InventoryLookupAmbiguous;
