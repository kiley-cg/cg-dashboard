import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// postgres-js is lazy — it does not open a TCP connection until a query runs.
// At build time DATABASE_URL may not be set; fall back to a dummy DSN so the
// Drizzle adapter can introspect the instance. It will error loudly if a query
// is actually attempted without a real DATABASE_URL at runtime.
const connectionString =
  process.env.DATABASE_URL ?? "postgres://build-placeholder@localhost:5432/none";

const client = postgres(connectionString, { max: 1, prepare: false });

export const db = drizzle(client, { schema });
export { schema };
