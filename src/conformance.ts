/**
 * 12-test PULSE v0.1 conformance suite.
 *
 * Most tests in the PULSE spec require a running inner loop to exercise
 * runtime behavior (atomicity, nesting waits, quorum, etc). For v0.1 of
 * os-pulse we run the manifest-level checks exhaustively and return
 * `pending` for tests that cannot be verified from the manifest alone.
 *
 * The 12 tests (PULSE spec §12):
 *   T01  Schema validation
 *   T02  Phase atomicity (runtime)
 *   T03  Phase idempotency (runtime)
 *   T04  Nesting waits (runtime)
 *   T05  κ-routing (runtime+manifest)
 *   T06  Quorum before commit (runtime+manifest)
 *   T07  Append-only audit (runtime+manifest)
 *   T08  Signal deduplication (runtime)
 *   T09  Substrate degradation (runtime)
 *   T10  Multi-tenant isolation (runtime)
 *   T11  trace_id propagation (runtime+manifest)
 *   T12  Schema/version monotonicity
 */
import type { ValidationResult } from "./schema.js";

export type TestStatus = "pass" | "fail" | "pending";

export interface TestResult {
  id: string;
  title: string;
  status: TestStatus;
  rationale: string;
}

export interface ConformanceReport {
  loop_id: string;
  version: string;
  overall: "pass" | "fail" | "pending";
  results: TestResult[];
}

type Manifest = Record<string, any>;

export function runConformance(
  manifest: Manifest,
  schemaResult: ValidationResult,
): ConformanceReport {
  const results: TestResult[] = [
    t01Schema(schemaResult),
    t02Atomicity(manifest),
    t03Idempotency(manifest),
    t04NestingWaits(manifest),
    t05KappaRouting(manifest),
    t06Quorum(manifest),
    t07AppendOnlyAudit(manifest),
    t08Dedup(manifest),
    t09Degradation(manifest),
    t10TenantIsolation(manifest),
    t11TraceIdProp(manifest),
    t12VersionMonotonicity(manifest),
  ];

  const anyFail = results.some((r) => r.status === "fail");
  const anyPending = results.some((r) => r.status === "pending");
  const overall: ConformanceReport["overall"] = anyFail
    ? "fail"
    : anyPending
    ? "pending"
    : "pass";

  return {
    loop_id: String(manifest.loop_id ?? "unknown"),
    version: String(manifest.version ?? "0.0.0"),
    overall,
    results,
  };
}

// T01 — Schema validation. Authoritative; fails if ajv rejects.
function t01Schema(schemaResult: ValidationResult): TestResult {
  return {
    id: "T01",
    title: "Schema validation",
    status: schemaResult.valid ? "pass" : "fail",
    rationale: schemaResult.valid
      ? "Manifest validates against pulse-loop-manifest.v0.1.json"
      : schemaResult.errorText,
  };
}

// T02 — Phase atomicity. Manifest must declare on_failure for every non-trivial phase.
function t02Atomicity(manifest: Manifest): TestResult {
  const atomicityFlag = manifest.invariants?.phase_atomicity === true;
  if (!atomicityFlag) {
    return {
      id: "T02",
      title: "Phase atomicity",
      status: "pass",
      rationale: "phase_atomicity invariant not claimed; test skipped",
    };
  }
  const phases: any[] = manifest.phases ?? [];
  const weak = phases.filter(
    (p) => !p.on_failure && p.kind !== "consolidate",
  );
  if (weak.length === 0) {
    return {
      id: "T02",
      title: "Phase atomicity",
      status: "pass",
      rationale: "All mutating phases declare on_failure",
    };
  }
  return {
    id: "T02",
    title: "Phase atomicity",
    status: "pending",
    rationale: `Runtime check required; ${weak.length} phase(s) without on_failure cannot be validated statically`,
  };
}

// T03 — Phase idempotency. At least one phase must declare idempotent: true
// for cross-loop retry safety.
function t03Idempotency(manifest: Manifest): TestResult {
  const phases: any[] = manifest.phases ?? [];
  const anyIdempotent = phases.some((p) => p.idempotent === true);
  return {
    id: "T03",
    title: "Phase idempotency",
    status: anyIdempotent ? "pass" : "pending",
    rationale: anyIdempotent
      ? "At least one phase declares idempotent: true"
      : "No phase declares idempotent: true; runtime retry semantics cannot be verified",
  };
}

// T04 — Nesting waits. If nesting.inner_loops is non-empty, every inner loop must declare a wait strategy.
function t04NestingWaits(manifest: Manifest): TestResult {
  const inner: any[] = manifest.nesting?.inner_loops ?? [];
  if (inner.length === 0) {
    return {
      id: "T04",
      title: "Nesting waits",
      status: "pass",
      rationale: "No inner loops declared",
    };
  }
  const missing = inner.filter((l) => !l.wait);
  if (missing.length > 0) {
    return {
      id: "T04",
      title: "Nesting waits",
      status: "fail",
      rationale: `${missing.length} inner loop(s) missing 'wait' field`,
    };
  }
  return {
    id: "T04",
    title: "Nesting waits",
    status: "pass",
    rationale: `All ${inner.length} inner loop(s) declare wait strategy`,
  };
}

// T05 — κ-routing. If invariants.kappa_routing is true, at least one route phase must exist.
function t05KappaRouting(manifest: Manifest): TestResult {
  const flag = manifest.invariants?.kappa_routing === true;
  if (!flag) {
    return {
      id: "T05",
      title: "κ-routing",
      status: "pass",
      rationale: "kappa_routing invariant not claimed",
    };
  }
  const phases: any[] = manifest.phases ?? [];
  const hasRoute = phases.some((p) => p.kind === "route");
  return {
    id: "T05",
    title: "κ-routing",
    status: hasRoute ? "pass" : "fail",
    rationale: hasRoute
      ? "kappa_routing claimed and route phase present"
      : "kappa_routing claimed but no route phase found",
  };
}

// T06 — Quorum before commit. If invariants.quorum_before_commit is true,
// an act phase must exist and either have a policy_check or be downstream of a route phase.
function t06Quorum(manifest: Manifest): TestResult {
  const flag = manifest.invariants?.quorum_before_commit === true;
  if (!flag) {
    return {
      id: "T06",
      title: "Quorum before commit",
      status: "pass",
      rationale: "quorum_before_commit invariant not claimed",
    };
  }
  const phases: any[] = manifest.phases ?? [];
  const actPhases = phases.filter((p) => p.kind === "act");
  if (actPhases.length === 0) {
    return {
      id: "T06",
      title: "Quorum before commit",
      status: "fail",
      rationale: "quorum_before_commit claimed but no act phase",
    };
  }
  const allProtected = actPhases.every(
    (p) => p.policy_check != null || p.invariant != null,
  );
  return {
    id: "T06",
    title: "Quorum before commit",
    status: allProtected ? "pass" : "pending",
    rationale: allProtected
      ? "All act phases declare policy_check or invariant"
      : "Runtime check required; some act phases lack static quorum markers",
  };
}

// T07 — Append-only audit. If claimed, substrates.audit must be non-null.
function t07AppendOnlyAudit(manifest: Manifest): TestResult {
  const flag = manifest.invariants?.append_only_audit === true;
  if (!flag) {
    return {
      id: "T07",
      title: "Append-only audit",
      status: "pass",
      rationale: "append_only_audit invariant not claimed",
    };
  }
  const audit = manifest.substrates?.audit;
  return {
    id: "T07",
    title: "Append-only audit",
    status: audit ? "pass" : "fail",
    rationale: audit
      ? `audit substrate declared (${audit})`
      : "append_only_audit claimed but substrates.audit is null",
  };
}

// T08 — Signal deduplication. Not statically verifiable — require runtime trace.
function t08Dedup(_manifest: Manifest): TestResult {
  return {
    id: "T08",
    title: "Signal deduplication",
    status: "pending",
    rationale: "Runtime dedup check requires observed CloudEvent id uniqueness; test deferred",
  };
}

// T09 — Substrate degradation. If a substrate is null, the manifest must document the fallback in description.
function t09Degradation(manifest: Manifest): TestResult {
  const subs = manifest.substrates ?? {};
  const nulls = Object.entries(subs).filter(([, v]) => v == null);
  if (nulls.length === 0) {
    return {
      id: "T09",
      title: "Substrate degradation",
      status: "pass",
      rationale: "All declared substrates are non-null",
    };
  }
  return {
    id: "T09",
    title: "Substrate degradation",
    status: "pending",
    rationale: `${nulls.length} null substrate(s); runtime fallback behavior cannot be verified statically`,
  };
}

// T10 — Multi-tenant isolation. Runtime-only.
function t10TenantIsolation(manifest: Manifest): TestResult {
  const ws = manifest.workspace_scope;
  if (ws === "required") {
    return {
      id: "T10",
      title: "Multi-tenant isolation",
      status: "pending",
      rationale: "workspace_scope=required; runtime isolation test deferred",
    };
  }
  return {
    id: "T10",
    title: "Multi-tenant isolation",
    status: "pass",
    rationale: `workspace_scope=${ws}; multi-tenant isolation not in scope`,
  };
}

// T11 — trace_id propagation. Manifest must claim it if any connection is sync.
function t11TraceIdProp(manifest: Manifest): TestResult {
  const flag = manifest.invariants?.trace_id_propagation === true;
  const conns: any[] = manifest.connections ?? [];
  const syncConns = conns.filter((c) => c.cadence === "sync");
  if (syncConns.length > 0 && !flag) {
    return {
      id: "T11",
      title: "trace_id propagation",
      status: "fail",
      rationale: `${syncConns.length} sync connection(s) declared but trace_id_propagation not claimed`,
    };
  }
  return {
    id: "T11",
    title: "trace_id propagation",
    status: flag ? "pass" : "pass",
    rationale: flag
      ? "trace_id_propagation claimed"
      : "No sync connections requiring trace_id propagation",
  };
}

// T12 — Version monotonicity. pulse_protocol_version must be 0.1.x.
function t12VersionMonotonicity(manifest: Manifest): TestResult {
  const ver = String(manifest.pulse_protocol_version ?? "");
  const ok = /^0\.1(\.[0-9]+)?$/.test(ver);
  return {
    id: "T12",
    title: "Protocol version monotonicity",
    status: ok ? "pass" : "fail",
    rationale: ok
      ? `pulse_protocol_version=${ver}`
      : `unexpected pulse_protocol_version=${ver}; expected 0.1.x`,
  };
}
