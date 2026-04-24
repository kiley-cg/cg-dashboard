// Syncore V2 REST client.
// Auth: x-api-key header (per docs.syncore.app).

export class SyncoreError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "SyncoreError";
  }
}

type SyncoreRequestInit = Omit<RequestInit, "body"> & {
  body?: unknown;
  searchParams?: Record<string, string | number | undefined>;
};

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new SyncoreError(`Missing env: ${name}`);
  return v;
}

export async function syncoreFetch<T = unknown>(
  path: string,
  init: SyncoreRequestInit = {},
): Promise<T> {
  const base = env("SYNCORE_BASE_URL").replace(/\/+$/, "");
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  if (init.searchParams) {
    for (const [k, v] of Object.entries(init.searchParams)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("x-api-key", env("SYNCORE_API_KEY"));
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    ...init,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => undefined);
    }
    throw new SyncoreError(
      `Syncore ${init.method ?? "GET"} ${path} failed: ${res.status}`,
      res.status,
      body,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
