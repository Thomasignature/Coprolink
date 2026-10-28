import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema.js";
import * as schemaV3 from "./schema-v3.js";

// Keep one runtime schema registry.  V3 tables used to be omitted here even
// though functions imported them directly, which made relational metadata and
// migrations disagree about the effective application model.
export const db = drizzle({ schema: { ...schema, ...schemaV3 } });
