"use client";

import { useState } from "react";

interface Task {
  id: string;
  text: string;
  done: boolean;
  urgent: boolean;
}

interface Props {
  activeDay: string;
}

// Huddle quick-add (Day 1 §1). Local state for the scaffold pass;
// once huddle_tasks is reachable from server actions, this becomes a
// server-driven form with optimistic updates. `activeDay` is the date
// new tasks should be scoped to.
export function HuddleSection({ activeDay }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");

  function add() {
    const text = draft.trim();
    if (!text) return;
    setTasks((t) => [
      ...t,
      { id: `t${Date.now()}`, text, done: false, urgent: false },
    ]);
    setDraft("");
  }

  function toggle(id: string) {
    setTasks((t) =>
      t.map((x) => (x.id === id ? { ...x, done: !x.done } : x)),
    );
  }

  return (
    <section className="mt-2 p-3.5 bg-[#F3F1E8] border border-[#E3DFD3] rounded-card">
      <div className="text-[11px] tracking-widest uppercase text-[#9A917F] font-bold mb-2.5">
        From the huddle · {activeDay}
      </div>

      <div className="flex gap-2 mb-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="Quick-add a task from the huddle…"
          className="flex-1 border border-[#E3DFD3] rounded-input px-3 py-2 text-[13.5px] bg-white"
        />
        <button
          type="button"
          onClick={add}
          className="bg-cg-teal text-white rounded-input px-5 text-[13.5px] font-semibold"
        >
          Add
        </button>
      </div>

      {tasks.length === 0 && (
        <div className="text-[12.5px] text-[#9A917F] italic">
          No huddle tasks yet for this day.
        </div>
      )}

      {tasks.map((t) => (
        <div key={t.id} className="flex items-center gap-2.5 py-1">
          <button
            type="button"
            onClick={() => toggle(t.id)}
            className="p-0.5"
            aria-label={t.done ? "Mark as not done" : "Mark as done"}
          >
            <span
              className={[
                "block w-[18px] h-[18px] rounded-full border-2 border-[#1C2B27]",
                t.done ? "bg-[#1C2B27]" : "bg-transparent",
              ].join(" ")}
            />
          </button>
          <span
            className={[
              "text-[13.5px]",
              t.done ? "line-through text-[#9A917F]" : "",
            ].join(" ")}
          >
            {t.urgent && (
              <span className="mr-1.5 text-[9px] font-extrabold tracking-widest bg-[#E0A800] text-[#3A2E00] rounded px-1.5 py-0.5">
                URGENT
              </span>
            )}
            {t.text}
          </span>
        </div>
      ))}
    </section>
  );
}
