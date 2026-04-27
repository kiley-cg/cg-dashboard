import * as soap from "soap";

// Shared PromoStandards Inventory 2.0.0 SOAP client.
// One WSDL URL → one cached soap client. Different vendors (SanMar, S&S, ...)
// register their own URL + credentials and share this implementation.

const clientCache = new Map<string, Promise<soap.Client>>();

async function getClient(wsdlUrl: string): Promise<soap.Client> {
  // Trim defensively — env-var values pasted from docs sometimes carry a
  // leading tab/space, and the soap library treats anything not starting
  // with http(s):// as a local file path (yields ENOENT).
  const url = wsdlUrl.trim();
  let pending = clientCache.get(url);
  if (!pending) {
    pending = soap.createClientAsync(url).catch((err) => {
      clientCache.delete(url);
      throw err;
    });
    clientCache.set(url, pending);
  }
  return pending;
}

export type GetInventoryLevelsArgs = {
  wsdlUrl: string;
  id: string;
  password: string;
  productId: string;
};

export async function getInventoryLevels(
  args: GetInventoryLevelsArgs,
): Promise<unknown> {
  let client: soap.Client;
  try {
    client = await getClient(args.wsdlUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load WSDL from ${args.wsdlUrl.trim()}: ${message}`,
      { cause: err },
    );
  }

  try {
    const [response] = (await client.getInventoryLevelsAsync({
      wsVersion: "2.0.0",
      id: args.id,
      password: args.password,
      productId: args.productId,
    })) as [unknown];
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `getInventoryLevels(productId=${args.productId}) failed: ${message}`,
      { cause: err },
    );
  }
}
