import { getUpsToken, upsHost } from "./auth";
import { zipToState } from "./zip-to-state";

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
  // Pre-calibration list rate from UPS, kept for tooltip transparency
  // when a calibration factor is applied.
  rawTotalCharge: number;
  calibrationFactor: number;
  currency: string;
  transitDays: number | null;
  isNegotiated: boolean;
};

// Calibration factor against real invoices. Job 32268 hit at exactly
// 0.661 ($167.58 actual vs $253.35 raw quote), but we keep the
// default biased high (0.75) to err on the side of overestimating —
// underquoting freight to a customer is worse than overquoting.
// Override via UPS_RATE_CALIBRATION env var. Reset to "1" once UPS
// starts returning negotiated rates, since the multiplier becomes
// double-counting at that point.
const DEFAULT_CALIBRATION = 0.75;

function calibrationFactor(): number {
  const raw = process.env.UPS_RATE_CALIBRATION?.trim();
  if (!raw) return DEFAULT_CALIBRATION;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CALIBRATION;
}

const DEFAULT_DIMENSIONS_IN = { length: 24, width: 16, height: 16 };
// UPS auto-applies an "Additional Handling" surcharge (~$26/package
// at list rate) on any package with actual weight > 50 lbs. Splitting
// at 50 lb cap avoids the trigger entirely, which matches how the
// decorators actually pack. Cap is intentionally per-package weight,
// not the legal max (UPS allows up to 150 lb/package).
const MAX_PACKAGE_LBS = 50;

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

  // UPS Rating requires StateProvinceCode on ship-from once the request
  // is properly registered for negotiated-rate evaluation — without it
  // we get error 9110016. Derive from ZIP3; if either side fails to
  // resolve, fail fast rather than send a malformed request.
  const fromState = zipToState(input.fromZip);
  const toState = zipToState(input.toZip);
  if (!fromState) {
    throw new Error(
      `UPS rating: could not derive state from fromZip="${input.fromZip}"`,
    );
  }
  if (!toState) {
    throw new Error(
      `UPS rating: could not derive state from toZip="${input.toZip}"`,
    );
  }

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
          Address: {
            PostalCode: input.fromZip,
            StateProvinceCode: fromState,
            CountryCode: "US",
          },
        },
        ShipFrom: {
          Address: {
            PostalCode: input.fromZip,
            StateProvinceCode: fromState,
            CountryCode: "US",
          },
        },
        ShipTo: {
          Address: {
            PostalCode: input.toZip,
            StateProvinceCode: toState,
            CountryCode: "US",
          },
        },
        Service: { Code: "03", Description: "Ground" },
        // UPS tier 3 (Tristan, May 2026) confirmed: NegotiatedRatesIndicator
        // lives inside ShipmentRatingOptions, NOT RateInformation. The
        // earlier shape (RateInformation.NegotiatedRatesIndicator) was
        // accepted without error but silently ignored, so the API returned
        // list rates with Alert 110971 instead of the contracted rate. The
        // value is documented as a string with presence-as-flag semantics
        // (≤1, empty string is the canonical form). Only meaningful when
        // a ShipperNumber is supplied.
        ...(accountNumber
          ? { ShipmentRatingOptions: { NegotiatedRatesIndicator: "" } }
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

  // Capture the full response text and headers up front so the
  // negotiated-rates diagnostic below has everything UPS support needs.
  // Read .text() then JSON.parse so we can paste the raw body verbatim.
  const responseText = await res.text();
  const responseHeaders = Object.fromEntries(res.headers.entries());

  if (!res.ok) {
    // Log the outgoing request body so we can see exactly what UPS
    // received when it rejected. Without this, a 4xx with a vague
    // "missing X" error gives us no way to confirm whether our payload
    // actually included X — particularly useful when chasing
    // StateProvinceCode / ZIP3-derivation bugs.
    console.error("[ups] rating request rejected", {
      status: res.status,
      transId,
      fromZip: input.fromZip,
      toZip: input.toZip,
      requestBody: JSON.stringify(body),
      responseBody: responseText.slice(0, 50_000),
    });
    throw new Error(
      `UPS Ratetimeintransit ${res.status}: ${responseText || res.statusText}`,
    );
  }

  const data = JSON.parse(responseText) as UpsRateResponse;
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
  const rawTotalCharge = Number(charges?.MonetaryValue ?? "0");
  const currency = charges?.CurrencyCode ?? "USD";
  // Apply the calibration factor only when we're falling back to list
  // rates. If UPS returned negotiated rates, the number is already
  // CG-specific and we shouldn't multiply it.
  const factor = negotiated ? 1 : calibrationFactor();
  const totalCharge =
    Math.round((rawTotalCharge * factor + Number.EPSILON) * 100) / 100;

  // When we asked for negotiated rates (account number present + indicator
  // sent) but UPS didn't return them, log the full request/response pair.
  // UPS API support specifically asks for "header and body of the API
  // request/response" to investigate account-tier issues — copy the
  // fields below into a text/zip file and send to them. The Authorization
  // header is redacted so you don't leak the OAuth bearer token.
  if (accountNumber && !negotiated) {
    console.warn("[ups] negotiated rates not returned despite account number", {
      accountNumber: `***${accountNumber.slice(-4)}`,
      transId,
      fromZip: input.fromZip,
      toZip: input.toZip,
      requestSentNegotiatedIndicator: true,
      responseHadNegotiatedRateCharges: !!rated.NegotiatedRateCharges,
      responseTotalCharge: list?.MonetaryValue,
      // Full exchange for UPS support — paste these verbatim.
      requestUrl: `https://${host}/api/rating/v2409/Ratetimeintransit`,
      requestHeaders: {
        Authorization: "Bearer [REDACTED]",
        "Content-Type": "application/json",
        transId,
        transactionSrc: "cg-inventory-check",
      },
      requestBody: JSON.stringify(body),
      responseStatus: res.status,
      responseHeaders,
      responseBody: responseText.slice(0, 50_000),
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
    rawTotalCharge,
    calibrationFactor: factor,
    currency,
    transitDays: Number.isFinite(parsedTransit) ? parsedTransit : null,
    isNegotiated: !!negotiated,
  };
}
