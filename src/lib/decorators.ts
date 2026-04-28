// Color Graphics' main contract decorators. Vendors ship blanks to the
// decorator (free freight on orders over $200 from SanMar/S&S/C&B).
// The decorator decorates and ships finished goods back to CG's Olympia
// shop — that leg is on CG's UPS account, and that's the freight number
// the rep actually needs.
//
// Decorator info lives in Syncore V1; once we wire that up we can pull
// per-job. For now these two cover ~95% of jobs.

export type Decorator = {
  id: string;
  name: string;
  city: string;
  state: string;
  zip: string;
};

export const DECORATORS: Decorator[] = [
  {
    id: "frontier",
    name: "Frontier Screenprinting",
    city: "Aurora",
    state: "OR",
    zip: "97002",
  },
  {
    id: "osi",
    name: "Oregon Screen Impressions",
    city: "Portland",
    state: "OR",
    zip: "97232",
  },
];

export const DEFAULT_DECORATOR_ID = "frontier";

export function decoratorById(id: string | null | undefined): Decorator {
  return (
    DECORATORS.find((d) => d.id === id) ??
    DECORATORS.find((d) => d.id === DEFAULT_DECORATOR_ID) ??
    DECORATORS[0]
  );
}
