import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import reviewedSchema from "../lib/department-schema.js";
import { migrationSql } from "../lib/department-migration.js";

const migration = readFileSync(new URL("../migrations/department.sql", import.meta.url), "utf8");
const production = readFileSync(new URL("../scripts/migrate-department-production.sql", import.meta.url), "utf8");
const tables = [
  "endepth_teachers", "endepth_assignments", "endepth_submissions",
  "endepth_coach_usage", "endepth_coach_requests", "department_admin",
  "department_sessions", "department_rate_limits", "enscribe_assignments",
  "enscribe_students", "enscribe_revisions", "enscribe_checks",
];

// This is a local PostgreSQL/WASM fixture. No connection URL, external driver,
// environment credential, or hosted database is used by these migration tests.
async function pilot() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE endepth_teachers (
      teacher_id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL, email TEXT NOT NULL,
      code_salt TEXT NOT NULL, code_hash TEXT NOT NULL, active BOOLEAN NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE endepth_assignments (
      assignment_id TEXT PRIMARY KEY, public_slug TEXT UNIQUE NOT NULL,
      teacher_id TEXT NOT NULL, teacher_name TEXT NOT NULL, course TEXT NOT NULL,
      section TEXT NOT NULL DEFAULT '', assignment_title TEXT NOT NULL,
      assignment_date TEXT NOT NULL DEFAULT '', central_question TEXT NOT NULL,
      source_title TEXT NOT NULL DEFAULT '', source_passage TEXT NOT NULL DEFAULT '',
      directions TEXT NOT NULL DEFAULT '', evidence_requirement TEXT NOT NULL DEFAULT '',
      coaching_focus TEXT NOT NULL DEFAULT 'Balanced preparation',
      max_coach_questions INTEGER NOT NULL DEFAULT 4, student_limit INTEGER NOT NULL DEFAULT 17,
      status TEXT NOT NULL DEFAULT 'draft', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
      open_question TEXT NOT NULL DEFAULT '', messages JSONB NOT NULL DEFAULT '[]',
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      assignment_id TEXT, teacher_id TEXT, section TEXT NOT NULL DEFAULT '',
      student_email TEXT NOT NULL DEFAULT '', student_key TEXT
    );
    CREATE TABLE endepth_coach_usage (
      assignment_id TEXT NOT NULL, student_email TEXT NOT NULL,
      successful_count INTEGER NOT NULL DEFAULT 0, in_flight_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(assignment_id,student_email)
    );
    INSERT INTO endepth_teachers(teacher_id,slug,display_name,email,code_salt,code_hash,active)
      VALUES ('teacher-active','active','Synthetic Active','active@example.invalid','original-salt','original-hash',TRUE),
        ('teacher-disabled','disabled','Synthetic Disabled','disabled@example.invalid','disabled-salt','disabled-hash',FALSE);
    INSERT INTO endepth_assignments(assignment_id,public_slug,teacher_id,teacher_name,course,assignment_title,central_question,status)
      VALUES ('assignment-existing','preserved-public-link','teacher-active','Synthetic Active','Synthetic course','Original assignment','Think independently','open');
    INSERT INTO endepth_submissions(submission_id,assignment_key,teacher_name,course,assignment_title,central_question,student_first_name,student_last_name,assignment_id,teacher_id,messages)
      VALUES ('submission-existing','preserved-key','Synthetic Active','Synthetic course','Original assignment','Think independently','Example','Learner','assignment-existing','teacher-active','[{"role":"coach","text":"Preserved history"}]');
    INSERT INTO endepth_coach_usage(assignment_id,student_email,successful_count,in_flight_count)
      VALUES ('assignment-existing','synthetic@example.invalid',3,1);
  `);
  return db;
}

async function snapshot(db, tableNames = tables) {
  return Object.fromEntries(await Promise.all(tableNames.map(async (name) => [
    name,
    (await db.query(`SELECT to_jsonb(t) AS record FROM ${name} t ORDER BY to_jsonb(t)::TEXT`)).rows,
  ])));
}

function receipt(results) {
  const rows = results.find((result) => result.rows?.[0]?.preserved !== undefined)?.rows;
  assert.ok(rows?.length, "Migration returns a preservation receipt");
  for (const row of rows) {
    assert.equal(row.preserved, true, row.table_name);
    assert.equal(row.before_count, row.after_count, row.table_name);
    assert.equal(row.schema_version, 1);
  }
  return rows;
}

async function expectRollback(db, sql, pattern) {
  await assert.rejects(db.exec(sql), pattern);
  await db.exec("ROLLBACK;");
}

test("production artifact contains the shared one-pass guard and exactly the reviewed schema", () => {
  assert.equal(reviewedSchema, migration);
  const start = production.indexOf("BEGIN;\n");
  assert.ok(start > 0, "Production safety instructions precede an explicit transaction");
  assert.equal(production.slice(start), migrationSql());
  assert.equal(production.match(/DO \$department_migration_verify\$/g)?.length, 1);
});

test("production first run preserves pilot records, credentials, links, disabled state and quota", async () => {
  const db = await pilot();
  try {
    const before = await snapshot(db, tables.slice(0, 4));
    const rows = receipt(await db.exec(production));
    assert.equal(rows.length, 4);
    const after = await snapshot(db, tables.slice(0, 4));
    for (const row of after.endepth_teachers) {
      assert.equal(row.record.auth_scheme, "legacy-sha256");
      assert.equal(row.record.credential_version, 1);
      assert.equal(row.record.activation_state, row.record.active ? "active" : "disabled");
      delete row.record.auth_scheme;
      delete row.record.credential_version;
      delete row.record.activation_state;
    }
    for (const row of after.endepth_assignments) {
      assert.equal(row.record.sandbox, false);
      delete row.record.sandbox;
    }
    assert.deepEqual(after, before);
    for (const name of tables.slice(4)) {
      assert.equal((await db.query(`SELECT COUNT(*)::INTEGER AS count FROM ${name}`)).rows[0].count, 0);
    }
    assert.equal((await db.query("SELECT to_regclass('pg_temp.department_migration_before') AS snapshot")).rows[0].snapshot, null);
  } finally {
    await db.close();
  }
});

test("production rerun preserves all existing department data and authentication metadata", async () => {
  const db = await pilot();
  try {
    await db.exec(production);
    await db.exec(`
      UPDATE endepth_teachers SET auth_scheme='scrypt',credential_version=7 WHERE teacher_id='teacher-active';
      INSERT INTO department_admin VALUES (1,'admin-original-hash','admin-original-salt','scrypt',4);
      INSERT INTO department_sessions VALUES ('preserved-session','teacher-active','teacher',7,'2099-01-01');
      INSERT INTO department_rate_limits VALUES ('preserved-bucket',3,'2099-01-01');
      INSERT INTO enscribe_assignments(id,public_slug,teacher_id,title,course,section,prompt,status,sandbox)
        VALUES ('writing-existing','writing-public-link','teacher-active','Writing','Synthetic course','1','Think independently','open',TRUE);
      INSERT INTO enscribe_students(id,assignment_id,token_hash,first_name,last_name,email,original,working,version,successful_checks,in_flight)
        VALUES ('writer-existing','writing-existing','preserved-student-token','Example','Learner','synthetic@example.invalid','Preserved original','Preserved working',2,3,1);
      INSERT INTO enscribe_revisions(id,student_id,version,draft,explanation)
        VALUES ('revision-existing','writer-existing',2,'Preserved working','Preserved explanation');
      INSERT INTO enscribe_checks(student_id,request_id,state,request_hash,academic,lease)
        VALUES ('writer-existing','request-existing','pending','preserved-request-hash','{"question":"Preserved question"}','preserved-writing-lease');
      INSERT INTO endepth_coach_requests(assignment_id,usage_key,request_id,request_hash,lease,state,reply)
        VALUES ('assignment-existing','synthetic@example.invalid','depth-request-existing','preserved-depth-hash','preserved-depth-lease','complete','{"text":"Preserved reply"}');
    `);
    const before = await snapshot(db);
    assert.equal(receipt(await db.exec(production)).length, tables.length + 1);
    assert.deepEqual(await snapshot(db), before);
  } finally {
    await db.close();
  }
});

test("production preservation failure rolls back credential mutation and all additive schema changes", async () => {
  const db = await pilot();
  try {
    const before = await snapshot(db, tables.slice(0, 4));
    const corrupt = production.replace("DO $department_migration_verify$", "UPDATE endepth_teachers SET code_hash='CORRUPTED';\nDO $department_migration_verify$");
    await expectRollback(db, corrupt, /did not preserve existing rows in endepth_teachers/);
    assert.deepEqual(await snapshot(db, tables.slice(0, 4)), before);
    assert.equal((await db.query("SELECT to_regclass('public.department_schema_version') AS marker")).rows[0].marker, null);
    assert.equal((await db.query("SELECT COUNT(*)::INTEGER AS count FROM information_schema.columns WHERE table_name='endepth_teachers' AND column_name='auth_scheme'")).rows[0].count, 0);
  } finally {
    await db.close();
  }
});

test("production rerun detects changes to existing authentication state instead of excluding it", async () => {
  const db = await pilot();
  try {
    await db.exec(production);
    const before = await snapshot(db);
    const corrupt = production.replace("DO $department_migration_verify$", "UPDATE endepth_teachers SET credential_version=99;\nDO $department_migration_verify$");
    await expectRollback(db, corrupt, /did not preserve existing rows in endepth_teachers/);
    assert.deepEqual(await snapshot(db), before);
  } finally {
    await db.close();
  }
});

test("production helper fails closed for missing pilot columns and unknown schema versions", async () => {
  const db = await pilot();
  try {
    await db.exec("ALTER TABLE endepth_teachers DROP COLUMN code_salt;");
    await expectRollback(db, production, /Required pilot column endepth_teachers.code_salt is missing/);
    assert.equal((await db.query("SELECT to_regclass('public.department_schema_version') AS marker")).rows[0].marker, null);
    await db.exec("ALTER TABLE endepth_teachers ADD COLUMN code_salt TEXT NOT NULL DEFAULT 'preserved';");
    await db.exec("CREATE TABLE department_schema_version(id INTEGER PRIMARY KEY,version INTEGER NOT NULL); INSERT INTO department_schema_version VALUES(1,2);");
    await expectRollback(db, production, /did not preserve existing rows in department_schema_version/);
    assert.deepEqual((await db.query("SELECT * FROM department_schema_version")).rows, [{id: 1, version: 2}]);
  } finally {
    await db.close();
  }
});

test("production helper rejects incompatible existing quota columns without changing rows or schema", async () => {
  const db = await pilot();
  try {
    await db.exec("ALTER TABLE endepth_coach_usage DROP COLUMN in_flight_count;");
    const before = await snapshot(db, tables.slice(0, 4));
    await expectRollback(db, production, /Required existing quota column in_flight_count is missing/);
    assert.deepEqual(await snapshot(db, tables.slice(0, 4)), before);
    assert.equal((await db.query("SELECT to_regclass('public.department_schema_version') AS marker")).rows[0].marker, null);
    assert.equal((await db.query("SELECT COUNT(*)::INTEGER AS count FROM information_schema.columns WHERE table_name='endepth_teachers' AND column_name='auth_scheme'")).rows[0].count, 0);
  } finally {
    await db.close();
  }
});
