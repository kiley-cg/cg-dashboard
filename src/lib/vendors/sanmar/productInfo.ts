import * as soap from "soap";

// SanMar's standard Product Info service. Two distinct uses:
//   1. `pieceWeight` per (color, size) for accurate freight calculations
//   2. The catalog color name mapping: SanMar's PromoStandards Inventory
//      service returns abbreviated/mainframe forms ("AnchorGyHt",
//      "Shad Grey Twst", "BlkHthr"), while Syncore sales orders use full
//      catalog names ("Anchor Grey Heather", "Shadow Grey Twist",
//      "Black Heather"). Product Info exposes both: `catalogColor` is
//      the abbreviated/mainframe form (matches Inventory's partColor)
//      and `color` is the full catalog name (matches Syncore). We use
//      this as a deterministic lookup so the matcher never has to guess.
//
// Auth pattern matches the other Standard SanMar services (customer
// number + username + password).

const DEFAULT_WSDL =
  "https://ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort?wsdl";

let clientPromise: Promise<soap.Client> | null = null;

async function getClient(): Promise<soap.Client> {
  if (!clientPromise) {
    const url = (
      process.env.SANMAR_PRODUCT_INFO_WSDL_URL?.trim() ?? DEFAULT_WSDL
    ).trim();
    clientPromise = soap.createClientAsync(url).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export type SanMarProductInfoRow = {
  // Abbreviated/mainframe color (catalogColor) — matches the partColor
  // returned by SanMar's PromoStandards Inventory service.
  abbreviatedColor: string | null;
  // Canonical full catalog color name (color) — matches what Syncore
  // sales orders use. Substituted onto the inventory line so the matcher
  // can do exact comparisons.
  fullColor: string | null;
  size: string | null;
  pieceWeightLbs: number | null;
};

type ProductBasicInfo = {
  catalogColor?: string;
  color?: string;
  size?: string;
  pieceWeight?: number | string;
};

type ListItem = {
  productBasicInfo?: ProductBasicInfo;
};

function toLbs(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function fetchSanMarProductInfo(
  style: string,
): Promise<SanMarProductInfoRow[]> {
  const customerNumber = process.env.SANMAR_CUSTOMER_NUMBER?.trim();
  const userName = process.env.SANMAR_WS_ID?.trim();
  const password = process.env.SANMAR_WS_PASSWORD?.trim();
  if (!customerNumber || !userName || !password) return [];

  const client = await getClient();
  const [response] = (await client.getProductInfoByStyleColorSizeAsync({
    arg0: { style },
    arg1: {
      sanMarCustomerNumber: customerNumber,
      sanMarUserName: userName,
      sanMarUserPassword: password,
    },
  })) as [unknown];

  const wrapped = (response as { return?: { listResponse?: ListItem | ListItem[] } })
    ?.return?.listResponse;
  const items: ListItem[] = Array.isArray(wrapped)
    ? wrapped
    : wrapped
      ? [wrapped]
      : [];

  return items.map((it): SanMarProductInfoRow => {
    const basic = it.productBasicInfo ?? {};
    return {
      abbreviatedColor: basic.catalogColor ?? null,
      fullColor: basic.color ?? null,
      size: basic.size ?? null,
      pieceWeightLbs: toLbs(basic.pieceWeight),
    };
  });
}
