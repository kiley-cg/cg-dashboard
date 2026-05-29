// Completed-PO tab on /production. Shows recently-closed decoration POs
// — the ones whose syncoreClosedAt has been stamped, regardless of
// whether the mirror cron has yet picked up the Posted-Manually status
// from Syncore.
//
// Intentionally read-only: no schedule controls, no re-open button.
// The closed state is treated as terminal here; if Kristen ever needs
// to re-open one (rare), they can do it in Syncore and the next mirror
// run will surface it back into the schedule.

import Link from "next/link";
import {
  getCustomerDisplayMap,
  listRecentlyClosedDecorationPos,
} from "@/lib/db/production-po";
import { departmentForSupplier } from "@/lib/syncore/production";

const SYNCORE_JOB_DEEP_LINK = "https://www.ateasesystems.net/Job/Details";
const SYNCORE_PO_DEEP_LINK = "https://www.ateasesystems.net/PurchaseOrder/Details";

const DEPT_TITLE: Record<string, string> = {
  embroidery: "Embroidery",
  transfers: "Transfers",
  fulfillment: "Fulfillment",
  other: "Other",
};

function formatClosedAt(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export async function CompletedTab() {
  const completed = await listRecentlyClosedDecorationPos({ sinceDays: 30 });
  const jobIds = Array.from(new Set(completed.map((v) => v.po.syncoreJobId)));
  const customerMap = await getCustomerDisplayMap({ jobIds });

  if (completed.length === 0) {
    return (
      <div className="mx-8 mt-6 mb-8 bg-white border border-[#E3DFD3] rounded-card p-8 text-center text-[#9A917F] italic">
        No POs closed in the last 30 days yet.
      </div>
    );
  }

  return (
    <section className="mx-8 mt-6 mb-8">
      <h2 className="text-[12px] tracking-[.14em] uppercase font-bold text-cg-teal mb-2">
        Completed · last 30 days · {completed.length} PO
        {completed.length === 1 ? "" : "s"}
      </h2>
      <div className="bg-white border border-[#E3DFD3] rounded-card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-[#F7F5EF] text-[#5A5346]">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">PO</th>
              <th className="text-left px-3 py-2 font-semibold">Customer</th>
              <th className="text-left px-3 py-2 font-semibold">Dept</th>
              <th className="text-right px-3 py-2 font-semibold">Qty</th>
              <th className="text-left px-3 py-2 font-semibold">Closed</th>
            </tr>
          </thead>
          <tbody>
            {completed.map(({ po, state }) => {
              const dept = departmentForSupplier(po.supplierName);
              const customer =
                customerMap.get(po.syncoreJobId) ??
                po.supplierName ??
                `Job ${po.syncoreJobId}`;
              const poLabel =
                po.poNumber != null
                  ? `${po.syncoreJobId}-${po.poNumber}`
                  : po.poId;
              return (
                <tr
                  key={po.poId}
                  className="border-t border-[#EFEDE4] hover:bg-[#FAF8F2]"
                >
                  <td className="px-3 py-2 font-mono text-[12px]">
                    <Link
                      href={`${SYNCORE_PO_DEEP_LINK}/${po.poId}?jobId=${po.syncoreJobId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cg-teal hover:underline"
                    >
                      {poLabel}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`${SYNCORE_JOB_DEEP_LINK}/${po.syncoreJobId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {customer}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[#5A5346]">
                    {DEPT_TITLE[dept] ?? dept}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {po.totalQuantity ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[#5A5346]">
                    {state.syncoreClosedAt
                      ? formatClosedAt(state.syncoreClosedAt)
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
