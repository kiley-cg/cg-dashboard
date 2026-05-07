import type { TalkingPoint } from "../_lib/compute";

const TONE: Record<
  TalkingPoint["tone"],
  { bg: string; dot: string; text: string }
> = {
  alert: { bg: "bg-cg-red-50", dot: "bg-cg-danger", text: "text-cg-danger" },
  concern: {
    bg: "bg-amber-50",
    dot: "bg-cg-warning",
    text: "text-cg-warning",
  },
  win: { bg: "bg-green-50", dot: "bg-cg-success", text: "text-cg-success" },
};

export function TalkingPoints({
  bullets,
  csrName,
}: {
  bullets: TalkingPoint[];
  csrName: string;
}) {
  return (
    <div className="rounded-card border border-cg-n-200 bg-white p-5 shadow-sm">
      <h4 className="text-xs uppercase tracking-wide text-cg-n-500 font-semibold mb-3">
        Talking points · {csrName}
      </h4>
      {bullets.length === 0 ? (
        <p className="text-sm text-cg-n-500 italic">No data yet</p>
      ) : (
        <ul className="space-y-2">
          {bullets.map((b, i) => {
            const t = TONE[b.tone];
            return (
              <li
                key={i}
                className={`flex items-start gap-2.5 rounded-md px-3 py-2 text-sm ${t.bg}`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${t.dot} mt-1.5 shrink-0`}
                  aria-hidden
                />
                <span className={t.text}>{b.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
