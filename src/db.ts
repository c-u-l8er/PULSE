/**
 * SQLite schema and open helper for os-pulse.
 *
 * Uses better-sqlite3 for fast synchronous access. The sqlite-vec extension
 * is loaded opportunistically for manifest similarity search; if the
 * extension fails to load the server continues without vector search.
 */
import Database, { type Database as Db } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export type Handle = Db;

export function openDatabase(filePath: string): Handle {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // sqlite-vec is optional — if it fails we keep going.
  try {
    sqliteVec.load(db);
  } catch (err) {
    process.stderr.write(
      `[os-pulse warn] sqlite-vec failed to load (${(err as Error).message}); continuing without vector search\n`,
    );
  }

  db.exec(SCHEMA_SQL);
  return db;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS manifests (
  loop_id                TEXT NOT NULL,
  version                TEXT NOT NULL,
  pulse_protocol_version TEXT NOT NULL,
  owner                  TEXT,
  workspace_scope        TEXT NOT NULL,
  manifest_json          TEXT NOT NULL,
  parent_loop_id         TEXT,
  registered_at          INTEGER NOT NULL,
  conformance_status     TEXT,
  conformance_report     TEXT,
  PRIMARY KEY (loop_id, version)
);

CREATE INDEX IF NOT EXISTS idx_manifests_owner ON manifests(owner);
CREATE INDEX IF NOT EXISTS idx_manifests_parent ON manifests(parent_loop_id);

CREATE TABLE IF NOT EXISTS connections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_loop_id  TEXT NOT NULL,
  from_phase_id TEXT NOT NULL,
  to_loop_id    TEXT NOT NULL,
  to_phase_id   TEXT,
  token_kind    TEXT NOT NULL,
  transport     TEXT NOT NULL,
  cadence       TEXT,
  delivery      TEXT
);

CREATE INDEX IF NOT EXISTS idx_connections_from ON connections(from_loop_id);
CREATE INDEX IF NOT EXISTS idx_connections_to ON connections(to_loop_id);

CREATE TABLE IF NOT EXISTS invocations (
  trace_id      TEXT NOT NULL,
  loop_id       TEXT NOT NULL,
  phase_id      TEXT NOT NULL,
  kind          TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  status        TEXT NOT NULL,
  input_hash    TEXT,
  output_hash   TEXT,
  error_message TEXT,
  PRIMARY KEY (trace_id, loop_id, phase_id, started_at)
);

CREATE TABLE IF NOT EXISTS signals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ce_id          TEXT NOT NULL UNIQUE,
  ce_source      TEXT NOT NULL,
  ce_type        TEXT NOT NULL,
  ce_time        TEXT NOT NULL,
  token_kind     TEXT NOT NULL,
  trace_id       TEXT,
  correlation_id TEXT,
  data_json      TEXT NOT NULL,
  received_at    INTEGER NOT NULL,
  delivered_to   TEXT,
  delivered_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_signals_target ON signals(delivered_to, delivered_at);
CREATE INDEX IF NOT EXISTS idx_signals_token ON signals(token_kind);
`;
