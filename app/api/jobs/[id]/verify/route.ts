import { NextResponse } from "next/server";
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db/client";

const BodySchema = z.object({
  salesOrderId: z.number(),
  sizeLineId: z.number(),
  colorLineId: z.number().optional(),
  productId: z.string(),
  qtyOrdered: z.number().int().nonnegative().optional(),
  qtyAvailable: z.number().int().nonnegative().optional(),
  qtyConfirmed: z.number().int().nonnegative(),
  note: z.string().optional(),
  snapshot: z.unknown(),
});

const DeleteBodySchema = z.object({
  // Either one row (salesOrderId + sizeLineId) or all rows for the job (omit both).
  salesOrderId: z.number().optional(),
  sizeLineId: z.number().optional(),
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
  const {
    salesOrderId,
    sizeLineId,
    productId,
    qtyOrdered,
    qtyAvailable,
    qtyConfirmed,
    note,
    snapshot,
  } = parsed.data;
  const snap = snapshot as { vendor?: string };

  // v1: DB-only audit trail. Once the Syncore Sales Order Status PATCH allowed
  // values are confirmed, we'll also promote the SO status here.
  try {
    await db.insert(schema.verifications).values({
      syncoreOrderId: `${jobId}:${salesOrderId}`,
      syncoreLineId: String(sizeLineId),
      vendor: snap?.vendor ?? "unknown",
      productId,
      qtyOrdered,
      qtyAvailable,
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

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: jobId } = await params;
  const parsed = DeleteBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { salesOrderId, sizeLineId } = parsed.data;

  try {
    if (salesOrderId != null && sizeLineId != null) {
      // Single row — used by the row-level "Re-verify" flow.
      const result = await db
        .delete(schema.verifications)
        .where(
          and(
            eq(
              schema.verifications.syncoreOrderId,
              `${jobId}:${salesOrderId}`,
            ),
            eq(schema.verifications.syncoreLineId, String(sizeLineId)),
          ),
        )
        .returning({ id: schema.verifications.id });
      return NextResponse.json({ ok: true, deleted: result.length });
    }

    // No specifics → wipe every verification for this job.
    // Used by the "Clear all" button. Also record a job_verification_clears
    // marker so autoVerifyClean stops re-creating verifications on the
    // next render — clearing without that marker was a no-op because
    // auto-verify ran milliseconds later and put them all back.
    const result = await db
      .delete(schema.verifications)
      .where(like(schema.verifications.syncoreOrderId, `${jobId}:%`))
      .returning({ id: schema.verifications.id });
    await db
      .insert(schema.jobVerificationClears)
      .values({
        jobId,
        clearedByUserId: session.user.id,
      })
      .onConflictDoUpdate({
        target: schema.jobVerificationClears.jobId,
        set: {
          clearedAt: new Date(),
          clearedByUserId: session.user.id,
        },
      });
    return NextResponse.json({ ok: true, deleted: result.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
