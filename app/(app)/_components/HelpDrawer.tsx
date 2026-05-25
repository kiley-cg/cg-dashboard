"use client";

// Slide-in help drawer triggered by the page-level HelpButton. Server
// pages preload the doc (via getHelpDoc) and pass it in; the drawer
// renders the markdown client-side so opening/closing doesn't reach
// back to the server. If the doc is null (not seeded yet), we show
// a friendly placeholder with a link for admins to create one.

import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  slug: string;
  title: string;
  doc: {
    title: string;
    bodyMd: string;
    updatedAt: Date | null;
  } | null;
  canEdit: boolean;
}

export function HelpButton({ slug, title, doc, canEdit }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Help: ${title}`}
        className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-cg-n-300 text-cg-n-600 hover:bg-cg-n-100 hover:text-cg-n-900 transition text-sm font-semibold"
        aria-label="Open help"
      >
        ?
      </button>
      {open && (
        <Drawer
          slug={slug}
          title={title}
          doc={doc}
          canEdit={canEdit}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Drawer({
  slug,
  title,
  doc,
  canEdit,
  onClose,
}: Props & { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close help"
        className="absolute inset-0 bg-black/40 cursor-default"
      />
      <aside className="relative bg-white w-full max-w-[460px] h-full shadow-xl flex flex-col">
        <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-cg-n-200">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold text-cg-teal">
              Help
            </p>
            <h2 className="font-extrabold text-lg leading-tight">
              {doc?.title ?? title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-cg-n-500 hover:text-cg-n-900 text-xl leading-none w-7 h-7"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm leading-relaxed">
          {doc?.bodyMd?.trim() ? (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {doc.bodyMd}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="text-cg-n-600 italic">
              No help content yet for{" "}
              <code className="not-italic bg-cg-n-100 px-1 rounded text-[12px]">
                {slug}
              </code>
              .
              {canEdit && (
                <>
                  {" "}
                  <Link
                    href={`/admin/help/${encodeURIComponent(slug)}`}
                    className="text-cg-teal underline"
                  >
                    Add one →
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
        {(doc?.updatedAt || canEdit) && (
          <footer className="border-t border-cg-n-200 px-5 py-2 flex items-center justify-between text-[11px] text-cg-n-500">
            {doc?.updatedAt && (
              <span>
                Updated{" "}
                {new Intl.DateTimeFormat("en-US", {
                  timeZone: "America/Los_Angeles",
                  dateStyle: "medium",
                }).format(new Date(doc.updatedAt))}
              </span>
            )}
            {canEdit && (
              <Link
                href={`/admin/help/${encodeURIComponent(slug)}`}
                className="text-cg-teal underline"
              >
                Edit →
              </Link>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}
