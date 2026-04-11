# os-pulse — NPM Package Specification

**Package**: `os-pulse`
**Version**: `0.1.0` (initial)
**Language**: TypeScript (pure JS, no native Elixir backend)
**License**: Apache-2.0
**Registry**: https://www.npmjs.com/package/os-pulse
**Repository**: `AmpersandBoxDesign/PULSE` (monorepo subdir)

## Purpose

`os-pulse` is the reference MCP server for OS-010 PULSE. It registers and
validates PULSE loop manifests, resolves cross-loop connections, emits and
receives CloudEvents v1 envelopes for the five canonical tokens, and runs
the 12-test conformance suite against any `*.pulse.json` document.

Unlike `graphonomous` and `os-prism`, which wrap Elixir engines via postinstall
escripts, `os-pulse` is **pure TypeScript**. PULSE is a manifest standard, not
a compute engine — everything the reference server needs (schema validation,
SQLite storage, CloudEvents envelopes) is available as pure JS.

## Install

```bash
npx -y os-pulse --db ~/.os-pulse/manifests.db
```

Or in `.mcp.json`:

```jsonc
{
  "mcpServers": {
    "pulse": {
      "command": "npx",
      "args": ["-y", "os-pulse", "--db", "~/.os-pulse/manifests.db"]
    }
  }
}
```

## CLI Flags

| Flag            | Default                         | Description                                        |
|-----------------|---------------------------------|----------------------------------------------------|
| `--db <path>`   | `~/.os-pulse/manifests.db`      | SQLite database path (auto-created).               |
| `--transport`   | `stdio`                         | `stdio` or `http` (Streamable HTTP per MCP 2025-11).|
| `--port <n>`    | `4710`                          | HTTP port (ignored for stdio).                     |
| `--log-level`   | `info`                          | `debug`, `info`, `warn`, `error`.                  |
| `--schema-path` | bundled `pulse-loop-manifest.v0.1.json` | Override bundled schema (for testing).     |
| `--version`     | —                               | Print version and exit.                            |
| `--help`        | —                               | Print help and exit.                               |

## Dependencies

| Dependency                 | Version   | Why                                              |
|----------------------------|-----------|--------------------------------------------------|
| `@modelcontextprotocol/sdk`| `^1.29.0` | Stable v1.x MCP server surface with stdio.       |
| `better-sqlite3`           | `^12.8.0` | Fast synchronous SQLite bindings.                |
| `sqlite-vec`               | `^0.1.10` | Vector index for manifest similarity search.     |
| `ajv`                      | `^8.17.0` | JSON Schema draft 2020-12 validation.            |
| `ajv-formats`              | `^3.0.1`  | `uri`, `date-time`, and other standard formats.  |
| `cloudevents`              | `^8.0.0`  | Official CloudEvents v1.0 TS SDK for envelopes.  |
| `zod`                      | `^3.23.0` | Tool input schemas for MCP registration.         |
| `yargs`                    | `^17.7.0` | CLI argument parsing.                            |

## SQLite Schema

```sql
-- Registered PULSE manifests (one row per loop_id@version).
CREATE TABLE IF NOT EXISTS manifests (
  loop_id               TEXT NOT NULL,
  version               TEXT NOT NULL,
  pulse_protocol_version TEXT NOT NULL,
  owner                 TEXT,
  workspace_scope       TEXT NOT NULL,
  manifest_json         TEXT NOT NULL,             -- full manifest as JSON text
  parent_loop_id        TEXT,                      -- nesting.parent_loop (nullable)
  registered_at         INTEGER NOT NULL,          -- unix epoch seconds
  conformance_status    TEXT,                      -- null | pass | fail | pending
  conformance_report    TEXT,                      -- JSON of failed/passed test names
  PRIMARY KEY (loop_id, version)
);

-- Cross-loop signal connections declared by manifests.
CREATE TABLE IF NOT EXISTS connections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_loop_id    TEXT NOT NULL,
  from_phase_id   TEXT NOT NULL,
  to_loop_id      TEXT NOT NULL,
  to_phase_id     TEXT,
  token_kind      TEXT NOT NULL,                   -- TopologyContext | DeliberationResult | OutcomeSignal | ReputationUpdate | ConsolidationEvent
  transport       TEXT NOT NULL,                   -- mcp | pubsub | http | ...
  FOREIGN KEY (from_loop_id) REFERENCES manifests (loop_id)
);

-- Phase invocation history (trace_id-keyed).
CREATE TABLE IF NOT EXISTS invocations (
  trace_id        TEXT NOT NULL,
  loop_id         TEXT NOT NULL,
  phase_id        TEXT NOT NULL,
  kind            TEXT NOT NULL,                   -- retrieve | route | act | learn | consolidate | custom
  started_at      INTEGER NOT NULL,                -- unix millis
  ended_at        INTEGER,
  status          TEXT NOT NULL,                   -- running | ok | error | rolled_back
  input_hash      TEXT,
  output_hash     TEXT,
  error_message   TEXT,
  PRIMARY KEY (trace_id, loop_id, phase_id, started_at)
);

-- CloudEvents v1 envelopes sent/received.
CREATE TABLE IF NOT EXISTS signals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ce_id           TEXT NOT NULL UNIQUE,            -- CloudEvent id (dedup key)
  ce_source       TEXT NOT NULL,                   -- URI of emitter
  ce_type         TEXT NOT NULL,                   -- e.g. "org.opensentience.pulse.outcome_signal.v1"
  ce_time         TEXT NOT NULL,                   -- RFC3339
  token_kind      TEXT NOT NULL,
  trace_id        TEXT,
  correlation_id  TEXT,
  data_json       TEXT NOT NULL,                   -- token payload
  received_at     INTEGER NOT NULL,
  delivered_to    TEXT                             -- target loop_id if routed
);

-- Vector index over manifest descriptions for similarity search.
CREATE VIRTUAL TABLE IF NOT EXISTS manifest_embeddings USING vec0(
  rowid INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);
```

## MCP Tools Exposed

All tools are registered against the `@modelcontextprotocol/sdk` v1.x server
with zod input schemas and structured output schemas (per MCP 2025-11-25).

| Tool                  | Purpose                                                     |
|-----------------------|-------------------------------------------------------------|
| `register_manifest`   | Validate and persist a `*.pulse.json` manifest.             |
| `validate_manifest`   | Validate (dry-run) without persistence. Returns schema errors. |
| `list_loops`          | List registered loops with filters (owner, kind, parent).   |
| `get_manifest`        | Return full manifest JSON for a `loop_id[@version]`.        |
| `resolve_phase`       | Given a loop + phase id, return the phase definition, substrate URIs, invariants in scope. |
| `emit_signal`         | Package a token payload into a CloudEvents v1 envelope and persist it in `signals`. Optional `to_loop_id` routes to a registered target. |
| `receive_signal`      | Deliver pending signals for a given loop_id (polling API).  |
| `trace_connection`    | Walk outbound `connections` from a loop to discover reachable downstream loops + tokens. |
| `run_conformance`     | Execute the 12-test PULSE v0.1 conformance suite against a manifest. Returns per-test pass/fail + rationale. |
| `export_topology`     | Emit a DOT / JSON graph of registered loops + nesting + connections for visualization. |

## MCP Resources Exposed

| URI                                | Returns                                          |
|------------------------------------|--------------------------------------------------|
| `pulse://runtime/health`           | Server health, manifest counts, signal counts.  |
| `pulse://manifests/recent`         | Recently registered manifests.                  |
| `pulse://signals/recent`           | Recently received CloudEvents envelopes.        |
| `pulse://conformance/{loop_id}`    | Last conformance report for a loop.             |

## Project Layout

```
PULSE/
├── package.json
├── tsconfig.json
├── bin/
│   └── os-pulse.js                 # CLI entry — parses args, boots server
├── src/
│   ├── server.ts                   # MCP server wiring (stdio + http)
│   ├── db.ts                       # better-sqlite3 + sqlite-vec setup + schema
│   ├── validate.ts                 # ajv wrapper for pulse-loop-manifest.v0.1.json
│   ├── tools/
│   │   ├── register_manifest.ts
│   │   ├── validate_manifest.ts
│   │   ├── list_loops.ts
│   │   ├── get_manifest.ts
│   │   ├── resolve_phase.ts
│   │   ├── emit_signal.ts
│   │   ├── receive_signal.ts
│   │   ├── trace_connection.ts
│   │   ├── run_conformance.ts
│   │   └── export_topology.ts
│   ├── resources/
│   │   ├── health.ts
│   │   ├── recent_manifests.ts
│   │   ├── recent_signals.ts
│   │   └── conformance_report.ts
│   ├── conformance/
│   │   ├── index.ts                # 12-test runner
│   │   ├── t01_schema.ts
│   │   ├── t02_atomicity.ts
│   │   ├── ...                     # t03..t12
│   │   └── t12_tenant_isolation.ts
│   ├── cloudevents_tokens.ts       # type defs for 5 canonical tokens
│   └── cli.ts                      # yargs config
├── schemas/
│   └── pulse-loop-manifest.v0.1.json  # symlink/copy of repo-root schema
├── manifests/                      # bundled reference manifests (optional)
└── test/
    └── conformance.test.ts
```

## Build and Publish

```bash
cd PULSE
npm install
npm run build              # tsc → dist/
npm run test               # vitest
npm pack --dry-run         # sanity check
npm publish --access public
```

## Why os-pulse ships first

1. **Smallest scope** — pure JS, no escript wrapper, no native Elixir binary.
2. **Unblocks the others** — `box-and-box`, `graphonomous`, and `os-prism`
   all ship their own PULSE manifests; once `os-pulse` is live they can
   register against a hosted or local instance and prove end-to-end flow.
3. **Cleanest conformance story** — the 12 tests are specified in the PULSE
   spec and can be black-box tested against the reference implementation
   before any other package ships.
