"use client";

import { useState } from "react";
import type { ProductionJob } from "@/lib/syncore/production";

const STATUS: Record<
  ProductionJob["status"],
  { dot: string; label: string }
> = {
  stopped: { dot: "#D64545", label: "Stopped" },
  pending: { dot: "#E0A800", label: "Pending — not clear yet" },
  production: { dot: "#3A8C5F", label: "In production" },
  finishing: { dot: "#3B6FB0", label: "Finishing" },
};

const JOB_TYPE: Record<
  ProductionJob["type"],
  { tag: string; color: string }
> = {
  embroidery: { tag: "EMB", color: "#0F6E56" },
  transfer: { tag: "TRN", color: "#8A5A2B" },
  screenprint: { tag: "SCR", color: "#6B3FA0" },
  fulfillment: { tag: "FUL", color: "#3B6FB0" },
};

function fmtMinutes(m: number | null): string {
  if (m === null) return "—";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm}m`;
  if (mm === 0) return `${h}h`;
  return `${h}h ${mm}m`;
}

interface Props {
  job: ProductionJob;
  isLastDayOfWeek: boolean;
}

// Identity row layout from Kristen's live review (May 21):
//   [status-dot] CustomerName  Job #####  Art ###  [TYPE]  [URGENT?]
//   description (serif)
//   Qty • Due • Est • POs received/total
// Working details on the second row; identity stands out.
export function JobCard({ job, isLastDayOfWeek }: Props) {
  // Local-only until persistence wires up — these toggles will hit a
  // server action once production_schedule_state is reachable.
  const [done, setDone] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const st = STATUS[job.status];
  const type = JOB_TYPE[job.type];
  const received = job.pos.filter((p) => p.received).length;
  const allReceived = received === job.pos.length;

  const cardClass = [
    "flex gap-3.5 p-4 border rounded-card relative transition",
    urgent
      ? "bg-[#FFF8E0] border-[#E8D27A] shadow-[inset_4px_0_0_#E0A800]"
      : "bg-[#FCFBF7] border-[#E3DFD3]",
    done ? "opacity-55" : "",
    "hover:-translate-y-px hover:shadow-md",
  ].join(" ");

  return (
    <article className={cardClass}>
      {/* notebook done circle */}
      <button
        type="button"
        onClick={() => setDone((v) => !v)}
        className="self-start mt-1 p-0.5"
        title="Mark done"
        aria-label={done ? "Mark as not done" : "Mark as done"}
      >
        <span
          className={[
            "block w-[18px] h-[18px] rounded-full border-2 border-[#1C2B27]",
            done ? "bg-[#1C2B27]" : "bg-transparent",
          ].join(" ")}
        />
      </button>

      <div className="flex-1 min-w-0">
        {/* Identity row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: st.dot }}
            title={st.label}
          />
          <span className="font-bold text-base">{job.customer}</span>
          <IdChip label="Job" value={job.jobId} />
          <IdChip label="Art" value={job.artNo} />
          <span
            className="text-[10px] font-bold tracking-wider border rounded px-1.5 py-px"
            style={{ color: type.color, borderColor: type.color }}
          >
            {type.tag}
          </span>
          {urgent && (
            <span className="text-[9px] font-extrabold tracking-widest bg-[#E0A800] text-[#3A2E00] rounded px-1.5 py-0.5">
              URGENT
            </span>
          )}
        </div>

        {/* description */}
        <div className="font-serif text-base mt-1 mb-1.5">{job.description}</div>

        {/* meta row */}
        <div className="flex flex-wrap gap-4 text-[12.5px] text-[#5A5346]">
          <span>
            <b>Qty</b> {job.qty}
          </span>
          <span>
            <b>Due</b> {job.due.slice(5)}
          </span>
          <span>
            <b>Est</b> {fmtMinutes(job.calcMinutes)}
          </span>
          <span style={{ color: allReceived ? "#3A8C5F" : "#D64545" }}>
            <b>POs</b> {received}/{job.pos.length}{" "}
            {allReceived ? "received" : "pending"}
          </span>
        </div>

        {job.note && (
          <div className="mt-2 text-[12.5px] text-[#6B6356] bg-[#F3F1E8] border-l-[3px] border-[#E3DFD3] py-1.5 px-2.5 rounded-r">
            {job.note}
          </div>
        )}

        <div className="flex gap-4 mt-2.5">
          <LinkButton onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide POs" : `Show ${job.pos.length} POs`}
          </LinkButton>
          <LinkButton onClick={() => setUrgent((v) => !v)}>
            {urgent ? "Clear highlight" : "Highlight urgent"}
          </LinkButton>
          {!done && (
            <LinkButton>
              {isLastDayOfWeek ? "Carry → next Mon" : "Carry → next day"}
            </LinkButton>
          )}
        </div>

        {expanded && (
          <div className="mt-2.5 p-2.5 bg-white border border-dashed border-[#E3DFD3] rounded-lg">
            {job.pos.map((p) => (
              <div
                key={p.po}
                className="flex items-center gap-2.5 py-1 text-sm"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: p.received ? "#3A8C5F" : "#D64545" }}
                />
                <span className="font-semibold tabular-nums">{p.po}</span>
                <span className="text-[#6B6356] text-[12.5px]">
                  {p.received
                    ? "received"
                    : `awaiting${p.eta ? ` · ETA ${p.eta.slice(5)}` : ""}`}
                </span>
              </div>
            ))}
            <div className="mt-1.5 text-[11.5px] text-[#9A917F] italic">
              Same-Job POs run together. Job can&apos;t be scheduled firm until
              all POs are received.
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function IdChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-xs text-[#4A4336] bg-[#ECEFE9] border border-[#D6DCCF] rounded px-2 py-px tabular-nums">
      {label} <b className="text-cg-teal font-extrabold text-[13px]">{value}</b>
    </span>
  );
}

function LinkButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-cg-teal text-[12.5px] font-semibold hover:underline"
    >
      {children}
    </button>
  );
}
