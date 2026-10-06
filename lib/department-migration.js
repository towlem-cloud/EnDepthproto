import schema from "./department-schema.js";
import { statements } from "./sql-statements.js";

// These guards run in the database transaction. Record/credential snapshots
// remain in temporary tables and are never returned to the caller.
const prepare = `
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path = public;

CREATE TEMP TABLE department_migration_before (
  table_name TEXT NOT NULL,
  row_data JSONB NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE department_migration_tables (
  table_name TEXT PRIMARY KEY,
  original_columns TEXT[] NOT NULL,
  before_count BIGINT NOT NULL,
  after_count BIGINT,
  preserved BOOLEAN
) ON COMMIT DROP;

DO $department_migration_prepare$
DECLARE
  required RECORD;
  required_column TEXT;
  observed RECORD;
  original_columns TEXT[];
BEGIN
  -- Require the installed pilot schema; never prepare or seed pilot accounts.
  FOR required IN
    SELECT * FROM (VALUES
      ('endepth_teachers', ARRAY[
        'teacher_id','slug','display_name','email','code_salt','code_hash',
        'active','created_at','updated_at'
      ]::TEXT[]),
      ('endepth_assignments', ARRAY[
        'assignment_id','public_slug','teacher_id','teacher_name','course',
        'section','assignment_title','assignment_date','central_question',
        'source_title','source_passage','directions','evidence_requirement',
        'coaching_focus','max_coach_questions','student_limit','status',
        'created_at','updated_at'
      ]::TEXT[]),
      ('endepth_submissions', ARRAY[
        'submission_id','assignment_key','teacher_name','course',
        'assignment_title','assignment_date','central_question','source_title',
        'student_first_name','student_last_name','initial_response','evidence',
        'significance','claim','complication','open_question','messages',
        'submitted_at','updated_at','assignment_id','teacher_id','section',
        'student_email','student_key'
      ]::TEXT[])
    ) AS pilot(table_name, columns)
  LOOP
    IF to_regclass(format('public.%I', required.table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required pilot table % is missing; migration not applied.',
        required.table_name;
    END IF;
    FOREACH required_column IN ARRAY required.columns LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = required.table_name
          AND c.column_name = required_column
      ) THEN
        RAISE EXCEPTION 'Required pilot column %.% is missing; migration not applied.',
          required.table_name, required_column;
      END IF;
    END LOOP;
  END LOOP;

  -- Capture every existing public application table, including future tables.
  -- Locks prevent concurrent record changes between capture and comparison.
  FOR observed IN
    SELECT c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',
      observed.table_name);
  END LOOP;

  FOR observed IN
    SELECT c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    SELECT array_agg(c.column_name::TEXT ORDER BY c.ordinal_position)
      INTO original_columns
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = observed.table_name;
    EXECUTE format(
      'INSERT INTO pg_temp.department_migration_before(table_name,row_data)
       SELECT $1,to_jsonb(t) FROM public.%I t', observed.table_name
    ) USING observed.table_name;
    INSERT INTO pg_temp.department_migration_tables(
      table_name, original_columns, before_count
    ) SELECT observed.table_name, original_columns, count(*)
      FROM pg_temp.department_migration_before b
      WHERE b.table_name = observed.table_name;
  END LOOP;
END;
$department_migration_prepare$;
`;

const verify = `
DO $department_migration_verify$
DECLARE
  observed RECORD;
  current_count BIGINT;
  preserved BOOLEAN;
BEGIN
  FOR observed IN
    SELECT * FROM pg_temp.department_migration_tables ORDER BY table_name
  LOOP
    IF to_regclass(format('public.%I', observed.table_name)) IS NULL THEN
      RAISE EXCEPTION 'Existing application table % was removed; transaction aborted.',
        observed.table_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(observed.original_columns) AS original(column_name)
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = observed.table_name
          AND c.column_name = original.column_name
      )
    ) THEN
      RAISE EXCEPTION 'Existing application column in % was removed; transaction aborted.',
        observed.table_name;
    END IF;
    EXECUTE format($department_migration_comparison$
      WITH current_rows AS MATERIALIZED (
        SELECT (
          SELECT jsonb_object_agg(j.key,j.value)
          FROM jsonb_each(to_jsonb(t)) j
          WHERE j.key = ANY($1)
        ) AS row_data FROM public.%I t
      ), before_rows AS MATERIALIZED (
        SELECT row_data FROM pg_temp.department_migration_before
        WHERE table_name = $2
      ), differences AS (
        (SELECT row_data FROM current_rows
         EXCEPT ALL SELECT row_data FROM before_rows)
        UNION ALL
        (SELECT row_data FROM before_rows
         EXCEPT ALL SELECT row_data FROM current_rows)
      )
      SELECT (SELECT count(*) FROM current_rows),
             NOT EXISTS (SELECT 1 FROM differences)
    $department_migration_comparison$, observed.table_name)
      INTO current_count, preserved
      USING observed.original_columns, observed.table_name;
    IF NOT preserved OR current_count <> observed.before_count THEN
      RAISE EXCEPTION 'Migration did not preserve existing rows in %; transaction aborted.',
        observed.table_name;
    END IF;
    UPDATE pg_temp.department_migration_tables
    SET after_count = current_count, preserved = TRUE
    WHERE table_name = observed.table_name;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM public.department_schema_version WHERE id = 1 AND version = 1
  ) THEN
    RAISE EXCEPTION 'Department schema marker missing; transaction aborted.';
  END IF;
END;
$department_migration_verify$;
`;

const result = `
SELECT table_name, before_count, after_count, preserved,
       (SELECT version FROM public.department_schema_version WHERE id = 1)
         AS schema_version
FROM pg_temp.department_migration_tables
ORDER BY table_name;
`;

export function migrationStatements(source = schema, runs = 1) {
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 2)
    throw new Error("Migration must run once or twice.");
  const queries = statements(prepare);
  for (let run = 0; run < runs; run++)
    queries.push(...statements(source), ...statements(verify));
  return [...queries, ...statements(result)];
}

export async function migrateDepartment(sql) {
  const results = await sql.transaction((tx) =>
    migrationStatements().map((query) => tx.query(query)),
  );
  return results.at(-1);
}

export function migrationSql(source = schema, runs = 1) {
  return ["BEGIN;", ...migrationStatements(source, runs), "COMMIT;"].join("\n\n") + "\n";
}
