import type { InventoryLine } from "../types";

// S&S Activewear REST API (api.ssactivewear.com).
// Auth: HTTP Basic with account number (id) : API key (password).
//
// We use /v2/products/?partnumber=… (note trailing slash and lowercase v2):
//   - The products endpoint returns full SKU detail per color×size, with
//     per-warehouse quantities, which is exactly what the row UI needs.
//   - Without the trailing slash the route falls through to /products/{x}
//     (single-identifier lookup) and rejects the query param with a 404
//     "Identifier" error.
//   - `partnumber=` is the documented filter for user-facing style codes
//     like DG530. `style=` accepts numeric styleIDs only and silently
//     returns [] for partnumbers.

const DEFAULT_API_BASE = "https://api.ssactivewear.com/v2";

type SSWarehouse = {
  warehouseAbbr?: string;
  warehouseName?: string;
  qty?: number | string;
};

type SSProduct = {
  sku?: string;
  gtin?: string;
  styleID?: number | string;
  partNumber?: string;
  qty?: number | string;
  colorName?: string;
  sizeName?: string;
  size?: string;
  color?: string;
  warehouses?: SSWarehouse[];
};

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function fetchSSInventory(
  productId: string,
): Promise<InventoryLine[]> {
  const accountNumber = process.env.SS_WS_ID?.trim();
  const apiKey = process.env.SS_WS_PASSWORD?.trim();
  if (!accountNumber || !apiKey) {
    throw new Error("SS_WS_ID and SS_WS_PASSWORD must be set");
  }

  const base = (process.env.SS_API_BASE_URL?.trim() ?? DEFAULT_API_BASE).replace(
    /\/+$/,
    "",
  );
  const params = new URLSearchParams({
    partnumber: productId,
    mediatype: "json",
  });
  // Trailing slash on /products/ is required — without it, ASP.NET routes
  // the request to /products/{Identifier} and 404s.
  const url = `${base}/products/?${params.toString()}`;

  const auth = Buffer.from(`${accountNumber}:${apiKey}`).toString("base64");

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${auth}`,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404) {
      throw new Error(
        `S&S has no style "${productId}" — may be discontinued or the supplier on this Syncore line is incorrect.`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `S&S authentication failed (${res.status}). Verify SS_WS_ID is the account number and SS_WS_PASSWORD is the API key.`,
      );
    }
    throw new Error(
      `S&S /products/?partnumber=${productId} → ${res.status}: ${body || res.statusText}`,
    );
  }

  const data = (await res.json()) as unknown;
  if (Array.isArray(data) && data.length === 0) {
    throw new Error(
      `S&S returned no products for style "${productId}" — may be discontinued or the supplier on this Syncore line is incorrect.`,
    );
  }
  return mapSSProducts(data);
}

function mapSSProducts(raw: unknown): InventoryLine[] {
  const products: SSProduct[] = Array.isArray(raw) ? (raw as SSProduct[]) : [];
  const asOf = new Date().toISOString();

  return products.map((p): InventoryLine => {
    const warehouses = Array.isArray(p.warehouses)
      ? p.warehouses.map((w, i) => ({
          id: w.warehouseAbbr ?? String(i),
          name: w.warehouseName ?? w.warehouseAbbr,
          quantity: toNum(w.qty),
        }))
      : [];

    return {
      color: p.colorName ?? p.color ?? null,
      size: p.sizeName ?? p.size ?? null,
      quantityAvailable: toNum(p.qty),
      warehouses: warehouses.length ? warehouses : undefined,
      asOf,
    };
  });
}
