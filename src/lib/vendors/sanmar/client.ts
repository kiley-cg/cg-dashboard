import * as soap from "soap";

let clientPromise: Promise<soap.Client> | null = null;

function wsdlUrl(): string {
  return (
    process.env.SANMAR_WSDL_URL ??
    "https://ws.sanmar.com:8080/promostandards/InventoryServiceBindingV2?WSDL"
  );
}

async function getClient(): Promise<soap.Client> {
  if (!clientPromise) {
    clientPromise = soap.createClientAsync(wsdlUrl()).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export type GetInventoryArgs = {
  productId: string;
};

export async function getInventoryLevels(
  args: GetInventoryArgs,
): Promise<unknown> {
  const id = process.env.SANMAR_WS_ID;
  const password = process.env.SANMAR_WS_PASSWORD;
  if (!id || !password) {
    throw new Error("SANMAR_WS_ID and SANMAR_WS_PASSWORD must be set");
  }

  const client = await getClient();

  // PromoStandards Inventory 2.0.0 replaced the 1.0.0 PartColorArray /
  // LabelSizeArray filter with a SelectionArray of typed Selection items.
  // Sending the whole style and filtering client-side via
  // mapSanMarInventory + matchingAvailable keeps us off that schema entirely.
  const payload = {
    wsVersion: "2.0.0",
    id,
    password,
    productId: args.productId,
  };

  const [response] = (await client.getInventoryLevelsAsync(payload)) as [
    unknown,
  ];
  return response;
}
