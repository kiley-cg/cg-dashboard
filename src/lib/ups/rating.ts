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

type UpsRateResponse = {
  RateResponse?: {
    RatedShipment?: {
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
  };
  response?: {
    errors?: Array<{ code?: string; message?: string }>;
  };
};

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
        // /Ratetimeintransit accepts a single Package or Package array.
        // Use array form so multi-package quotes go through cleanly.
        Package: Array.from({ length: packageCount }, () => onePackage),
        ShipmentTotalWeight: {
          UnitOfMeasurement: { Code: "LBS" },
          Weight: String(Math.max(1, Math.ceil(input.totalWeightLbs))),
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
  const rated = data.RateResponse?.RatedShipment;
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

  const transitStr =
    rated.TimeInTransit?.ServiceSummary?.EstimatedArrival?.BusinessDaysInTransit;
  const parsedTransit = transitStr != null ? Number(transitStr) : NaN;

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
