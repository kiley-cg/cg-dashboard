"use client";

// 5-column Mon-Fri grid view of /production. Each column lists scheduled
// POs as compact tiles. Drag a tile to a different column to re-schedule
// (calls the same schedulePo server action the dropdown uses). Drag
// from the Unscheduled strip at the top to assign a day.
//
// Honors the FilterProvider — chips/search apply to both the grid and
// the unscheduled strip.

import { useTransition, useState } from "react";
import type { Department } from "@/lib/syncore/production";
import { schedulePo, unschedulePo } from "../_actions";
import { useFilter } from "./FilterProvider";

interface TileData {
  poId: string;
  jobId: string;
  poNumber: number | null;
  customer: string | null;
  department: Department;
  qty: number | null;
  dueDate: string | null;
  inboundReady: boolean;
  conflict: boolean;
  isDone: boolean;
}

interface DayLabel {
  iso: string;
  label: string; // "Mon May 25"
}

interface Props {
  days: DayLabel[];
  today: string;
  scheduled: Record<string, TileData[]>; // keyed by iso date
  unscheduled: TileData[];
}

const DEPT_COLOR: Record<Department, string> = {
  embroidery: "#0F6E56",
  transfers: "#8A5A2B",
  fulfillment: "#3B6FB0",
  other: "#6B6356",
};

export function WeekGridView({ days, today, scheduled, unscheduled }: Props) {
  const [pending, startTransition] = useTransition();
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const filter = useFilter();

  const matches = (t: TileData) =>
    filter.matches({
      dept: t.department,
      inboundReady: t.inboundReady,
      customer: t.customer,
      jobId: t.jobId,
    });

  function moveTo(poId: string, target: string | "unscheduled") {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("poId", poId);
      if (target === "unscheduled") {
        await unschedulePo(fd);
      } else {
        fd.set("scheduledDate", target);
        await schedulePo(fd);
      }
    });
  }

  function onDrop(e: React.DragEvent, target: string | "unscheduled") {
    e.preventDefault();
    setDropTarget(null);
    const poId = e.dataTransfer.getData("text/plain");
    if (poId) moveTo(poId, target);
  }

  return (
    <div className={pending ? "opacity-70 pointer-events-none transition" : "transition"}>
      {/* Unscheduled strip — drag source AND drop target (to remove
          a PO from its day). */}
      <UnscheduledStrip
        items={unscheduled.filter(matches)}
        isDropTarget={dropTarget === "unscheduled"}
        onDragEnter={() => setDropTarget("unscheduled")}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => onDrop(e, "unscheduled")}
      />

      <div className="grid grid-cols-5 gap-2 mt-3">
        {days.map((d) => {
          const items = (scheduled[d.iso] ?? []).filter(matches);
          const isToday = d.iso === today;
          const isHover = dropTarget === d.iso;
          return (
            <div
              key={d.iso}
              onDragOver={(e) => {
                e.preventDefault();
                if (dropTarget !== d.iso) setDropTarget(d.iso);
              }}
              onDragLeave={() => setDropTarget((t) => (t === d.iso ? null : t))}
              onDrop={(e) => onDrop(e, d.iso)}
              className={[
                "rounded border min-h-[200px] p-2 flex flex-col gap-1.5 transition",
                isHover
                  ? "bg-[#EAF4EF] border-cg-teal border-2"
                  : isToday
                    ? "bg-white border-[#E3DFD3]"
                    : "bg-[#FCFBF7] border-[#E3DFD3]",
              ].join(" ")}
            >
              <header className="flex items-baseline justify-between text-[11px] font-semibold text-[#6B6356] mb-1 pb-1 border-b border-[#E3DFD3]">
                <span className={isToday ? "text-cg-teal" : ""}>
                  {d.label}
                  {isToday && (
                    <span className="ml-1 text-[9px] uppercase tracking-wider">
                      today
                    </span>
                  )}
                </span>
                <span className="tabular-nums">{items.length}</span>
              </header>
              {items.length === 0 ? (
                <div className="text-[11px] text-[#9A917F] italic px-1 py-2">
                  Drop here to schedule
                </div>
              ) : (
                items.map((t) => <CompactTile key={t.poId} t={t} />)
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UnscheduledStrip(props: {
  items: TileData[];
  isDropTarget: boolean;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        props.onDragEnter();
      }}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      className={[
        "rounded border p-2 transition",
        props.isDropTarget
          ? "bg-[#FBEFEF] border-[#D64545] border-2"
          : "bg-[#F3F1E8] border-[#E3DFD3]",
      ].join(" ")}
    >
      <header className="flex items-baseline justify-between text-[11px] font-semibold text-[#6B6356] mb-1.5">
        <span>Unscheduled — drag to a day below</span>
        <span className="tabular-nums">{props.items.length}</span>
      </header>
      {props.items.length === 0 ? (
        <div className="text-[11px] text-[#9A917F] italic px-1 py-1">
          Nothing waiting. (Drop a card here to move it back to Unscheduled.)
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-y-auto">
          {props.items.map((t) => (
            <CompactTile key={t.poId} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompactTile({ t }: { t: TileData }) {
  const dept = DEPT_COLOR[t.department];
  // Frame precedence matches PoCard: done dim → conflict red → ready
  // green → neutral. Keep the dept-color stripe always visible.
  const bg = t.isDone
    ? "#F3F1E8"
    : t.conflict
      ? "#FBEBEB"
      : t.inboundReady
        ? "#E5F2E5"
        : "#FFFFFF";
  const border = t.isDone
    ? "#E3DFD3"
    : t.conflict
      ? "#D64545"
      : t.inboundReady
        ? "#3A8C5F"
        : "#E3DFD3";
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", t.poId);
        e.dataTransfer.effectAllowed = "move";
      }}
      title={`${t.customer ?? `Job ${t.jobId}`} · Job ${t.jobId} · PO ${t.poNumber ?? t.poId}${t.dueDate ? ` · Due ${t.dueDate.slice(5)}` : ""}`}
      style={{
        borderLeftColor: dept,
        borderLeftWidth: 4,
        borderColor: border,
        borderWidth: t.conflict || t.inboundReady ? 2 : 1,
        backgroundColor: bg,
      }}
      className={[
        "rounded px-1.5 py-1 text-[11px] cursor-grab active:cursor-grabbing w-full",
        t.isDone ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="font-semibold text-[#1C2B27] truncate">
        {t.customer ?? `Job ${t.jobId}`}
      </div>
      <div className="flex items-baseline gap-1.5 text-[10px] text-[#6B6356] tabular-nums">
        <span>#{t.jobId}-{t.poNumber ?? "—"}</span>
        <span>·</span>
        <span>{t.qty ?? "—"}q</span>
        {t.dueDate && (
          <>
            <span>·</span>
            <span>due {t.dueDate.slice(5)}</span>
          </>
        )}
      </div>
    </div>
  );
}
