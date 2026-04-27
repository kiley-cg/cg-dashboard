import type { InventoryLine } from "../types";

// S&S Activewear REST API (api.ssactivewear.com).
//
// Auth: HTTP Basic with account number (id) : API key (password).
//
// Lookup quirk: Syncore stores S&S items by `styleName` ("DG530",
// "JST50", etc.) but S&S's products endpoint won't filter by that
// field directly. The `?style=` filter only accepts numeric StyleID,
// internal PartNumber (e.g. "674B2"), or "BrandName Name" combined.
// So we maintain an in-process index built from /v2/styles and
// translate styleName → styleID before each products lookup.

const DEFAULT_API_BASE = "https://api.ssactivewear.com/v2";
const STYLES_TTL_MS = 60 * 60 * 1000; // 1 hour

type SSStyle = {
  styleID?: number;
  styleName?: string;
  uniqueStyleName?: string;
  partNumber?: string;
  brandName?: string;
};

type SSWarehouse = {
  warehouseAbbr?: string;
  warehouseName?: string;
  qty?: number | string;
};

type SSProduct = {
  sku?: string;
  styleID?: number | string;
  qty?: number | string;
  colorName?: string;
  sizeName?: string;
  size?: string;
  color?: string;
  warehouses?: SSWarehouse[];
};

type StylesIndex = {
  byKey: Map<string, number>;
  fetchedAt: number;
};

let stylesCache: StylesIndex | null = null;
let stylesPending: Promise<StylesIndex> | null = null;

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function basicAuthHeader(accountNumber: string, apiKey: string): string {
  return `Basic ${Buffer.from(`${accountNumber}:${apiKey}`).toString("base64")}`;
}

function indexKey(value: string): string {
  return value.trim().toUpperCase();
}

async function loadStylesIndex(
  base: string,
  authHeader: string,
): Promise<StylesIndex> {
  const res = await fetch(`${base}/styles?mediatype=json`, {
    headers: { Accept: "application/json", Authorization: authHeader },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `S&S /styles index fetch failed (${res.status}). Cannot resolve style names to IDs.`,
    );
  }
  const styles = (await res.json()) as SSStyle[];
  const byKey = new Map<string, number>();
  for (const s of styles) {
    if (s.styleID == null) continue;
    if (s.styleName) byKey.set(indexKey(s.styleName), s.styleID);
    if (s.uniqueStyleName) byKey.set(indexKey(s.uniqueStyleName), s.styleID);
    if (s.partNumber) byKey.set(indexKey(s.partNumber), s.styleID);
  }
  return { byKey, fetchedAt: Date.now() };
}

async function getStyleId(
  styleName: string,
  base: string,
  authHeader: string,
): Promise<number | null> {
  const now = Date.now();
  if (!stylesCache || now - stylesCache.fetchedAt > STYLES_TTL_MS) {
    // Coalesce concurrent first-load requests so we don't hammer the index.
    if (!stylesPending) {
      stylesPending = loadStylesIndex(base, authHeader)
        .then((idx) => {
          stylesCache = idx;
          return idx;
        })
        .finally(() => {
          stylesPending = null;
        });
    }
    await stylesPending;
  }
  return stylesCache?.byKey.get(indexKey(styleName)) ?? null;
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
  const authHeader = basicAuthHeader(accountNumber, apiKey);

  const styleID = await getStyleId(productId, base, authHeader);
  if (styleID == null) {
    throw new Error(
      `S&S has no style "${productId}" — not in your account's catalog (may be discontinued, misspelled, or the supplier on this Syncore line is incorrect).`,
    );
  }

  const params = new URLSearchParams({
    style: String(styleID),
    mediatype: "json",
  });
  const url = `${base}/products/?${params.toString()}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", Authorization: authHeader },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `S&S authentication failed (${res.status}). Verify SS_WS_ID is the account number and SS_WS_PASSWORD is the API key.`,
      );
    }
    throw new Error(
      `S&S /products/?style=${styleID} (resolved from "${productId}") → ${res.status}: ${body || res.statusText}`,
    );
  }

  const data = (await res.json()) as unknown;
  if (Array.isArray(data) && data.length === 0) {
    throw new Error(
      `S&S returned no products for style "${productId}" (styleID ${styleID}).`,
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
