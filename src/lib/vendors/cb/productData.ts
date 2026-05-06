import * as soap from "soap";

// C&B PromoStandards Product Data 1.0.0 — used to translate the
// abbreviated color codes returned by their Inventory service (e.g.
// "ALS", "NVBU", "BL") into the canonical color names that Syncore
// sales orders use ("Navy Blue", "Black"). Matches by partID, which
// the Inventory response also exposes.
//
// Endpoint: https://api.cbcorporate.com/promostandards/ProductData.asmx
// Auth and localization conventions match the Inventory service —
// without localizationCountry/Language the .NET service NREs.

const DEFAULT_WSDL =
  "https://api.cbcorporate.com/promostandards/ProductData.asmx?WSDL";

let clientPromise: Promise<soap.Client> | null = null;

async function getClient(): Promise<soap.Client> {
  if (!clientPromise) {
    const url = (
      process.env.CB_PRODUCT_DATA_WSDL_URL?.trim() ?? DEFAULT_WSDL
    ).trim();
    clientPromise = soap.createClientAsync(url).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export type CBProductDataPart = {
  partID: string;
  colorName: string | null;
};

type ColorEntry = { colorName?: string; hex?: string };
type ProductPart = {
  partId?: string | number;
  partID?: string | number;
  ColorArray?: { Color?: ColorEntry | ColorEntry[] };
};

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export async function fetchCutterBuckProductData(
  productId: string,
): Promise<CBProductDataPart[]> {
  const id = process.env.CB_WS_ID?.trim();
  const password = process.env.CB_WS_PASSWORD?.trim();
  if (!id || !password) return [];

  const client = await getClient();
  let response: unknown;
  try {
    [response] = (await client.getProductAsync({
      wsVersion: "1.0.0",
      id,
      password,
      localizationCountry: "US",
      localizationLanguage: "en",
      productID: productId,
      productId: productId,
    })) as [unknown];
  } catch (err) {
    // Soft failure: log and return empty so the inventory adapter still
    // returns lines (with raw color codes). Better to show "ALS" in a
    // diagnostic match log than to throw the whole row to vendor-error.
    // Redact creds before logging — same pattern as cb/index.ts.
    const lastRequest = (client as unknown as { lastRequest?: string })
      .lastRequest;
    const safeRequest = lastRequest
      ? lastRequest
          .replace(/(<password>)[^<]*(<\/password>)/g, "$1[REDACTED]$2")
          .replace(/(<id>)[^<]*(<\/id>)/g, "$1[REDACTED]$2")
      : "(unavailable)";
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cb] productData fetch failed", {
      productId,
      message,
      request: safeRequest,
    });
    return [];
  }

  return parseProductDataResponse(response);
}

function parseProductDataResponse(raw: unknown): CBProductDataPart[] {
  // C&B's Inventory response sat at the response root rather than
  // inside the spec'd <Inventory> wrapper; match that defensively here
  // too, while also supporting the spec-compliant nesting.
  const root = raw as {
    Product?: {
      ProductPartArray?: { ProductPart?: ProductPart | ProductPart[] };
    };
    ProductPartArray?: { ProductPart?: ProductPart | ProductPart[] };
  };
  const parts = [
    ...asArray(root.Product?.ProductPartArray?.ProductPart),
    ...asArray(root.ProductPartArray?.ProductPart),
  ];

  return parts
    .map((p): CBProductDataPart => {
      const partID = String(p.partId ?? p.partID ?? "");
      const colors = asArray(p.ColorArray?.Color);
      const colorName = colors[0]?.colorName?.trim() || null;
      return { partID, colorName };
    })
    .filter((p) => p.partID);
}
