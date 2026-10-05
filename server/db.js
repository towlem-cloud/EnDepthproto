import { neon } from '@neondatabase/serverless';

let client;
let testClient;
export function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || '';
}
// Injection is available only to the local automated test process, never via HTTP.
export function setTestSql(sql) {
  if (process.env.NODE_ENV !== 'test') throw new Error('TEST_ONLY');
  testClient = sql;
}
export function previewSchema() {
  // Preview must never fall back to public when production and preview share a DB.
  return process.env.VERCEL_ENV === 'preview' ? 'department_preview_v1' : null;
}
export function getSql() {
  if (testClient) return testClient;
  if (client) return client;
  if (!databaseUrl()) throw new Error('DATABASE_NOT_CONFIGURED');
  const base = neon(databaseUrl());
  const schema = previewSchema();
  if (!schema) return (client = base);
  let ready;
  client = async (strings, ...values) => {
    ready ||= base`CREATE SCHEMA IF NOT EXISTS department_preview_v1`.catch(e => { ready = null; throw e; });
    await ready;
    // A transaction-local path, WITHOUT public, prevents accidental production reads/writes.
    const result = await base.transaction([
      base`SELECT set_config('search_path', ${schema}, true)`,
      base(strings, ...values),
    ]);
    return result[1];
  };
  return client;
}
