// UPS Tracking API client. Companion to ./auth.ts (OAuth) and ./freight.ts
// (rating + TNT). Used by the Phase 5b cron to fetch ETA + delivery status
// for every tracking # we have in po_tracking with carrier='UPS'.
//
// Docs: https://developer.ups.com/api/reference?loc=en_US#operation/getSingleTrackResponseUsingGET
// Endpoint: GET /api/track/v1/details/{inquiryNumber}
// Throttling: UPS gives plenty of headroom on prod accounts; we still
// stagger calls via the cron's concurrency cap.

import { getUpsToken, upsHost } from "./auth";

export interface UpsTrackingResult {
  trackingNumber: string;
  // High-level UPS status (e.g. "I" = In Transit, "D" = Delivered).
  // We surface both the code and the human description so the UI can
  // show whichever is friendlier.
  statusCode: string | null;
  statusDescription: string | null;
  // YYYY-MM-DD if UPS returned a scheduled / actual delivery date,
  // else null. Delivered shipments will have actualDeliveryDate set
  // and the status flips to "Delivered".
  scheduledDeliveryDate: string | null;
  actualDeliveryDate: string | null;
  // Raw decoded API body for debugging — small relative to the value.
  raw: unknown;
}

export class UpsTrackingError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "UpsTrackingError";
  }
}

export async function fetchUpsTracking(
  trackingNumber: string,
): Promise<UpsTrackingResult> {
  const token = await getUpsToken();
  const url =
    `https://${upsHost()}/api/track/v1/details/${encodeURIComponent(trackingNumber)}` +
    `?locale=en_US&returnSignature=false`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      // UPS requires a request id + version (any short unique string).
      transId: `cgd-${Date.now()}`,
      transactionSrc: "cg-dashboard",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new UpsTrackingError(
      `UPS Track API ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
      res.status,
      body,
    );
  }

  return parseUpsResponse(trackingNumber, body);
}

function parseUpsResponse(
  trackingNumber: string,
  body: unknown,
): UpsTrackingResult {
  // Response shape: trackResponse.shipment[0].package[0].{ ... }.
  // shipment + package are arrays; UPS sometimes returns the singular
  // object when there's only one — guard for both.
  const top = body as Record<string, unknown> | null;
  const trackResponse = top?.trackResponse as Record<string, unknown> | undefined;
  const shipmentRaw = trackResponse?.shipment;
  const shipments = Array.isArray(shipmentRaw)
    ? shipmentRaw
    : shipmentRaw
      ? [shipmentRaw]
      : [];
  const shipment = shipments[0] as Record<string, unknown> | undefined;
  const packageRaw = shipment?.package;
  const packages = Array.isArray(packageRaw)
    ? packageRaw
    : packageRaw
      ? [packageRaw]
      : [];
  const pkg = packages[0] as Record<string, unknown> | undefined;

  // currentStatus is { code, description, simplifiedTextDescription }
  const currentStatus = pkg?.currentStatus as
    | Record<string, unknown>
    | undefined;
  const statusCode = strOrNull(currentStatus?.code);
  const statusDescription =
    strOrNull(currentStatus?.description) ??
    strOrNull(currentStatus?.simplifiedTextDescription);

  // deliveryDate is an array of {type, date} pairs. type values:
  //   "SDD" = Scheduled Delivery Date  (YYYYMMDD)
  //   "DEL" = Delivered                (YYYYMMDD)
  //   "RDD" = Rescheduled Delivery Date
  const deliveryDateRaw = pkg?.deliveryDate as unknown[] | undefined;
  const deliveryDates = Array.isArray(deliveryDateRaw) ? deliveryDateRaw : [];
  let scheduledDeliveryDate: string | null = null;
  let actualDeliveryDate: string | null = null;
  for (const dd of deliveryDates) {
    if (!dd || typeof dd !== "object") continue;
    const obj = dd as Record<string, unknown>;
    const type = strOrNull(obj.type);
    const date = strOrNull(obj.date);
    const iso = date ? formatYyyymmdd(date) : null;
    if (!iso) continue;
    if (type === "DEL") actualDeliveryDate = iso;
    else if (type === "SDD" || type === "RDD") scheduledDeliveryDate = iso;
  }

  return {
    trackingNumber,
    statusCode,
    statusDescription,
    scheduledDeliveryDate,
    actualDeliveryDate,
    raw: body,
  };
}

function strOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

// "20260417" → "2026-04-17". Any unexpected shape returns null.
function formatYyyymmdd(s: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
