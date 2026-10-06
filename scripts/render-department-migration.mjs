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
const production = `-- PRODUCTION migration: apply only to the verified existing Neon main branch.
-- Before running, confirm that the production Vercel deployment resolves to
-- this main branch and the existing database (neondb). A project-level env
-- listing and current_database() cannot prove the effective Neon binding.
-- Create and retain a recovery branch of main before making changes. Record
-- its branch ID and creation time; do not reset, delete, or replace main.
-- First validate the reviewed migration on an isolated branch of production.
-- Use the Neon SQL Editor with main explicitly selected, or a direct
-- (non-pooled) connection to that verified branch and existing database.
-- Execute this complete file once. It applies the reviewed department schema
-- in one transaction with row-preservation assertions, then commits the result.
-- Existing records and credentials are copied only into temporary tables.
-- No account seeding, teacher activation, credential rotation, or quota reset
-- runs. Any failed assertion aborts the transaction; issue ROLLBACK before
-- retrying. An error means the rollout remains pending: do not bypass it.
-- Review the SELECT result: all preserved values must be true, all
-- before_count/after_count pairs equal, and every schema_version must be 1.
-- Confirm COMMIT succeeded before deploying the department application.
-- Keep the recovery branch until hosted authentication and both tools pass.
\n`;
await writeFile(
  new URL("./migrate-department.sql", import.meta.url),
  migration + migrationSql(),
);
await writeFile(
  new URL("./validate-department-preview.sql", import.meta.url),
  preview + migrationSql(undefined, 2),
);
await writeFile(
  new URL("./migrate-department-production.sql", import.meta.url),
  production + migrationSql(),
);
