/**
 * 12-test PULSE v0.1 conformance suite.
 *
 * Each test reports a verdict (`pass`, `fail`, or `pending`), an evidence
 * rung naming the basis for that verdict, and a rationale identifying the
 * observation or missing capability behind it.
 *
 * Evidence rungs (from the [&] evidence ladder):
 *   `spec`          — specified/schema'd, no implementation observed
 *   `in_tree`       — tested against stubs, manifest declarations, or
 *                      in-process loop simulation (e.g. LoopDriver)
 *   `live_local`    — exercised against a real substrate on a developer machine
 *   `live_deployed` — runs in production and exercised there
 *   `external`      — validated by someone who is not us
 *
 * Three categories of evidence:
 *
 *   Manifest checks (T01, T04, T05, T06, T07, T12) reach `in_tree` when
 *   the manifest structure is sufficient to decide the verdict.
 *
 *   Behavioral observations from LoopDriver (T02, T03, T04, T05, T06,
 *   T07, T11) reach `in_tree` when the in-process loop simulation
 *   exercises the property — atomicity via failure injection, idempotency
 *   via replay, κ-routing via route-phase execution, quorum via policy
 *   check audit, append-only audit via monotonic log verification, and
 *   trace_id propagation via cross-phase trace verification.
 *
 *   Live observations from a verified substrate (source in the
 *   VERIFIED_SUBSTRATES allowlist, e.g. "graphonomous") reach
 *   `live_local`.  Unknown source strings resolve to `in_tree`.
 *
 *   Runtime-only tests (T08 signal dedup, T09 substrate degradation,
 *   T10 multi-tenant isolation) reach `in_tree` when the LoopDriver
 *   exercises the property — dedup via duplicate-trace signal comparison,
 *   degradation via null-substrate fallback, isolation via separate
 *   workspace-scoped runs.  Without an observation they remain `pending`.
 *   A manifest declaration alone never produces a runtime `pass`.
 *
 * The 12 tests (PULSE spec §12):
 *   T01  Schema validation
 *   T02  Phase atomicity (runtime)
 *   T03  Phase idempotency (runtime)
 *   T04  Nesting waits (runtime+manifest)
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

export type EvidenceRung =
  | "spec"
  | "in_tree"
  | "live_local"
  | "live_deployed"
  | "external";

/**
 * Structured deployment provenance tied to a configured HTTPS endpoint.
 *
 * `live_deployed` requires ALL of:
 *   1. `endpoint_url` is an `https://` URL (not localhost, not http://)
 *   2. `identity` is a non-empty string returned by the deployed service
 *   3. `endpoint_url` starts with the configured `configured_endpoint` prefix
 *
 * Missing, empty, or mismatched fields cause an explicit downgrade.
 */
export interface DeploymentProvenance {
  /** The HTTPS URL that was actually called. */
  endpoint_url: string;
  /** Identity string returned by the deployed service (e.g. server name, app id). */
  identity: string;
  /** Version string returned by the deployed service, if any. */
  version?: string;
  /** Deployment/request identifier returned in response headers or body. */
  request_id?: string;
  /** UTC ISO-8601 timestamp of when the observation was made. */
  observed_at: string;
  /** The configured endpoint prefix this observation is verified against. */
  configured_endpoint: string;
}

export interface RuntimeObservation {
  /** What behavior was observed or attempted. */
  behavior: string;
  /** Whether the observation succeeded. */
  success: boolean;
  /** Source of the observation.  Only sources in VERIFIED_SUBSTRATES
   *  (e.g. "graphonomous", "prism") produce `live_local` evidence;
   *  all others (including "mock", "loop-driver") produce `in_tree`.
   *  `live_deployed` additionally requires verified `deployment_provenance`. */
  source: string;
  /** Optional detail about what was missing or what failed. */
  detail?: string;
  /** Structured deployment provenance.  Required for `live_deployed`;
   *  verified against the configured HTTPS endpoint and response metadata. */
  deployment_provenance?: DeploymentProvenance;
}

export interface TestResult {
  id: string;
  title: string;
  status: TestStatus;
  evidence_rung: EvidenceRung;
  rationale: string;
  observation?: RuntimeObservation;
}

export interface StatusCounts {
  pass: number;
  fail: number;
  pending: number;
  total: number;
}

export interface ConformanceReport {
  loop_id: string;
  version: string;
  overall: "pass" | "fail" | "pending";
  counts: StatusCounts;
  results: TestResult[];
}

type Manifest = Record<string, any>;

/** Optional runtime observations keyed by test id (e.g. "T02"). */
export type RuntimeObservations = Partial<Record<string, RuntimeObservation>>;

/**
 * Substrates whose provenance has been verified against reference manifests
 * in `manifests/`.  Only observations whose `source` matches one of these
 * names may reach `live_local`; every other source — including unknown
 * strings — resolves to `in_tree` at most.
 *
 * This is an allowlist, not a denylist: an arbitrary non-simulation source
 * string cannot elevate evidence.
 */
const VERIFIED_SUBSTRATES = new Set([
  "graphonomous",
  "prism",
  "agentromatic",
  "body-browser",
  "body-os",
]);

/**
 * Validate deployment provenance for `live_deployed` eligibility.
 *
 * Returns `null` when valid, or a string naming the specific disqualification.
 * Each check is explicit so adverse tests can target individual failure modes.
 */
export function validateDeploymentProvenance(
  prov: DeploymentProvenance,
): string | null {
  // 1. endpoint_url must be https://
  if (!prov.endpoint_url || !prov.endpoint_url.startsWith("https://")) {
    return `endpoint_url is not HTTPS: ${prov.endpoint_url ?? "(empty)"}`;
  }
  // 2. No localhost — deployed means remote
  const urlLower = prov.endpoint_url.toLowerCase();
  if (
    urlLower.includes("://localhost") ||
    urlLower.includes("://127.0.0.1") ||
    urlLower.includes("://[::1]") ||
    urlLower.includes("://0.0.0.0")
  ) {
    return `endpoint_url points to localhost: ${prov.endpoint_url}`;
  }
  // 3. identity must be non-empty
  if (!prov.identity || prov.identity.trim().length === 0) {
    return `identity is missing or empty`;
  }
  // 4. configured_endpoint must be non-empty
  if (
    !prov.configured_endpoint ||
    prov.configured_endpoint.trim().length === 0
  ) {
    return `configured_endpoint is missing or empty`;
  }
  // 5. endpoint_url must start with configured_endpoint (provenance match)
  if (!prov.endpoint_url.startsWith(prov.configured_endpoint)) {
    return `endpoint_url '${prov.endpoint_url}' does not match configured_endpoint '${prov.configured_endpoint}'`;
  }
  // 6. observed_at must be a non-empty string (ISO timestamp)
  if (!prov.observed_at || prov.observed_at.trim().length === 0) {
    return `observed_at timestamp is missing or empty`;
  }
  return null;
}

function evidenceRungFor(obs: RuntimeObservation): EvidenceRung {
  // Check for live_deployed first: requires verified substrate + valid
  // deployment provenance from a configured HTTPS endpoint.
  if (obs.deployment_provenance && VERIFIED_SUBSTRATES.has(obs.source)) {
    const error = validateDeploymentProvenance(obs.deployment_provenance);
    if (error === null) {
      return "live_deployed";
    }
    // Provenance present but invalid → downgrade, do not silently elevate.
    // The observation still qualifies for live_local via the substrate check.
  }
  return VERIFIED_SUBSTRATES.has(obs.source) ? "live_local" : "in_tree";
}

function computeCounts(results: TestResult[]): StatusCounts {
  const counts: StatusCounts = { pass: 0, fail: 0, pending: 0, total: results.length };
  for (const r of results) {
    counts[r.status]++;
  }
  return counts;
}

export function runConformance(
  manifest: Manifest,
  schemaResult: ValidationResult,
  observations?: RuntimeObservations,
): ConformanceReport {
  const obs = observations ?? {};
  const results: TestResult[] = [
    t01Schema(schemaResult),
    t02Atomicity(manifest, obs["T02"]),
    t03Idempotency(manifest, obs["T03"]),
    t04NestingWaits(manifest, obs["T04"]),
    t05KappaRouting(manifest, obs["T05"]),
    t06Quorum(manifest, obs["T06"]),
    t07AppendOnlyAudit(manifest, obs["T07"]),
    t08Dedup(obs["T08"]),
    t09Degradation(manifest, obs["T09"]),
    t10TenantIsolation(manifest, obs["T10"]),
    t11TraceIdProp(manifest, obs["T11"]),
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
    counts: computeCounts(results),
    results,
  };
}

// T01 — Schema validation. Authoritative; fails if ajv rejects.
function t01Schema(schemaResult: ValidationResult): TestResult {
  return {
    id: "T01",
    title: "Schema validation",
    status: schemaResult.valid ? "pass" : "fail",
    evidence_rung: "in_tree",
    rationale: schemaResult.valid
      ? "Manifest validates against pulse-loop-manifest.v0.1.json"
      : schemaResult.errorText,
  };
}

// T02 — Phase atomicity. Requires runtime observation to pass.
// Manifest on_failure declarations are necessary but not sufficient.
function t02Atomicity(manifest: Manifest, obs?: RuntimeObservation): TestResult {
  const atomicityFlag = manifest.invariants?.phase_atomicity === true;
  if (!atomicityFlag) {
    return {
      id: "T02",
      title: "Phase atomicity",
      status: "pass",
      evidence_rung: "in_tree",
      rationale: "phase_atomicity invariant not claimed; test not applicable",
    };
  }
  // If a runtime observation was supplied, use it
  if (obs) {
    return {
      id: "T02",
      title: "Phase atomicity",
      status: obs.success ? "pass" : "fail",
      evidence_rung: evidenceRungFor(obs),
      rationale: obs.success
        ? `Phase atomicity observed: ${obs.detail ?? obs.behavior}`
        : `Phase atomicity violation: ${obs.detail ?? obs.behavior}`,
      observation: obs,
    };
  }
  // Manifest declares the invariant but no runtime observation available
  const phases: any[] = manifest.phases ?? [];
  const weak = phases.filter(
    (p) => !p.on_failure && p.kind !== "consolidate",
  );
  return {
    id: "T02",
    title: "Phase atomicity",
    status: "pending",
    evidence_rung: "spec",
    rationale: weak.length === 0
      ? "All mutating phases declare on_failure, but runtime atomicity behavior not observed"
      : `${weak.length} phase(s) without on_failure; runtime atomicity behavior not observed`,
  };
}

// T03 — Phase idempotency. Requires runtime observation to confirm retry safety.
function t03Idempotency(manifest: Manifest, obs?: RuntimeObservation): TestResult {
  if (obs) {
    return {
      id: "T03",
      title: "Phase idempotency",
      status: obs.success ? "pass" : "fail",
      evidence_rung: evidenceRungFor(obs),
      rationale: obs.success
        ? `Phase idempotency observed: ${obs.detail ?? obs.behavior}`
        : `Phase idempotency violation: ${obs.detail ?? obs.behavior}`,
      observation: obs,
    };
  }
  const phases: any[] = manifest.phases ?? [];
  const anyIdempotent = phases.some((p) => p.idempotent === true);
  return {
    id: "T03",
    title: "Phase idempotency",
    status: "pending",
    evidence_rung: anyIdempotent ? "spec" : "spec",
    rationale: anyIdempotent
      ? "At least one phase declares idempotent: true, but runtime retry behavior not observed"
      : "No phase declares idempotent: true; runtime retry semantics cannot be verified",
  };
}

// T04 — Nesting waits. Manifest structure can prove or disprove;
// runtime observation elevates the evidence.
function t04NestingWaits(manifest: Manifest, obs?: RuntimeObservation): TestResult {
  const inner: any[] = manifest.nesting?.inner_loops ?? [];
  if (inner.length === 0) {
    return {
      id: "T04",
      title: "Nesting waits",
      status: "pass",
      evidence_rung: "in_tree",
      rationale: "No inner loops declared; nesting wait not applicable",
    };
  }
  const missing = inner.filter((l) => !l.wait);
  if (missing.length > 0) {
    return {
      id: "T04",
      title: "Nesting waits",
      status: "fail",
      evidence_rung: "in_tree",
      rationale: `${missing.length} inner loop(s) missing 'wait' field`,
    };
  }
  if (obs) {
    return {
      id: "T04",
      title: "Nesting waits",
      status: obs.success ? "pass" : "fail",
      evidence_rung: evidenceRungFor(obs),
      rationale: obs.success
        ? `Nesting wait observed: ${obs.detail ?? obs.behavior}`
        : `Nesting wait violation: ${obs.detail ?? obs.behavior}`,
      observation: obs,
    };
  }
  return {
    id: "T04",
    title: "Nesting waits",
    status: "pass",
    evidence_rung: "in_tree",
    rationale: `All ${inner.length} inner loop(s) declare wait strategy (manifest check only)`,
  };
}

// T05 — κ-routing. Manifest check for route phase; runtime observation for actual routing.
function t05KappaRouting(manifest: Manifest, obs?: RuntimeObservation): TestResult {
  const flag = manifest.invariants?.kappa_routing === true;
  if (!flag) {
    return {
      id: "T05",
      title: "κ-routing",
      status: "pass",
      evidence_rung: "in_tree",
      rationale: "kappa_routing invariant not claimed; test not applicable",
    };
  }
  const phases: any[] = manifest.phases ?? [];
  const hasRoute = phases.some((p) => p.kind === "route");
  if (!hasRoute) {
    return {
      id: "T05",
      title: "κ-routing",
      status: "fail",
      evidence_rung: "in_tree",
      rationale: "kappa_routing claimed but no route phase found",
    };
  }
  if (obs) {
    return {
      id: "T05",
      title: "κ-routing",
      status: obs.success ? "pass" : "fail",
      evidence_rung: evidenceRungFor(obs),
      rationale: obs.success
        ? `κ-routing observed: ${obs.detail ?? obs.behavior}`
        : `κ-routing failure: ${obs.detail ?? obs.behavior}`,
      observation: obs,
    };
  }
  return {
    id: "T05",
    title: "κ-routing",
    status: "pass",
    evidence_rung: "in_tree",
    rationale: "kappa_routing claimed and route phase present (manifest check only)",
  };
}

// T06 — Quorum before commit. Manifest check for policy markers;
// runtime observation needed to confirm enforcement.
function t06Quorum(manifest: Manifest, obs?: RuntimeObservation): TestResult {
  const flag = manifest.invariants?.quorum_before_commit === true;
  if (!flag) {
    return {
      id: "T06",
      title: "Quorum before commit",
      status: "pass",
      evidence_rung: "in_tree",
      rationale: "quorum_before_commit invariant not claimed; test not applicable",
    };
  }
  const phases: any[] = manifest.phases ?? [];
  const actPhases = phases.filter((p) => p.kind === "act");
  if (actPhases.length === 0) {
    return {
      id: "T06",
      title: "Quorum before commit",
      status: "fail",
      evidence_rung: "in_tree",
      rationale: "quorum_before_commit claimed but no act phase",
    };
  }
  if (obs) {
    return {
      id: "T06",
      title: "Quorum before commit",
      status: obs.success ? "pass" : "fail",
      evidence_rung: evidenceRungFor(obs),
      rationale: obs.success
        ? `Quorum enforcement observed: ${obs.detail ?? obs.behavior}`
        : `Quorum enforcement failure: ${obs.detail ?? obs.behavior}`,
      observation: obs,
    };
  }
  const allProtected = actPhases.every(
    (p) => p.policy_check != null || p.invariant != null,
  );
  return {
    id: "T06",
    title: "Quorum before commit",
    status: "pending",
    evidence_rung: "spec",
    rationale: allProtected
      ? "All act phases declare policy_check or invariant, but runtime quorum enforcement not observed"
      : "Some act phases lack static quorum markers; runtime check required",
  };
}

// T07 — Append-only audit. Manifest can confirm substrate declaration;
// runtime observation needed to confirm append-only behavior.
function t07AppendOnlyAudit(manifest: Manifest, obs?: RuntimeObservation): TestResult {
  const flag = manifest.invariants?.append_only_audit === true;
  if (!flag) {
    return {
      id: "T07",
      title: "Append-only audit",
      status: "pass",
      evidence_rung: "in_tree",
      rationale: "append_only_audit invariant not claimed; test not applicable",
    };
  }
  const audit = manifest.substrates?.audit;
  if (!audit) {
    return {
      id: "T07",
      title: "Append-only audit",
      status: "fail",
      evidence_rung: "in_tree",
      rationale: "append_only_audit claimed but substrates.audit is null",
    };
  }
  if (obs) {
    return {
      id: "T07",
      title: "Append-only audit",
      status: obs.success ? "pass" : "fail",
      evidence_rung: evidenceRungFor(obs),
      rationale: obs.success
        ? `Append-only audit observed: ${obs.detail ?? obs.behavior}`
        : `Append-only audit violation: ${obs.detail ?? obs.behavior}`,
      observation: obs,
    };
  }
  return {
    id: "T07",
    title: "Append-only audit",
    status: "pass",
    evidence_rung: "in_tree",
    rationale: `audit substrate declared (${audit}); append-only behavior not runtime-verified`,
  };
}

// T08 — Signal deduplication. Purely runtime — requires observed CloudEvent id uniqueness.
function t08Dedup(obs?: RuntimeObservation): TestResult {
  if (obs) {
    return {
      id: "T08",
      title: "Signal deduplication",
      status: obs.success ? "pass" : "fail",
      evidence_rung: evidenceRungFor(obs),
      rationale: obs.success
        ? `Signal dedup observed: ${obs.detail ?? obs.behavior}`
        : `Signal dedup failure: ${obs.detail ?? obs.behavior}`,
      observation: obs,
    };
  }
  return {
    id: "T08",
    title: "Signal deduplication",
    status: "pending",
    evidence_rung: "spec",
    rationale: "Runtime dedup check requires observed CloudEvent id uniqueness; no observation supplied",
  };
}

// T09 — Substrate degradation. Manifest can identify null substrates;
// runtime observation needed to verify fallback behavior.
function t09Degradation(manifest: Manifest, obs?: RuntimeObservation): TestResult {
  const subs = manifest.substrates ?? {};
  const nulls = Object.entries(subs).filter(([, v]) => v == null);
  if (nulls.length === 0) {
    return {
      id: "T09",
      title: "Substrate degradation",
      status: "pass",
      evidence_rung: "in_tree",
      rationale: "All declared substrates are non-null; degradation not applicable",
    };
  }
  if (obs) {
    return {
      id: "T09",
      title: "Substrate degradation",
      status: obs.success ? "pass" : "fail",
      evidence_rung: evidenceRungFor(obs),
      rationale: obs.success
        ? `Substrate degradation observed: ${obs.detail ?? obs.behavior}`
        : `Substrate degradation failure: ${obs.detail ?? obs.behavior}`,
      observation: obs,
    };
  }
  return {
    id: "T09",
    title: "Substrate degradation",
    status: "pending",
    evidence_rung: "spec",
    rationale: `${nulls.length} null substrate(s); runtime fallback behavior not observed`,
  };
}

// T10 — Multi-tenant isolation. Runtime-only when workspace_scope=required.
function t10TenantIsolation(manifest: Manifest, obs?: RuntimeObservation): TestResult {
  const ws = manifest.workspace_scope;
  if (ws !== "required") {
    return {
      id: "T10",
      title: "Multi-tenant isolation",
      status: "pass",
      evidence_rung: "in_tree",
      rationale: `workspace_scope=${ws}; multi-tenant isolation not in scope`,
    };
  }
  if (obs) {
    return {
      id: "T10",
      title: "Multi-tenant isolation",
      status: obs.success ? "pass" : "fail",
      evidence_rung: evidenceRungFor(obs),
      rationale: obs.success
        ? `Tenant isolation observed: ${obs.detail ?? obs.behavior}`
        : `Tenant isolation violation: ${obs.detail ?? obs.behavior}`,
      observation: obs,
    };
  }
  return {
    id: "T10",
    title: "Multi-tenant isolation",
    status: "pending",
    evidence_rung: "spec",
    rationale: "workspace_scope=required; runtime isolation behavior not observed",
  };
}

// T11 — trace_id propagation. Manifest check for sync connections;
// runtime observation needed to confirm propagation.
function t11TraceIdProp(manifest: Manifest, obs?: RuntimeObservation): TestResult {
  const flag = manifest.invariants?.trace_id_propagation === true;
  const conns: any[] = manifest.connections ?? [];
  const syncConns = conns.filter((c) => c.cadence === "sync");
  if (syncConns.length > 0 && !flag) {
    return {
      id: "T11",
      title: "trace_id propagation",
      status: "fail",
      evidence_rung: "in_tree",
      rationale: `${syncConns.length} sync connection(s) declared but trace_id_propagation not claimed`,
    };
  }
  if (obs) {
    return {
      id: "T11",
      title: "trace_id propagation",
      status: obs.success ? "pass" : "fail",
      evidence_rung: evidenceRungFor(obs),
      rationale: obs.success
        ? `trace_id propagation observed: ${obs.detail ?? obs.behavior}`
        : `trace_id propagation failure: ${obs.detail ?? obs.behavior}`,
      observation: obs,
    };
  }
  return {
    id: "T11",
    title: "trace_id propagation",
    status: flag ? "pass" : "pass",
    evidence_rung: "in_tree",
    rationale: flag
      ? "trace_id_propagation claimed (manifest check only; runtime propagation not observed)"
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
    evidence_rung: "in_tree",
    rationale: ok
      ? `pulse_protocol_version=${ver}`
      : `unexpected pulse_protocol_version=${ver}; expected 0.1.x`,
  };
}

// ---------------------------------------------------------------------------
// Coverage matrix — property-by-property successful + adverse observations
// ---------------------------------------------------------------------------

/** Status of one observation (successful or adverse) for a runtime property. */
export type ObservationStatus =
  | { observed: true; evidence_rung: EvidenceRung; detail: string }
  | { observed: false; reason: string };

/** Coverage entry for a single runtime property. */
export interface PropertyCoverage {
  /** Human-readable property name (e.g. "atomicity"). */
  property: string;
  /** Conformance test id (e.g. "T02"). */
  test_id: string;
  /** Whether a successful (happy-path) observation was supplied. */
  successful: ObservationStatus;
  /** Whether an adverse (failure/violation) observation was supplied. */
  adverse: ObservationStatus;
}

/** Summary counts for the coverage matrix. */
export interface CoverageMatrixSummary {
  /** Number of properties with at least one observation (successful or adverse). */
  observed: number;
  /** Number of properties with no observation at all. */
  pending: number;
  /** Total number of runtime properties in the matrix. */
  total: number;
}

/** Full coverage matrix: one row per runtime property. */
export interface CoverageMatrix {
  properties: PropertyCoverage[];
  summary: CoverageMatrixSummary;
}

/**
 * The 10 runtime properties mapped by test id.
 * T01 and T12 are manifest-only checks and do not appear in the matrix.
 */
const RUNTIME_PROPERTIES: { test_id: string; property: string }[] = [
  { test_id: "T02", property: "atomicity" },
  { test_id: "T03", property: "idempotency" },
  { test_id: "T04", property: "nesting_waits" },
  { test_id: "T05", property: "routing" },
  { test_id: "T06", property: "quorum" },
  { test_id: "T07", property: "append_only_audit" },
  { test_id: "T08", property: "signal_dedup" },
  { test_id: "T09", property: "degradation" },
  { test_id: "T10", property: "tenant_isolation" },
  { test_id: "T11", property: "trace_propagation" },
];

/**
 * Build a property-by-property coverage matrix from conformance results
 * and explicit adverse observations.
 *
 * `successfulObs` — observations from the normal/happy-path run (keyed by test id).
 * `adverseObs`    — observations from adverse/failure runs (keyed by test id).
 *
 * A property is "observed" if it has at least a successful OR adverse observation.
 * A property is "pending" if neither was supplied.
 */
export function buildCoverageMatrix(
  report: ConformanceReport,
  successfulObs: RuntimeObservations,
  adverseObs: RuntimeObservations,
): CoverageMatrix {
  const properties: PropertyCoverage[] = RUNTIME_PROPERTIES.map(({ test_id, property }) => {
    const result = report.results.find((r) => r.id === test_id);
    const sObs = successfulObs[test_id];
    const aObs = adverseObs[test_id];

    // If the test passed without a runtime observation (e.g. invariant not
    // claimed, so the property is not applicable), treat the manifest-level
    // pass as a successful observation at the manifest's evidence rung.
    const successful: ObservationStatus = sObs
      ? { observed: true, evidence_rung: evidenceRungFor(sObs), detail: sObs.detail ?? sObs.behavior }
      : result && result.status === "pass" && !result.observation
        ? { observed: true, evidence_rung: result.evidence_rung, detail: result.rationale }
        : { observed: false, reason: result?.status === "pending"
            ? (result.rationale ?? `no successful observation for ${property}`)
            : `no successful observation supplied for ${property}` };

    const adverse: ObservationStatus = aObs
      ? { observed: true, evidence_rung: evidenceRungFor(aObs), detail: aObs.detail ?? aObs.behavior }
      : { observed: false, reason: `no adverse observation supplied for ${property}` };

    return { property, test_id, successful, adverse };
  });

  let observed = 0;
  let pending = 0;
  for (const p of properties) {
    if (p.successful.observed || p.adverse.observed) {
      observed++;
    } else {
      pending++;
    }
  }

  return {
    properties,
    summary: { observed, pending, total: properties.length },
  };
}
