"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { markHandled, replyToEntry, unmarkHandled } from "../_actions";
import { ROUTABLE_PEOPLE } from "@/lib/people/registry";

interface Entry {
  syncoreEntryId: string;
  jobId: string;
  createdAt: string; // ISO
  createdByUserId: number;
  createdByName: string;
  description: string;
  customer: string | null;
}

interface Props {
  entry: Entry;
  recipientUserId: number;
  handled: { handledAt: string | null; handledByUserId: string | null } | null;
}

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  dateStyle: "medium",
  timeStyle: "short",
});

function senderPerson(uid: number) {
  return ROUTABLE_PEOPLE.find((p) => p.syncoreUserId === uid) ?? null;
}

export function InboxRow({ entry, recipientUserId, handled }: Props) {
  const [pending, start] = useTransition();
  const [replyOpen, setReplyOpen] = useState(false);

  function toggleHandled() {
    start(async () => {
      const fd = new FormData();
      fd.set("entryId", entry.syncoreEntryId);
      fd.set("recipientUserId", String(recipientUserId));
      if (handled) await unmarkHandled(fd);
      else await markHandled(fd);
    });
  }

  return (
    <li
      className={[
        "border rounded-card p-3 bg-white transition",
        handled
          ? "border-cg-n-200 opacity-70"
          : "border-cg-n-200 hover:border-cg-teal",
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-3 text-[11.5px] text-cg-n-600">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold text-cg-n-900">
            {entry.customer ?? `Job ${entry.jobId}`}
          </span>
          <Link
            href={`/production?job=${entry.jobId}`}
            className="text-cg-teal hover:underline"
          >
            Job {entry.jobId}
          </Link>
          <span>·</span>
          <span>{formatter.format(new Date(entry.createdAt))}</span>
          <span>·</span>
          <span>from {entry.createdByName}</span>
        </div>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={!!handled}
            onChange={toggleHandled}
            disabled={pending}
            className="w-4 h-4 accent-cg-success"
          />
          <span className="text-[11px] font-semibold">
            {handled ? "Handled" : "Mark handled"}
          </span>
        </label>
      </div>

      <p className="mt-2 text-[13px] text-cg-n-900 whitespace-pre-wrap leading-relaxed">
        {entry.description}
      </p>

      {handled?.handledAt && (
        <p className="mt-1.5 text-[10.5px] text-cg-n-500 italic">
          Handled at {formatter.format(new Date(handled.handledAt))}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {!handled && (
          <button
            type="button"
            onClick={() => setReplyOpen((v) => !v)}
            className="text-[11.5px] border border-cg-teal text-cg-teal font-semibold rounded px-2 py-0.5 hover:bg-cg-teal hover:text-white"
          >
            {replyOpen ? "Cancel reply" : "Reply"}
          </button>
        )}
      </div>

      {replyOpen && (
        <ReplyComposer
          jobId={entry.jobId}
          recipientUserId={entry.createdByUserId}
          recipientName={
            senderPerson(entry.createdByUserId)?.displayName ??
            entry.createdByName
          }
          onClose={() => setReplyOpen(false)}
        />
      )}
    </li>
  );
}

function ReplyComposer({
  jobId,
  recipientUserId,
  recipientName,
  onClose,
}: {
  jobId: string;
  recipientUserId: number;
  recipientName: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || !body.trim()) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("jobId", jobId);
      fd.set("recipientUserId", String(recipientUserId));
      fd.set("recipientName", recipientName);
      fd.set("body", body.trim());
      const result = await replyToEntry(fd);
      if (result.ok) {
        setSent(true);
        setBody("");
      } else {
        setError(result.error);
      }
    });
  }

  if (sent) {
    return (
      <div className="mt-2 border-2 border-cg-success rounded-card p-3 bg-white">
        <p className="text-cg-success font-semibold">
          Reply sent to {recipientName} ✓
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 text-[11px] text-cg-n-600 hover:underline"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-2 border-2 border-cg-teal rounded-card p-3 bg-white space-y-2"
    >
      <p className="text-[11.5px] font-semibold text-cg-teal">
        Replying to {recipientName}
      </p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        disabled={pending}
        rows={3}
        placeholder="Type your reply…"
        className="w-full border border-cg-n-300 rounded-input px-2 py-1 bg-white text-[12.5px] leading-relaxed"
      />
      {error && <p className="text-[11px] text-cg-error">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className={[
            "rounded-btn bg-cg-teal text-white px-3 py-1 text-[12px] font-semibold hover:bg-cg-teal/90",
            pending || !body.trim() ? "opacity-60 cursor-not-allowed" : "",
          ].join(" ")}
        >
          {pending ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="text-[12px] text-cg-n-600 hover:underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
