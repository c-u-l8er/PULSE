# os-pulse

**OpenSentience OS-010 PULSE reference MCP server.**

One of three MCP servers in the [&] three-protocol stack:

| Package        | Role                                     | Install                                                          |
|----------------|------------------------------------------|------------------------------------------------------------------|
| `graphonomous` | Memory loop (5 machines)                 | `npx -y graphonomous --db ~/.graphonomous/knowledge.db`          |
| `os-prism`     | Diagnostic loop (6 machines)             | `npx -y os-prism --db ~/.os-prism/benchmarks.db`                 |
| `os-pulse`     | PULSE manifest registry (**this**)       | `npx -y os-pulse --db ~/.os-pulse/manifests.db`                  |

> The `box-and-box` name now belongs to the [&] **governance kernel** (the
> eight-rung arithmetic ladder · 97 property-tested laws — `AmpersandBoxDesign/box-and-box/`),
> not an MCP server. The old `box-and-box` [&] Protocol validator MCP was removed.
> PULSE's invariants + closure guarantees line up with the kernel's alethic and temporal
> rungs — see [`docs/ARITHMETIC_INTEGRATION.md`](./docs/ARITHMETIC_INTEGRATION.md).

## What os-pulse does

- Validates `*.pulse.json` loop manifests against `pulse-loop-manifest.v0.1.json`
  (JSON Schema draft 2020-12).
- Runs the 12-test PULSE v0.1 conformance suite and stores the report.
- Persists registered manifests, connections, and phase invocations in an
  embedded SQLite + sqlite-vec database.
- Emits and receives **CloudEvents v1.0 envelopes** for the six canonical
  cross-loop tokens (`TopologyContext`, `DeliberationResult`, `OutcomeSignal`,
  `ReputationUpdate`, `ConsolidationEvent`, `SurpriseSignal`) plus
  vendor-namespaced tokens (`<vendor>.v<N>.<TokenName>`, PULSE v0.1.2).
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
2. **T02** Phase atomicity (runtime — observed via LoopDriver failure injection)
3. **T03** Phase idempotency (runtime — observed via LoopDriver replay)
4. **T04** Nesting waits (manifest + runtime)
5. **T05** κ-routing (manifest + runtime — observed via route-phase execution)
6. **T06** Quorum before commit (manifest + runtime — observed via policy check)
7. **T07** Append-only audit (manifest + runtime — observed via log verification)
8. **T08** Signal deduplication (runtime — observed via duplicate-trace comparison)
9. **T09** Substrate degradation (runtime — observed via null-substrate fallback)
10. **T10** Multi-tenant isolation (runtime — observed via workspace-scoped runs)
11. **T11** trace_id propagation (manifest + runtime — observed via cross-phase trace)
12. **T12** Protocol version monotonicity (manifest)

Each test reports a verdict (`pass`, `fail`, or `pending`), an evidence rung
(`spec`, `in_tree`, `live_local`, `live_deployed`, or `external`), and a
rationale naming the observation or missing capability behind it.

Manifest-level checks reach `in_tree`. Behavioral observations from the
in-process LoopDriver also reach `in_tree`. Observations from a real
substrate (e.g. Graphonomous, PRISM) reach `live_local`. Tests that lack the
required observation remain `pending` with a rationale identifying the missing
capability.

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
