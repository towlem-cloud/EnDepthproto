import { writeFile } from "node:fs/promises";
import { migrationSql } from "../lib/department-migration.js";

const preview = `-- Select Neon branch preview/feature/department-tools and database neondb.
-- Run the complete file in the SQL Editor. Do not use this preview validator on main.
-- The reviewed migration runs twice in one transaction. Existing application rows
-- and every preexisting column are compared internally after each pass.
-- Only newly added columns are excluded; no existing authentication or lease
-- fields are ignored. No pilot seeding, account activation, or rotation runs.
-- Results contain table counts and preservation booleans only. Snapshots containing
-- records/credentials stay in temporary tables and disappear at commit/rollback.
-- On error, issue ROLLBACK before retrying. Database name alone cannot identify a branch.
\n`;
const migration = `-- Select the reviewed existing database branch and database in the SQL Editor.
-- Validate on an isolated branch first; database name alone cannot identify a branch.
-- Execute this complete file in one run. It requires the installed pilot schema,
-- applies the reviewed migration once, and commits only if every original row
-- and preexisting column remains unchanged. No account seeding, activation, or
-- credential rotation runs. Results contain counts/preservation booleans only.
-- Temporary snapshots disappear at commit/rollback. On error issue ROLLBACK.
\n`;
await writeFile(
  new URL("./migrate-department.sql", import.meta.url),
  migration + migrationSql(),
);
await writeFile(
  new URL("./validate-department-preview.sql", import.meta.url),
  preview + migrationSql(undefined, 2),
);
