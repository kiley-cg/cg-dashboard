import { getUpsToken, upsHost } from "./auth";

// UPS Rating + Time-In-Transit (combined endpoint).
// Spec: POST /api/rating/v2409/Ratetimeintransit
// Returns charges + transit days in one call.

export type RateInput = {
  fromZip: string;
  toZip: string;
  totalWeightLbs: number;
  packageDimensionsInches?: { length: number; width: number; height: number };
};

export type RateEstimate = {
  carrier: "UPS";
  serviceCode: string;
  serviceName: string;
  packages: number;
  totalCharge: number;
  currency: string;
  transitDays: number | null;
  isNegotiated: boolean;
};

const DEFAULT_DIMENSIONS_IN = { length: 24, width: 16, height: 16 };
const MAX_PACKAGE_LBS = 70; // split across packages above this for cleaner rate quotes

function splitIntoPackages(totalLbs: number): number {
  if (totalLbs <= 0) return 1;
  return Math.max(1, Math.ceil(totalLbs / MAX_PACKAGE_LBS));
}

type UpsRatedShipment = {
  Service?: { Code?: string; Description?: string };
  TotalCharges?: { MonetaryValue?: string; CurrencyCode?: string };
  NegotiatedRateCharges?: {
    TotalCharge?: { MonetaryValue?: string; CurrencyCode?: string };
  };
  TimeInTransit?: {
    ServiceSummary?: {
      EstimatedArrival?: { BusinessDaysInTransit?: string };
    };
  };
};

type UpsRateResponse = {
  RateResponse?: {
    // RatedShipment is an object for Rate (single service) and an array for
    // Shop. Ratetimeintransit can return either depending on whether the
    // server filtered to one service — handle both shapes.
    RatedShipment?: UpsRatedShipment | UpsRatedShipment[];
  };
  response?: {
    errors?: Array<{ code?: string; message?: string }>;
  };
};

function pickGroundShipment(
  rated: UpsRatedShipment | UpsRatedShipment[] | undefined,
): UpsRatedShipment | null {
  if (!rated) return null;
  if (!Array.isArray(rated)) return rated;
  // Prefer the Ground service when present; fall back to the first entry.
  return rated.find((s) => s.Service?.Code === "03") ?? rated[0] ?? null;
}

export async function getUpsGroundRate(input: RateInput): Promise<RateEstimate> {
  const token = await getUpsToken();
  const accountNumber = process.env.UPS_ACCOUNT_NUMBER?.trim();
  const host = upsHost();
  const transId = `cg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const dims = input.packageDimensionsInches ?? DEFAULT_DIMENSIONS_IN;
  const packageCount = splitIntoPackages(input.totalWeightLbs);
  const perPackageLbs = Math.max(
    1,
    Math.ceil(input.totalWeightLbs / packageCount),
  );

  const onePackage = {
    PackagingType: { Code: "02", Description: "Customer Supplied Package" },
    Dimensions: {
      UnitOfMeasurement: { Code: "IN" },
      Length: String(dims.length),
      Width: String(dims.width),
      Height: String(dims.height),
    },
    PackageWeight: {
      UnitOfMeasurement: { Code: "LBS" },
      Weight: String(perPackageLbs),
    },
  };

  // UPS Ratetimeintransit requires DeliveryTimeInformation to be set —
  // without it the API returns 111563. PackageBillType "03" = Non-Document
  // (apparel goods); pickup date is today, pickup time 14:00 local
  // (representative of a same-day cutoff).
  const today = new Date();
  const pickupDate =
    String(today.getFullYear()) +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");

  const body = {
    RateRequest: {
      Request: {
        TransactionReference: { CustomerContext: "cg-inventory-check" },
      },
      Shipment: {
        Shipper: {
          ShipperNumber: accountNumber ?? undefined,
          Address: { PostalCode: input.fromZip, CountryCode: "US" },
        },
        ShipFrom: {
          Address: { PostalCode: input.fromZip, CountryCode: "US" },
        },
        ShipTo: {
          Address: { PostalCode: input.toZip, CountryCode: "US" },
        },
        Service: { Code: "03", Description: "Ground" },
        // Without this, UPS silently returns list rates even when
        // ShipperNumber matches a contracted account. NegotiatedRatesIndicator
        // is an empty element (presence is the flag); only meaningful when
        // a ShipperNumber is supplied.
        ...(accountNumber
          ? { RateInformation: { NegotiatedRatesIndicator: {} } }
          : {}),
        // /Ratetimeintransit accepts a single Package or Package array.
        // Use array form so multi-package quotes go through cleanly.
        Package: Array.from({ length: packageCount }, () => onePackage),
        ShipmentTotalWeight: {
          UnitOfMeasurement: { Code: "LBS" },
          Weight: String(Math.max(1, Math.ceil(input.totalWeightLbs))),
        },
        DeliveryTimeInformation: {
          PackageBillType: "03",
          Pickup: {
            Date: pickupDate,
            Time: "1400",
          },
        },
      },
    },
  };

  const res = await fetch(
    `https://${host}/api/rating/v2409/Ratetimeintransit`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        transId,
        transactionSrc: "cg-inventory-check",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `UPS Ratetimeintransit ${res.status}: ${txt || res.statusText}`,
    );
  }

  const data = (await res.json()) as UpsRateResponse;
  const rated = pickGroundShipment(data.RateResponse?.RatedShipment);
  if (!rated) {
    const err = data.response?.errors?.[0];
    throw new Error(
      err
        ? `UPS rate error ${err.code ?? "?"}: ${err.message ?? "unknown"}`
        : "UPS rate: no RatedShipment in response",
    );
  }

  const negotiated = rated.NegotiatedRateCharges?.TotalCharge;
  const list = rated.TotalCharges;
  const charges = negotiated ?? list;
  const totalCharge = Number(charges?.MonetaryValue ?? "0");
  const currency = charges?.CurrencyCode ?? "USD";

  // When we asked for negotiated rates (account number present + indicator
  // sent) but UPS didn't return them, dump enough of the response to
  // diagnose: most often this means the dev-portal app doesn't have
  // negotiated rates enabled, or the account isn't on file with a
  // contract. Surfaced so we don't have to guess from a "list rate" badge.
  if (accountNumber && !negotiated) {
    console.warn("[ups] negotiated rates not returned despite account number", {
      accountNumber: `***${accountNumber.slice(-4)}`,
      fromZip: input.fromZip,
      toZip: input.toZip,
      requestSentNegotiatedIndicator: true,
      responseHadNegotiatedRateCharges: !!rated.NegotiatedRateCharges,
      responseTotalCharge: list?.MonetaryValue,
      // First ~2KB of the rated-shipment JSON so we can see what UPS
      // actually included (top-level keys are the diagnostic part).
      ratedShipmentSnippet: JSON.stringify(rated).slice(0, 2000),
    });
  }

  const transitStr =
    rated.TimeInTransit?.ServiceSummary?.EstimatedArrival?.BusinessDaysInTransit;
  const parsedTransit = transitStr != null ? Number(transitStr) : NaN;

  // If we parsed nothing useful, log the response so we can diagnose what
  // shape UPS actually returned (paths vary by request option / account).
  if (totalCharge === 0 && !Number.isFinite(parsedTransit)) {
    console.error("[ups] rating returned but parsed empty", {
      fromZip: input.fromZip,
      toZip: input.toZip,
      response: JSON.stringify(data).slice(0, 4000),
    });
  }

  return {
    carrier: "UPS",
    serviceCode: rated.Service?.Code ?? "03",
    serviceName: rated.Service?.Description ?? "Ground",
    packages: packageCount,
    totalCharge,
    currency,
    transitDays: Number.isFinite(parsedTransit) ? parsedTransit : null,
    isNegotiated: !!negotiated,
  };
}
