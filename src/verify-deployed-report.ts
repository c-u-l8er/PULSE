#!/usr/bin/env node
/**
 * Verifies a deployed conformance report against the done-conditions.
 *
 * Checks:
 *   1. Report contains exactly 12 PULSE test results
 *   2. Measured pass/fail/pending totals recompute from results
 *   3. Phase observations for all 5 Graphonomous phases present
 *   4. Phase observation counts recompute from observations
 *   5. Every live_deployed claim has a successful deployed observation
 *   6. Unexercised/adverse properties are not claimed as live_deployed
 *   7. DOCTRINE section present with required fields
 *   8. Report digest is valid
 *   9. Persistence: registered and read-back matches
 *
 * Usage:
 *   npm run verify:deployed-report [-- path/to/report.json]
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { DeployedConformanceReport } from "./deployed-conformance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findLatestReport(dir: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("deployed-conformance-") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) {
    throw new Error(`No deployed conformance reports found in ${dir}`);
  }
  return resolve(dir, files[0]);
}

function verify(reportPath: string): {
  passed: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
} {
  const raw = readFileSync(reportPath, "utf-8");
  const report: DeployedConformanceReport = JSON.parse(raw);
  const checks: { name: string; passed: boolean; detail: string }[] = [];

  // 1. Exactly 12 test results
  const resultCount = report.conformance?.results?.length ?? 0;
  checks.push({
    name: "12 PULSE test results",
    passed: resultCount === 12,
    detail: `${resultCount} results`,
  });

  // 2. Counts recompute from results
  if (report.conformance?.results) {
    const pass = report.conformance.results.filter(
      (r) => r.status === "pass",
    ).length;
    const fail = report.conformance.results.filter(
      (r) => r.status === "fail",
    ).length;
    const pending = report.conformance.results.filter(
      (r) => r.status === "pending",
    ).length;
    const countsMatch =
      report.conformance.counts.pass === pass &&
      report.conformance.counts.fail === fail &&
      report.conformance.counts.pending === pending &&
      report.conformance.counts.total === 12;
    checks.push({
      name: "Counts recompute from results",
      passed: countsMatch,
      detail: `pass=${pass}(${report.conformance.counts.pass}) fail=${fail}(${report.conformance.counts.fail}) pending=${pending}(${report.conformance.counts.pending})`,
    });
  }

  // 3. Phase observations for all 5 phases
  const expectedPhases = ["retrieve", "route", "act", "learn", "consolidate"];
  const observedPhases = (report.phase_observations ?? []).map(
    (o) => o.kind ?? o.phase,
  );
  const allPhasesPresent = expectedPhases.every((p) =>
    observedPhases.includes(p),
  );
  checks.push({
    name: "5 Graphonomous phase observations",
    passed: allPhasesPresent,
    detail: `observed: [${observedPhases.join(", ")}]`,
  });

  // 4. Phase observation counts recompute
  const phaseObs = report.phase_observations ?? [];
  const phasePassed = phaseObs.filter((o) => o.success).length;
  const phaseFailed = phaseObs.filter((o) => !o.success).length;
  const phaseCountsMatch =
    report.phase_observation_counts?.total === phaseObs.length &&
    report.phase_observation_counts?.passed === phasePassed &&
    report.phase_observation_counts?.failed === phaseFailed;
  checks.push({
    name: "Phase counts recompute from observations",
    passed: phaseCountsMatch,
    detail: `total=${phaseObs.length} passed=${phasePassed} failed=${phaseFailed}`,
  });

  // 5. Every live_deployed claim has a successful deployed observation
  const deployedResults = (report.conformance?.results ?? []).filter(
    (r) => r.evidence_rung === "live_deployed",
  );
  let allDeployedHaveEvidence = true;
  const deployedDetails: string[] = [];
  for (const r of deployedResults) {
    const obs = r.observation;
    if (!obs || !obs.success || !obs.deployment_provenance) {
      allDeployedHaveEvidence = false;
      deployedDetails.push(
        `${r.id}: live_deployed without successful deployed observation`,
      );
    } else {
      deployedDetails.push(`${r.id}: live_deployed with evidence`);
    }
  }
  checks.push({
    name: "live_deployed claims supported by evidence",
    passed: allDeployedHaveEvidence,
    detail:
      deployedDetails.length > 0
        ? deployedDetails.join("; ")
        : "no live_deployed claims",
  });

  // 6. Unexercised properties not overstated
  const nonDeployedResults = (report.conformance?.results ?? []).filter(
    (r) => r.evidence_rung !== "live_deployed",
  );
  const noOverstatement = nonDeployedResults.every(
    (r) =>
      r.evidence_rung === "spec" ||
      r.evidence_rung === "in_tree" ||
      r.evidence_rung === "live_local",
  );
  checks.push({
    name: "Unexercised properties not overstated",
    passed: noOverstatement,
    detail: `${nonDeployedResults.length} non-deployed results at honest rungs`,
  });

  // 7. DOCTRINE section
  const doctrineValid =
    report.doctrine != null &&
    ["advanced", "contradicted", "proposed", "none"].includes(
      report.doctrine.assessment,
    );
  checks.push({
    name: "DOCTRINE assessment present",
    passed: doctrineValid,
    detail: report.doctrine
      ? `assessment=${report.doctrine.assessment}`
      : "missing",
  });

  // 8. Digest validity
  const reportCopy = { ...report };
  delete (reportCopy as any).digest;
  const canonical = JSON.stringify(reportCopy, null, 2);
  const expectedDigest =
    "sha256:" + createHash("sha256").update(canonical).digest("hex");
  const digestValid = report.digest === expectedDigest;
  checks.push({
    name: "Report digest valid",
    passed: digestValid,
    detail: digestValid
      ? report.digest
      : `expected ${expectedDigest}, got ${report.digest}`,
  });

  // 9. Persistence
  const persistenceValid =
    report.persistence?.registered === true &&
    report.persistence?.read_back === true &&
    report.persistence?.read_back_matches === true;
  checks.push({
    name: "Deployed persistence (register + read-back)",
    passed: persistenceValid,
    detail: `registered=${report.persistence?.registered} read_back=${report.persistence?.read_back} matches=${report.persistence?.read_back_matches}`,
  });

  // 10. Endpoint URLs present
  const endpointsPresent =
    !!report.pulse_endpoint &&
    report.pulse_endpoint.startsWith("https://") &&
    !!report.graphonomous_endpoint &&
    report.graphonomous_endpoint.startsWith("https://");
  checks.push({
    name: "Deployed endpoint URLs present",
    passed: endpointsPresent,
    detail: `pulse=${report.pulse_endpoint} graphonomous=${report.graphonomous_endpoint}`,
  });

  // 11. Timestamps present
  const timestampsPresent = !!report.started_at && !!report.finished_at;
  checks.push({
    name: "UTC timestamps present",
    passed: timestampsPresent,
    detail: `started=${report.started_at} finished=${report.finished_at}`,
  });

  // 12. Identities present
  const identitiesPresent =
    report.pulse_identity != null || report.graphonomous_identity != null;
  checks.push({
    name: "Endpoint identities present",
    passed: identitiesPresent,
    detail: `pulse=${JSON.stringify(report.pulse_identity)} graphonomous=${JSON.stringify(report.graphonomous_identity)}`,
  });

  const passed = checks.every((c) => c.passed);
  return { passed, checks };
}

// CLI entrypoint
if (
  process.argv[1] &&
  (process.argv[1].endsWith("verify-deployed-report.ts") ||
    process.argv[1].endsWith("verify-deployed-report.js"))
) {
  const reportDir = resolve(__dirname, "..", "reports");
  const reportPath = process.argv[2] ?? findLatestReport(reportDir);
  console.error(`[verify] Checking ${reportPath}`);

  try {
    const { passed, checks } = verify(reportPath);
    for (const c of checks) {
      const icon = c.passed ? "✓" : "✗";
      console.log(`  ${icon} ${c.name}: ${c.detail}`);
    }
    console.log(
      `\n${passed ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`,
    );
    process.exit(passed ? 0 : 1);
  } catch (err) {
    console.error(
      `[verify] Error: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
}

export { verify, findLatestReport };
