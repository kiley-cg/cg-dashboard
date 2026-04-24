import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getJobBundle, flattenLines } from "@/lib/syncore/orders";
import { lookupInventory } from "@/lib/vendors/registry";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const { job, salesOrders } = await getJobBundle(id);
    const withInventory = await Promise.all(
      salesOrders.map(async ({ salesOrder, lineItems }) => {
        const flat = flattenLines(lineItems);
        const lookups = await Promise.all(flat.map((l) => lookupInventory(l)));
        return {
          salesOrder,
          lines: flat.map((line, i) => ({ line, lookup: lookups[i] })),
        };
      }),
    );
    return NextResponse.json({ job, salesOrders: withInventory });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 502 },
    );
  }
}
