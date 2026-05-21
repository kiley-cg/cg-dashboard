import Link from "next/link";

export const metadata = {
  title: "Inventory Help · Color Graphics",
};

export default function InventoryHelpPage() {
  return (
    <article className="max-w-4xl mx-auto px-6 py-10">
      <header className="mb-10">
        <Link href="/" className="text-cg-n-500 hover:text-cg-n-900 text-sm">
          ← Back to Inventory
        </Link>
        <p className="text-cg-red text-xs font-semibold uppercase tracking-wider mt-4">
          Help
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight mt-2">
          Inventory Verification
        </h1>
        <p className="text-cg-n-600 mt-3">
          What each part of the inventory tool does and how to use it.
          If you&rsquo;re new, start at the top.
        </p>
      </header>

      <nav className="mb-12 rounded-card border border-cg-n-200 bg-cg-n-50 p-5">
        <p className="text-xs uppercase tracking-wider font-semibold text-cg-n-500 mb-3">
          Contents
        </p>
        <ul className="grid gap-1 sm:grid-cols-2 text-sm">
          <li>
            <a className="text-cg-info hover:underline" href="#search-page">
              The Search page
            </a>
          </li>
          <li>
            <a className="text-cg-info hover:underline" href="#job-page">
              The Job page
            </a>
          </li>
          <li>
            <a className="text-cg-info hover:underline" href="#verify">
              Verifying a line
            </a>
          </li>
          <li>
            <a className="text-cg-info hover:underline" href="#freight">
              Freight estimate
            </a>
          </li>
          <li>
            <a className="text-cg-info hover:underline" href="#errors">
              Common errors
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
        <p className="text-cg-n-700 leading-relaxed mb-4">
          Used by reps to check live vendor stock and pricing for the
          color/size variants on a Syncore job before cutting POs. The page
          pulls the sales orders for a Job ID, calls the right vendor
          (SanMar, S&amp;S, Cutter &amp; Buck) for each line, and shows you
          what&rsquo;s available, where it ships from, and what it costs.
        </p>
      </section>

      <section id="search-page" className="mb-12">
        <h2 className="text-xl font-bold tracking-tight border-b border-cg-n-200 pb-2 mb-4">
          The Search page (home)
        </h2>
        <p className="text-cg-n-700 leading-relaxed mb-3">
          Type a Syncore Job ID (just the number, e.g.{" "}
          <code className="rounded bg-cg-n-100 px-1 py-0.5">32428</code>),
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
      </section>

      <section id="job-page" className="mb-12">
        <h2 className="text-xl font-bold tracking-tight border-b border-cg-n-200 pb-2 mb-4">
          The Job page
        </h2>
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
      </section>

      <section id="verify" className="mb-12">
        <h2 className="text-xl font-bold tracking-tight border-b border-cg-n-200 pb-2 mb-4">
          Verifying a line
        </h2>
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
      </section>

      <section id="freight" className="mb-12">
        <h2 className="text-xl font-bold tracking-tight border-b border-cg-n-200 pb-2 mb-4">
          Freight estimate
        </h2>
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
      </section>

      <section id="errors" className="mb-12">
        <h2 className="text-xl font-bold tracking-tight border-b border-cg-n-200 pb-2 mb-4">
          Common errors on a line
        </h2>
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
      </section>

      <section id="faq" className="mb-12">
        <h2 className="text-xl font-bold tracking-tight border-b border-cg-n-200 pb-2 mb-4">
          FAQ
        </h2>
        <FaqItem
          q="Why does the warehouse pick change when I switch decorators?"
          a="Warehouses are ranked by proximity to the decorator's ZIP, because vendors ship blanks to the decorator. Frontier (97002, Aurora OR) and OSI (97232, Portland OR) are both on the West Coast, so the pick is usually similar — but customers shipped from different decorators may see Reno vs Phoenix vs an East-Coast warehouse depending on stock and distance."
        />
        <FaqItem
          q="The vendor's website shows stock in a size, but the app says 'Out'. What's going on?"
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
