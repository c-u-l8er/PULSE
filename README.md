# os-pulse

**OpenSentience OS-010 PULSE reference MCP server.**

One of four MCP servers in the [&] three-protocol stack:

| Package        | Role                                     | Install                                                          |
|----------------|------------------------------------------|------------------------------------------------------------------|
| `box-and-box`  | [&] Protocol validator / composer        | `npx -y box-and-box --db ~/.box-and-box/specs.db`                |
| `graphonomous` | Memory loop (5 machines)                 | `npx -y graphonomous --db ~/.graphonomous/knowledge.db`          |
| `os-prism`     | Diagnostic loop (6 machines)             | `npx -y os-prism --db ~/.os-prism/benchmarks.db`                 |
| `os-pulse`     | PULSE manifest registry (**this**)       | `npx -y os-pulse --db ~/.os-pulse/manifests.db`                  |

## What os-pulse does

- Validates `*.pulse.json` loop manifests against `pulse-loop-manifest.v0.1.json`
  (JSON Schema draft 2020-12).
- Runs the 12-test PULSE v0.1 conformance suite and stores the report.
- Persists registered manifests, connections, and phase invocations in an
  embedded SQLite + sqlite-vec database.
- Emits and receives **CloudEvents v1.0 envelopes** for the five canonical
  cross-loop tokens (`TopologyContext`, `DeliberationResult`, `OutcomeSignal`,
  `ReputationUpdate`, `ConsolidationEvent`).
- Exposes 10 MCP tools and 3 resources over stdio.

## MCP tools

| Tool                 | Description                                                           |
|----------------------|-----------------------------------------------------------------------|
| `register_manifest`  | Validate + persist a manifest; runs conformance.                     |
| `validate_manifest`  | Dry-run validation; returns conformance report without persistence.  |
| `list_loops`         | List registered loops, filterable by owner or parent.                |
| `get_manifest`       | Retrieve a full manifest JSON by `loop_id[@version]`.                |
| `resolve_phase`      | Return a phase definition + substrate/invariant scope.               |
| `emit_signal`        | Wrap a token payload in a CloudEvents v1 envelope and persist.        |
| `receive_signal`     | Deliver pending envelopes for a target loop and mark delivered.       |
| `trace_connection`   | Walk outbound connections up to `max_depth`.                          |
| `run_conformance`    | Re-run the 12 conformance tests against a registered loop.           |
| `export_topology`    | Export loops + edges + nesting as JSON or Graphviz DOT.              |

## MCP resources

| URI                            | Returns                                 |
|--------------------------------|-----------------------------------------|
| `pulse://runtime/health`       | Server health + manifest / signal counts. |
| `pulse://manifests/recent`     | Recently registered manifests.          |
| `pulse://signals/recent`       | Recent CloudEvents envelopes.           |

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

## Flags

| Flag             | Default                       |
|------------------|-------------------------------|
| `--db <path>`    | `~/.os-pulse/manifests.db`    |
| `--transport`    | `stdio` (only; HTTP is planned) |
| `--schema-path`  | bundled `pulse-loop-manifest.v0.1.json` |
| `--log-level`    | `info`                        |

## Conformance suite (12 tests)

1. **T01** Schema validation (authoritative — ajv against v0.1 schema)
2. **T02** Phase atomicity
3. **T03** Phase idempotency
4. **T04** Nesting waits
5. **T05** κ-routing
6. **T06** Quorum before commit
7. **T07** Append-only audit
8. **T08** Signal deduplication (runtime-only — returns `pending`)
9. **T09** Substrate degradation
10. **T10** Multi-tenant isolation (runtime-only — returns `pending`)
11. **T11** trace_id propagation
12. **T12** Protocol version monotonicity

Tests that require a running loop to observe runtime behavior return
`pending` in v0.1. Manifest-level checks are exhaustive.

## Build from source

```bash
git clone https://github.com/c-u-l8er/AmpersandBoxDesign
cd AmpersandBoxDesign/PULSE
npm install
npm run build
node bin/os-pulse.js --help
```

## Spec

- [`docs/NPM_PACKAGE.md`](./docs/NPM_PACKAGE.md) — full package specification
- [`schemas/pulse-loop-manifest.v0.1.json`](./schemas/pulse-loop-manifest.v0.1.json) — manifest schema
- [`manifests/`](./manifests/) — reference manifests (graphonomous, prism, agentromatic)
- [OS-010 PULSE Specification](https://opensentience.org/docs/spec/OS-010-PULSE-SPECIFICATION.md)

## License

Apache-2.0
