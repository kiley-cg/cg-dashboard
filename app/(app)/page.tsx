import { OrderSearch } from "@/components/OrderSearch";

export default function HomePage() {
  return (
    <section className="max-w-5xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold">Verify a sales order</h1>
      <p className="text-cg-muted mt-2 mb-8">
        Enter a Syncore order number to pull its line items and check live
        vendor inventory.
      </p>
      <OrderSearch />
    </section>
  );
}
