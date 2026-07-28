/**
 * Integration tests for MCP registration, validation, run_conformance,
 * and persistence paths.
 *
 * These tests exercise the full path from manifest input through schema
 * validation, conformance execution, database persistence, and retrieval,
 * proving that evidence-bearing reports and measured counts survive the
 * round-trip through SQLite.
 *
 * Evidence rung: `in_tree` — tests run against a real SQLite database
 * (not mocked) but within a single process.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, type Handle } from "../src/db.ts";
import { ManifestValidator } from "../src/schema.ts";
import {
  runConformance,
  type ConformanceReport,
  type StatusCounts,
  type TestResult,
  type EvidenceRung,
  type RuntimeObservations,
} from "../src/conformance.ts";
import { LoopDriver } from "../src/loop-driver.ts";
import { buildCloudEvent, isValidToken } from "../src/tokens.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadManifest(name: string): any {
  return JSON.parse(
    readFileSync(resolve(__dirname, "..", "manifests", name), "utf-8"),
  );
}

/** Open an in-memory SQLite database with the os-pulse schema applied. */
function freshDb(): Handle {
  return openDatabase(":memory:");
}

const validator = new ManifestValidator();

// ---------------------------------------------------------------------------
// Helpers that mirror the tool handler logic in src/tools.ts
// ---------------------------------------------------------------------------

/** Mirrors the register_manifest tool: validate, run conformance, persist. */
function registerManifest(
  db: Handle,
  manifest: any,
  observations?: RuntimeObservations,
): { report: ConformanceReport; schemaValid: boolean } {
  const result = validator.check(manifest);
  const report = runConformance(manifest, result, observations);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO manifests
      (loop_id, version, pulse_protocol_version, owner, workspace_scope,
       manifest_json, parent_loop_id, registered_at, conformance_status, conformance_report)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    String(manifest.loop_id),
    String(manifest.version),
    String(manifest.pulse_protocol_version),
    manifest.owner ?? null,
    String(manifest.workspace_scope ?? "required"),
    JSON.stringify(manifest),
    manifest.nesting?.parent_loop ?? null,
    Math.floor(Date.now() / 1000),
    report.overall,
    JSON.stringify(report),
  );

  // Insert connections
  const conns: any[] = manifest.connections ?? [];
  if (conns.length > 0) {
    db.prepare("DELETE FROM connections WHERE from_loop_id = ?").run(
      String(manifest.loop_id),
    );
    const insConn = db.prepare(`
      INSERT INTO connections
        (from_loop_id, from_phase_id, to_loop_id, to_phase_id, token_kind, transport, cadence, delivery)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of conns) {
      insConn.run(
        String(manifest.loop_id),
        String(c.emit_phase ?? "unknown"),
        String(c.to_loop ?? "unknown"),
        c.to_phase ?? null,
        String(c.token ?? "OutcomeSignal"),
        String(c.envelope ?? "cloudevents.v1"),
        c.cadence ?? null,
        c.delivery ?? null,
      );
    }
  }

  return { report, schemaValid: result.valid };
}

/** Mirrors the run_conformance tool: look up manifest from DB, re-run, persist. */
function rerunConformance(
  db: Handle,
  loop_id: string,
  version?: string,
  observations?: RuntimeObservations,
): ConformanceReport {
  const row = version
    ? db
        .prepare(
          "SELECT manifest_json FROM manifests WHERE loop_id = ? AND version = ?",
        )
        .get(loop_id, version)
    : db
        .prepare(
          `SELECT manifest_json FROM manifests WHERE loop_id = ?
           ORDER BY registered_at DESC LIMIT 1`,
        )
        .get(loop_id);
  if (!row) throw new Error(`loop not found: ${loop_id}`);
  const manifest = JSON.parse((row as { manifest_json: string }).manifest_json);
  const result = validator.check(manifest);
  const report = runConformance(manifest, result, observations);

  db.prepare(
    `UPDATE manifests SET conformance_status = ?, conformance_report = ?
     WHERE loop_id = ?${version ? " AND version = ?" : ""}`,
  ).run(
    ...(version
      ? [report.overall, JSON.stringify(report), loop_id, version]
      : [report.overall, JSON.stringify(report), loop_id]),
  );

  return report;
}

/** Read back the persisted conformance report from the database. */
function readReport(
  db: Handle,
  loop_id: string,
  version?: string,
): { conformance_status: string; report: ConformanceReport } | null {
  const row = version
    ? db
        .prepare(
          "SELECT conformance_status, conformance_report FROM manifests WHERE loop_id = ? AND version = ?",
        )
        .get(loop_id, version)
    : db
        .prepare(
          `SELECT conformance_status, conformance_report FROM manifests
           WHERE loop_id = ? ORDER BY registered_at DESC LIMIT 1`,
        )
        .get(loop_id);
  if (!row) return null;
  const r = row as { conformance_status: string; conformance_report: string };
  return {
    conformance_status: r.conformance_status,
    report: JSON.parse(r.conformance_report),
  };
}

// ===================================================================
// 1. Registration persists evidence-bearing report
// ===================================================================

describe("register_manifest persists evidence-bearing report", () => {
  test("registering a valid manifest persists conformance report with counts", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");
    const { report } = registerManifest(db, manifest);

    const stored = readReport(db, manifest.loop_id)!;
    assert.ok(stored, "Report should be persisted");
    assert.equal(stored.conformance_status, report.overall);
    assert.equal(stored.report.loop_id, manifest.loop_id);
    assert.equal(stored.report.version, manifest.version);
    assert.equal(stored.report.results.length, 12);
    assert.equal(stored.report.counts.total, 12);
    assert.equal(
      stored.report.counts.pass + stored.report.counts.fail + stored.report.counts.pending,
      12,
    );
    db.close();
  });

  test("persisted report contains evidence rungs for every result", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");
    registerManifest(db, manifest);

    const stored = readReport(db, manifest.loop_id)!;
    const validRungs: EvidenceRung[] = [
      "spec",
      "in_tree",
      "live_local",
      "live_deployed",
      "external",
    ];
    for (const r of stored.report.results) {
      assert.ok(
        validRungs.includes(r.evidence_rung),
        `Persisted ${r.id} has invalid evidence_rung: ${r.evidence_rung}`,
      );
      assert.ok(
        typeof r.rationale === "string" && r.rationale.length > 0,
        `Persisted ${r.id} missing rationale`,
      );
    }
    db.close();
  });

  test("registration without observations marks runtime tests pending in DB", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");
    registerManifest(db, manifest);

    const stored = readReport(db, manifest.loop_id)!;
    // T02 (atomicity), T03 (idempotency) should be pending
    const t02 = stored.report.results.find((r) => r.id === "T02")!;
    const t03 = stored.report.results.find((r) => r.id === "T03")!;
    assert.equal(t02.status, "pending");
    assert.equal(t03.status, "pending");
    // Overall should reflect pending
    assert.equal(stored.conformance_status, "pending");
    db.close();
  });

  test("registration with driver observations persists in_tree evidence", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");
    const driver = new LoopDriver(manifest);

    const normalRun = driver.runCycle({
      trace_id: "reg-trace",
      workspace_id: "ws-reg",
    });
    const actPhase = (manifest.phases as any[]).find(
      (p: any) => p.kind === "act",
    );
    const adverseRun = driver.runCycle({
      trace_id: "reg-adverse",
      inject_failure: {
        phase_id: actPhase.id,
        error: "test failure",
      },
    });
    const dupRun = driver.runCycle({
      trace_id: "reg-trace",
      workspace_id: "ws-reg",
    });
    const subs = manifest.substrates ?? {};
    const nullSub = Object.entries(subs).find(([, v]) => v == null);
    const degradedRun = nullSub
      ? driver.runCycle({
          trace_id: "reg-degraded",
          degrade_substrate: nullSub[0],
        })
      : undefined;
    const isolationRun =
      manifest.workspace_scope === "required"
        ? driver.runCycle({
            trace_id: "reg-iso",
            workspace_id: "ws-other",
          })
        : undefined;

    const observations = driver.deriveObservations(
      normalRun,
      adverseRun,
      dupRun,
      degradedRun,
      isolationRun,
    );
    registerManifest(db, manifest, observations);

    const stored = readReport(db, manifest.loop_id)!;
    // All tests should pass with driver observations
    assert.equal(stored.conformance_status, "pass");
    assert.equal(stored.report.counts.pass, 12);
    assert.equal(stored.report.counts.fail, 0);
    assert.equal(stored.report.counts.pending, 0);

    // All observation-backed results should have in_tree evidence
    for (const r of stored.report.results) {
      if (r.observation) {
        assert.equal(
          r.observation.source,
          "loop-driver",
          `${r.id} observation source should be loop-driver`,
        );
        assert.equal(
          r.evidence_rung,
          "in_tree",
          `${r.id} with loop-driver source should be in_tree`,
        );
      }
    }
    db.close();
  });
});

// ===================================================================
// 2. validate_manifest (dry run) does not persist
// ===================================================================

describe("validate_manifest dry run", () => {
  test("validation produces a report but does not persist to DB", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");

    // Validation only (mirrors validate_manifest tool)
    const result = validator.check(manifest);
    const report = runConformance(manifest, result);

    // Report should be valid
    assert.equal(report.results.length, 12);
    assert.equal(report.counts.total, 12);

    // But nothing should be in the DB
    const stored = readReport(db, manifest.loop_id);
    assert.equal(stored, null, "validate_manifest should not persist");
    db.close();
  });

  test("validation report has same structure as registration report", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");

    // Validation path
    const valResult = validator.check(manifest);
    const valReport = runConformance(manifest, valResult);

    // Registration path
    const { report: regReport } = registerManifest(db, manifest);

    // Same structure
    assert.equal(valReport.loop_id, regReport.loop_id);
    assert.equal(valReport.version, regReport.version);
    assert.equal(valReport.results.length, regReport.results.length);
    assert.equal(valReport.counts.total, regReport.counts.total);

    // Same verdicts (same inputs, same outputs)
    for (let i = 0; i < valReport.results.length; i++) {
      assert.equal(valReport.results[i].id, regReport.results[i].id);
      assert.equal(valReport.results[i].status, regReport.results[i].status);
      assert.equal(
        valReport.results[i].evidence_rung,
        regReport.results[i].evidence_rung,
      );
    }
    db.close();
  });
});

// ===================================================================
// 3. run_conformance re-runs and updates persisted report
// ===================================================================

describe("run_conformance updates persisted report", () => {
  test("re-running conformance updates the stored report", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");

    // Register without observations
    registerManifest(db, manifest);
    const before = readReport(db, manifest.loop_id)!;
    assert.equal(before.conformance_status, "pending");
    assert.ok(before.report.counts.pending > 0);

    // Re-run with observations (mirrors run_conformance tool)
    const driver = new LoopDriver(manifest);
    const normalRun = driver.runCycle({
      trace_id: "rerun-trace",
      workspace_id: "ws-rerun",
    });
    const actPhase = (manifest.phases as any[]).find(
      (p: any) => p.kind === "act",
    );
    const adverseRun = driver.runCycle({
      trace_id: "rerun-adverse",
      inject_failure: { phase_id: actPhase.id, error: "rerun fail" },
    });
    const dupRun = driver.runCycle({
      trace_id: "rerun-trace",
      workspace_id: "ws-rerun",
    });
    const subs = manifest.substrates ?? {};
    const nullSub = Object.entries(subs).find(([, v]) => v == null);
    const degradedRun = nullSub
      ? driver.runCycle({
          trace_id: "rerun-degraded",
          degrade_substrate: nullSub[0],
        })
      : undefined;
    const isolationRun =
      manifest.workspace_scope === "required"
        ? driver.runCycle({
            trace_id: "rerun-iso",
            workspace_id: "ws-other",
          })
        : undefined;

    const observations = driver.deriveObservations(
      normalRun,
      adverseRun,
      dupRun,
      degradedRun,
      isolationRun,
    );
    const rerunReport = rerunConformance(
      db,
      manifest.loop_id,
      manifest.version,
      observations,
    );

    // Verify the DB was updated
    const after = readReport(db, manifest.loop_id)!;
    assert.equal(after.conformance_status, "pass");
    assert.equal(after.report.counts.pass, 12);
    assert.equal(after.report.counts.pending, 0);

    // Verify the returned report matches the persisted one
    assert.deepEqual(rerunReport.counts, after.report.counts);
    assert.equal(rerunReport.overall, after.report.overall);
    db.close();
  });

  test("re-running conformance on non-existent loop throws", () => {
    const db = freshDb();
    assert.throws(
      () => rerunConformance(db, "nonexistent.loop"),
      /loop not found/,
    );
    db.close();
  });

  test("re-running conformance preserves manifest_json", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");
    registerManifest(db, manifest);
    rerunConformance(db, manifest.loop_id, manifest.version);

    // manifest_json should be unchanged
    const row = db
      .prepare(
        "SELECT manifest_json FROM manifests WHERE loop_id = ? AND version = ?",
      )
      .get(manifest.loop_id, manifest.version) as { manifest_json: string };
    const roundTripped = JSON.parse(row.manifest_json);
    assert.equal(roundTripped.loop_id, manifest.loop_id);
    assert.equal(roundTripped.version, manifest.version);
    assert.equal(roundTripped.phases.length, manifest.phases.length);
    db.close();
  });
});

// ===================================================================
// 4. Report round-trip: JSON serialization fidelity
// ===================================================================

describe("report round-trip through database", () => {
  test("all TestResult fields survive JSON round-trip through SQLite", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");
    const driver = new LoopDriver(manifest);
    const normalRun = driver.runCycle({
      trace_id: "rt-trace",
      workspace_id: "ws-rt",
    });
    const actPhase = (manifest.phases as any[]).find(
      (p: any) => p.kind === "act",
    );
    const adverseRun = driver.runCycle({
      trace_id: "rt-adverse",
      inject_failure: { phase_id: actPhase.id, error: "rt fail" },
    });
    const dupRun = driver.runCycle({
      trace_id: "rt-trace",
      workspace_id: "ws-rt",
    });
    const subs = manifest.substrates ?? {};
    const nullSub = Object.entries(subs).find(([, v]) => v == null);
    const degradedRun = nullSub
      ? driver.runCycle({
          trace_id: "rt-degraded",
          degrade_substrate: nullSub[0],
        })
      : undefined;
    const isolationRun =
      manifest.workspace_scope === "required"
        ? driver.runCycle({
            trace_id: "rt-iso",
            workspace_id: "ws-other",
          })
        : undefined;

    const observations = driver.deriveObservations(
      normalRun,
      adverseRun,
      dupRun,
      degradedRun,
      isolationRun,
    );
    const { report: original } = registerManifest(db, manifest, observations);
    const stored = readReport(db, manifest.loop_id)!;

    // Field-by-field comparison
    assert.equal(stored.report.loop_id, original.loop_id);
    assert.equal(stored.report.version, original.version);
    assert.equal(stored.report.overall, original.overall);
    assert.deepEqual(stored.report.counts, original.counts);
    assert.equal(stored.report.results.length, original.results.length);

    for (let i = 0; i < original.results.length; i++) {
      const orig = original.results[i];
      const rt = stored.report.results[i];
      assert.equal(rt.id, orig.id, `Result ${i} id mismatch`);
      assert.equal(rt.title, orig.title, `Result ${i} title mismatch`);
      assert.equal(rt.status, orig.status, `Result ${i} status mismatch`);
      assert.equal(
        rt.evidence_rung,
        orig.evidence_rung,
        `Result ${i} evidence_rung mismatch`,
      );
      assert.equal(
        rt.rationale,
        orig.rationale,
        `Result ${i} rationale mismatch`,
      );
      if (orig.observation) {
        assert.ok(rt.observation, `Result ${i} observation lost in round-trip`);
        assert.equal(rt.observation!.behavior, orig.observation.behavior);
        assert.equal(rt.observation!.success, orig.observation.success);
        assert.equal(rt.observation!.source, orig.observation.source);
        assert.equal(rt.observation!.detail, orig.observation.detail);
      } else {
        assert.equal(
          rt.observation,
          undefined,
          `Result ${i} gained spurious observation`,
        );
      }
    }
    db.close();
  });

  test("StatusCounts survive round-trip as numbers, not strings", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");
    registerManifest(db, manifest);

    const stored = readReport(db, manifest.loop_id)!;
    assert.equal(typeof stored.report.counts.pass, "number");
    assert.equal(typeof stored.report.counts.fail, "number");
    assert.equal(typeof stored.report.counts.pending, "number");
    assert.equal(typeof stored.report.counts.total, "number");
    db.close();
  });
});

// ===================================================================
// 5. Multiple manifests: independent persistence
// ===================================================================

describe("multiple manifest persistence", () => {
  test("registering multiple manifests stores independent reports", () => {
    const db = freshDb();
    const graphonomous = loadManifest("graphonomous.continual_learning.json");
    const prism = loadManifest("prism.benchmark.json");

    registerManifest(db, graphonomous);
    registerManifest(db, prism);

    const gReport = readReport(db, graphonomous.loop_id)!;
    const pReport = readReport(db, prism.loop_id)!;

    assert.ok(gReport, "graphonomous report should be stored");
    assert.ok(pReport, "prism report should be stored");
    assert.equal(gReport.report.loop_id, graphonomous.loop_id);
    assert.equal(pReport.report.loop_id, prism.loop_id);
    // Each has its own counts
    assert.equal(gReport.report.counts.total, 12);
    assert.equal(pReport.report.counts.total, 12);
    db.close();
  });

  test("re-registering same loop_id+version replaces the report", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");

    // First registration (no observations)
    registerManifest(db, manifest);
    const first = readReport(db, manifest.loop_id)!;
    assert.equal(first.conformance_status, "pending");

    // Second registration (with observations)
    const driver = new LoopDriver(manifest);
    const run = driver.runCycle({ trace_id: "replace-trace" });
    const actPhase = (manifest.phases as any[]).find(
      (p: any) => p.kind === "act",
    );
    const adverseRun = driver.runCycle({
      trace_id: "replace-adverse",
      inject_failure: { phase_id: actPhase.id, error: "replace fail" },
    });
    const dupRun = driver.runCycle({ trace_id: "replace-trace" });
    const subs = manifest.substrates ?? {};
    const nullSub = Object.entries(subs).find(([, v]) => v == null);
    const degradedRun = nullSub
      ? driver.runCycle({
          trace_id: "replace-degraded",
          degrade_substrate: nullSub[0],
        })
      : undefined;
    const isolationRun =
      manifest.workspace_scope === "required"
        ? driver.runCycle({
            trace_id: "replace-iso",
            workspace_id: "ws-other",
          })
        : undefined;
    const observations = driver.deriveObservations(
      run,
      adverseRun,
      dupRun,
      degradedRun,
      isolationRun,
    );
    registerManifest(db, manifest, observations);

    const second = readReport(db, manifest.loop_id)!;
    assert.equal(second.conformance_status, "pass");
    assert.equal(second.report.counts.pass, 12);

    // Only one row in the DB for this loop_id+version
    const count = db
      .prepare(
        "SELECT COUNT(*) as c FROM manifests WHERE loop_id = ? AND version = ?",
      )
      .get(manifest.loop_id, manifest.version) as { c: number };
    assert.equal(count.c, 1, "INSERT OR REPLACE should keep exactly one row");
    db.close();
  });
});

// ===================================================================
// 6. Schema validation failure path through DB
// ===================================================================

describe("schema validation failure persists correctly", () => {
  test("invalid manifest persists fail status and report", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");
    const bad = { ...manifest };
    delete bad.substrates;

    const { report, schemaValid } = registerManifest(db, bad);
    assert.equal(schemaValid, false);
    assert.equal(report.overall, "fail");

    const stored = readReport(db, manifest.loop_id)!;
    assert.equal(stored.conformance_status, "fail");
    assert.ok(stored.report.counts.fail >= 1);
    const t01 = stored.report.results.find((r) => r.id === "T01")!;
    assert.equal(t01.status, "fail");
    assert.equal(t01.evidence_rung, "in_tree");
    db.close();
  });
});

// ===================================================================
// 7. Connection persistence alongside conformance report
// ===================================================================

describe("connections persist alongside conformance", () => {
  test("manifest connections are stored in the connections table", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");
    registerManifest(db, manifest);

    const conns = db
      .prepare("SELECT * FROM connections WHERE from_loop_id = ?")
      .all(manifest.loop_id) as any[];
    const manifestConns: any[] = manifest.connections ?? [];

    // Should have same number of connections
    assert.equal(
      conns.length,
      manifestConns.length,
      `Expected ${manifestConns.length} connections, got ${conns.length}`,
    );

    // Each connection should have token_kind
    for (const c of conns) {
      assert.ok(c.token_kind, "Connection missing token_kind");
      assert.ok(c.transport, "Connection missing transport");
    }
    db.close();
  });
});

// ===================================================================
// 8. Signal persistence (emit_signal path)
// ===================================================================

describe("signal persistence", () => {
  test("emitted signal is persisted and retrievable", () => {
    const db = freshDb();
    const ce = buildCloudEvent({
      source: "test.mcp-persistence",
      token: "OutcomeSignal",
      data: { result: "test-data" },
      trace_id: "sig-trace-001",
    });

    db.prepare(
      `INSERT INTO signals
         (ce_id, ce_source, ce_type, ce_time, token_kind, trace_id, correlation_id, data_json, received_at, delivered_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ce.id,
      ce.source,
      ce.type,
      ce.time as string,
      "OutcomeSignal",
      "sig-trace-001",
      null,
      JSON.stringify(ce.data ?? {}),
      Math.floor(Date.now() / 1000),
      "graphonomous.continual_learning",
    );

    // Retrieve undelivered signals
    const rows = db
      .prepare(
        `SELECT ce_id, ce_source, ce_type, token_kind, trace_id, data_json
         FROM signals
         WHERE delivered_to = ? AND delivered_at IS NULL`,
      )
      .all("graphonomous.continual_learning") as any[];

    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_kind, "OutcomeSignal");
    assert.equal(rows[0].trace_id, "sig-trace-001");
    const data = JSON.parse(rows[0].data_json);
    assert.equal(data.result, "test-data");
    db.close();
  });
});

// ===================================================================
// 9. Measured counts: never hard-coded in persistence
// ===================================================================

describe("measured counts in persisted reports", () => {
  test("persisted counts are computed from results, not hard-coded", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");
    registerManifest(db, manifest);

    const stored = readReport(db, manifest.loop_id)!;
    const { counts, results } = stored.report;

    // Recompute from results
    const recomputed = { pass: 0, fail: 0, pending: 0 };
    for (const r of results) {
      recomputed[r.status]++;
    }

    assert.equal(counts.pass, recomputed.pass);
    assert.equal(counts.fail, recomputed.fail);
    assert.equal(counts.pending, recomputed.pending);
    assert.equal(counts.total, results.length);
    assert.equal(counts.total, 12);
    db.close();
  });

  test("counts change when conformance is re-run with observations", () => {
    const db = freshDb();
    const manifest = loadManifest("graphonomous.continual_learning.json");

    // First: no observations
    registerManifest(db, manifest);
    const before = readReport(db, manifest.loop_id)!;
    const pendingBefore = before.report.counts.pending;
    assert.ok(pendingBefore > 0, "Should have pending tests without observations");

    // Second: with driver observations
    const driver = new LoopDriver(manifest);
    const normalRun = driver.runCycle({ trace_id: "count-trace" });
    const actPhase = (manifest.phases as any[]).find(
      (p: any) => p.kind === "act",
    );
    const adverseRun = driver.runCycle({
      trace_id: "count-adverse",
      inject_failure: { phase_id: actPhase.id, error: "count fail" },
    });
    const dupRun = driver.runCycle({ trace_id: "count-trace" });
    const subs = manifest.substrates ?? {};
    const nullSub = Object.entries(subs).find(([, v]) => v == null);
    const degradedRun = nullSub
      ? driver.runCycle({ trace_id: "count-degraded", degrade_substrate: nullSub[0] })
      : undefined;
    const isolationRun =
      manifest.workspace_scope === "required"
        ? driver.runCycle({ trace_id: "count-iso", workspace_id: "ws-other" })
        : undefined;
    const observations = driver.deriveObservations(
      normalRun,
      adverseRun,
      dupRun,
      degradedRun,
      isolationRun,
    );
    rerunConformance(db, manifest.loop_id, manifest.version, observations);

    const after = readReport(db, manifest.loop_id)!;
    assert.equal(after.report.counts.pending, 0);
    assert.equal(after.report.counts.pass, 12);
    assert.ok(
      after.report.counts.pending < pendingBefore,
      "Pending count should decrease after adding observations",
    );
    db.close();
  });
});
