import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";

const BodySchema = z.object({
  salesOrderId: z.number(),
  sizeLineId: z.number(),
  colorLineId: z.number().optional(),
  productId: z.string(),
  qtyConfirmed: z.number().int().nonnegative(),
  note: z.string().optional(),
  snapshot: z.unknown(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: jobId } = await params;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { salesOrderId, sizeLineId, productId, qtyConfirmed, note, snapshot } =
    parsed.data;
  const snap = snapshot as { vendor?: string };

  // v1: DB-only audit trail. Once the Syncore Sales Order Status PATCH allowed
  // values are confirmed, we'll also promote the SO status here.
  try {
    await db.insert(schema.verifications).values({
      syncoreOrderId: `${jobId}:${salesOrderId}`,
      syncoreLineId: String(sizeLineId),
      vendor: snap?.vendor ?? "unknown",
      productId,
      qtyConfirmed,
      vendorSnapshot: snapshot ?? null,
      verifiedByUserId: session.user.id,
      note,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
