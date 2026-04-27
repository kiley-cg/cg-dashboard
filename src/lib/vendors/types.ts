export type VendorCode = "sanmar" | "ss" | "unknown";

// Human-readable label for a vendor — used in tooltips, audit notes, etc.
export const vendorLabel: Record<VendorCode, string> = {
  sanmar: "SanMar",
  ss: "S&S Activewear",
  unknown: "unknown vendor",
};

export type InventoryLine = {
  color: string | null;
  size: string | null;
  quantityAvailable: number;
  // Contracted / customer-specific price per piece. SanMar = "mySpecialPrice",
  // S&S = "yourPrice". Null when the vendor didn't return one.
  yourCost: number | null;
  // Per-piece price when buying a full case. Both vendors expose this.
  casePrice: number | null;
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

export type InventoryLookup = InventoryLookupOk | InventoryLookupError;
