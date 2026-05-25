import Link from "next/link";
import { OrderSearch } from "@/components/OrderSearch";
import { PageHelp } from "./_components/PageHelp";

export default async function HomePage() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
            Jobs
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight mt-2">
            Job Inventory Verification
          </h1>
          <p className="text-cg-n-600 mt-3 mb-8 max-w-xl">
            Enter a Syncore Job ID to pull its sales orders and check live vendor
            inventory and pricing.
          </p>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Link
            href="/help/inventory"
            className="text-cg-info hover:underline text-sm whitespace-nowrap"
          >
            Help &amp; FAQ →
          </Link>
          <PageHelp slug="inventory" title="Inventory check" />
        </div>
      </div>
      <OrderSearch />
    </section>
  );
}
