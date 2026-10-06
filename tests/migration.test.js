import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import reviewedSchema from "../lib/department-schema.js";
import {
  migrationStatements,
  migrateDepartment,
  migrationSql,
} from "../lib/department-migration.js";

// This fixture matches ensurePilotSchema without importing it or running its
// environment-driven teacher seeding. All data and credentials are synthetic.
const pilotSchema = `
CREATE TABLE endepth_teachers (
  teacher_id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
  code_salt TEXT NOT NULL, code_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE endepth_assignments (
  assignment_id TEXT PRIMARY KEY, public_slug TEXT UNIQUE NOT NULL,
  teacher_id TEXT NOT NULL, teacher_name TEXT NOT NULL, course TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT '', assignment_title TEXT NOT NULL,
  assignment_date TEXT NOT NULL DEFAULT '', central_question TEXT NOT NULL,
  source_title TEXT NOT NULL DEFAULT '', source_passage TEXT NOT NULL DEFAULT '',
  directions TEXT NOT NULL DEFAULT '', evidence_requirement TEXT NOT NULL DEFAULT '',
  coaching_focus TEXT NOT NULL DEFAULT 'Balanced preparation',
  max_coach_questions INTEGER NOT NULL DEFAULT 4,
  student_limit INTEGER NOT NULL DEFAULT 17, status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE endepth_submissions (
  submission_id TEXT PRIMARY KEY, assignment_key TEXT NOT NULL,
  teacher_name TEXT NOT NULL, course TEXT NOT NULL, assignment_title TEXT NOT NULL,
  assignment_date TEXT NOT NULL DEFAULT '', central_question TEXT NOT NULL,
  source_title TEXT NOT NULL DEFAULT '', student_first_name TEXT NOT NULL,
  student_last_name TEXT NOT NULL, initial_response TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '', significance TEXT NOT NULL DEFAULT '',
  claim TEXT NOT NULL DEFAULT '', complication TEXT NOT NULL DEFAULT '',
  open_question TEXT NOT NULL DEFAULT '', messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assignment_id TEXT, teacher_id TEXT, section TEXT NOT NULL DEFAULT '',
  student_email TEXT NOT NULL DEFAULT '', student_key TEXT
);
CREATE INDEX endepth_assignments_teacher_updated_idx
  ON endepth_assignments (teacher_id, updated_at DESC);
CREATE INDEX endepth_submissions_assignment_updated_idx
  ON endepth_submissions (assignment_id, updated_at DESC);
CREATE UNIQUE INDEX endepth_submissions_student_key_unique_idx
  ON endepth_submissions (student_key) WHERE student_key IS NOT NULL;
INSERT INTO endepth_teachers VALUES
  ('pilot-active', 'pilot-active-link', 'Synthetic Active', 'active@example.invalid',
   'synthetic-active-salt', 'synthetic-active-hash', TRUE, '2025-01-01Z', '2025-02-01Z'),
  ('pilot-disabled', 'pilot-disabled-link', 'Synthetic Disabled', 'disabled@example.invalid',
   'synthetic-disabled-salt', 'synthetic-disabled-hash', FALSE, '2025-01-02Z', '2025-02-02Z');
INSERT INTO endepth_assignments VALUES
  ('pilot-assignment', 'unchanged-private-depth-link', 'pilot-active', 'Synthetic Active',
   'Synthetic Course', 'Section A', 'Existing pilot assignment', '2025-02-03',
   'Existing question?', 'Existing source', 'Existing passage.', 'Existing directions.',
   'Cite two passages', 'Evidence first', 3, 11, 'open', '2025-01-03Z', '2025-02-03Z'),
  ('disabled-assignment', 'disabled-private-depth-link', 'pilot-disabled', 'Synthetic Disabled',
   'Synthetic Other Course', 'Section B', 'Disabled teacher assignment', '',
   'Preserved disabled question?', '', '', '', '', 'Balanced preparation',
   4, 17, 'closed', '2025-01-04Z', '2025-02-04Z');
INSERT INTO endepth_submissions VALUES
  ('pilot-submission', 'pilot-assignment', 'Synthetic Active', 'Synthetic Course',
   'Existing pilot assignment', '2025-02-03', 'Existing question?', 'Existing source',
   'Synthetic', 'Learner', 'Independent initial response.', 'Original evidence.',
   'Original significance.', 'Original claim.', 'Original complication.',
   'Original open question?', '[{"role":"user","content":"Preserved transcript"}]',
   '2025-02-05Z', '2025-02-06Z', 'pilot-assignment', 'pilot-active', 'Section A',
   'learner@example.invalid', 'pilot-assignment:learner@example.invalid'),
  ('legacy-submission', 'legacy-link-key', 'Synthetic Disabled', 'Legacy Course',
   'Legacy assignment', '', 'Legacy question?', '', 'Legacy', 'Learner',
   'Legacy initial response.', '', '', '', '', '', '[]',
   '2024-02-05Z', '2024-02-06Z', NULL, NULL, '', '', NULL);
`;

const departmentRecords = `
UPDATE endepth_teachers SET auth_scheme='scrypt', credential_version=8
  WHERE teacher_id='pilot-active';
INSERT INTO department_admin VALUES
  (1, 'synthetic-existing-admin-hash', 'synthetic-existing-admin-salt', 'scrypt', 6);
INSERT INTO department_sessions VALUES
  ('synthetic-session-hash', 'pilot-active', 'teacher', 8, '2030-01-01Z');
INSERT INTO department_rate_limits VALUES
  ('synthetic-rate-limit-bucket', 3, '2030-01-02Z');
INSERT INTO enscribe_assignments VALUES
  ('writing-assignment', 'unchanged-private-writing-link', 'pilot-active',
   'Existing writing assignment', 'Synthetic Course', 'Section A', 'Existing writing prompt',
   'Existing instructions', 'Existing rubric', 'Existing timing', 'moderate',
   'open', TRUE, '2025-03-01Z');
INSERT INTO enscribe_students VALUES
  ('writing-student', 'writing-assignment', 'synthetic-student-token-hash',
   'Synthetic', 'Writer', 'writer@example.invalid', 'Immutable original draft.',
   'Existing revised draft.', 'Existing reflection.', 2, NULL, 3, 1);
INSERT INTO enscribe_revisions VALUES
  ('writing-student:1', 'writing-student', 1, 'Immutable original draft.',
   'Initial independent draft.', '2025-03-02Z'),
  ('writing-student:2', 'writing-student', 2, 'Existing revised draft.',
   'Existing explanation.', '2025-03-03Z');
INSERT INTO enscribe_checks VALUES
  ('writing-student', 'writing-request', 'pending', 'synthetic-existing-request-hash',
   '{"draft":"Existing revised draft."}', NULL, '2025-03-04Z', 'synthetic-writing-lease');
INSERT INTO endepth_coach_usage VALUES
  ('pilot-assignment', 'learner@example.invalid', 2, 1, '2025-03-05Z');
INSERT INTO endepth_coach_requests VALUES
  ('pilot-assignment', 'learner@example.invalid', 'depth-request',
   'synthetic-depth-request-hash', 'synthetic-depth-lease', 'pending',
   '{"preserved":"cached response"}', '2025-03-06Z');
CREATE TABLE unrelated_existing_records (label TEXT, payload JSONB);
INSERT INTO unrelated_existing_records VALUES
  ('duplicate', '{"preserved":true}'), ('duplicate', '{"preserved":true}');
CREATE TABLE empty_existing_records (id TEXT, private_state TEXT);
`;

async function isolatedDatabase(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(pilotSchema);
  return db;
}

function quoteIdentifier(value) {
  return '"' + value.replaceAll('"', '""') + '"';
}

async function publicTables(db) {
  return (
    await db.query(`SELECT tablename FROM pg_tables
      WHERE schemaname='public' ORDER BY tablename`)
  ).rows.map((row) => row.tablename);
}

async function snapshot(db) {
  const result = {};
  for (const table of await publicTables(db)) {
    const columns = (
      await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
        [table],
      )
    ).rows.map((row) => row.column_name);
    result[table] = { columns, rows: await snapshotRows(db, table, columns) };
  }
  return result;
}

async function snapshotRows(db, table, columns) {
  const select = columns.map(quoteIdentifier).join(',');
  return (
    await db.query(`SELECT to_jsonb(saved) AS row FROM
      (SELECT ${select} FROM ${quoteIdentifier(table)}) saved
      ORDER BY to_jsonb(saved)::text`)
  ).rows.map((row) => row.row);
}

async function assertPreserved(db, before, exactSchema = false) {
  for (const [table, saved] of Object.entries(before)) {
    assert.deepEqual(
      await snapshotRows(db, table, saved.columns),
      saved.rows,
      `${table}: every preexisting column and row must be preserved`,
    );
  }
  if (exactSchema) assert.deepEqual(await snapshot(db), before);
}

// Neon builds an array of lazy queries in its transaction callback. This
// adapter executes that array in an actual PGlite transaction, including DDL.
function transactionSql(db) {
  const stats = { transactions: 0 };
  const sql = () => {
    throw new Error('Migration must run inside one transaction');
  };
  sql.query = sql;
  sql.transaction = async (build) => {
    stats.transactions += 1;
    assert.equal(typeof build, 'function');
    const transaction = (strings, ...values) => {
      let text = strings[0];
      values.forEach((_, index) => {
        text += '$' + (index + 1) + strings[index + 1];
      });
      return { text, values };
    };
    transaction.query = (text, values = []) => ({ text, values });
    const queries = build(transaction);
    assert.ok(Array.isArray(queries));
    return db.transaction(async (tx) => {
      const result = [];
      for (const query of queries) {
        result.push((await tx.query(query.text, query.values)).rows);
      }
      return result;
    });
  };
  return { sql, stats };
}

async function applySource(db, source) {
  return db.transaction(async (tx) => {
    const results = [];
    for (const statement of migrationStatements(source)) {
      results.push((await tx.query(statement)).rows);
    }
    return results;
  });
}

test('migration succeeds atomically and preserves all existing pilot values, including a disabled teacher', async (t) => {
  const db = await isolatedDatabase(t);
  const before = await snapshot(db);
  const { sql, stats } = transactionSql(db);
  const compiled = migrationStatements();
  assert.ok(compiled.length > 5);
  assert.ok(compiled.every((statement) => typeof statement === 'string'));
  assert.equal(
    compiled.some((statement) => /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/i.test(statement)),
    false,
    'The caller owns transaction boundaries',
  );
  const result = await migrateDepartment(sql);
  assert.equal(stats.transactions, 1);
  assert.deepEqual(result.map((row) => row.table_name), Object.keys(before));
  for (const row of result) {
    assert.equal(Number(row.before_count), before[row.table_name].rows.length);
    assert.equal(Number(row.after_count), Number(row.before_count));
    assert.equal(row.preserved, true);
    assert.equal(row.schema_version, 1);
    assert.deepEqual(Object.keys(row).sort(),
      ['after_count', 'before_count', 'preserved', 'schema_version', 'table_name']);
  }
  await assertPreserved(db, before);
  assert.ok((await publicTables(db)).includes('enscribe_students'));
  assert.ok((await publicTables(db)).includes('endepth_coach_requests'));
  const disabled = (
    await db.query(`SELECT active, activation_state FROM endepth_teachers
      WHERE teacher_id='pilot-disabled'`)
  ).rows[0];
  assert.equal(disabled.active, false);
  assert.equal(disabled.activation_state, 'disabled');
  assert.equal(
    JSON.stringify(result).includes('synthetic-active-hash'),
    false,
    'Migration result must not expose credentials',
  );
  assert.equal(JSON.stringify(result).includes('learner@example.invalid'), false);
});

test('rerunning migration preserves existing module, credential, session, limit, lease and usage records', async (t) => {
  const db = await isolatedDatabase(t);
  await applySource(db, reviewedSchema);
  await db.exec(departmentRecords);
  const before = await snapshot(db);
  const { sql, stats } = transactionSql(db);
  await migrateDepartment(sql);
  await migrateDepartment(sql);
  assert.equal(stats.transactions, 2);
  await assertPreserved(db, before, true);
});

test('missing pilot prerequisites reject without leaving department DDL or altered records', async (t) => {
  for (const missing of ['endepth_teachers', 'endepth_assignments', 'endepth_submissions']) {
    await t.test(missing, async (t) => {
      const db = await isolatedDatabase(t);
      await db.exec(`DROP TABLE ${quoteIdentifier(missing)} CASCADE`);
      const before = await snapshot(db);
      const { sql, stats } = transactionSql(db);
      await assert.rejects(migrateDepartment(sql), /Required pilot table .* is missing/);
      assert.equal(stats.transactions, 1);
      await assertPreserved(db, before, true);
    });
  }
  await t.test('missing required pilot column', async (t) => {
    const db = await isolatedDatabase(t);
    await db.exec('ALTER TABLE endepth_teachers DROP COLUMN email');
    const before = await snapshot(db);
    const { sql } = transactionSql(db);
    await assert.rejects(migrateDepartment(sql), /Required pilot column .* is missing/);
    await assertPreserved(db, before, true);
  });
});

test('an injected SQL failure rolls back all migration DDL and keeps pilot rows unchanged', async (t) => {
  const db = await isolatedDatabase(t);
  const before = await snapshot(db);
  await assert.rejects(
    applySource(db, reviewedSchema + `
      DO $$ BEGIN RAISE EXCEPTION 'INJECTED_SQL_FAILURE'; END $$;`),
    /INJECTED_SQL_FAILURE/,
  );
  await assertPreserved(db, before, true);
  assert.equal((await publicTables(db)).includes('department_schema_version'), false);
});

test('preservation guards reject record drift and roll back preexisting auth, activation and lease fields', async (t) => {
  const db = await isolatedDatabase(t);
  await applySource(db, reviewedSchema);
  await db.exec(departmentRecords);
  const before = await snapshot(db);
  const injections = [
    ['pilot submission', `UPDATE endepth_submissions SET claim='Injected drift'
      WHERE submission_id='pilot-submission';`],
    ['teacher auth scheme', `UPDATE endepth_teachers SET auth_scheme='injected'
      WHERE teacher_id='pilot-active';`],
    ['disabled activation state', `UPDATE endepth_teachers SET activation_state='active'
      WHERE teacher_id='pilot-disabled';`],
    ['credential hash', `UPDATE department_admin SET code_hash='injected' WHERE id=1;`],
    ['session', `DELETE FROM department_sessions;`],
    ['rate limit', `UPDATE department_rate_limits SET attempts=0;`],
    ['writing lease', `UPDATE enscribe_checks SET lease='injected';`],
    ['depth lease', `UPDATE endepth_coach_requests SET lease='injected';`],
    ['coach usage', `UPDATE endepth_coach_usage SET successful_count=0;`],
    ['unrelated existing table', `DELETE FROM unrelated_existing_records
      WHERE ctid IN (SELECT ctid FROM unrelated_existing_records LIMIT 1);`],
    ['new pilot row', `INSERT INTO endepth_teachers
      (teacher_id,slug,display_name,code_salt,code_hash)
      VALUES('injected','injected','Injected','synthetic','synthetic');`],
  ];
  for (const [name, injection] of injections) {
    await t.test(name, async () => {
      await assert.rejects(
        applySource(db, reviewedSchema + `
          CREATE TABLE migration_rollback_marker (id INTEGER);
          ${injection}`),
        /Migration did not preserve existing rows in .*; transaction aborted/,
      );
      await assertPreserved(db, before, true);
      assert.equal((await publicTables(db)).includes('migration_rollback_marker'), false);
    });
  }
  for (const [name, injection, error] of [
    ['removed original column on an empty table',
      'ALTER TABLE empty_existing_records DROP COLUMN private_state;',
      /Existing application column in empty_existing_records was removed/],
    ['removed existing table', 'DROP TABLE unrelated_existing_records;',
      /Existing application table unrelated_existing_records was removed/],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(applySource(db, reviewedSchema + injection), error);
      await assertPreserved(db, before, true);
    });
  }
});

test('generated SQL artifacts contain exactly the reviewed one-pass and two-pass migration bodies', async () => {
  for (const [file, runs] of [
    ['migrate-department.sql', 1],
    ['validate-department-preview.sql', 2],
  ]) {
    const source = await readFile(new URL('../scripts/' + file, import.meta.url), 'utf8');
    const start = source.indexOf('BEGIN;\n');
    assert.ok(start >= 0, `${file}: explicit transaction boundary required`);
    assert.equal(source.slice(start), migrationSql(undefined, runs),
      `${file}: regenerate whenever the reviewed migration changes`);
  }
});

test('complete SQL Editor artifact succeeds and an injected failure rolls back after explicit ROLLBACK', async (t) => {
  const db = await isolatedDatabase(t);
  const before = await snapshot(db);
  const artifact = await readFile(new URL('../scripts/migrate-department.sql', import.meta.url), 'utf8');
  const failing = artifact.replace(/\nCOMMIT;\s*$/, () => `
    DO $$ BEGIN RAISE EXCEPTION 'SQL_EDITOR_INJECTED_FAILURE'; END $$;
    COMMIT;
  `);
  assert.notEqual(failing, artifact);
  await assert.rejects(db.exec(failing), /SQL_EDITOR_INJECTED_FAILURE/);
  await db.exec('ROLLBACK;');
  await assertPreserved(db, before, true);

  await db.exec(artifact);
  await assertPreserved(db, before);
  await db.exec(departmentRecords);
  const existing = await snapshot(db);
  await db.exec(artifact);
  await assertPreserved(db, existing, true);
});
