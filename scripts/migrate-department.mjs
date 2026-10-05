import { ensurePilotSchema } from "../lib/endepth-db.js";
import schema from "../lib/department-schema.js";
import { statements } from "../lib/sql-statements.js";
if (!process.env.DEPARTMENT_MIGRATION_APPROVED)
  throw new Error(
    "Compare preview and production database bindings and validate on an isolated copy first. Set DEPARTMENT_MIGRATION_APPROVED=1 only after review.",
  );
const sql = await ensurePilotSchema();
for (const statement of statements(schema)) await sql.query(statement);
console.log(
  "Additive department schema applied; no roster activation or credentials issued.",
);
