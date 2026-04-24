import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";
import { writeVerification } from "@/lib/syncore/orders";

const BodySchema = z.object({
  lineId: z.string().min(1),
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

  const { id: orderId } = await params;
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { lineId, qtyConfirmed, note, snapshot } = parsed.data;

  const snap = snapshot as { vendor?: string; productId?: string };

  try {
    await writeVerification({
      orderId,
      lineId,
      verifiedByEmail: session.user.email,
      qtyConfirmed,
      note,
    });

    await db.insert(schema.verifications).values({
      syncoreOrderId: orderId,
      syncoreLineId: lineId,
      vendor: snap?.vendor ?? "unknown",
      productId: snap?.productId ?? "",
      qtyConfirmed,
      vendorSnapshot: snapshot ?? null,
      verifiedByUserId: session.user.id,
      note,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 502 },
    );
  }
}
