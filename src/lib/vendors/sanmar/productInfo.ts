import * as soap from "soap";

// SanMar's standard Product Info service. We use it specifically to pull
// `pieceWeight` (lbs per piece) per (color, size) for accurate freight
// calculations. Auth pattern matches the other Standard SanMar services
// (customer number + username + password).

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

export type SanMarPieceWeightRow = {
  color: string | null;
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

export async function fetchSanMarPieceWeights(
  style: string,
): Promise<SanMarPieceWeightRow[]> {
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

  // Probe: log the catalogColor↔color pairs SanMar returns. The Inventory
  // (PromoStandards) call returns abbreviated color tokens like
  // "Shad Grey Twst" while Syncore sales orders use the full catalog name
  // "Shadow Grey Twist". Product Info exposes both forms but the docs are
  // ambiguous about which field is which — this log resolves it
  // empirically. Remove once we wire the mapping into matchVariant.
  const colorPairs = Array.from(
    new Map(
      items.map((it) => {
        const b = it.productBasicInfo ?? {};
        return [`${b.catalogColor ?? ""}|${b.color ?? ""}`, b];
      }),
    ).values(),
  ).map((b) => ({ catalogColor: b.catalogColor, color: b.color }));
  console.log("[sanmar productInfo] color name pairs", { style, colorPairs });

  return items.map((it) => {
    const basic = it.productBasicInfo ?? {};
    return {
      color: basic.catalogColor ?? basic.color ?? null,
      size: basic.size ?? null,
      pieceWeightLbs: toLbs(basic.pieceWeight),
    };
  });
}
