import * as soap from "soap";

// SanMar's standard pricing service (NOT PromoStandards). Returns one row per
// color/size for a given style with piecePrice / casePrice / myPrice (the
// customer-specific contracted price) and others.
//
// Auth differs from inventory — uses customer number + username + password.
// Add SANMAR_CUSTOMER_NUMBER to the env to enable pricing; without it the
// inventory call still works and rows render with cost = "—".

const DEFAULT_WSDL =
  "https://ws.sanmar.com:8080/SanMarWebService/SanMarPricingServicePort?wsdl";

let clientPromise: Promise<soap.Client> | null = null;

async function getClient(): Promise<soap.Client> {
  if (!clientPromise) {
    const url = (
      process.env.SANMAR_PRICING_WSDL_URL?.trim() ?? DEFAULT_WSDL
    ).trim();
    clientPromise = soap.createClientAsync(url).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export type SanMarPriceRow = {
  color: string | null;
  size: string | null;
  myPrice: number | null;
  casePrice: number | null;
  piecePrice: number | null;
  salePrice: number | null;
};

type SanMarPriceItem = {
  casePrice?: number | string;
  caseSalePrice?: number | string;
  color?: string;
  dozenPrice?: number | string;
  inventoryKey?: number | string;
  myPrice?: number | string;
  piecePrice?: number | string;
  salePrice?: number | string;
  size?: string;
  sizeIndex?: number | string;
  style?: string;
};

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function fetchSanMarPricing(
  style: string,
): Promise<SanMarPriceRow[]> {
  const customerNumber = process.env.SANMAR_CUSTOMER_NUMBER?.trim();
  const userName = process.env.SANMAR_WS_ID?.trim();
  const password = process.env.SANMAR_WS_PASSWORD?.trim();
  if (!customerNumber || !userName || !password) {
    // Pricing is optional — return empty to skip the merge.
    return [];
  }

  const client = await getClient();
  const [response] = (await client.getPricingAsync({
    arg0: { style },
    arg1: {
      sanMarCustomerNumber: customerNumber,
      sanMarUserName: userName,
      sanMarUserPassword: password,
    },
  })) as [unknown];

  const wrapped = (response as { return?: { listResponse?: SanMarPriceItem | SanMarPriceItem[] } })
    ?.return?.listResponse;
  const items: SanMarPriceItem[] = Array.isArray(wrapped)
    ? wrapped
    : wrapped
      ? [wrapped]
      : [];

  return items.map((it) => ({
    color: it.color ?? null,
    size: it.size ?? null,
    myPrice: toNum(it.myPrice),
    casePrice: toNum(it.casePrice),
    piecePrice: toNum(it.piecePrice),
    salePrice: toNum(it.salePrice),
  }));
}
