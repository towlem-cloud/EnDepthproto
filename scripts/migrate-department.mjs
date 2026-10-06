import { getSql } from "../lib/endepth-db.js";
import { migrateDepartment } from "../lib/department-migration.js";
if (process.env.DEPARTMENT_MIGRATION_APPROVED !== "1")
  throw new Error(
    "Compare preview and production database bindings and validate on an isolated copy first. Set DEPARTMENT_MIGRATION_APPROVED=1 only after review.",
  );
try {
  const preserved = await migrateDepartment(getSql());
  console.log(
    `Department schema committed atomically; ${preserved.length} existing tables preserved. No accounts seeded or credentials issued.`,
  );
} catch {
  // Provider errors can contain connection/query details; never print them.
  console.error(
    "Migration completion could not be confirmed. SQL or preservation failures roll back; verify the database binding and schema status before retrying.",
  );
  process.exitCode = 1;
}
