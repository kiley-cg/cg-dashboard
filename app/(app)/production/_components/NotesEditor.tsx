"use client";

import { useState, useTransition } from "react";
import { saveProductionNotes } from "../_actions";

interface Props {
  poId: string;
  initialNotes: string | null;
}

// Kristen's per-PO notes. Collapsed by default — shows a snippet if notes
// exist, or a tiny "+ Add note" button if not. Expanding swaps in a
// textarea with Save/Cancel. We treat empty-after-trim as a clear; the
// server action wipes both the note and the audit fields so the archive
// page filters cleanly on "notes IS NOT NULL".
export function NotesEditor({ poId, initialNotes }: Props) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [draft, setDraft] = useState(initialNotes ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    const next = draft;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("poId", poId);
      fd.set("notes", next);
      await saveProductionNotes(fd);
      setNotes(next.trim());
      setEditing(false);
    });
  }

  function cancel() {
    setDraft(notes);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="mt-2.5 border border-[#D6DCCF] rounded bg-white p-2">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="How did you run this job? (thread weight, hooping, color order, gotchas, etc.)"
          className="w-full text-[13px] text-[#1C2B27] placeholder:text-[#9B9588] resize-y outline-none"
        />
        <div className="flex items-center gap-2 mt-1.5">
          <button
            type="button"
            onClick={save}
            disabled={pending || draft.trim() === notes.trim()}
            className="text-[12px] font-semibold bg-cg-teal text-white rounded px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="text-[12px] text-[#6B6356] hover:text-[#1C2B27] px-1"
          >
            Cancel
          </button>
          {notes && draft.trim() === "" && (
            <span className="text-[11px] text-[#8A5A2B] ml-auto">
              Saving empty will clear the note
            </span>
          )}
        </div>
      </div>
    );
  }

  if (!notes) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-2 text-[12px] text-[#6B6356] hover:text-cg-teal font-semibold inline-flex items-center gap-1"
      >
        <span aria-hidden>+</span> Add note
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="mt-2 w-full text-left text-[12.5px] text-[#1C2B27] bg-white border border-[#D6DCCF] hover:border-cg-teal rounded py-1.5 px-2.5 group"
      title="Click to edit"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] font-bold tracking-wider text-[#6B6356] shrink-0">
          NOTE
        </span>
        <span className="flex-1 whitespace-pre-wrap break-words">{notes}</span>
        <span className="text-[11px] text-[#9B9588] group-hover:text-cg-teal shrink-0">
          edit
        </span>
      </div>
    </button>
  );
}
