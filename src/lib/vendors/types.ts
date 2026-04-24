export type VendorCode = "sanmar" | "unknown";

export type InventoryLine = {
  color: string | null;
  size: string | null;
  quantityAvailable: number;
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
