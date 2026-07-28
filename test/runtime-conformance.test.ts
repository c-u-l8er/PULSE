/**
 * Runtime conformance tests — exercise behavioral properties T02–T11
 * by driving an in-process loop simulation against reference manifests.
 *
 * Evidence rung: `in_tree` — the driver simulates phase execution with real
 * state management but does not call out to live substrates.  Observations
 * from source "loop-driver" produce `in_tree`; only observations from a
 * real substrate (source matching the actual system name) earn `live_local`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ManifestValidator } from "../src/schema.ts";
import {
  runConformance,
  type RuntimeObservation,
  type RuntimeObservations,
  type ConformanceReport,
  type TestResult,
} from "../src/conformance.ts";
import { LoopDriver } from "../src/loop-driver.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadManifest(name: string): any {
  const path = resolve(__dirname, "..", "manifests", name);
  return JSON.parse(readFileSync(path, "utf-8"));
}

// ---------------------------------------------------------------------------
// Load reference manifests
// ---------------------------------------------------------------------------
const graphonomous = loadManifest("graphonomous.continual_learning.json");

// ---------------------------------------------------------------------------
// Helper: run conformance with driver observations
// ---------------------------------------------------------------------------
function runWithDriver(
  manifest: any,
  extraObs?: RuntimeObservations,
): { report: ConformanceReport; driver: LoopDriver; normalRun: ReturnType<LoopDriver["runCycle"]>; adverseRun: ReturnType<LoopDriver["runCycle"]> } {
  const driver = new LoopDriver(manifest);
  const normalRun = driver.runCycle({ trace_id: "test-trace-001", workspace_id: "ws-1" });

  // Find a mutating phase to inject failure into for atomicity testing
  const phases: any[] = manifest.phases ?? [];
  const actPhase = phases.find((p: any) => p.kind === "act");
  const adverseRun = actPhase
    ? driver.runCycle({
        trace_id: "test-trace-adverse",
        inject_failure: { phase_id: actPhase.id, error: "injected failure for atomicity test" },
      })
    : driver.runCycle({ trace_id: "test-trace-adverse" });

  // T08: duplicate delivery run — same trace_id to produce duplicate signal ids
  const dupRun = driver.runCycle({ trace_id: "test-trace-001", workspace_id: "ws-1" });

  // T09: substrate degradation — find first null substrate
  const subs = manifest.substrates ?? {};
  const nullSub = Object.entries(subs).find(([, v]) => v == null);
  const degradedRun = nullSub
    ? driver.runCycle({ trace_id: "test-trace-degraded", degrade_substrate: nullSub[0] })
    : undefined;

  // T10: tenant isolation — run in a different workspace
  const isolationRun = manifest.workspace_scope === "required"
    ? driver.runCycle({ trace_id: "test-trace-iso", workspace_id: "ws-2" })
    : undefined;

  const obs = driver.deriveObservations(normalRun, adverseRun, dupRun, degradedRun, isolationRun);
  const merged = { ...obs, ...extraObs };
  const v = new ManifestValidator();
  const schemaResult = v.check(manifest);
  const report = runConformance(manifest, schemaResult, merged);
  return { report, driver, normalRun, adverseRun };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("graphonomous manifest exercises all 5 canonical phase kinds", () => {
  const driver = new LoopDriver(graphonomous);
  const run = driver.runCycle({ trace_id: "phase-kinds-test" });
  const kinds = new Set(run.executions.map((e) => e.kind));
  for (const k of ["retrieve", "route", "act", "learn", "consolidate"]) {
    assert.ok(kinds.has(k), `Expected phase kind '${k}' to be executed`);
  }
  // All should succeed
  const errors = run.executions.filter((e) => e.error);
  assert.equal(errors.length, 0, `Expected no errors, got: ${errors.map((e) => `${e.phase_id}: ${e.error}`).join(", ")}`);
});

test("T02: phase atomicity — failure injection triggers rollback", () => {
  const { report } = runWithDriver(graphonomous);
  const t02 = report.results.find((r) => r.id === "T02")!;
  assert.ok(t02, "T02 result must exist");
  assert.equal(t02.status, "pass", `T02 status: ${t02.rationale}`);
  assert.equal(t02.evidence_rung, "in_tree", "loop-driver observation → in_tree");
  assert.ok(t02.observation, "T02 must have an observation");
  assert.equal(t02.observation!.source, "loop-driver");
  assert.ok(
    t02.observation!.detail!.includes("rolled back"),
    `Expected rollback detail, got: ${t02.observation!.detail}`,
  );
});

test("T03: phase idempotency — replay produces same output for idempotent phases", () => {
  const { report } = runWithDriver(graphonomous);
  const t03 = report.results.find((r) => r.id === "T03")!;
  assert.ok(t03, "T03 result must exist");
  assert.equal(t03.status, "pass", `T03 status: ${t03.rationale}`);
  assert.equal(t03.evidence_rung, "in_tree");
  assert.ok(t03.observation, "T03 must have an observation");
  assert.ok(
    t03.observation!.detail!.includes("idempotent phase"),
    `Expected idempotency detail, got: ${t03.observation!.detail}`,
  );
});

test("T04: nesting waits — inner loops declare wait strategy", () => {
  const { report } = runWithDriver(graphonomous);
  const t04 = report.results.find((r) => r.id === "T04")!;
  assert.ok(t04, "T04 result must exist");
  // Graphonomous has an inner loop with wait: "until_stable"
  assert.equal(t04.status, "pass", `T04 status: ${t04.rationale}`);
  assert.ok(t04.observation, "T04 must have an observation");
});

test("T05: κ-routing — route phase produces routing decision", () => {
  const { report } = runWithDriver(graphonomous);
  const t05 = report.results.find((r) => r.id === "T05")!;
  assert.ok(t05, "T05 result must exist");
  assert.equal(t05.status, "pass", `T05 status: ${t05.rationale}`);
  assert.equal(t05.evidence_rung, "in_tree");
  assert.ok(t05.observation, "T05 must have an observation");
  assert.ok(
    t05.observation!.detail!.includes("kappa="),
    `Expected kappa detail, got: ${t05.observation!.detail}`,
  );
});

test("T06: quorum before commit — not applicable when invariant is false", () => {
  // Graphonomous declares quorum_before_commit: false
  const { report } = runWithDriver(graphonomous);
  const t06 = report.results.find((r) => r.id === "T06")!;
  assert.ok(t06, "T06 result must exist");
  // Should pass as not applicable
  assert.equal(t06.status, "pass");
  assert.equal(t06.evidence_rung, "in_tree");
});

test("T06: quorum before commit — policy check observed when invariant claimed", () => {
  // Create a manifest that claims quorum
  const quorumManifest = {
    ...graphonomous,
    invariants: { ...graphonomous.invariants, quorum_before_commit: true },
  };
  const { report } = runWithDriver(quorumManifest);
  const t06 = report.results.find((r) => r.id === "T06")!;
  assert.ok(t06, "T06 result must exist");
  assert.equal(t06.status, "pass", `T06 status: ${t06.rationale}`);
  assert.equal(t06.evidence_rung, "in_tree");
  assert.ok(t06.observation, "T06 must have an observation");
  assert.ok(
    t06.observation!.detail!.includes("policy check"),
    `Expected policy check detail, got: ${t06.observation!.detail}`,
  );
});

test("T07: append-only audit — audit log is monotonic and non-empty", () => {
  const { report } = runWithDriver(graphonomous);
  const t07 = report.results.find((r) => r.id === "T07")!;
  assert.ok(t07, "T07 result must exist");
  assert.equal(t07.status, "pass", `T07 status: ${t07.rationale}`);
  assert.equal(t07.evidence_rung, "in_tree");
  assert.ok(t07.observation, "T07 must have an observation");
  assert.ok(
    t07.observation!.detail!.includes("monotonic=true"),
    `Expected monotonic audit, got: ${t07.observation!.detail}`,
  );
});

test("T11: trace_id propagation — trace_id present in all audit entries", () => {
  const { report } = runWithDriver(graphonomous);
  const t11 = report.results.find((r) => r.id === "T11")!;
  assert.ok(t11, "T11 result must exist");
  assert.equal(t11.status, "pass", `T11 status: ${t11.rationale}`);
  assert.equal(t11.evidence_rung, "in_tree");
  assert.ok(t11.observation, "T11 must have an observation");
  assert.ok(
    t11.observation!.detail!.includes("test-trace-001"),
    `Expected trace_id in detail, got: ${t11.observation!.detail}`,
  );
});

test("T08: signal deduplication — duplicate delivery detected across runs with same trace_id", () => {
  const { report } = runWithDriver(graphonomous);
  const t08 = report.results.find((r) => r.id === "T08")!;
  assert.ok(t08, "T08 result must exist");
  assert.equal(t08.status, "pass", `T08 status: ${t08.rationale}`);
  assert.equal(t08.evidence_rung, "in_tree", "loop-driver observation → in_tree");
  assert.ok(t08.observation, "T08 must have an observation");
  assert.equal(t08.observation!.source, "loop-driver");
  assert.ok(
    t08.observation!.detail!.includes("duplicate") || t08.observation!.detail!.includes("signal"),
    `Expected dedup detail, got: ${t08.observation!.detail}`,
  );
});

test("T09: substrate degradation — graceful fallback for null substrate", () => {
  // Graphonomous has substrates.time = null
  const { report } = runWithDriver(graphonomous);
  const t09 = report.results.find((r) => r.id === "T09")!;
  assert.ok(t09, "T09 result must exist");
  assert.equal(t09.status, "pass", `T09 status: ${t09.rationale}`);
  assert.equal(t09.evidence_rung, "in_tree", "loop-driver observation → in_tree");
  assert.ok(t09.observation, "T09 must have an observation");
  assert.equal(t09.observation!.source, "loop-driver");
  assert.ok(
    t09.observation!.detail!.includes("degraded") || t09.observation!.detail!.includes("time"),
    `Expected degradation detail, got: ${t09.observation!.detail}`,
  );
});

test("T10: multi-tenant isolation — workspace-scoped runs maintain state isolation", () => {
  // Graphonomous has workspace_scope: "required"
  const { report } = runWithDriver(graphonomous);
  const t10 = report.results.find((r) => r.id === "T10")!;
  assert.ok(t10, "T10 result must exist");
  assert.equal(t10.status, "pass", `T10 status: ${t10.rationale}`);
  assert.equal(t10.evidence_rung, "in_tree", "loop-driver observation → in_tree");
  assert.ok(t10.observation, "T10 must have an observation");
  assert.equal(t10.observation!.source, "loop-driver");
  assert.ok(
    t10.observation!.detail!.includes("ws-1") && t10.observation!.detail!.includes("ws-2"),
    `Expected workspace detail, got: ${t10.observation!.detail}`,
  );
});

test("driver observations produce in_tree evidence, not live_local", () => {
  const { report } = runWithDriver(graphonomous);
  // All observations from loop-driver should be in_tree
  for (const r of report.results) {
    if (r.observation && r.observation.source === "loop-driver") {
      assert.equal(
        r.evidence_rung,
        "in_tree",
        `${r.id} with loop-driver source should be in_tree, got ${r.evidence_rung}`,
      );
    }
  }
});

test("without driver observations, runtime-required tests stay pending", () => {
  const v = new ManifestValidator();
  const schemaResult = v.check(graphonomous);
  // No observations at all
  const report = runConformance(graphonomous, schemaResult);
  const t02 = report.results.find((r) => r.id === "T02")!;
  const t03 = report.results.find((r) => r.id === "T03")!;
  assert.equal(t02.status, "pending", "T02 pending without observations");
  assert.equal(t03.status, "pending", "T03 pending without observations");
});

test("status counts from driver run sum to 12 and are computed, not hard-coded", () => {
  const { report } = runWithDriver(graphonomous);
  const { counts } = report;
  assert.equal(counts.total, 12);
  assert.equal(counts.pass + counts.fail + counts.pending, 12);
  // Verify counts match reality
  const actualPass = report.results.filter((r) => r.status === "pass").length;
  const actualFail = report.results.filter((r) => r.status === "fail").length;
  const actualPending = report.results.filter((r) => r.status === "pending").length;
  assert.equal(counts.pass, actualPass);
  assert.equal(counts.fail, actualFail);
  assert.equal(counts.pending, actualPending);
});

test("adverse run: injecting failure at act phase does not corrupt state", () => {
  const driver = new LoopDriver(graphonomous);
  const normalRun = driver.runCycle({ trace_id: "normal" });
  const adverseRun = driver.runCycle({
    trace_id: "adverse",
    inject_failure: { phase_id: "act_store", error: "disk full" },
  });
  // After failure injection, the act phase should show rolled_back
  const failedAct = adverseRun.executions.find(
    (e) => e.phase_id === "act_store" && e.rolled_back,
  );
  assert.ok(failedAct, "Act phase should show rolled_back after injection");
  assert.ok(failedAct!.error!.includes("disk full"));
});

test("PRISM manifest: custom phase kinds produce no false observations", () => {
  const prism = loadManifest("prism.benchmark.json");
  const driver = new LoopDriver(prism);
  const run = driver.runCycle({ trace_id: "prism-test" });
  // PRISM uses custom kinds (compose, interact, observe, reflect, diagnose)
  // None of the 5 canonical kinds are used, so no canonical phase executions
  const canonicalExecutions = run.executions.filter(
    (e) => ["retrieve", "route", "act", "learn", "consolidate"].includes(e.kind),
  );
  assert.equal(canonicalExecutions.length, 0, "PRISM uses only custom kinds");
  // The driver should not fabricate observations for tests whose behavior it didn't observe
  const obs = driver.deriveObservations(run);
  // T02: phase_atomicity is true in PRISM, but no adverse run, so observation should still exist
  // T05: kappa_routing is false, so no T05 observation
  assert.equal(obs.T05, undefined, "T05 should not be generated when kappa_routing is false");
});

test("report overall is 'pending' when any test is pending, never 'fail' without a failure", () => {
  const v = new ManifestValidator();
  const schemaResult = v.check(graphonomous);
  // Without observations, runtime tests are pending
  const report = runConformance(graphonomous, schemaResult);
  assert.notEqual(report.overall, "fail", "No manifest failures should mean no fail");
  // With full observations, no pending
  const { report: fullReport } = runWithDriver(graphonomous);
  // Check there are no spurious failures
  const failures = fullReport.results.filter((r) => r.status === "fail");
  if (failures.length === 0) {
    const pending = fullReport.results.filter((r) => r.status === "pending");
    if (pending.length === 0) {
      assert.equal(fullReport.overall, "pass");
    } else {
      assert.equal(fullReport.overall, "pending");
    }
  }
});
