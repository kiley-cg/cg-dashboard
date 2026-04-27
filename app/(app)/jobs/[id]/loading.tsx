// Streaming UI shown by Next.js while the job page's server render is in
// flight — i.e. while we're fetching from Syncore and querying SanMar / S&S
// inventory. Replaces the previous-page content the moment the user clicks
// "Look up", so they get immediate visual feedback even if the data takes
// several seconds.

export default function JobLoading() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-10">
      <span className="text-cg-n-500 text-sm">← Back</span>

      <div className="mt-4 mb-8">
        <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
          Job
        </p>
        <div className="mt-1 h-9 w-40 bg-cg-n-100 rounded animate-pulse" />
        <div className="mt-2 h-4 w-72 bg-cg-n-100 rounded animate-pulse" />
      </div>

      <div className="bg-white border border-cg-n-200 rounded-card p-10 shadow-sm flex items-center justify-center gap-3 text-cg-n-600">
        <span
          aria-hidden
          className="inline-block h-4 w-4 rounded-full border-2 border-cg-red border-t-transparent animate-spin"
        />
        <span className="text-sm">
          Loading job and checking live vendor inventory…
        </span>
      </div>
    </section>
  );
}
