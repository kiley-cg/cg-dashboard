import { OrderSearch } from "@/components/OrderSearch";

export default function HomePage() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-16">
      <p className="text-cg-red text-xs font-semibold uppercase tracking-wider">
        Jobs
      </p>
      <h1 className="text-4xl font-extrabold tracking-tight mt-2">
        Verify a job
      </h1>
      <p className="text-cg-n-600 mt-3 mb-8 max-w-xl">
        Enter a Syncore Job ID to pull its sales orders and check live vendor
        inventory and pricing.
      </p>
      <OrderSearch />
    </section>
  );
}
