/**
 * Runs before every test file in the worker environment.
 * Creates the D1 tables needed by the licence worker.
 */
import { env } from "cloudflare:test";
import { beforeAll } from "vitest";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id                 TEXT PRIMARY KEY,
  company_name       TEXT NOT NULL,
  contact_email      TEXT NOT NULL,
  licence_key_hash   TEXT,
  licence_key_suffix TEXT,
  tier               TEXT NOT NULL DEFAULT 'starter',
  status             TEXT NOT NULL DEFAULT 'trial',
  expiry_date        TEXT NOT NULL,
  enabled_modules    TEXT NOT NULL DEFAULT '[]',
  enabled_menu_items TEXT NOT NULL DEFAULT '[]',
  features           TEXT NOT NULL DEFAULT '{}',
  llm_config         TEXT NOT NULL DEFAULT '{}',
  machine_fingerprint TEXT,
  last_ping          TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  module      TEXT NOT NULL,
  category    TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'medium',
  enabled     INTEGER NOT NULL DEFAULT 1,
  conditions  TEXT NOT NULL DEFAULT '[]',
  thresholds  TEXT NOT NULL DEFAULT '{}',
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS field_mappings (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  module         TEXT NOT NULL,
  standard_field TEXT NOT NULL,
  standard_label TEXT,
  customer_field TEXT,
  customer_label TEXT,
  data_type      TEXT NOT NULL DEFAULT 'string',
  is_mapped      INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  updated_at     TEXT NOT NULL,
  UNIQUE(tenant_id, module, standard_field),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
`;

beforeAll(async () => {
  const db = (env as unknown as { DB: D1Database }).DB;
  // D1 exec() only accepts one statement at a time
  const statements = SCHEMA
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.exec(stmt);
  }
});
