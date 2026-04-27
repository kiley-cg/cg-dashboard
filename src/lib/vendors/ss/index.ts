import type { InventoryLine } from "../types";

// S&S Activewear REST API (api.ssactivewear.com) — preferred over their
// PromoStandards SOAP endpoint, which uses a WCF-generated WSDL with
// xsd:imports that node-soap cannot reliably parse.
//
// Auth: HTTP Basic with account number (id) : API key (password). Both come
// from the credentials S&S email when api@ssactivewear.com issues an API key.
//
// Inventory lookup: GET /V2/products/{style} returns a JSON array of every
// SKU under the given style (one entry per color × size) with per-warehouse
// quantities. We pass the SKU/style number from Syncore as `style`.

const DEFAULT_API_BASE = "https://api.ssactivewear.com/V2";

type SSProduct = {
  sku?: string;
  partNumber?: string;
  styleID?: number | string;
  qty?: number | string;
  colorName?: string;
  sizeName?: string;
  size?: string;
  color?: string;
  warehouses?: Array<{
    warehouseAbbr?: string;
    warehouseName?: string;
    qty?: number | string;
  }>;
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
  const url = `${base}/products/${encodeURIComponent(productId)}?mediatype=json`;

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
      `S&S GET /products/${productId} → ${res.status}: ${body || res.statusText}`,
    );
  }

  const data = (await res.json()) as unknown;
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
