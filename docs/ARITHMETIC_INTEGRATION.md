# PULSE × box-and-box — Arithmetic Integration Review

**Status:** review (no schema break) · **Kernel:** `box-and-box` v0.8.0 (8 rungs, 97 laws)
**Scope:** how the PULSE loop-manifest standard (OS-010) relates to the [&] governance
kernel, what already aligns, and what additive wiring is available.

## TL;DR

PULSE and box-and-box are **orthogonal and complementary**. PULSE *sequences a loop
over time* (phases, cadence, substrates, cross-loop signals). box-and-box renders a
**single-decision verdict** — `feasible ▸ permitted ▸ best` over an un-weakenable safety
floor. The kernel governs *what is allowed to happen at* a PULSE phase; it is not itself a
phase or a set of phases. There is **no 1:1 mapping** between the 8 rungs and the 5 phase
kinds — do not introduce one.

The integration surface is small and entirely additive:

1. PULSE's 7 boolean `invariants` are the manifest-level shadow of the kernel's alethic
   **Value families**. They can be *checked* by the kernel but the schema needs no change.
2. `closure.guarantee` is already an LTL fragment — it lines up with the kernel's
   **temporal** rung (rung 4) operators.
3. PULSE V0.2's proposed linear/affine token typing is the kernel's **resource** rung
   (rung 8, the affine ledger) viewed at the manifest layer.
4. A loop *may* declare a phase whose body is "run the kernel verdict" — but PULSE does not
   need a new phase `kind` to express this; it is an ordinary `act`/`route` phase.

## Rung-by-rung alignment

| Kernel rung | PULSE construct that already carries it | Already aligned? |
|---|---|---|
| 1. alethic (`value`) | `invariants` booleans (π/κ/β/σ families); `phase.kind` enumerates what *can* happen | ✅ at manifest level |
| 2. axiological (`score`) | — (PULSE does not rank; PRISM does) | n/a — lives in PRISM |
| 3. deontic (norm/govern) | `substrates.policy`, `substrates.audit`; `quorum_before_commit` | ◻ partial — declared, not enforced by PULSE |
| 4. temporal (LTL ▸ supervise) | `closure.guarantee` (immediate/next_tick/eventual), `cadence` | ✅ direct LTL correspondence |
| 5. reflexive (entrenched ring-0) | the manifest schema itself (which fields may change) | ◻ implicit |
| 6. epistemic (knows ▸ believes) | `OutcomeSignal` / `outcome_grounding` invariant | ◻ partial |
| 7. strategic (coalition power) | multi-loop `connection` graph (who can ensure a signal lands) | ◻ implicit |
| 8. resource (affine ledger) | V0.2 linear/affine token typing (draft) | ◻ draft — this *is* the resource rung |

## Concrete alignments (grounded in the schema)

### 1. The 7 invariants ↔ alethic Value families

`schemas/pulse-loop-manifest.v0.1.json` lines 180–191 declare seven boolean invariants.
Each is the manifest-level assertion of a box-and-box **alethic Value** invariant family:

| PULSE invariant | box-and-box Value family | Meaning |
|---|---|---|
| `phase_atomicity` | **π** (phase ordering) | a phase runs to completion or not at all |
| `kappa_routing` | **κ** (cyclicity) | route on the κ invariant (OS-002) |
| `feedback_immutability` | **β** (no-overwrite) | recorded feedback is never mutated |
| `append_only_audit` | **σ** (provenance) | audit is append-only |
| `outcome_grounding` | **σ** (provenance) | every outcome traces to a cause |
| `trace_id_propagation` | **σ** (provenance) | trace ids flow across phases |
| `quorum_before_commit` | **deontic obligation** (rung 3) | an obligation gate, not an alethic fact |

**Additive wiring (no schema change):** a conformance checker can lift a manifest's
`invariants` object into a kernel `value` and assert the corresponding Value laws
(`L1–L14`). The manifest stays declarative; the kernel becomes the *executable* checker.
`quorum_before_commit` is the one invariant that is genuinely **deontic** (an obligation),
not alethic — worth noting in the spec so it is enforced via the norm rung, not as a fact.

### 2. `closure.guarantee` ↔ temporal rung (rung 4)

PULSE already encodes a three-valued temporal guarantee. It maps directly onto the
kernel's LTL fragment in `temporal.mjs`:

| `closure.guarantee` | LTL operator (rung 4) |
|---|---|
| `immediate` | `X` (next) — closes within the same tick |
| `next_tick` | `X` over the loop's cadence |
| `eventual` | `◇` (eventually) — liveness, no deadline |

This is the cleanest existing alignment: PULSE's cadence + closure guarantee *is* a
temporal-arithmetic obligation. No change required; the spec should simply cite the rung-4
correspondence so loop authors know `eventual` carries only a liveness (not safety) promise.

### 3. V0.2 linear/affine tokens ↔ resource rung (rung 8)

`docs/V0.2-BEHAVIORAL-TYPES.md` drafts linear/affine typing for cross-loop tokens. That is
exactly the kernel's **resource** rung — the affine ledger where a token is either
*depletable* (linear: consumed once) or *reusable* (affine/"of-course": intact after use).
**Recommendation:** when V0.2 lands, name this correspondence explicitly and reuse the
resource-rung vocabulary (`consume`, `0̲` annihilation on overspend) rather than inventing a
parallel one. The kernel's `resource.mjs` (laws `C1–C8`, `CB1–CB3`) is the reference
semantics.

### 4. An optional "verify" gate is just an ordinary phase

A loop that wants the kernel to gate a commit declares a normal `route` or `act` phase
whose body calls `bridge.select(...)`. PULSE needs **no new phase kind** and **no schema
change** — the verdict is a phase *body*, and its result is an ordinary `OutcomeSignal` (or
a `DeliberationResult` when κ>0). Keep the 5 canonical phase kinds intact.

## What this review deliberately does NOT do

- It does **not** add an 8th invariant, a verdict phase kind, or any required field — the
  v0.1 schema is unchanged and remains backward compatible.
- It does **not** claim a rung↔phase-kind bijection (the two are orthogonal axes).
- Enforcement of the deontic/strategic/reflexive rungs stays in the runtime that *hosts*
  the loop (Delegatic for policy/audit), not in the manifest.

## Follow-ups (out of scope here)

- A `pulse-conformance` checker that lifts `invariants` → kernel `value` and runs `L1–L14`.
- Fold the resource-rung vocabulary into the V0.2 linear/affine token spec.
- A worked example manifest annotated with its rung correspondences.

## Reference

- `AmpersandBoxDesign/box-and-box/` — the kernel (run `node test/laws.mjs` → 97 laws)
- `AmpersandBoxDesign/docs/CC2-capability-composition.md` — operators × arithmetics
- `schemas/pulse-loop-manifest.v0.1.json` — the manifest schema (invariants: lines 180–191)
- `docs/V0.2-BEHAVIORAL-TYPES.md` — linear/affine token draft (= resource rung)
