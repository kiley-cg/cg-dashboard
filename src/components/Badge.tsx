type Tone = "success" | "warning" | "review" | "info" | "neutral" | "danger";

const tones: Record<Tone, { dot: string; bg: string; text: string }> = {
  success: { dot: "bg-cg-success", bg: "bg-green-50", text: "text-cg-success" },
  warning: { dot: "bg-cg-warning", bg: "bg-amber-50", text: "text-cg-warning" },
  review: { dot: "bg-cg-warning", bg: "bg-amber-50", text: "text-cg-warning" },
  info: { dot: "bg-cg-info", bg: "bg-sky-50", text: "text-cg-info" },
  neutral: { dot: "bg-cg-n-400", bg: "bg-cg-n-100", text: "text-cg-n-700" },
  danger: { dot: "bg-cg-danger", bg: "bg-cg-red-50", text: "text-cg-danger" },
};

type Props = {
  tone?: Tone;
  children: React.ReactNode;
};

export function Badge({ tone = "neutral", children }: Props) {
  const t = tones[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-chip px-2.5 py-0.5 text-xs font-semibold ${t.bg} ${t.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {children}
    </span>
  );
}
