# The Three-Protocol Stack: [&], PULSE, PRISM

This document explains how the three [&] ecosystem protocols compose into
a complete substrate for accountable, evolvable, benchmarkable agent
systems.

```
┌──────────────────────────────────────────────────────────┐
│  PRISM    — measures loops over time      (diagnostic)   │ OS-009
├──────────────────────────────────────────────────────────┤
│  PULSE    — declares loops + circulation   (temporal)    │ OS-010
├──────────────────────────────────────────────────────────┤
│  [&]      — composes capabilities          (structural)  │ AmpersandBoxDesign
└──────────────────────────────────────────────────────────┘
```

## What each layer answers

| Layer  | Question                                          | Artifact                          |
|--------|---------------------------------------------------|-----------------------------------|
| [[&]](../../AmpersandBoxDesign/docs/index.md)    | What can each agent do, and how do they compose?  | `*.ampersand.json`                |
| [PULSE](../../opensentience.org/docs/spec/OS-010-PULSE-SPECIFICATION.md)  | How do their processes cycle and signal each other? | `*.pulse.json` (loop manifest)  |
| [PRISM](../../opensentience.org/docs/spec/OS-009-PRISM-SPECIFICATION.md) | How well do those cycles actually work over time? | Diagnostic reports + leaderboards |

A customer adopting all three writes (at minimum) two files:

```
acme-insurance/
├── acme.ampersand.json   # [&] — capability declarations
└── acme.pulse.json       # PULSE — loop topology + cadence + connections
```

PRISM does not require a separate file — it reads the PULSE manifest
directly to discover phases, signatures, and substrates.

## Three closed loops, three nesting levels

The reference [&] ecosystem already operates with three nested loops:

```
PRISM (outer)        compose → interact → observe → reflect → diagnose
  │
  └─ Graphonomous    retrieve → route → act → learn → consolidate
       │
       └─ Deliberation    survey → triage → dispatch → act → learn
```

PULSE encodes this nesting in the `nesting` block of each manifest:

- `prism.benchmark` declares `inner_loops: [graphonomous.continual_learning]`
- `graphonomous.continual_learning` declares `inner_loops: [graphonomous.deliberate]`
- `graphonomous.deliberate` declares `parent_loop: graphonomous.continual_learning`

OS-008 (Agent Harness, draft) is expected to add a fourth outer layer.
PULSE supports unbounded nesting depth — adding OS-008 is just another
manifest with `inner_loops: [prism.benchmark]`.

## How signals flow

Cross-loop signals carry one of five canonical tokens through
CloudEvents-compatible envelopes:

```
                              ┌────────────────────┐
                              │  ReputationUpdate  │ ────────────────┐
                              └────────────────────┘                  │
                                       ▲                              ▼
                                       │                    ┌──────────────────┐
                              ┌────────┴────────┐           │ fleetprompt.trust │
                              │ OutcomeSignal   │           │  (marketplace)    │
                              └────────┬────────┘           └──────────────────┘
                                       │
        ┌──────────────────────────────┼───────────────────────────┐
        │                              │                            │
        ▼                              ▼                            ▼
┌──────────────┐            ┌──────────────────┐         ┌────────────────────┐
│ graphonomous │ ──signal──▶│  prism.benchmark │         │ agentromatic.delib │
│ (memory loop)│            │ (eval loop)      │         │ (consensus loop)   │
└──────┬───────┘            └────────┬─────────┘         └─────────┬──────────┘
       │                             │                              │
       │ TopologyContext             │ DeliberationResult           │
       ▼                             ▼                              ▼
┌──────────────┐            ┌──────────────────┐         ┌────────────────────┐
│ ConsolidationEvent          (read by other loops as substrate state)        │
└──────────────┘            └──────────────────┘         └────────────────────┘
```

The five tokens are stable for v0.1:

1. `TopologyContext` — emitted by `retrieve`, consumed by `route`
2. `DeliberationResult` — emitted by inner deliberation loops
3. `OutcomeSignal` — emitted by `learn` after action results
4. `ReputationUpdate` — canonical reputation/confidence delta
5. `ConsolidationEvent` — emitted by `consolidate` phases

## Conformance composition

A loop is **PULSE-conforming** if its manifest validates against
`pulse-loop-manifest.v0.1.json` and its runtime passes all 12 conformance
tests.

A system is **PRISM-evaluable** automatically once it is PULSE-conforming
— PRISM's `compose` phase reads the manifest, injects scenarios at the
declared `retrieve` boundary, and observes outcomes via the declared
`learn` phase.

A system is **[&]-composable** if its agents declare capabilities with
matching `accepts_from` / `feeds_into` contracts.

The three layers are independent. A system may adopt one without the
others. Adoption order is typically:

1. **[&]** (capability declarations) — earliest, lowest commitment
2. **PULSE** (loop manifest) — when the system has closed feedback
3. **PRISM** (benchmarking) — when the loop is ready to be measured

## Why three protocols, not one

A monolithic protocol covering capabilities, loops, and benchmarking
would be larger, harder to evolve, and harder to adopt incrementally.
The three-layer split mirrors how HTTP, HTML, and CSS became ubiquitous
separately before converging in the browser.

| Concern                                | Layer  | Cadence of change  |
|----------------------------------------|--------|--------------------|
| What can be done                       | [&]    | months–years       |
| How it cycles                          | PULSE  | weeks–months       |
| How well it works                      | PRISM  | continuous         |

Different rates of change deserve different protocols.

## Related

- [Ecosystem overview](../../ECOSYSTEM.md) — how every product fits the stack
- [Stack status](../../STACK_COMPLETION.md) — versions, test counts, deployment state
- [[&] Protocol docs](../../AmpersandBoxDesign/docs/index.md) — capability composition (structural)
- [OS-010 PULSE specification](../../opensentience.org/docs/spec/OS-010-PULSE-SPECIFICATION.md) — loop + circulation algebra (temporal)
- [OS-009 PRISM specification](../../opensentience.org/docs/spec/OS-009-PRISM-SPECIFICATION.md) — cross-system benchmark (diagnostic)
- [Graphonomous spec](../../graphonomous/docs/spec/README.md) — the reference memory loop these protocols compose around

### PULSE implementation docs

- [Arithmetic Integration](ARITHMETIC_INTEGRATION.md) — how PULSE phases gate on the box-and-box kernel verdict
- [V0.2 Behavioral Types](V0.2-BEHAVIORAL-TYPES.md) — session-typed phase contracts (draft)
- [V0.2 Implementation Plan](V0.2-IMPLEMENTATION-PLAN.md) — roadmap for the v0.2 manifest schema
- [NPM Package](NPM_PACKAGE.md) — the PULSE validator/conformance package
