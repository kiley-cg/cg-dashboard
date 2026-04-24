import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOrder } from "@/lib/syncore/orders";
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
    const order = await getOrder(id);
    const lookups = await Promise.all(
      order.lines.map((l) => lookupInventory(l)),
    );
    return NextResponse.json({ order, lookups });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 502 },
    );
  }
}
