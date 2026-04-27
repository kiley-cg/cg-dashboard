// UPS OAuth 2.0 client-credentials helper. Tokens last about 4 hours; we
// cache them in-process and refresh ~1 minute before expiry. Coalesces
// concurrent first-load requests so we don't make a thundering herd of
// token requests during a cold start.

let tokenCache: { token: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

export function upsHost(): string {
  return process.env.UPS_ENV?.trim() === "test"
    ? "wwwcie.ups.com"
    : "onlinetools.ups.com";
}

async function fetchToken(): Promise<string> {
  const id = process.env.UPS_CLIENT_ID?.trim();
  const secret = process.env.UPS_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    throw new Error("UPS_CLIENT_ID and UPS_CLIENT_SECRET must be set");
  }
  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(`https://${upsHost()}/security/v1/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `UPS OAuth failed (${res.status}): ${body || res.statusText}`,
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: string | number;
  };
  if (!data.access_token) throw new Error("UPS OAuth: no access_token in response");
  const expiresInSec =
    typeof data.expires_in === "string"
      ? Number(data.expires_in)
      : data.expires_in ?? 14400;
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + expiresInSec * 1000 - 60_000, // refresh 1m early
  };
  return data.access_token;
}

export async function getUpsToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  if (!pending) {
    pending = fetchToken().finally(() => {
      pending = null;
    });
  }
  return pending;
}
