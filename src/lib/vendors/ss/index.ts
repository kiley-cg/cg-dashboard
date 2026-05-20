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
  // Pricing fields included on /v2/products/?style= responses.
  yourPrice?: number | string;
  piecePrice?: number | string;
  casePrice?: number | string;
  salePrice?: number | string;
  customerPrice?: number | string;
  // Per-piece weight in pounds (S&S returns this directly per SKU).
  weight?: number | string;
  pieceWeight?: number | string;
  warehouses?: SSWarehouse[];
};

// Each style lookup keeps *all* candidate styleIDs that share the input
// key. Styles can collide on `styleName` alone (e.g. "220" is used by
// Richardson, SoftShirts, and Paragon), so we resolve to a list and let
// the caller disambiguate via product description / brandName.
type Candidate = { styleId: number; brand: string };
type StylesIndex = {
  byKey: Map<string, Candidate[]>;
  fetchedAt: number;
};

export class AmbiguousStyleError extends Error {
  candidates: Array<{ brand: string; styleId: number }>;
  constructor(
    productId: string,
    candidates: Array<{ brand: string; styleId: number }>,
  ) {
    const brands = candidates.map((c) => c.brand).filter(Boolean).join(", ");
    super(
      `S&S has ${candidates.length} products with style "${productId}"${brands ? ` (${brands})` : ""}. Fix the Syncore line to use a brand-prefixed style code (e.g. "Richardson ${productId}") so we know which one to pull.`,
    );
    this.name = "AmbiguousStyleError";
    this.candidates = candidates;
  }
}

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

function toPrice(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
  const byKey = new Map<string, Candidate[]>();
  const push = (key: string | undefined, c: Candidate) => {
    if (!key) return;
    const k = indexKey(key);
    const list = byKey.get(k);
    if (list) {
      // Don't double-count the same styleID under multiple indexed keys
      // for the same lookup string.
      if (!list.some((x) => x.styleId === c.styleId)) list.push(c);
    } else {
      byKey.set(k, [c]);
    }
  };
  for (const s of styles) {
    if (s.styleID == null) continue;
    const c: Candidate = { styleId: s.styleID, brand: s.brandName ?? "" };
    push(s.styleName, c);
    push(s.uniqueStyleName, c);
    push(s.partNumber, c);
  }
  return { byKey, fetchedAt: Date.now() };
}

async function getCandidateStyleIds(
  styleName: string,
  base: string,
  authHeader: string,
): Promise<Candidate[]> {
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
  return stylesCache?.byKey.get(indexKey(styleName)) ?? [];
}

// Pick a candidate styleID when the S&S styleName lookup returned more
// than one. Substring-matches each candidate's brand against the auto-
// filled Syncore product description (which comes straight from the
// vendor wizard, so it reliably contains the brand name). Returns null
// when no candidate matches — caller throws AmbiguousStyleError.
function disambiguateByDescription(
  candidates: Candidate[],
  description: string | null | undefined,
): Candidate | null {
  if (!description) return null;
  const haystack = description.toLowerCase();
  const matches = candidates.filter((c) => {
    const b = c.brand?.trim().toLowerCase();
    return b && haystack.includes(b);
  });
  if (matches.length === 1) return matches[0];
  return null;
}

export async function fetchSSInventory(
  productId: string,
  opts: {
    includeCosts?: boolean;
    includeWeights?: boolean;
    productDescription?: string | null;
  } = {},
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

  const candidates = await getCandidateStyleIds(productId, base, authHeader);
  if (candidates.length === 0) {
    throw new Error(
      `S&S has no style "${productId}" — not in your account's catalog (may be discontinued, misspelled, or the supplier on this Syncore line is incorrect).`,
    );
  }
  let styleID: number;
  if (candidates.length === 1) {
    styleID = candidates[0].styleId;
  } else {
    const picked = disambiguateByDescription(candidates, opts.productDescription);
    if (!picked) {
      throw new AmbiguousStyleError(productId, candidates);
    }
    styleID = picked.styleId;
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
  return mapSSProducts(data, opts);
}

function mapSSProducts(
  raw: unknown,
  opts: { includeCosts?: boolean; includeWeights?: boolean },
): InventoryLine[] {
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

    // S&S's aggregate `qty` field occasionally lags behind the per-
    // warehouse breakdown (seen during Special-Exp promo transitions:
    // qty=0 while warehouses[] still has real numbers). The per-
    // warehouse numbers are what their UI displays as ship-from
    // inventory, so use them as a fallback when the aggregate is 0.
    const aggregateQty = toNum(p.qty);
    const warehouseSum = warehouses.reduce((n, w) => n + w.quantity, 0);
    const quantityAvailable =
      aggregateQty > 0 ? aggregateQty : warehouseSum;

    // S&S bundles costs and weights into the inventory response, so
    // there's no API call to skip — but we still drop those fields
    // when the caller didn't ask for them, to keep the UI consistent
    // with availability-only mode and avoid implying confidence in
    // numbers the user wasn't intending to surface.
    return {
      color: p.colorName ?? p.color ?? null,
      size: p.sizeName ?? p.size ?? null,
      quantityAvailable,
      yourCost: opts.includeCosts
        ? toPrice(p.yourPrice) ??
          toPrice(p.customerPrice) ??
          toPrice(p.salePrice) ??
          toPrice(p.piecePrice)
        : null,
      msrp: opts.includeCosts ? toPrice(p.piecePrice) : null,
      casePrice: opts.includeCosts ? toPrice(p.casePrice) : null,
      salePrice: opts.includeCosts ? toPrice(p.salePrice) : null,
      pieceWeightLbs: opts.includeWeights
        ? toPrice(p.weight) ?? toPrice(p.pieceWeight)
        : null,
      warehouses: warehouses.length ? warehouses : undefined,
      asOf,
    };
  });
}
