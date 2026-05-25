"use client";

// Phase B "Ask about this Job" composer. Mounted on each PoCard;
// clicking opens an inline popover with a recipient select (defaulted
// to the job's CSR when known), a message textarea, and Send/Cancel.
// On Send, calls askAboutJobAction which posts the message to the
// Job's Syncore Job Log via pushFloorMessageToJobLog.

import { useState, useTransition } from "react";
import { askAboutJobAction } from "../_actions";
import {
  ROLE_LABEL,
  ROUTABLE_PEOPLE,
  matchCsrByName,
  type Person,
} from "@/lib/people/registry";

interface Props {
  jobId: string;
  // CSR name as Syncore returned it on the latest follow-up snapshot,
  // if we have one. Used to default the recipient. Null = no default;
  // floor has to pick from the dropdown.
  csrName: string | null;
}

const GROUP_ORDER: Person["role"][] = ["csr", "sales", "sales_assistant"];

export function AskAboutJobButton({ jobId, csrName }: Props) {
  const [open, setOpen] = useState(false);
  const defaultMatch = matchCsrByName(csrName);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] border border-cg-teal text-cg-teal font-semibold rounded px-2 py-0.5 hover:bg-cg-teal hover:text-white transition"
        title="Send a question about this job to a CSR or salesperson"
      >
        Ask about this Job
      </button>
      {open && (
        <Composer
          jobId={jobId}
          defaultKey={defaultMatch?.key ?? ""}
          defaultLabel={
            defaultMatch
              ? `${defaultMatch.displayName} (CSR on this job)`
              : csrName
                ? `${csrName} (not in routable list)`
                : null
          }
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Composer({
  jobId,
  defaultKey,
  defaultLabel,
  onClose,
}: {
  jobId: string;
  defaultKey: string;
  defaultLabel: string | null;
  onClose: () => void;
}) {
  const [recipient, setRecipient] = useState(defaultKey);
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = ROUTABLE_PEOPLE.find((p) => p.key === recipient) ?? null;
  const headerText = selected
    ? `To: ${selected.displayName} (${ROLE_LABEL[selected.role]})`
    : defaultLabel
      ? `To: ${defaultLabel}`
      : "To: pick a recipient";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return; // Belt-and-suspenders idempotency: disabled button + early return.
    if (!recipient || !body.trim()) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("jobId", jobId);
      fd.set("recipient", recipient);
      fd.set("body", body.trim());
      const result = await askAboutJobAction(fd);
      if (result.ok) {
        setSent(selected?.displayName ?? recipient);
        setBody("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="mt-2 bg-white border-2 border-cg-teal rounded-card p-3 shadow-md text-[12.5px]">
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-semibold text-cg-teal">{headerText}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-cg-n-500 hover:text-cg-n-900 text-lg leading-none px-1"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {sent ? (
        <div className="py-3">
          <p className="text-cg-success font-semibold">Sent to {sent} ✓</p>
          <p className="text-[11px] text-cg-n-600 mt-1">
            Posted to the Syncore Job Log for Job {jobId}.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setSent(null);
                setBody("");
                setRecipient(defaultKey);
              }}
              className="text-[11px] border border-cg-teal text-cg-teal rounded px-2 py-0.5 hover:bg-cg-teal hover:text-white"
            >
              Send another
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] text-cg-n-600 hover:underline"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider font-bold text-cg-n-600">
              Recipient
            </span>
            <select
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              required
              disabled={pending}
              className="mt-0.5 w-full border border-cg-n-300 rounded-input px-2 py-1 bg-white text-[12.5px]"
            >
              <option value="" disabled>
                — pick a recipient —
              </option>
              {GROUP_ORDER.map((role) => {
                const group = ROUTABLE_PEOPLE.filter((p) => p.role === role);
                if (group.length === 0) return null;
                return (
                  <optgroup key={role} label={ROLE_LABEL[role]}>
                    {group.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.displayName}
                        {p.key === defaultKey ? " — CSR on this job" : ""}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider font-bold text-cg-n-600">
              Message
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              disabled={pending}
              rows={4}
              placeholder="What do you need to know about this job?"
              className="mt-0.5 w-full border border-cg-n-300 rounded-input px-2 py-1 bg-white text-[12.5px] leading-relaxed"
            />
          </label>
          {error && (
            <p className="text-[11px] text-cg-error">Couldn&apos;t send: {error}</p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={pending || !recipient || !body.trim()}
              className={[
                "rounded-btn bg-cg-teal text-white px-3 py-1 text-[12px] font-semibold hover:bg-cg-teal/90 transition",
                pending || !recipient || !body.trim()
                  ? "opacity-60 cursor-not-allowed"
                  : "",
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
      )}
    </div>
  );
}
