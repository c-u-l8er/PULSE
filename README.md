# PULSE — Protocol for Uniform Loop State Exchange

**OpenSentience Specification OS-010**

The temporal algebra of the [&] Protocol stack. PULSE declares how closed-loop
agent processes cycle over time, share substrates, and signal each other.

> "[&] composes agents. PRISM measures them. PULSE gives them a heartbeat."

## What PULSE Is

A **manifest standard** (not a runtime) for declaring closed-loop agent
processes. Every [&] portfolio product implements one or more closed loops
(memory consolidation, deliberation, build pipelines, marketplace trust,
etc.). PULSE gives them a uniform way to declare:

- Their **phases** (variable length, canonical or custom kinds)
- Their **cadence** (event, periodic, streaming, idle, cross-loop, manual)
- Their **substrates** (memory, policy, audit, auth, transport, time)
- Their **invariants** (atomicity, idempotency, kappa-routing, quorum, etc.)
- Their **connections** to other loops (CloudEvents-compatible signaling)
- Their **nesting** (arbitrary depth — PRISM contains Graphonomous contains Deliberation)

## Why a Loop Protocol Now

The [&] portfolio contains at least 11 closed-loop processes operating at
cadences from sub-millisecond to monthly. Three nesting levels are already
in production. Without a uniform manifest, every product reinvents phase
ordering, cadence, signaling, and audit correlation.

| Concern                    | Today (per-product)                       | With PULSE                              |
|----------------------------|-------------------------------------------|-----------------------------------------|
| Phase ordering             | Hardcoded in supervision tree             | Declared in `phases[]`                  |
| Cadence                    | Cron, GenServer timer, Broadway, custom   | Declared in `cadence{}`                 |
| Cross-loop signaling       | Phoenix.PubSub, NOTIFY, ad-hoc            | Declared in `connections[]`             |
| Audit correlation          | Per-substrate, no shared trace_id         | Mandated `trace_id` propagation         |
| Reputation semantics       | 5 incompatible definitions                | Canonical `ReputationUpdate` token      |
| PRISM evaluation           | Bespoke per system                        | PRISM reads PULSE manifests directly    |

## The Five Canonical Phase Kinds

| Kind          | Meaning                                                      |
|---------------|--------------------------------------------------------------|
| `retrieve`    | Read from a substrate to gather context for the iteration.   |
| `route`       | Decide what to do next based on retrieved context.           |
| `act`         | Mutate the world or a substrate (write).                     |
| `learn`       | Update beliefs/confidence/reputation from outcome.           |
| `consolidate` | Compress, merge, or promote state across timescales.         |

These match Graphonomous v0.4's machine architecture and PRISM v3.0's phase
taxonomy. Loops with different shapes use `kind: "custom"` with a
`custom_kind` string (e.g., `compose`, `interact`, `observe`, `reflect`,
`diagnose` for PRISM; `bid`, `negotiate`, `elect` for AgenTroMatic).

## The Five Canonical Tokens

Cross-loop signals are typed by one of five canonical tokens:

| Token                 | Emitted By                            | Carries                                  |
|-----------------------|---------------------------------------|------------------------------------------|
| `TopologyContext`     | `retrieve` phases                     | SCC structure + κ value                  |
| `DeliberationResult`  | inner deliberation loops              | Verdict + evidence chain + dissent       |
| `OutcomeSignal`       | `learn` phases                        | Action result + causal attribution       |
| `ReputationUpdate`    | any reputation-touching phase         | Subject delta + calibration              |
| `ConsolidationEvent`  | `consolidate` phases                  | Merged nodes + convergence status        |

## The Seven Invariants

A conforming runtime must enforce all seven for any loop that opts in:

1. **Phase atomicity** — phases complete or roll back; no partial output
2. **Feedback immutability** — `learn` is append-only over confidence
3. **Append-only audit** — every transition is logged with trace_id
4. **κ-routing** — `max_kappa > 0` forces `route → deliberate` (OS-002)
5. **Quorum before commit** — outer `act` waits for inner `DeliberationResult` ≥ threshold
6. **Outcome grounding** — every `act` records `causal_parent_ids` (OS-001)
7. **trace_id propagation** — every substrate call carries trace_id

## The Three-Protocol Stack

```
┌──────────────────────────────────────────────────────────┐
│  PRISM    — measures loops over time      (diagnostic)   │ OS-009
├──────────────────────────────────────────────────────────┤
│  PULSE    — declares loops + circulation   (temporal)    │ OS-010
├──────────────────────────────────────────────────────────┤
│  [&]      — composes capabilities          (structural)  │ AmpersandBoxDesign
└──────────────────────────────────────────────────────────┘
```

## Quick Start (manifest authoring)

A minimal PULSE manifest looks like this:

```jsonc
{
  "$schema": "https://opensentience.org/schemas/pulse-loop-manifest.v0.1.json",
  "pulse_protocol_version": "0.1",
  "loop_id": "myorg.my_loop",
  "version": "0.1.0",
  "owner": "myorg.com",
  "workspace_scope": "required",

  "phases": [
    { "id": "fetch",   "kind": "retrieve", "outputs": { "to": "phase:decide" } },
    { "id": "decide",  "kind": "route",    "outputs": { "to": "phase:apply" } },
    { "id": "apply",   "kind": "act",      "outputs": { "to": "substrate:memory" } },
    { "id": "feedback","kind": "learn",    "outputs": { "to": "substrate:memory" } }
  ],

  "closure": { "from_phase": "feedback", "to_phase": "fetch", "via": "substrate:memory" },

  "cadence": { "type": "event", "params": { "trigger": "external_request" } },

  "substrates": {
    "memory":    "graphonomous://workspace/{ws_id}",
    "policy":    "delegatic://workspace/{ws_id}",
    "audit":     "delegatic://workspace/{ws_id}/audit",
    "auth":      "open_sentience://workspace/{ws_id}",
    "transport": "mcp"
  },

  "invariants": {
    "phase_atomicity":      true,
    "feedback_immutability":true,
    "append_only_audit":    true,
    "outcome_grounding":    true,
    "trace_id_propagation": true
  }
}
```

## Reference Manifests

Three canonical manifests ship with this spec:

| Manifest                  | File                                                  | Phases |
|---------------------------|-------------------------------------------------------|--------|
| Graphonomous CL Loop      | `manifests/graphonomous.continual_learning.json`      | 5      |
| PRISM Benchmark Loop      | `manifests/prism.benchmark.json`                      | 5 (custom) |
| AgenTroMatic Deliberation | `manifests/agentromatic.deliberation.json`            | 7      |

These are the stress tests for the v0.1 schema. If a new field is needed
for a portfolio loop, the schema is incomplete and must be updated before
v0.1 lock.

## Conformance

A runtime claims PULSE v0.1 conformance only if it passes all 12
conformance tests (see spec §12). Tests cover atomicity, idempotency,
nesting waits, κ-routing, quorum, audit, deduplication, signal delivery,
substrate degradation, multi-tenant isolation, trace propagation, and
schema validation.

## Specification

Full spec: [OS-010-PULSE-SPECIFICATION.md](https://opensentience.org/docs/spec/OS-010-PULSE-SPECIFICATION.md)

Lives in the OpenSentience research collection at
`opensentience.org/docs/spec/OS-010-PULSE-SPECIFICATION.md`.

## Status

**v0.1 Draft.** Schema, canonical kinds, tokens, and invariants are
stable for v0.1. Field-level additions are permitted before v1.0; all
v0.1 commitments lock at v1.0 release.

## License

Apache 2.0
