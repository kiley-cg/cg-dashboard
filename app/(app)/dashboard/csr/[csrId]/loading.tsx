// Shown automatically while the CSR drill-down's server component is
// fetching snapshot data + computing metrics. Replaces the in-place
// "nothing happened" experience the user reported when clicking a CSR
// name on the main dashboard.

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-card bg-cg-n-100 ${className ?? ""}`}
    />
  );
}

export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="h-5 w-32 rounded bg-cg-n-100 animate-pulse" />
      <div className="h-8 w-64 rounded bg-cg-n-100 animate-pulse" />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <SkeletonBlock className="h-72" />
          <SkeletonBlock className="h-32" />
        </div>
        <div className="space-y-4">
          <SkeletonBlock className="h-32" />
          <SkeletonBlock className="h-32" />
          <SkeletonBlock className="h-32" />
        </div>
      </div>

      <SkeletonBlock className="h-48" />
      <SkeletonBlock className="h-72" />
    </div>
  );
}
