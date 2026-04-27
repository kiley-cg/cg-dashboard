import * as soap from "soap";

// Shared PromoStandards Inventory 2.0.0 SOAP client.
// One WSDL URL → one cached soap client. Different vendors (SanMar, S&S, ...)
// register their own URL + credentials and share this implementation.

const clientCache = new Map<string, Promise<soap.Client>>();

async function getClient(wsdlUrl: string): Promise<soap.Client> {
  let pending = clientCache.get(wsdlUrl);
  if (!pending) {
    pending = soap.createClientAsync(wsdlUrl).catch((err) => {
      clientCache.delete(wsdlUrl);
      throw err;
    });
    clientCache.set(wsdlUrl, pending);
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
  const client = await getClient(args.wsdlUrl);
  const [response] = (await client.getInventoryLevelsAsync({
    wsVersion: "2.0.0",
    id: args.id,
    password: args.password,
    productId: args.productId,
  })) as [unknown];
  return response;
}
