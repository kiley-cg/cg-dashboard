import Link from "next/link";

export const metadata = {
  title: "Help & FAQ · Color Graphics",
};

export default function HelpPage() {
  return (
    <article className="max-w-4xl mx-auto px-6 py-10">
      <header className="mb-10">
        <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
          Help
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight mt-2">
          Help &amp; FAQ
        </h1>
        <p className="text-cg-n-600 mt-3">
          What each part of this app does and how to use it. If you&rsquo;re new,
          start at the top of the section that applies to you.
        </p>
      </header>

      <nav className="mb-12 rounded-card border border-cg-n-200 bg-cg-n-50 p-5">
        <p className="text-xs uppercase tracking-wider font-semibold text-cg-n-500 mb-3">
          Contents
        </p>
        <ul className="grid gap-1 sm:grid-cols-2 text-sm">
          <li>
            <a className="text-cg-info hover:underline" href="#inventory">
              1. Inventory Verification
            </a>
          </li>
          <li>
            <a className="text-cg-info hover:underline" href="#csr">
              2. CSR Performance
            </a>
          </li>
          <li className="pl-4">
            <a className="text-cg-n-700 hover:underline" href="#search-page">
              The Search page
            </a>
          </li>
          <li className="pl-4">
            <a className="text-cg-n-700 hover:underline" href="#team-summary">
              Team summary tiles
            </a>
          </li>
          <li className="pl-4">
            <a className="text-cg-n-700 hover:underline" href="#job-page">
              The Job page
            </a>
          </li>
          <li className="pl-4">
            <a className="text-cg-n-700 hover:underline" href="#priority-queue">
              Needs attention queue
            </a>
          </li>
          <li className="pl-4">
            <a className="text-cg-n-700 hover:underline" href="#verify">
              Verifying a line
            </a>
          </li>
          <li className="pl-4">
            <a className="text-cg-n-700 hover:underline" href="#scorecard">
              The CSR scorecard
            </a>
          </li>
          <li className="pl-4">
            <a className="text-cg-n-700 hover:underline" href="#freight">
              Freight estimate
            </a>
          </li>
          <li className="pl-4">
            <a className="text-cg-n-700 hover:underline" href="#drill-down">
              CSR drill-down page
            </a>
          </li>
          <li className="pl-4">
            <a className="text-cg-n-700 hover:underline" href="#inv-errors">
              Common errors
            </a>
          </li>
          <li className="pl-4">
            <a className="text-cg-n-700 hover:underline" href="#daily-history">
              Daily follow-up history
            </a>
          </li>
          <li className="pl-4">
            <a className="text-cg-n-700 hover:underline" href="#inv-faq">
              Inventory FAQ
            </a>
          </li>
          <li className="pl-4">
            <a className="text-cg-n-700 hover:underline" href="#csr-faq">
              CSR FAQ
            </a>
          </li>
        </ul>
      </nav>

      {/* ─────────────── INVENTORY VERIFICATION ─────────────── */}

      <section id="inventory" className="mb-16">
        <h2 className="text-2xl font-extrabold tracking-tight border-b border-cg-n-200 pb-2 mb-6">
          1. Inventory Verification
        </h2>
        <p className="text-cg-n-700 leading-relaxed mb-4">
          Used by reps to check live vendor stock and pricing for the
          color/size variants on a Syncore job before cutting POs. The page
          pulls the sales orders for a Job ID, calls the right vendor
          (SanMar, S&amp;S, Cutter &amp; Buck) for each line, and shows you
          what&rsquo;s available, where it ships from, and what it costs.
        </p>

        <h3 id="search-page" className="text-lg font-bold tracking-tight mt-8 mb-2">
          The Search page (home)
        </h3>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          Type a Syncore Job ID (just the number, e.g. <code className="rounded bg-cg-n-100 px-1 py-0.5">32428</code>),
          pick a few options, click <strong>Look up</strong>.
        </p>
        <ul className="space-y-2 mb-4">
          <li>
            <strong className="text-cg-n-900">Costs on/off</strong> &mdash;
            include vendor pricing on the job page. Off is faster when
            you&rsquo;re only checking availability.
          </li>
          <li>
            <strong className="text-cg-n-900">Freight on/off</strong> &mdash;
            estimate UPS Ground freight from the decorator to Color Graphics.
          </li>
          <li>
            <strong className="text-cg-n-900">Decorator</strong> &mdash;
            which contract decorator is decorating this job (Frontier or
            OSI). Affects warehouse picks (vendors ship blanks to the
            decorator, so the warehouse closest to the decorator&rsquo;s ZIP
            wins) and the freight FROM ZIP.
          </li>
          <li>
            <strong className="text-cg-n-900">Drop-ship to ZIP</strong>{" "}
            (visible only when Freight is on) &mdash; leave blank for the
            default (decorator &rarr; Color Graphics). Fill in a ZIP only
            when the decorator is shipping finished goods directly to a
            customer instead of back to CG.
          </li>
        </ul>

        <h3 id="job-page" className="text-lg font-bold tracking-tight mt-8 mb-2">
          The Job page
        </h3>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          Each sales order on the job is a card. Inside each card, one row
          per color/size variant. Columns:
        </p>
        <ul className="space-y-2 mb-4">
          <li>
            <strong className="text-cg-n-900">Style</strong> &mdash; vendor
            style number from Syncore.
          </li>
          <li>
            <strong className="text-cg-n-900">Color / Size</strong> &mdash;
            the variant on this line.
          </li>
          <li>
            <strong className="text-cg-n-900">Ordered</strong> &mdash; qty
            on the sales order line.
          </li>
          <li>
            <strong className="text-cg-n-900">Available</strong> &mdash;
            live stock from the vendor. Underneath shows{" "}
            <em>Ships from {`{warehouse}`} &middot; N of M warehouses</em>{" "}
            so you know which warehouse fills it and how many warehouses
            could in total. A multi-warehouse split is shown when no single
            warehouse covers the line.
          </li>
          <li>
            <strong className="text-cg-n-900">Pricing</strong> &mdash; only
            when Costs is on. Shows up to three prices in order: Original
            Price (case price), Sale Price (when active), Program Price
            (CG&rsquo;s contracted rate).
          </li>
          <li>
            <strong className="text-cg-n-900">Verify</strong> &mdash; the
            button on the right. See below.
          </li>
        </ul>

        <p className="text-cg-n-700 leading-relaxed mb-3">
          The header strip lets you flip Costs/Freight on/off without
          retyping the Job ID, and shows the selected Decorator (with ZIP).
        </p>

        <h3 id="verify" className="text-lg font-bold tracking-tight mt-8 mb-2">
          Verifying a line
        </h3>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          Clicking <strong>Verify</strong> on a row captures a snapshot of
          what the vendor showed at that moment: available quantity, the
          warehouse it would ship from, the price, your name and timestamp.
          That snapshot is the audit trail &mdash; if the rep ordered 28
          and the vendor only had 28 when they clicked Verify, the row
          carries proof of that intent.
        </p>
        <ul className="space-y-2 mb-4">
          <li>
            <strong className="text-cg-n-900">Auto-verify</strong> &mdash;
            rows that the vendor can fully fill from a single warehouse get
            auto-verified when the page loads, so you don&rsquo;t have to
            click every clean row by hand. Rows with partial stock, splits,
            or vendor errors require an explicit click.
          </li>
          <li>
            <strong className="text-cg-n-900">Stale flag</strong> &mdash;
            when the live numbers no longer match the verified ones (vendor
            stock changed since you verified), a count appears next to the{" "}
            <em>Clear all verifications</em> button.
          </li>
          <li>
            <strong className="text-cg-n-900">Clear all verifications</strong>{" "}
            &mdash; resets the job to unverified and turns OFF auto-verify
            until you verify lines again manually. Use this when something
            changed and you want a fresh pass with the rep checking each
            row deliberately.
          </li>
        </ul>

        <h3 id="freight" className="text-lg font-bold tracking-tight mt-8 mb-2">
          Freight estimate
        </h3>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          When Freight is on, the page quotes UPS Ground from the
          <strong> selected decorator </strong>(FROM ZIP) to{" "}
          <strong>Color Graphics</strong> (TO ZIP). This is the leg CG
          actually pays. Vendor &rarr; decorator freight is free on orders
          over $200 and isn&rsquo;t quoted here.
        </p>
        <ul className="space-y-2 mb-4">
          <li>
            <strong className="text-cg-n-900">Drop-ship case</strong>{" "}
            &mdash; if the decorator is shipping finished goods directly to
            a customer instead of CG, type the customer&rsquo;s ZIP on the
            search page&rsquo;s &ldquo;Drop-ship to ZIP&rdquo; field. The
            quote then reads &ldquo;Frontier &rarr; ZIP 90210&rdquo;
            instead of &ldquo;Frontier &rarr; Color Graphics&rdquo;.
          </li>
          <li>
            <strong className="text-cg-n-900">Editing on the job page</strong>{" "}
            &mdash; both ZIPs are visible and editable in the freight
            section. Change either one and click <em>Quote freight</em> to
            re-quote.
          </li>
          <li>
            <strong className="text-cg-n-900">Negotiated vs list</strong>{" "}
            &mdash; when UPS returns CG&rsquo;s contracted rate, both are
            shown side by side with the contracted rate as the primary
            number. When UPS doesn&rsquo;t return a negotiated rate, the
            display falls back to list rate times a calibration factor.
          </li>
          <li>
            <strong className="text-cg-n-900">Skipped lines</strong> &mdash;
            if a vendor doesn&rsquo;t return a per-piece weight for a
            variant, that line is excluded from the freight total and the
            detail line says &ldquo;N lines (X pcs) skipped &mdash; no
            vendor weight&rdquo;. The total isn&rsquo;t inflated by
            guesses.
          </li>
        </ul>

        <h3 id="inv-errors" className="text-lg font-bold tracking-tight mt-8 mb-2">
          Common errors on a line
        </h3>
        <ul className="space-y-3 mb-4">
          <li>
            <strong className="text-cg-n-900">Vendor error</strong> &mdash;
            the vendor&rsquo;s API rejected the lookup. Usually means the
            style doesn&rsquo;t exist in their catalog (could be
            discontinued, misspelled, or the supplier on the Syncore line
            is wrong &mdash; e.g. a SanMar style on a line marked S&amp;S).
            Hover the error for the vendor&rsquo;s exact message.
          </li>
          <li>
            <strong className="text-cg-n-900">Ambiguous style</strong>{" "}
            &mdash; only on S&amp;S. Some style numbers (e.g.{" "}
            <code className="rounded bg-cg-n-100 px-1 py-0.5">220</code>) are
            shared by multiple brands (Richardson, SoftShirts, Paragon).
            The app tries to disambiguate using the auto-filled product
            description from the Syncore wizard. If that&rsquo;s missing or
            doesn&rsquo;t name a brand uniquely, you&rsquo;ll see this
            error listing the candidates. Fix the Syncore line so the
            style is brand-prefixed (e.g. &ldquo;Richardson 220&rdquo;).
          </li>
          <li>
            <strong className="text-cg-n-900">No SKU</strong> &mdash; the
            Syncore line has no style number on it. Add one in Syncore.
          </li>
          <li>
            <strong className="text-cg-n-900">Unsupported</strong> &mdash;
            the supplier on the Syncore line is one we don&rsquo;t have an
            adapter for yet (anything other than SanMar, S&amp;S, or Cutter
            &amp; Buck).
          </li>
        </ul>

        <h3 id="inv-faq" className="text-lg font-bold tracking-tight mt-8 mb-2">
          Inventory FAQ
        </h3>
        <FaqItem
          q="Why does the warehouse pick change when I switch decorators?"
          a="Warehouses are ranked by proximity to the decorator's ZIP, because vendors ship blanks to the decorator. Frontier (97002, Aurora OR) and OSI (97232, Portland OR) are both on the West Coast, so the pick is usually similar — but customers shipped from different decorators may see Reno vs Phoenix vs an East-Coast warehouse depending on stock and distance."
        />
        <FaqItem
          q="The vendor's website shows stock in S, but the app says 'Out'. What's going on?"
          a="A few possibilities, in order of likelihood: (1) the vendor returns multiple SKU rows for the same color/size (e.g. a regular SKU and a 'Special Exp' promo SKU). The matcher now picks the best-stocked of the duplicates, but if you're seeing the issue, it's worth a screenshot and a flag. (2) The vendor's aggregate qty is 0 but per-warehouse stock isn't — the matcher now falls back to summing warehouses. (3) Real catalog mismatch — vendor truly has 0 in that variant despite what the website seems to show (sometimes the website lags by a few hours)."
        />
        <FaqItem
          q="The freight estimate is way higher/lower than expected. How is it computed?"
          a="UPS Ground rate from the selected decorator's ZIP to the destination, using each line's per-piece weight (from the vendor) × ordered qty, packed into boxes capped at 70 lb. Lines without a real vendor weight are skipped and called out in the detail line. When UPS returns a negotiated rate (CG's contracted rate), that's the primary number; otherwise it's the published list rate × 0.75 as a rough proxy for the contracted rate."
        />
        <FaqItem
          q="Quotes (vs Jobs)?"
          a="There's a /quotes/[id] route that mirrors the job page for Syncore Quotes, but it depends on a Syncore API endpoint that isn't fully reliable yet. For day-to-day verification, work from the Job ID."
        />
      </section>

      {/* ─────────────── CSR PERFORMANCE ─────────────── */}

      <section id="csr" className="mb-16">
        <h2 className="text-2xl font-extrabold tracking-tight border-b border-cg-n-200 pb-2 mb-6">
          2. CSR Performance
        </h2>
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

        <h3 id="team-summary" className="text-lg font-bold tracking-tight mt-8 mb-2">
          Team summary tiles (top of page)
        </h3>
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

        <h3 id="priority-queue" className="text-lg font-bold tracking-tight mt-8 mb-2">
          Needs attention queue
        </h3>
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

        <h3 id="scorecard" className="text-lg font-bold tracking-tight mt-8 mb-2">
          Per-CSR scorecard
        </h3>
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

        <h3 id="drill-down" className="text-lg font-bold tracking-tight mt-8 mb-2">
          CSR drill-down page
        </h3>
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

        <h3 id="daily-history" className="text-lg font-bold tracking-tight mt-8 mb-2">
          Daily follow-up history table
        </h3>
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

        <h3 id="csr-faq" className="text-lg font-bold tracking-tight mt-8 mb-2">
          CSR Performance FAQ
        </h3>
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
        <a className="text-cg-info hover:underline" href="mailto:kiley@colorgraphicswa.com">
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
