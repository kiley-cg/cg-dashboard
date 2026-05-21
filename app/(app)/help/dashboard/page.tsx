import Link from "next/link";

export const metadata = {
  title: "Dashboard Help · Color Graphics",
};

export default function DashboardHelpPage() {
  return (
    <article className="max-w-4xl mx-auto px-6 py-10">
      <header className="mb-10">
        <Link
          href="/dashboard"
          className="text-cg-n-500 hover:text-cg-n-900 text-sm"
        >
          ← Back to Dashboard
        </Link>
        <p className="text-cg-red text-xs font-semibold uppercase tracking-wider mt-4">
          Help
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight mt-2">
          CSR Performance
        </h1>
        <p className="text-cg-n-600 mt-3">
          What each part of the manager dashboard means and how to use it.
        </p>
      </header>

      <nav className="mb-12 rounded-card border border-cg-n-200 bg-cg-n-50 p-5">
        <p className="text-xs uppercase tracking-wider font-semibold text-cg-n-500 mb-3">
          Contents
        </p>
        <ul className="grid gap-1 sm:grid-cols-2 text-sm">
          <li>
            <a className="text-cg-info hover:underline" href="#team-summary">
              Team summary tiles
            </a>
          </li>
          <li>
            <a className="text-cg-info hover:underline" href="#priority-queue">
              Needs attention queue
            </a>
          </li>
          <li>
            <a className="text-cg-info hover:underline" href="#scorecard">
              Per-CSR scorecard
            </a>
          </li>
          <li>
            <a className="text-cg-info hover:underline" href="#drill-down">
              CSR drill-down page
            </a>
          </li>
          <li>
            <a className="text-cg-info hover:underline" href="#daily-history">
              Daily follow-up history
            </a>
          </li>
          <li>
            <a className="text-cg-info hover:underline" href="#faq">
              FAQ
            </a>
          </li>
        </ul>
      </nav>

      <section className="mb-12">
        <p className="text-cg-n-700 leading-relaxed mb-2">
          Manager-only dashboard at{" "}
          <Link className="text-cg-info hover:underline" href="/dashboard">
            /dashboard
          </Link>
          . Snapshots of every CSR&rsquo;s Syncore Job Follow-Ups are
          captured hourly on weekdays; the page lays them out as a team
          summary, a triage queue, per-CSR scorecards, and a filterable
          table of every open follow-up.
        </p>
        <p className="text-cg-n-700 leading-relaxed mb-4">
          A &ldquo;follow-up&rdquo; in this app is one row in a CSR&rsquo;s
          Job Follow-Ups list in Syncore. Each row is a job that needs
          attention, with a due date (the <em>fuDate</em>) and a priority.
        </p>
      </section>

      <section id="team-summary" className="mb-12">
        <h2 className="text-xl font-bold tracking-tight border-b border-cg-n-200 pb-2 mb-4">
          Team summary tiles (top of page)
        </h2>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          Six tiles for a one-glance read on the team:
        </p>
        <ul className="space-y-2 mb-4">
          <li>
            <strong className="text-cg-n-900">Open follow-ups</strong> &mdash;
            total open follow-ups across the team. The little arrow shows
            change vs yesterday.
          </li>
          <li>
            <strong className="text-cg-n-900">Total issues</strong> &mdash;
            open follow-ups with an issue assigned (artwork, hold,
            problem, etc.). Excludes follow-ups with no issue. Arrow shows
            change vs yesterday.
          </li>
          <li>
            <strong className="text-cg-n-900">Overdue</strong> &mdash; open
            follow-ups whose fuDate has passed.{" "}
            <em>Click this tile</em> to jump to the follow-ups table below
            with the Overdue filter pre-applied.
          </li>
          <li>
            <strong className="text-cg-n-900">Stale Crit/Rush</strong> &mdash;
            Critical or Critical-Rush priority follow-ups that are also
            overdue. The most actionable number on the page.{" "}
            <em>Click to drill in.</em>
          </li>
          <li>
            <strong className="text-cg-n-900">Over workload</strong> &mdash;
            count of CSRs with more than 45 open follow-ups. If everyone
            is over, that&rsquo;s a team-wide workload story; if one
            person is over and others aren&rsquo;t, that&rsquo;s an
            imbalance story.
          </li>
          <li>
            <strong className="text-cg-n-900">Closed today</strong> &mdash;
            jobs that were on the team&rsquo;s open list yesterday but
            aren&rsquo;t today. Reflects all queue movement, not just
            literally clicked-done.
          </li>
        </ul>
      </section>

      <section id="priority-queue" className="mb-12">
        <h2 className="text-xl font-bold tracking-tight border-b border-cg-n-200 pb-2 mb-4">
          Needs attention queue
        </h2>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          Top 15 items across the whole team that need eyes on them right
          now, ranked by an urgency score. Each row is tagged with a{" "}
          <em>reason</em>:
        </p>
        <ul className="space-y-1 mb-4 text-sm">
          <li>
            <strong>Stale Critical/Rush</strong> &mdash; highest priority.
            Critical job AND overdue.
          </li>
          <li>
            <strong>Long-stuck (14d+)</strong> &mdash; on the open list 14+
            days regardless of priority.
          </li>
          <li>
            <strong>Overdue &amp; aged</strong> &mdash; overdue AND has
            been on the list 7+ days.
          </li>
          <li>
            <strong>Critical/Rush</strong> &mdash; high-priority job, not
            yet overdue.
          </li>
          <li>
            <strong>Overdue</strong> &mdash; past its fuDate, not yet
            in any of the above buckets.
          </li>
        </ul>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          The CSR badge in each row links to that CSR&rsquo;s drill-down
          page. The Job # opens the job in Syncore.
        </p>
      </section>

      <section id="scorecard" className="mb-12">
        <h2 className="text-xl font-bold tracking-tight border-b border-cg-n-200 pb-2 mb-4">
          Per-CSR scorecard
        </h2>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          One card per CSR. The big number on the right is the{" "}
          <strong>attention score</strong> = Overdue + Stale Crit/Rush.
          Lower is better. Color-coded relative to the rest of the team
          (top quartile green, bottom quartile red). The line below shows
          the CSR&rsquo;s rank (e.g. &ldquo;3rd of 8 on attention
          score&rdquo;).
        </p>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          Six stats, each with a faint &ldquo;team avg X&rdquo; subtitle
          so you can spot outliers without scanning every other card:
        </p>
        <ul className="space-y-2 mb-4">
          <li>
            <strong>Follow-ups</strong> &mdash; total open follow-ups on
            this CSR&rsquo;s plate.
          </li>
          <li>
            <strong>Due today</strong> &mdash; fuDate is today.
          </li>
          <li>
            <strong>Overdue</strong> &mdash; fuDate has passed.
          </li>
          <li>
            <strong>Critical/Rush</strong> &mdash; high-priority count.
          </li>
          <li>
            <strong>Stale crit/rush</strong> &mdash; Critical AND overdue.
          </li>
          <li>
            <strong>Avg closed/day</strong> &mdash; 7-day rolling rate of
            follow-ups this CSR closes per day. Excludes today&rsquo;s
            partial day.
          </li>
        </ul>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          Below the stats: a stacked <strong>issue mix</strong> bar
          showing what kinds of issues the open follow-ups fall under
          (artwork, hold, in production, etc.), and four{" "}
          <strong>aging buckets</strong> (&lt; 1d, 1&ndash;3d, 3&ndash;7d,
          7d+) so you can see whether the workload is fresh or stale.
        </p>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          Click the CSR&rsquo;s name (the chevron <code>&rsaquo;</code>{" "}
          next to it) for the drill-down page.
        </p>
      </section>

      <section id="drill-down" className="mb-12">
        <h2 className="text-xl font-bold tracking-tight border-b border-cg-n-200 pb-2 mb-4">
          CSR drill-down page
        </h2>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          At <code>/dashboard/csr/{`{csrId}`}</code>. Same scorecard, plus:
        </p>
        <ul className="space-y-2 mb-4">
          <li>
            <strong>Talking points</strong> &mdash; auto-generated bullets
            for a 1:1 (e.g. &ldquo;2 Critical/Rush jobs are overdue&rdquo;,
            &ldquo;Job #4991 has been open 18d &mdash; long-stuck, dig
            in&rdquo;).
          </li>
          <li>
            <strong>What changed this week</strong> &mdash; how many jobs
            were added to the open list vs closed since 7 days ago.
          </li>
          <li>
            <strong>30-day workload &amp; issues sparklines</strong>{" "}
            &mdash; full-size versions of the trends shown small on the
            main dashboard.
          </li>
          <li>
            <strong>Oldest open jobs</strong> &mdash; the 15 longest-aged
            open follow-ups for this CSR with their days-open, issue, and
            priority.
          </li>
          <li>
            <strong>Daily follow-up history table</strong> &mdash; see
            below.
          </li>
          <li>
            <strong>Filtered follow-ups table</strong> &mdash; all of this
            CSR&rsquo;s open and completed follow-ups, sortable and
            filterable.
          </li>
        </ul>
      </section>

      <section id="daily-history" className="mb-12">
        <h2 className="text-xl font-bold tracking-tight border-b border-cg-n-200 pb-2 mb-4">
          Daily follow-up history table
        </h2>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          Last 30 days, one row per Pacific workday. Three numbers per
          day:
        </p>
        <ul className="space-y-2 mb-4">
          <li>
            <strong>Unfinished at EOD</strong> &mdash; follow-ups still on
            the rep&rsquo;s open list at end of day with a fuDate of that
            day or earlier (the items they should have handled but
            didn&rsquo;t). Should be near zero on a productive day. Color
            coded: green at 0, neutral 1&ndash;3, red 4+.
          </li>
          <li>
            <strong>Closed</strong> &mdash; jobs that were on the open
            list yesterday but aren&rsquo;t today. Includes completions,
            re-dating to the future, deletions &mdash; everything the rep
            moved off their plate.
          </li>
          <li>
            <strong>7-day avg closed</strong> &mdash; rolling close rate.
          </li>
        </ul>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          Today&rsquo;s row shows an <em>in progress</em> chip and dashes
          for Closed/avg, since the day isn&rsquo;t over. Each row shows
          the actual time of the snapshot it&rsquo;s based on (&ldquo;as
          of 4:00 PM PT&rdquo;) so you know whether you&rsquo;re looking
          at near-EOD data or mid-day data.
        </p>
      </section>

      <section id="faq" className="mb-12">
        <h2 className="text-xl font-bold tracking-tight border-b border-cg-n-200 pb-2 mb-4">
          FAQ
        </h2>
        <FaqItem
          q="How fresh is the data?"
          a="Snapshots run every hour on weekdays (UTC). The header at the top of /dashboard shows when the most recent one was taken. If something looks stale, check that timestamp first."
        />
        <FaqItem
          q="Why don't I see weekend data?"
          a="The snapshot cron only runs Monday–Friday. Saturday and Sunday data is whatever the Friday-evening snapshot captured."
        />
        <FaqItem
          q="What's the difference between 'attention score' and 'workload'?"
          a="Workload is the raw count of open follow-ups (could be 60 — most are due next week). Attention score is Overdue + Stale Crit/Rush (the urgent unfinished work). A CSR can have a high workload and low attention score if their queue is mostly future-dated, or vice versa."
        />
        <FaqItem
          q="Workload imbalance banner — when does it fire?"
          a="When the highest-workload CSR is 1.5× the lowest AND the absolute gap is at least 8 jobs AND the high CSR has 10+ jobs. Designed to suppress noise when the team is light and only flag when redistribution is worth talking about."
        />
        <FaqItem
          q="What does 'Closed today' actually count?"
          a="Jobs that were on the team's open follow-ups list ~24 hours ago and aren't on it now. So completions, removals, deferring to a future date, and the rep clearing a follow-up by acting on it all count. It is NOT Syncore's cumulative completed-list total."
        />
        <FaqItem
          q="The heatmap cells — what does the color intensity mean?"
          a="In the Team Rollup table, red intensity is proportional to that CSR's count of follow-ups in that issue type, relative to the max across the team. Darker = more concentrated. Click a cell to filter the follow-ups table below by that CSR + issue type."
        />
        <FaqItem
          q="Job links open Syncore, not stay in this app?"
          a="Right. Job IDs deep-link to https://www.ateasesystems.net/Job/Details/{id} so you can act on them. To stay in this app and see one CSR's data, click the CSR name on a scorecard or the CSR badge in the priority queue."
        />
      </section>

      <p className="text-cg-n-500 text-sm border-t border-cg-n-200 pt-6">
        Something missing or wrong? Tell{" "}
        <a
          className="text-cg-info hover:underline"
          href="mailto:kiley@colorgraphicswa.com"
        >
          Kiley
        </a>{" "}
        and this page will get updated.
      </p>
    </article>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-card border border-cg-n-200 bg-white p-4 mb-3">
      <p className="font-semibold text-cg-n-900 mb-1">{q}</p>
      <p className="text-cg-n-700 text-sm leading-relaxed">{a}</p>
    </div>
  );
}
