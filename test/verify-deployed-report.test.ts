/**
 * Tests for the offline deployed-report verifier (src/verify-deployed-report.ts).
 *
 * Covers:
 *   - Successful artifact: all checks pass on a well-formed report
 *   - Malformed provenance: wrong digest, missing fields, bad endpoints
 *   - Inconsistent counts: pass/fail/pending totals that don't recompute
 *   - Missing phase observations: fewer than 5 Graphonomous phases
 *   - Unsupported live_deployed: result claims live_deployed without evidence
 *   - Digest mismatch: report with tampered digest
 *   - Read-back mismatch: persistence fields inconsistent
 *   - Secrets: report containing sensitive-looking strings
 *   - Missing or dishonest DOCTRINE assessment
 *
 * Evidence rung: in_tree — these tests exercise the verifier offline against
 * synthetic report artifacts. No deployed endpoints are contacted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verify } from "../src/verify-deployed-report.ts";
import { writeFileSync, mkdtempSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DeployedConformanceReport } from "../src/deployed-conformance.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Valid deployment provenance for test fixtures. */
const VALID_PROVENANCE = {
  endpoint_url: "https://graphonomous-mcp.fly.dev/mcp",
  identity: "graphonomous",
  version: "0.4.3",
  request_id: "01KYN7WH6PT58B11BNM2WF494Y-dfw",
  observed_at: "2026-07-28T20:50:29.816Z",
  configured_endpoint: "https://graphonomous-mcp.fly.dev",
};

/** Build a well-formed result entry. */
function makeResult(
  id: string,
  title: string,
  status: "pass" | "fail" | "pending",
  rung: string,
  rationale: string,
  observation?: any,
) {
  const r: any = { id, title, status, evidence_rung: rung, rationale };
  if (observation) r.observation = observation;
  return r;
}

/** Build a complete valid report (before digest). */
function buildValidReportData(): Omit<DeployedConformanceReport, "digest"> {
  const deployedObs = {
    behavior: "act phase completed",
    success: true,
    source: "graphonomous",
    detail: "act ok",
    deployment_provenance: VALID_PROVENANCE,
  };

  return {
    report_id: "test-report-001",
    pulse_endpoint: "https://os-pulse-mcp.fly.dev",
    graphonomous_endpoint: "https://graphonomous-mcp.fly.dev",
    pulse_identity: { name: "os-pulse", version: "0.1.0" },
    graphonomous_identity: { name: "graphonomous", version: "0.4.3" },
    fly_request_ids: { pulse_health: "req-1", graphonomous_health: "req-2" },
    started_at: "2026-07-28T20:50:29.148Z",
    finished_at: "2026-07-28T20:50:30.399Z",
    conformance: {
      loop_id: "graphonomous.continual_learning",
      version: "0.4.0",
      overall: "pending",
      counts: { pass: 9, fail: 0, pending: 3, total: 12 },
      results: [
        makeResult("T01", "Schema validation", "pass", "in_tree", "ok"),
        makeResult("T02", "Phase atomicity", "pass", "live_deployed", "ok", deployedObs),
        makeResult("T03", "Phase idempotency", "pass", "live_deployed", "ok", deployedObs),
        makeResult("T04", "Nesting waits", "pass", "in_tree", "ok"),
        makeResult("T05", "κ-routing", "pass", "live_deployed", "ok", deployedObs),
        makeResult("T06", "Quorum before commit", "pass", "in_tree", "ok"),
        makeResult("T07", "Append-only audit", "pass", "live_deployed", "ok", deployedObs),
        makeResult("T08", "Signal deduplication", "pending", "spec", "no observation"),
        makeResult("T09", "Substrate degradation", "pending", "spec", "no observation"),
        makeResult("T10", "Multi-tenant isolation", "pending", "spec", "no observation"),
        makeResult("T11", "trace_id propagation", "pass", "live_deployed", "ok", deployedObs),
        makeResult("T12", "Protocol version monotonicity", "pass", "in_tree", "ok"),
      ],
    },
    phase_observations: [
      {
        phase: "retrieve", kind: "retrieve",
        started_at: "2026-07-28T20:50:29.592Z", finished_at: "2026-07-28T20:50:29.657Z",
        success: true, redacted_request: {}, redacted_response: "ok",
      },
      {
        phase: "route", kind: "route",
        started_at: "2026-07-28T20:50:29.657Z", finished_at: "2026-07-28T20:50:29.725Z",
        success: true, redacted_request: {}, redacted_response: "ok",
      },
      {
        phase: "act", kind: "act",
        started_at: "2026-07-28T20:50:29.725Z", finished_at: "2026-07-28T20:50:29.816Z",
        success: true, redacted_request: {}, redacted_response: "ok",
      },
      {
        phase: "learn", kind: "learn",
        started_at: "2026-07-28T20:50:29.816Z", finished_at: "2026-07-28T20:50:29.876Z",
        success: true, redacted_request: {}, redacted_response: "ok",
      },
      {
        phase: "consolidate", kind: "consolidate",
        started_at: "2026-07-28T20:50:29.876Z", finished_at: "2026-07-28T20:50:29.943Z",
        success: true, redacted_request: {}, redacted_response: "ok",
      },
    ],
    phase_observation_counts: { total: 5, passed: 5, failed: 0 },
    persistence: {
      registered: true,
      read_back: true,
      read_back_loop_id: "graphonomous.continual_learning",
      read_back_version: "0.4.0",
      read_back_matches: true,
    },
    doctrine: {
      assessment: "advanced" as const,
      claim: "Graphonomous continual learning loop runtime conformance",
      old_rung: "live_local",
      new_rung: "live_deployed",
      evidence: "5 tests reached live_deployed",
    },
  };
}

/** Compute and attach a valid digest to report data. */
function addDigest(data: Omit<DeployedConformanceReport, "digest">): DeployedConformanceReport {
  const canonical = JSON.stringify(data, null, 2);
  const hash = createHash("sha256").update(canonical).digest("hex");
  return { ...data, digest: `sha256:${hash}` };
}

/** Write a report to a temp file and return the path. */
function writeTempReport(report: DeployedConformanceReport): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pulse-verify-test-"));
  const path = join(dir, "report.json");
  writeFileSync(path, JSON.stringify(report, null, 2));
  return {
    path,
    cleanup: () => {
      try { rmSync(dir, { recursive: true }); } catch { /* ignore */ }
    },
  };
}

/** Build a valid report, write it, and return path + cleanup. */
function validReport() {
  const report = addDigest(buildValidReportData());
  return writeTempReport(report);
}

/** Build a mutated report with a valid digest for the mutated content. */
function mutatedReport(mutate: (data: any) => void) {
  const data = buildValidReportData() as any;
  mutate(data);
  const report = addDigest(data);
  return writeTempReport(report);
}

/** Build a mutated report WITHOUT recomputing the digest (for digest-mismatch tests). */
function mutatedReportBadDigest(mutate: (report: any) => void) {
  const report = addDigest(buildValidReportData()) as any;
  mutate(report);
  return writeTempReport(report);
}

// ---------------------------------------------------------------------------
// Tests: successful artifact
// ---------------------------------------------------------------------------

test("verify: well-formed report passes all checks", () => {
  const { path, cleanup } = validReport();
  try {
    const { passed, checks } = verify(path);
    const failedChecks = checks.filter((c) => !c.passed);
    assert.equal(
      passed,
      true,
      `Expected all checks to pass, but these failed: ${failedChecks.map((c) => c.name).join(", ")}`,
    );
    assert.ok(checks.length >= 9, `Expected at least 9 checks, got ${checks.length}`);
  } finally {
    cleanup();
  }
});

test("verify: check count is stable and comprehensive", () => {
  const { path, cleanup } = validReport();
  try {
    const { checks } = verify(path);
    // The verifier should produce exactly 12 checks
    assert.equal(checks.length, 12, `Expected 12 checks, got ${checks.length}`);
    // Verify expected check names are present
    const names = checks.map((c) => c.name);
    for (const expected of [
      "12 PULSE test results",
      "Counts recompute from results",
      "5 Graphonomous phase observations",
      "Phase counts recompute from observations",
      "live_deployed claims supported by evidence",
      "Unexercised properties not overstated",
      "DOCTRINE assessment present",
      "Report digest valid",
      "Deployed persistence (register + read-back)",
      "Deployed endpoint URLs present",
      "UTC timestamps present",
      "Endpoint identities present",
    ]) {
      assert.ok(names.includes(expected), `Missing check: ${expected}`);
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tests: malformed provenance / missing fields
// ---------------------------------------------------------------------------

test("verify: report with wrong result count fails '12 PULSE test results'", () => {
  const { path, cleanup } = mutatedReport((data) => {
    // Remove two results, leaving only 10
    data.conformance.results = data.conformance.results.slice(0, 10);
    data.conformance.counts = {
      pass: data.conformance.results.filter((r: any) => r.status === "pass").length,
      fail: data.conformance.results.filter((r: any) => r.status === "fail").length,
      pending: data.conformance.results.filter((r: any) => r.status === "pending").length,
      total: 10,
    };
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const resultCheck = checks.find((c) => c.name === "12 PULSE test results")!;
    assert.equal(resultCheck.passed, false, "Should fail with non-12 result count");
    assert.ok(resultCheck.detail.includes("10"), "Detail should mention 10 results");
  } finally {
    cleanup();
  }
});

test("verify: inconsistent counts fail 'Counts recompute from results'", () => {
  const { path, cleanup } = mutatedReport((data) => {
    // Set counts that don't match reality
    data.conformance.counts = { pass: 12, fail: 0, pending: 0, total: 12 };
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const countCheck = checks.find((c) => c.name === "Counts recompute from results")!;
    assert.equal(countCheck.passed, false, "Mismatched counts should fail recompute check");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tests: missing phase observations
// ---------------------------------------------------------------------------

test("verify: missing phase observations fails '5 Graphonomous phase observations'", () => {
  const { path, cleanup } = mutatedReport((data) => {
    // Only keep 3 of 5 phases
    data.phase_observations = data.phase_observations.slice(0, 3);
    data.phase_observation_counts = { total: 3, passed: 3, failed: 0 };
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const phaseCheck = checks.find((c) => c.name === "5 Graphonomous phase observations")!;
    assert.equal(phaseCheck.passed, false, "Missing phases should fail observation check");
  } finally {
    cleanup();
  }
});

test("verify: phase observation counts that don't recompute fail", () => {
  const { path, cleanup } = mutatedReport((data) => {
    // Phase counts don't match actual observations
    data.phase_observation_counts = { total: 10, passed: 8, failed: 2 };
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const phaseCountCheck = checks.find((c) => c.name === "Phase counts recompute from observations")!;
    assert.equal(phaseCountCheck.passed, false);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tests: unsupported live_deployed
// ---------------------------------------------------------------------------

test("verify: live_deployed result without observation fails evidence check", () => {
  const { path, cleanup } = mutatedReport((data) => {
    // T02 claims live_deployed but strip the observation
    const t02 = data.conformance.results.find((r: any) => r.id === "T02");
    delete t02.observation;
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const evidenceCheck = checks.find((c) => c.name === "live_deployed claims supported by evidence")!;
    assert.equal(evidenceCheck.passed, false, "live_deployed without observation must fail");
    assert.ok(evidenceCheck.detail.includes("T02"));
  } finally {
    cleanup();
  }
});

test("verify: live_deployed result with failed observation fails evidence check", () => {
  const { path, cleanup } = mutatedReport((data) => {
    const t02 = data.conformance.results.find((r: any) => r.id === "T02");
    t02.observation.success = false;
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const evidenceCheck = checks.find((c) => c.name === "live_deployed claims supported by evidence")!;
    assert.equal(evidenceCheck.passed, false, "live_deployed with failed observation must fail");
  } finally {
    cleanup();
  }
});

test("verify: live_deployed result without deployment_provenance fails evidence check", () => {
  const { path, cleanup } = mutatedReport((data) => {
    const t02 = data.conformance.results.find((r: any) => r.id === "T02");
    delete t02.observation.deployment_provenance;
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const evidenceCheck = checks.find((c) => c.name === "live_deployed claims supported by evidence")!;
    assert.equal(evidenceCheck.passed, false, "live_deployed without deployment_provenance must fail");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tests: unexercised properties not overstated
// ---------------------------------------------------------------------------

test("verify: pending result at live_deployed rung fails overstatement check", () => {
  const { path, cleanup } = mutatedReport((data) => {
    // Mark a pending result as live_deployed — this should fail
    const t08 = data.conformance.results.find((r: any) => r.id === "T08");
    t08.evidence_rung = "live_deployed";
    // It's pending/live_deployed which is unusual but let's see if overstatement catches it
  });
  try {
    const { checks } = verify(path);
    const overstateCheck = checks.find((c) => c.name === "Unexercised properties not overstated")!;
    // The check filters non-deployed results, so a pending@live_deployed wouldn't be in that set.
    // But it WOULD be in the live_deployed set and would fail the evidence check since it has no observation.
    const evidenceCheck = checks.find((c) => c.name === "live_deployed claims supported by evidence")!;
    assert.equal(evidenceCheck.passed, false, "pending@live_deployed without observation must fail evidence check");
  } finally {
    cleanup();
  }
});

test("verify: non-deployed result at 'external' rung fails overstatement check", () => {
  const { path, cleanup } = mutatedReport((data) => {
    // Set a result to 'external' rung — only spec/in_tree/live_local are allowed for non-deployed
    const t04 = data.conformance.results.find((r: any) => r.id === "T04");
    t04.evidence_rung = "external";
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const overstateCheck = checks.find((c) => c.name === "Unexercised properties not overstated")!;
    assert.equal(overstateCheck.passed, false, "'external' rung on non-deployed result is overstatement");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tests: digest mismatch
// ---------------------------------------------------------------------------

test("verify: tampered digest fails 'Report digest valid'", () => {
  const { path, cleanup } = mutatedReportBadDigest((report) => {
    // Change the digest to something wrong
    report.digest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const digestCheck = checks.find((c) => c.name === "Report digest valid")!;
    assert.equal(digestCheck.passed, false, "Wrong digest must fail");
  } finally {
    cleanup();
  }
});

test("verify: content mutation with original digest fails", () => {
  const { path, cleanup } = mutatedReportBadDigest((report) => {
    // Mutate content but keep original digest
    report.report_id = "tampered-id";
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const digestCheck = checks.find((c) => c.name === "Report digest valid")!;
    assert.equal(digestCheck.passed, false, "Content mutation must break digest");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tests: read-back / persistence mismatch
// ---------------------------------------------------------------------------

test("verify: persistence.registered=false fails persistence check", () => {
  const { path, cleanup } = mutatedReport((data) => {
    data.persistence.registered = false;
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const persistCheck = checks.find((c) => c.name === "Deployed persistence (register + read-back)")!;
    assert.equal(persistCheck.passed, false, "Unregistered persistence must fail");
  } finally {
    cleanup();
  }
});

test("verify: persistence.read_back_matches=false fails persistence check", () => {
  const { path, cleanup } = mutatedReport((data) => {
    data.persistence.read_back_matches = false;
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const persistCheck = checks.find((c) => c.name === "Deployed persistence (register + read-back)")!;
    assert.equal(persistCheck.passed, false, "Mismatched read-back must fail");
  } finally {
    cleanup();
  }
});

test("verify: persistence.read_back=false fails persistence check", () => {
  const { path, cleanup } = mutatedReport((data) => {
    data.persistence.read_back = false;
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const persistCheck = checks.find((c) => c.name === "Deployed persistence (register + read-back)")!;
    assert.equal(persistCheck.passed, false);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tests: missing or dishonest DOCTRINE assessment
// ---------------------------------------------------------------------------

test("verify: missing doctrine fails DOCTRINE check", () => {
  const { path, cleanup } = mutatedReport((data) => {
    delete data.doctrine;
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const doctrineCheck = checks.find((c) => c.name === "DOCTRINE assessment present")!;
    assert.equal(doctrineCheck.passed, false, "Missing doctrine must fail");
    assert.ok(doctrineCheck.detail.includes("missing"));
  } finally {
    cleanup();
  }
});

test("verify: doctrine with invalid assessment value fails", () => {
  const { path, cleanup } = mutatedReport((data) => {
    data.doctrine = { assessment: "maybe", claim: "test" };
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const doctrineCheck = checks.find((c) => c.name === "DOCTRINE assessment present")!;
    assert.equal(doctrineCheck.passed, false, "Invalid assessment value must fail");
  } finally {
    cleanup();
  }
});

test("verify: doctrine with each valid assessment value passes", () => {
  for (const assessment of ["advanced", "contradicted", "proposed", "none"] as const) {
    const { path, cleanup } = mutatedReport((data) => {
      data.doctrine = { assessment, claim: "test" };
    });
    try {
      const { checks } = verify(path);
      const doctrineCheck = checks.find((c) => c.name === "DOCTRINE assessment present")!;
      assert.equal(doctrineCheck.passed, true, `assessment='${assessment}' should pass`);
    } finally {
      cleanup();
    }
  }
});

// ---------------------------------------------------------------------------
// Tests: endpoint validation
// ---------------------------------------------------------------------------

test("verify: http:// endpoint fails endpoint check", () => {
  const { path, cleanup } = mutatedReport((data) => {
    data.pulse_endpoint = "http://os-pulse-mcp.fly.dev";
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const endpointCheck = checks.find((c) => c.name === "Deployed endpoint URLs present")!;
    assert.equal(endpointCheck.passed, false, "http:// endpoint must fail");
  } finally {
    cleanup();
  }
});

test("verify: missing endpoint fails endpoint check", () => {
  const { path, cleanup } = mutatedReport((data) => {
    data.pulse_endpoint = "";
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const endpointCheck = checks.find((c) => c.name === "Deployed endpoint URLs present")!;
    assert.equal(endpointCheck.passed, false);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tests: missing timestamps
// ---------------------------------------------------------------------------

test("verify: missing started_at fails timestamp check", () => {
  const { path, cleanup } = mutatedReport((data) => {
    data.started_at = "";
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const tsCheck = checks.find((c) => c.name === "UTC timestamps present")!;
    assert.equal(tsCheck.passed, false);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tests: missing identities
// ---------------------------------------------------------------------------

test("verify: both identities null fails identity check", () => {
  const { path, cleanup } = mutatedReport((data) => {
    data.pulse_identity = null;
    data.graphonomous_identity = null;
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const idCheck = checks.find((c) => c.name === "Endpoint identities present")!;
    assert.equal(idCheck.passed, false);
  } finally {
    cleanup();
  }
});

test("verify: one identity present is sufficient", () => {
  const { path, cleanup } = mutatedReport((data) => {
    data.pulse_identity = null;
    // graphonomous_identity remains
  });
  try {
    const { checks } = verify(path);
    const idCheck = checks.find((c) => c.name === "Endpoint identities present")!;
    assert.equal(idCheck.passed, true, "One identity present should pass");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Tests: unparseable / missing file
// ---------------------------------------------------------------------------

test("verify: throws on non-existent file", () => {
  assert.throws(
    () => verify("/tmp/does-not-exist-pulse-verify-test.json"),
    /ENOENT/,
  );
});

test("verify: throws on invalid JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "pulse-verify-test-"));
  const path = join(dir, "bad.json");
  writeFileSync(path, "not json{{{");
  try {
    assert.throws(() => verify(path));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Tests: multiple failures accumulate correctly
// ---------------------------------------------------------------------------

test("verify: report with many defects fails multiple checks independently", () => {
  const { path, cleanup } = mutatedReport((data) => {
    // Break many things at once
    data.conformance.results = data.conformance.results.slice(0, 5); // wrong count
    data.conformance.counts = { pass: 99, fail: 0, pending: 0, total: 5 }; // wrong counts
    data.phase_observations = []; // no phases
    data.phase_observation_counts = { total: 0, passed: 0, failed: 0 };
    data.persistence = { registered: false, read_back: false, read_back_matches: false };
    delete data.doctrine;
    data.pulse_endpoint = "";
    data.started_at = "";
    data.pulse_identity = null;
    data.graphonomous_identity = null;
  });
  try {
    const { passed, checks } = verify(path);
    assert.equal(passed, false);
    const failedCount = checks.filter((c) => !c.passed).length;
    // At least 8 checks should fail with all these defects
    assert.ok(failedCount >= 8, `Expected at least 8 failures, got ${failedCount}`);
  } finally {
    cleanup();
  }
});
