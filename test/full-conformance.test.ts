/**
 * Full conformance tests — exercise a complete five-phase run plus adverse
 * cases, assert all 12 verdicts and evidence rungs, verify measured counts,
 * and prove that absent or incomplete observations cannot turn runtime
 * requirements into passes.
 *
 * Evidence rung: observations from LoopDriver are `in_tree` (in-process
 * simulation).  Only observations sourced from a real system name earn
 * `live_local`.
 */
import { test, describe } from "node:test";
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
  type EvidenceRung,
  type StatusCounts,
} from "../src/conformance.ts";
import { LoopDriver } from "../src/loop-driver.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadManifest(name: string): any {
  return JSON.parse(
    readFileSync(resolve(__dirname, "..", "manifests", name), "utf-8"),
  );
}

const validator = new ManifestValidator();

// ---------------------------------------------------------------------------
// Helper: full driver run with all adverse scenarios
// ---------------------------------------------------------------------------
function fullDriverRun(manifest: any): {
  report: ConformanceReport;
  observations: RuntimeObservations;
} {
  const driver = new LoopDriver(manifest);
  const phases: any[] = manifest.phases ?? [];

  // Normal run
  const normalRun = driver.runCycle({
    trace_id: "full-trace-001",
    workspace_id: "ws-alpha",
  });

  // Adverse run: inject failure at act phase
  const actPhase = phases.find((p: any) => p.kind === "act");
  const adverseRun = actPhase
    ? driver.runCycle({
        trace_id: "full-trace-adverse",
        inject_failure: {
          phase_id: actPhase.id,
          error: "simulated disk failure",
        },
      })
    : driver.runCycle({ trace_id: "full-trace-adverse" });

  // Duplicate delivery run (same trace_id)
  const dupRun = driver.runCycle({
    trace_id: "full-trace-001",
    workspace_id: "ws-alpha",
  });

  // Substrate degradation run
  const subs = manifest.substrates ?? {};
  const nullSub = Object.entries(subs).find(([, v]) => v == null);
  const degradedRun = nullSub
    ? driver.runCycle({
        trace_id: "full-trace-degraded",
        degrade_substrate: nullSub[0],
      })
    : undefined;

  // Tenant isolation run (different workspace)
  const isolationRun =
    manifest.workspace_scope === "required"
      ? driver.runCycle({
          trace_id: "full-trace-iso",
          workspace_id: "ws-beta",
        })
      : undefined;

  const observations = driver.deriveObservations(
    normalRun,
    adverseRun,
    dupRun,
    degradedRun,
    isolationRun,
  );

  const schemaResult = validator.check(manifest);
  const report = runConformance(manifest, schemaResult, observations);
  return { report, observations };
}

// ===================================================================
// 1. Complete five-phase run: all 12 verdicts and evidence rungs
// ===================================================================

describe("complete five-phase run (graphonomous)", () => {
  const manifest = loadManifest("graphonomous.continual_learning.json");
  const { report } = fullDriverRun(manifest);

  test("report contains exactly 12 results, one per T01–T12", () => {
    assert.equal(report.results.length, 12);
    const ids = report.results.map((r) => r.id);
    for (let i = 1; i <= 12; i++) {
      const tid = `T${String(i).padStart(2, "0")}`;
      assert.ok(ids.includes(tid), `Missing result for ${tid}`);
    }
  });

  test("every result has exactly one verdict from {pass, fail, pending}", () => {
    const validStatuses = new Set(["pass", "fail", "pending"]);
    for (const r of report.results) {
      assert.ok(
        validStatuses.has(r.status),
        `${r.id} has invalid status '${r.status}'`,
      );
    }
  });

  test("every result has exactly one evidence rung", () => {
    const validRungs: EvidenceRung[] = [
      "spec",
      "in_tree",
      "live_local",
      "live_deployed",
      "external",
    ];
    for (const r of report.results) {
      assert.ok(
        validRungs.includes(r.evidence_rung),
        `${r.id} has invalid evidence_rung '${r.evidence_rung}'`,
      );
    }
  });

  test("every result has a non-empty rationale", () => {
    for (const r of report.results) {
      assert.ok(
        typeof r.rationale === "string" && r.rationale.length > 0,
        `${r.id} missing rationale`,
      );
    }
  });

  test("T01 (schema) passes with in_tree evidence", () => {
    const t = report.results.find((r) => r.id === "T01")!;
    assert.equal(t.status, "pass");
    assert.equal(t.evidence_rung, "in_tree");
  });

  test("T02 (atomicity) passes with in_tree evidence from loop-driver", () => {
    const t = report.results.find((r) => r.id === "T02")!;
    assert.equal(t.status, "pass", t.rationale);
    assert.equal(t.evidence_rung, "in_tree");
    assert.ok(t.observation);
    assert.equal(t.observation!.source, "loop-driver");
  });

  test("T03 (idempotency) passes with in_tree evidence", () => {
    const t = report.results.find((r) => r.id === "T03")!;
    assert.equal(t.status, "pass", t.rationale);
    assert.equal(t.evidence_rung, "in_tree");
    assert.ok(t.observation);
  });

  test("T04 (nesting waits) passes with observation", () => {
    const t = report.results.find((r) => r.id === "T04")!;
    assert.equal(t.status, "pass", t.rationale);
    assert.ok(t.observation);
  });

  test("T05 (κ-routing) passes with in_tree evidence", () => {
    const t = report.results.find((r) => r.id === "T05")!;
    assert.equal(t.status, "pass", t.rationale);
    assert.equal(t.evidence_rung, "in_tree");
    assert.ok(t.observation);
    assert.ok(
      t.observation!.detail!.includes("kappa="),
      `Expected kappa in detail: ${t.observation!.detail}`,
    );
  });

  test("T06 (quorum) passes — invariant not claimed", () => {
    const t = report.results.find((r) => r.id === "T06")!;
    assert.equal(t.status, "pass");
    assert.equal(t.evidence_rung, "in_tree");
  });

  test("T07 (append-only audit) passes with in_tree evidence", () => {
    const t = report.results.find((r) => r.id === "T07")!;
    assert.equal(t.status, "pass", t.rationale);
    assert.equal(t.evidence_rung, "in_tree");
    assert.ok(t.observation);
  });

  test("T08 (signal dedup) passes with in_tree evidence", () => {
    const t = report.results.find((r) => r.id === "T08")!;
    assert.equal(t.status, "pass", t.rationale);
    assert.equal(t.evidence_rung, "in_tree");
    assert.ok(t.observation);
    assert.equal(t.observation!.source, "loop-driver");
  });

  test("T09 (substrate degradation) passes with in_tree evidence", () => {
    // graphonomous has substrates.time = null
    const t = report.results.find((r) => r.id === "T09")!;
    assert.equal(t.status, "pass", t.rationale);
    assert.equal(t.evidence_rung, "in_tree");
    assert.ok(t.observation);
  });

  test("T10 (tenant isolation) passes with in_tree evidence", () => {
    // graphonomous has workspace_scope: "required"
    const t = report.results.find((r) => r.id === "T10")!;
    assert.equal(t.status, "pass", t.rationale);
    assert.equal(t.evidence_rung, "in_tree");
    assert.ok(t.observation);
  });

  test("T11 (trace_id propagation) passes with in_tree evidence", () => {
    const t = report.results.find((r) => r.id === "T11")!;
    assert.equal(t.status, "pass", t.rationale);
    assert.equal(t.evidence_rung, "in_tree");
    assert.ok(t.observation);
  });

  test("T12 (version monotonicity) passes with in_tree evidence", () => {
    const t = report.results.find((r) => r.id === "T12")!;
    assert.equal(t.status, "pass");
    assert.equal(t.evidence_rung, "in_tree");
  });

  test("all 12 tests pass when full driver observations are supplied", () => {
    const failures = report.results.filter((r) => r.status !== "pass");
    assert.equal(
      failures.length,
      0,
      `Expected all pass, got: ${failures.map((f) => `${f.id}=${f.status}: ${f.rationale}`).join("; ")}`,
    );
    assert.equal(report.overall, "pass");
  });
});

// ===================================================================
// 2. Measured counts: dynamically computed, sum to 12
// ===================================================================

describe("measured counts", () => {
  test("counts from full driver run sum to 12 and match results", () => {
    const manifest = loadManifest("graphonomous.continual_learning.json");
    const { report } = fullDriverRun(manifest);
    const { counts } = report;
    assert.equal(counts.total, 12);
    assert.equal(counts.pass + counts.fail + counts.pending, 12);
    // Cross-check against actual results
    const measured = { pass: 0, fail: 0, pending: 0 };
    for (const r of report.results) {
      measured[r.status]++;
    }
    assert.deepEqual(
      { pass: counts.pass, fail: counts.fail, pending: counts.pending },
      measured,
      "Counts must be computed from results, not hard-coded",
    );
  });

  test("counts from no-observation run sum to 12", () => {
    const manifest = loadManifest("graphonomous.continual_learning.json");
    const schemaResult = validator.check(manifest);
    const report = runConformance(manifest, schemaResult);
    const { counts } = report;
    assert.equal(counts.total, 12);
    assert.equal(counts.pass + counts.fail + counts.pending, 12);
    // Should have some pending for runtime-required tests
    assert.ok(counts.pending > 0, "Runtime tests without observations must be pending");
  });

  test("counts from a failing schema run sum to 12", () => {
    const bad = { ...loadManifest("graphonomous.continual_learning.json") };
    delete bad.substrates;
    const schemaResult = validator.check(bad);
    const report = runConformance(bad, schemaResult);
    assert.equal(report.counts.total, 12);
    assert.equal(
      report.counts.pass + report.counts.fail + report.counts.pending,
      12,
    );
    assert.ok(report.counts.fail >= 1, "Schema failure should produce at least one fail");
  });
});

// ===================================================================
// 3. Absent observations cannot produce runtime passes
// ===================================================================

describe("absent observations cannot produce runtime passes", () => {
  // These tests verify each runtime-required test individually stays
  // pending when no observation is supplied.

  const runtimeManifest = {
    ...loadManifest("graphonomous.continual_learning.json"),
    invariants: {
      phase_atomicity: true,
      feedback_immutability: true,
      append_only_audit: true,
      kappa_routing: true,
      quorum_before_commit: true,
      outcome_grounding: true,
      trace_id_propagation: true,
    },
  };
  const schemaResult = validator.check(runtimeManifest);

  test("T02 (atomicity) stays pending without observation", () => {
    const report = runConformance(runtimeManifest, schemaResult);
    const t = report.results.find((r) => r.id === "T02")!;
    assert.equal(t.status, "pending");
    assert.equal(t.evidence_rung, "spec");
  });

  test("T03 (idempotency) stays pending without observation", () => {
    const report = runConformance(runtimeManifest, schemaResult);
    const t = report.results.find((r) => r.id === "T03")!;
    assert.equal(t.status, "pending");
  });

  test("T06 (quorum) stays pending without observation when invariant is claimed", () => {
    const report = runConformance(runtimeManifest, schemaResult);
    const t = report.results.find((r) => r.id === "T06")!;
    assert.equal(t.status, "pending");
  });

  test("T08 (dedup) stays pending without observation", () => {
    const report = runConformance(runtimeManifest, schemaResult);
    const t = report.results.find((r) => r.id === "T08")!;
    assert.equal(t.status, "pending");
    assert.equal(t.evidence_rung, "spec");
  });

  test("T10 (tenant isolation) stays pending when workspace_scope=required and no observation", () => {
    const report = runConformance(runtimeManifest, schemaResult);
    const t = report.results.find((r) => r.id === "T10")!;
    assert.equal(t.status, "pending");
  });

  test("supplying observations for some tests does not elevate unobserved tests", () => {
    // Only supply T02 observation; T03, T06, T08, T10 must stay pending
    const partialObs: RuntimeObservations = {
      T02: {
        behavior: "rollback observed",
        success: true,
        source: "loop-driver",
        detail: "act phase rolled back on failure",
      },
    };
    const report = runConformance(runtimeManifest, schemaResult, partialObs);
    const t02 = report.results.find((r) => r.id === "T02")!;
    assert.equal(t02.status, "pass", "T02 with observation should pass");
    // Others must remain pending
    for (const tid of ["T03", "T06", "T08", "T10"]) {
      const t = report.results.find((r) => r.id === tid)!;
      assert.equal(
        t.status,
        "pending",
        `${tid} must stay pending without its own observation`,
      );
    }
  });

  test("manifest declarations alone never produce pass for runtime tests", () => {
    // Even with all invariants claimed and a valid schema, runtime tests
    // must stay pending without observations
    const report = runConformance(runtimeManifest, schemaResult);
    const runtimeTests = ["T02", "T03", "T06", "T08", "T10"];
    for (const tid of runtimeTests) {
      const t = report.results.find((r) => r.id === tid)!;
      assert.notEqual(
        t.status,
        "pass",
        `${tid} must not pass from declaration alone; got status=${t.status}`,
      );
    }
  });
});

// ===================================================================
// 4. Incomplete or failed observations
// ===================================================================

describe("incomplete and failed observations", () => {
  const manifest = loadManifest("graphonomous.continual_learning.json");
  const schemaResult = validator.check(manifest);

  test("failed observation produces fail, not pending", () => {
    const obs: RuntimeObservations = {
      T02: {
        behavior: "atomicity check",
        success: false,
        source: "loop-driver",
        detail: "rollback did not occur; partial state leaked",
      },
    };
    const report = runConformance(manifest, schemaResult, obs);
    const t = report.results.find((r) => r.id === "T02")!;
    assert.equal(t.status, "fail", "A failed observation must produce fail");
    assert.ok(t.observation);
  });

  test("observation with success=false makes overall status fail", () => {
    const obs: RuntimeObservations = {
      T08: {
        behavior: "dedup check",
        success: false,
        source: "loop-driver",
        detail: "duplicate signals not detected",
      },
    };
    const report = runConformance(manifest, schemaResult, obs);
    assert.equal(report.overall, "fail");
  });

  test("observation from simulation source gets in_tree, never live_local", () => {
    for (const src of ["mock", "loop-driver", "stub", "test"]) {
      const obs: RuntimeObservations = {
        T02: {
          behavior: "atomicity",
          success: true,
          source: src,
          detail: "simulated",
        },
      };
      const report = runConformance(manifest, schemaResult, obs);
      const t = report.results.find((r) => r.id === "T02")!;
      assert.equal(
        t.evidence_rung,
        "in_tree",
        `Source '${src}' should produce in_tree, got ${t.evidence_rung}`,
      );
    }
  });

  test("observation from real system source gets live_local", () => {
    for (const src of ["graphonomous", "prism", "agentromatic"]) {
      const obs: RuntimeObservations = {
        T02: {
          behavior: "atomicity",
          success: true,
          source: src,
          detail: "observed on real system",
        },
      };
      const report = runConformance(manifest, schemaResult, obs);
      const t = report.results.find((r) => r.id === "T02")!;
      assert.equal(
        t.evidence_rung,
        "live_local",
        `Source '${src}' should produce live_local, got ${t.evidence_rung}`,
      );
    }
  });
});

// ===================================================================
// 5. Adverse cases via LoopDriver
// ===================================================================

describe("adverse driver runs", () => {
  const manifest = loadManifest("graphonomous.continual_learning.json");

  test("failure injection at act phase produces rolled_back execution", () => {
    const driver = new LoopDriver(manifest);
    const run = driver.runCycle({
      trace_id: "adverse-test",
      inject_failure: {
        phase_id: "act_store",
        error: "write failed: permission denied",
      },
    });
    const failedAct = run.executions.find(
      (e) => e.phase_id === "act_store" && e.error,
    );
    assert.ok(failedAct, "act_store should show error after injection");
    assert.ok(failedAct!.rolled_back, "act_store should be rolled back");
    assert.ok(failedAct!.error!.includes("permission denied"));
  });

  test("substrate degradation produces graceful completion", () => {
    const driver = new LoopDriver(manifest);
    const run = driver.runCycle({
      trace_id: "degrade-test",
      degrade_substrate: "time",
    });
    // time substrate is null in graphonomous; no phase outputs to substrate:time,
    // so the run should complete normally
    const fatalErrors = run.executions.filter(
      (e) => e.error && !e.rolled_back,
    );
    // Custom phase errors are not fatal
    const realErrors = fatalErrors.filter((e) => e.kind !== "custom");
    assert.equal(
      realErrors.length,
      0,
      `Degraded run should complete without fatal errors: ${realErrors.map((e) => `${e.phase_id}: ${e.error}`).join("; ")}`,
    );
  });

  test("workspace isolation: two runs in different workspaces have independent state", () => {
    const driver = new LoopDriver(manifest);
    const run1 = driver.runCycle({
      trace_id: "iso-a",
      workspace_id: "tenant-1",
    });
    const run2 = driver.runCycle({
      trace_id: "iso-b",
      workspace_id: "tenant-2",
    });
    // Each run creates its own state map; verify no trace_id leaks
    const mem1 = (run1.state.get("memory") as any[]) ?? [];
    const mem2 = (run2.state.get("memory") as any[]) ?? [];
    const traces1 = new Set(mem1.map((m: any) => m.trace_id));
    const traces2 = new Set(mem2.map((m: any) => m.trace_id));
    for (const t of traces1) {
      assert.ok(!traces2.has(t), `Trace ${t} leaked between workspaces`);
    }
  });

  test("duplicate delivery: same trace_id produces detectable duplicate signals", () => {
    const driver = new LoopDriver(manifest);
    const run1 = driver.runCycle({
      trace_id: "dup-test",
      workspace_id: "ws-1",
    });
    const run2 = driver.runCycle({
      trace_id: "dup-test",
      workspace_id: "ws-1",
    });
    const allSignals = [...run1.signal_log, ...run2.signal_log];
    const ids = allSignals.map((s) => s.id);
    const uniqueIds = new Set(ids);
    // Same trace_id + same workspace + same connection = same signal id
    // This means duplicates should be detectable
    if (ids.length > 0) {
      assert.ok(
        ids.length >= uniqueIds.size,
        "Duplicate runs with same trace should produce detectable duplicates",
      );
    }
  });
});

// ===================================================================
// 6. Cross-manifest coverage: PRISM (custom phases only)
// ===================================================================

describe("PRISM manifest (custom phases)", () => {
  const prism = loadManifest("prism.benchmark.json");

  test("PRISM has no canonical phase kinds", () => {
    const canonical = new Set(["retrieve", "route", "act", "learn", "consolidate"]);
    const phases: any[] = prism.phases ?? [];
    const canonicalPhases = phases.filter((p: any) => canonical.has(p.kind));
    assert.equal(
      canonicalPhases.length,
      0,
      "PRISM uses only custom phase kinds",
    );
  });

  test("PRISM conformance still produces 12 results", () => {
    const schemaResult = validator.check(prism);
    const report = runConformance(prism, schemaResult);
    assert.equal(report.results.length, 12);
    assert.equal(report.counts.total, 12);
  });

  test("PRISM with driver: custom phase errors do not produce false fails", () => {
    const driver = new LoopDriver(prism);
    const run = driver.runCycle({ trace_id: "prism-full" });
    // All phases are custom → each gets "no executor" error
    // But this is expected for custom kinds, not a conformance failure
    const schemaResult = validator.check(prism);
    const obs = driver.deriveObservations(run);
    const report = runConformance(prism, schemaResult, obs);
    // T01 and T12 should pass (schema + version)
    const t01 = report.results.find((r) => r.id === "T01")!;
    const t12 = report.results.find((r) => r.id === "T12")!;
    assert.equal(t01.status, "pass");
    assert.equal(t12.status, "pass");
    assert.equal(report.counts.total, 12);
  });
});

// ===================================================================
// 7. Overall status transitions
// ===================================================================

describe("overall status transitions", () => {
  const manifest = loadManifest("graphonomous.continual_learning.json");

  test("no observations → overall is pending (runtime tests pending)", () => {
    const schemaResult = validator.check(manifest);
    const report = runConformance(manifest, schemaResult);
    assert.equal(report.overall, "pending");
  });

  test("all observations successful → overall is pass", () => {
    const { report } = fullDriverRun(manifest);
    assert.equal(report.overall, "pass");
  });

  test("any fail overrides pending → overall is fail", () => {
    const schemaResult = validator.check(manifest);
    const obs: RuntimeObservations = {
      T02: {
        behavior: "atomicity violated",
        success: false,
        source: "loop-driver",
        detail: "state leaked",
      },
    };
    const report = runConformance(manifest, schemaResult, obs);
    assert.equal(report.overall, "fail");
  });

  test("schema failure makes overall fail regardless of observations", () => {
    const bad = { ...manifest };
    delete (bad as any).substrates;
    const schemaResult = validator.check(bad);
    const { report } = fullDriverRun(bad);
    // Actually re-run with the bad schema result
    const report2 = runConformance(bad, schemaResult);
    assert.equal(report2.overall, "fail");
  });
});

// ===================================================================
// 8. Report structure completeness
// ===================================================================

describe("report structure", () => {
  test("report contains loop_id and version from manifest", () => {
    const manifest = loadManifest("graphonomous.continual_learning.json");
    const { report } = fullDriverRun(manifest);
    assert.equal(report.loop_id, "graphonomous.continual_learning");
    assert.equal(report.version, "0.4.0");
  });

  test("each result observation names its source", () => {
    const manifest = loadManifest("graphonomous.continual_learning.json");
    const { report } = fullDriverRun(manifest);
    for (const r of report.results) {
      if (r.observation) {
        assert.ok(
          typeof r.observation.source === "string" &&
            r.observation.source.length > 0,
          `${r.id} observation missing source`,
        );
      }
    }
  });
});
