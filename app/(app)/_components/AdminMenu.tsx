"use client";

// Top-bar admin dropdown — replaces the single "Admin" link with a
// menu that goes directly to whichever admin pages the user can see.
// Server passes pre-computed per-item permission flags; we just render.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Item {
  href: string;
  label: string;
  show: boolean;
}

export function AdminMenu({ items }: { items: Item[] }) {
  const visible = items.filter((i) => i.show);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside + Escape to close. Simple, no portal — the menu
  // floats above the page via z-index.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="text-cg-n-300 hover:text-white transition inline-flex items-center gap-1"
      >
        Admin
        <span
          className="text-[10px] transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 min-w-[160px] rounded-card border border-cg-n-200 bg-white shadow-lg overflow-hidden z-50"
        >
          {visible.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-cg-n-900 hover:bg-cg-n-50 transition"
            >
              {i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
