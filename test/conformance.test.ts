/**
 * Basic smoke tests for the os-pulse conformance suite.
 *
 * Run with `npm test` (uses Node's built-in test runner with experimental
 * type stripping).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ManifestValidator } from "../src/schema.ts";
import {
  runConformance,
  type TestResult,
  type EvidenceRung,
  type RuntimeObservation,
  type StatusCounts,
} from "../src/conformance.ts";
import {
  ceTypeFor,
  isValidToken,
  isVendorToken,
  isCanonicalToken,
} from "../src/tokens.ts";

const MINIMAL_MANIFEST = {
  $schema: "https://opensentience.org/schemas/pulse-loop-manifest.v0.1.json",
  pulse_protocol_version: "0.1",
  loop_id: "test.smoke",
  version: "0.0.1",
  owner: "test",
  workspace_scope: "required",
  phases: [
    { id: "fetch", kind: "retrieve", outputs: { to: "phase:decide" } },
    { id: "decide", kind: "route", outputs: { to: "phase:apply" } },
    { id: "apply", kind: "act", outputs: { to: "substrate:memory" } },
    { id: "feedback", kind: "learn", outputs: { to: "substrate:memory" } },
  ],
  closure: { from_phase: "feedback", to_phase: "fetch", via: "substrate:memory" },
  cadence: { type: "event", params: { trigger: "test" } },
  substrates: {
    memory: "graphonomous://workspace/{ws_id}",
    policy: "delegatic://workspace/{ws_id}",
    audit: "delegatic://workspace/{ws_id}/audit",
    auth: "open_sentience://workspace/{ws_id}",
  },
  invariants: {
    phase_atomicity: true,
    feedback_immutability: true,
    append_only_audit: true,
    outcome_grounding: true,
    trace_id_propagation: true,
  },
};

test("minimal manifest validates against v0.1 schema", () => {
  const v = new ManifestValidator();
  const res = v.check(MINIMAL_MANIFEST);
  assert.equal(res.valid, true, res.errorText);
});

test("conformance suite runs T01..T12", () => {
  const v = new ManifestValidator();
  const schemaResult = v.check(MINIMAL_MANIFEST);
  const report = runConformance(MINIMAL_MANIFEST, schemaResult);
  assert.equal(report.results.length, 12);
  assert.notEqual(report.overall, "fail");
});

test("every result has an evidence rung", () => {
  const v = new ManifestValidator();
  const schemaResult = v.check(MINIMAL_MANIFEST);
  const report = runConformance(MINIMAL_MANIFEST, schemaResult);
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
      `${r.id} has invalid evidence_rung: ${r.evidence_rung}`,
    );
  }
});

test("status counts are dynamically computed and sum to 12", () => {
  const v = new ManifestValidator();
  const schemaResult = v.check(MINIMAL_MANIFEST);
  const report = runConformance(MINIMAL_MANIFEST, schemaResult);
  const { counts } = report;
  assert.equal(counts.total, 12, `total should be 12, got ${counts.total}`);
  assert.equal(
    counts.pass + counts.fail + counts.pending,
    12,
    `pass(${counts.pass}) + fail(${counts.fail}) + pending(${counts.pending}) != 12`,
  );
  // Verify counts match actual results
  const actualPass = report.results.filter((r) => r.status === "pass").length;
  const actualFail = report.results.filter((r) => r.status === "fail").length;
  const actualPending = report.results.filter(
    (r) => r.status === "pending",
  ).length;
  assert.equal(counts.pass, actualPass);
  assert.equal(counts.fail, actualFail);
  assert.equal(counts.pending, actualPending);
});

test("runtime-required tests do not pass from manifest declarations alone", () => {
  const v = new ManifestValidator();
  // Use a manifest that claims runtime invariants
  const runtimeManifest = {
    ...MINIMAL_MANIFEST,
    invariants: {
      ...MINIMAL_MANIFEST.invariants,
      phase_atomicity: true,
      quorum_before_commit: true,
    },
  };
  const schemaResult = v.check(runtimeManifest);
  // No runtime observations supplied
  const report = runConformance(runtimeManifest, schemaResult);
  // T02 (atomicity) and T03 (idempotency) should be pending without observations
  const t02 = report.results.find((r) => r.id === "T02")!;
  assert.equal(t02.status, "pending", "T02 should be pending without runtime observation");
  const t03 = report.results.find((r) => r.id === "T03")!;
  assert.equal(t03.status, "pending", "T03 should be pending without runtime observation");
  // T06 (quorum) should be pending without observations
  const t06 = report.results.find((r) => r.id === "T06")!;
  assert.equal(t06.status, "pending", "T06 should be pending without runtime observation");
  // T08 (dedup) always pending without observation
  const t08 = report.results.find((r) => r.id === "T08")!;
  assert.equal(t08.status, "pending", "T08 should be pending without runtime observation");
  // T10 (tenant isolation) should be pending when workspace_scope=required
  const t10 = report.results.find((r) => r.id === "T10")!;
  assert.equal(t10.status, "pending", "T10 should be pending without runtime observation");
});

test("runtime observation can move a test off pending", () => {
  const v = new ManifestValidator();
  const runtimeManifest = {
    ...MINIMAL_MANIFEST,
    invariants: {
      ...MINIMAL_MANIFEST.invariants,
      phase_atomicity: true,
    },
  };
  const schemaResult = v.check(runtimeManifest);
  const obs: RuntimeObservation = {
    behavior: "phase failure triggers rollback",
    success: true,
    source: "graphonomous",
    detail: "act phase failure observed to roll back; no partial state leaked",
  };
  const report = runConformance(runtimeManifest, schemaResult, { T02: obs });
  const t02 = report.results.find((r) => r.id === "T02")!;
  assert.equal(t02.status, "pass");
  assert.equal(t02.evidence_rung, "live_local");
  assert.ok(t02.observation);
  assert.equal(t02.observation!.source, "graphonomous");
});

test("mock-sourced observation produces in_tree evidence, not live_local", () => {
  const v = new ManifestValidator();
  const runtimeManifest = {
    ...MINIMAL_MANIFEST,
    invariants: {
      ...MINIMAL_MANIFEST.invariants,
      phase_atomicity: true,
    },
  };
  const schemaResult = v.check(runtimeManifest);
  const obs: RuntimeObservation = {
    behavior: "phase failure triggers rollback",
    success: true,
    source: "mock",
    detail: "simulated atomicity check",
  };
  const report = runConformance(runtimeManifest, schemaResult, { T02: obs });
  const t02 = report.results.find((r) => r.id === "T02")!;
  assert.equal(t02.status, "pass");
  assert.equal(
    t02.evidence_rung,
    "in_tree",
    "mock observation should produce in_tree, not live_local",
  );
});

test("manifest with missing required field fails T01", () => {
  const v = new ManifestValidator();
  const bad = { ...MINIMAL_MANIFEST } as any;
  delete bad.substrates;
  const res = v.check(bad);
  assert.equal(res.valid, false);
  const report = runConformance(bad, res);
  assert.equal(report.results[0].status, "fail");
  assert.equal(report.overall, "fail");
});

// --- v0.1.2 vendor-namespaced tokens ---------------------------------------

const withConnectionToken = (token: string) => ({
  ...MINIMAL_MANIFEST,
  pulse_protocol_version: "0.1.2",
  connections: [
    {
      id: "c1",
      emit_phase: "apply",
      token,
      to_loop: "other.loop",
    },
  ],
});

test("connection with a canonical token validates", () => {
  const v = new ManifestValidator();
  const res = v.check(withConnectionToken("OutcomeSignal"));
  assert.equal(res.valid, true, res.errorText);
});

test("connection with a vendor-namespaced token validates (v0.1.2)", () => {
  const v = new ManifestValidator();
  const res = v.check(withConnectionToken("scope.v1.SpatialClaim"));
  assert.equal(res.valid, true, res.errorText);
});

test("connection with a malformed vendor token is rejected", () => {
  const v = new ManifestValidator();
  for (const bad of [
    "scope.SpatialClaim", // missing version segment
    "Scope.v1.SpatialClaim", // uppercase vendor segment
    "scope.v1.spatialClaim", // lowercase token name
    "NotAToken", // not canonical, not namespaced
  ]) {
    const res = v.check(withConnectionToken(bad));
    assert.equal(res.valid, false, `expected ${bad} to be rejected`);
  }
});

test("token helpers classify canonical vs vendor vs invalid", () => {
  assert.equal(isCanonicalToken("SurpriseSignal"), true);
  assert.equal(isVendorToken("SurpriseSignal"), false);
  assert.equal(isVendorToken("scope.v1.SpatialClaim"), true);
  assert.equal(isVendorToken("pulse.v1.Foo"), false); // reserved prefix
  assert.equal(isValidToken("scope.v1.SpatialClaim"), true);
  assert.equal(isValidToken("nope"), false);
});

test("ceTypeFor derives canonical and vendor CloudEvents types", () => {
  assert.equal(
    ceTypeFor("OutcomeSignal"),
    "org.opensentience.pulse.outcome_signal.v1",
  );
  assert.equal(
    ceTypeFor("scope.v1.SpatialClaim"),
    "scope.spatial_claim.v1",
  );
  assert.throws(() => ceTypeFor("not-a-token"));
});

// --- substrate provenance allowlist -----------------------------------------

test("arbitrary non-simulation source cannot elevate to live_local", () => {
  const v = new ManifestValidator();
  const runtimeManifest = {
    ...MINIMAL_MANIFEST,
    invariants: {
      ...MINIMAL_MANIFEST.invariants,
      phase_atomicity: true,
    },
  };
  const schemaResult = v.check(runtimeManifest);
  // An unknown source string that is not in VERIFIED_SUBSTRATES should
  // produce in_tree, not live_local — even though it is also not a
  // known simulation name.
  for (const bogus of ["banana", "my-system", "GRAPHONOMOUS", "Prism", ""]) {
    const obs: RuntimeObservation = {
      behavior: "phase failure triggers rollback",
      success: true,
      source: bogus,
      detail: "observation from unverified source",
    };
    const report = runConformance(runtimeManifest, schemaResult, { T02: obs });
    const t02 = report.results.find((r) => r.id === "T02")!;
    assert.equal(
      t02.evidence_rung,
      "in_tree",
      `source '${bogus}' must not reach live_local`,
    );
  }
});

test("verified substrate sources produce live_local", () => {
  const v = new ManifestValidator();
  const runtimeManifest = {
    ...MINIMAL_MANIFEST,
    invariants: {
      ...MINIMAL_MANIFEST.invariants,
      phase_atomicity: true,
    },
  };
  const schemaResult = v.check(runtimeManifest);
  for (const real of ["graphonomous", "prism", "agentromatic", "body-browser", "body-os"]) {
    const obs: RuntimeObservation = {
      behavior: "phase failure triggers rollback",
      success: true,
      source: real,
      detail: "observation from verified substrate",
    };
    const report = runConformance(runtimeManifest, schemaResult, { T02: obs });
    const t02 = report.results.find((r) => r.id === "T02")!;
    assert.equal(
      t02.evidence_rung,
      "live_local",
      `source '${real}' should reach live_local`,
    );
  }
});

// --- deployment provenance for live_deployed ---------------------------------

import {
  validateDeploymentProvenance,
  type DeploymentProvenance,
} from "../src/conformance.ts";

/** A valid deployment provenance for testing. */
const VALID_PROVENANCE: DeploymentProvenance = {
  endpoint_url: "https://graphonomous.fly.dev/mcp",
  identity: "graphonomous-mcp-v0.4",
  version: "0.4.0",
  request_id: "req-abc-123",
  observed_at: "2026-07-28T12:00:00Z",
  configured_endpoint: "https://graphonomous.fly.dev",
};

test("valid deployment provenance with verified substrate reaches live_deployed", () => {
  const v = new ManifestValidator();
  const runtimeManifest = {
    ...MINIMAL_MANIFEST,
    invariants: {
      ...MINIMAL_MANIFEST.invariants,
      phase_atomicity: true,
    },
  };
  const schemaResult = v.check(runtimeManifest);
  const obs: RuntimeObservation = {
    behavior: "phase failure triggers rollback",
    success: true,
    source: "graphonomous",
    detail: "observation from deployed substrate",
    deployment_provenance: VALID_PROVENANCE,
  };
  const report = runConformance(runtimeManifest, schemaResult, { T02: obs });
  const t02 = report.results.find((r) => r.id === "T02")!;
  assert.equal(
    t02.evidence_rung,
    "live_deployed",
    "verified substrate + valid deployment provenance → live_deployed",
  );
});

test("source string alone cannot reach live_deployed without deployment provenance", () => {
  const v = new ManifestValidator();
  const runtimeManifest = {
    ...MINIMAL_MANIFEST,
    invariants: {
      ...MINIMAL_MANIFEST.invariants,
      phase_atomicity: true,
    },
  };
  const schemaResult = v.check(runtimeManifest);
  // Even a verified substrate source cannot reach live_deployed without provenance
  for (const src of ["graphonomous", "prism", "agentromatic"]) {
    const obs: RuntimeObservation = {
      behavior: "phase failure triggers rollback",
      success: true,
      source: src,
      detail: "no deployment provenance attached",
      // no deployment_provenance field
    };
    const report = runConformance(runtimeManifest, schemaResult, { T02: obs });
    const t02 = report.results.find((r) => r.id === "T02")!;
    assert.notEqual(
      t02.evidence_rung,
      "live_deployed",
      `source '${src}' without deployment provenance must not reach live_deployed`,
    );
    assert.equal(
      t02.evidence_rung,
      "live_local",
      `source '${src}' without provenance should stay at live_local`,
    );
  }
});

test("localhost endpoint cannot reach live_deployed", () => {
  const v = new ManifestValidator();
  const runtimeManifest = {
    ...MINIMAL_MANIFEST,
    invariants: {
      ...MINIMAL_MANIFEST.invariants,
      phase_atomicity: true,
    },
  };
  const schemaResult = v.check(runtimeManifest);
  const localhostUrls = [
    "https://localhost:4000/mcp",
    "https://127.0.0.1:4000/mcp",
    "https://[::1]:4000/mcp",
    "https://0.0.0.0:4000/mcp",
    "https://LOCALHOST:4000/mcp",
  ];
  for (const url of localhostUrls) {
    const obs: RuntimeObservation = {
      behavior: "phase failure triggers rollback",
      success: true,
      source: "graphonomous",
      detail: "localhost observation",
      deployment_provenance: {
        ...VALID_PROVENANCE,
        endpoint_url: url,
        configured_endpoint: url.replace("/mcp", ""),
      },
    };
    const report = runConformance(runtimeManifest, schemaResult, { T02: obs });
    const t02 = report.results.find((r) => r.id === "T02")!;
    assert.notEqual(
      t02.evidence_rung,
      "live_deployed",
      `localhost URL '${url}' must not reach live_deployed`,
    );
  }
});

test("http:// (non-TLS) endpoint cannot reach live_deployed", () => {
  const v = new ManifestValidator();
  const runtimeManifest = {
    ...MINIMAL_MANIFEST,
    invariants: {
      ...MINIMAL_MANIFEST.invariants,
      phase_atomicity: true,
    },
  };
  const schemaResult = v.check(runtimeManifest);
  const obs: RuntimeObservation = {
    behavior: "phase failure triggers rollback",
    success: true,
    source: "graphonomous",
    detail: "http observation",
    deployment_provenance: {
      ...VALID_PROVENANCE,
      endpoint_url: "http://graphonomous.fly.dev/mcp",
      configured_endpoint: "http://graphonomous.fly.dev",
    },
  };
  const report = runConformance(runtimeManifest, schemaResult, { T02: obs });
  const t02 = report.results.find((r) => r.id === "T02")!;
  assert.notEqual(
    t02.evidence_rung,
    "live_deployed",
    "http:// endpoint must not reach live_deployed",
  );
});

test("missing identity in deployment provenance cannot reach live_deployed", () => {
  const v = new ManifestValidator();
  const runtimeManifest = {
    ...MINIMAL_MANIFEST,
    invariants: {
      ...MINIMAL_MANIFEST.invariants,
      phase_atomicity: true,
    },
  };
  const schemaResult = v.check(runtimeManifest);
  for (const badIdentity of ["", "  ", undefined as any]) {
    const obs: RuntimeObservation = {
      behavior: "phase failure triggers rollback",
      success: true,
      source: "graphonomous",
      detail: "missing identity",
      deployment_provenance: {
        ...VALID_PROVENANCE,
        identity: badIdentity ?? "",
      },
    };
    const report = runConformance(runtimeManifest, schemaResult, { T02: obs });
    const t02 = report.results.find((r) => r.id === "T02")!;
    assert.notEqual(
      t02.evidence_rung,
      "live_deployed",
      `empty/missing identity '${badIdentity}' must not reach live_deployed`,
    );
    // Should fall back to live_local since source is verified
    assert.equal(
      t02.evidence_rung,
      "live_local",
      `empty identity should downgrade to live_local, not further`,
    );
  }
});

test("mismatched provenance (endpoint vs configured_endpoint) cannot reach live_deployed", () => {
  const v = new ManifestValidator();
  const runtimeManifest = {
    ...MINIMAL_MANIFEST,
    invariants: {
      ...MINIMAL_MANIFEST.invariants,
      phase_atomicity: true,
    },
  };
  const schemaResult = v.check(runtimeManifest);
  const obs: RuntimeObservation = {
    behavior: "phase failure triggers rollback",
    success: true,
    source: "graphonomous",
    detail: "mismatched endpoint",
    deployment_provenance: {
      ...VALID_PROVENANCE,
      endpoint_url: "https://graphonomous.fly.dev/mcp",
      configured_endpoint: "https://different-host.fly.dev",
    },
  };
  const report = runConformance(runtimeManifest, schemaResult, { T02: obs });
  const t02 = report.results.find((r) => r.id === "T02")!;
  assert.notEqual(
    t02.evidence_rung,
    "live_deployed",
    "mismatched endpoint/configured_endpoint must not reach live_deployed",
  );
  assert.equal(
    t02.evidence_rung,
    "live_local",
    "mismatched provenance should downgrade to live_local",
  );
});

test("unverified substrate source with valid provenance cannot reach live_deployed", () => {
  const v = new ManifestValidator();
  const runtimeManifest = {
    ...MINIMAL_MANIFEST,
    invariants: {
      ...MINIMAL_MANIFEST.invariants,
      phase_atomicity: true,
    },
  };
  const schemaResult = v.check(runtimeManifest);
  // Source is not in VERIFIED_SUBSTRATES — even with valid provenance, stays in_tree
  for (const src of ["mock", "banana", "GRAPHONOMOUS", "loop-driver", ""]) {
    const obs: RuntimeObservation = {
      behavior: "phase failure triggers rollback",
      success: true,
      source: src,
      detail: "unverified source with provenance",
      deployment_provenance: VALID_PROVENANCE,
    };
    const report = runConformance(runtimeManifest, schemaResult, { T02: obs });
    const t02 = report.results.find((r) => r.id === "T02")!;
    assert.equal(
      t02.evidence_rung,
      "in_tree",
      `unverified source '${src}' with provenance must stay at in_tree`,
    );
  }
});

test("validateDeploymentProvenance returns null for valid provenance", () => {
  const result = validateDeploymentProvenance(VALID_PROVENANCE);
  assert.equal(result, null, `expected null, got: ${result}`);
});

test("validateDeploymentProvenance returns error for each invalid field", () => {
  // Missing HTTPS
  assert.notEqual(
    validateDeploymentProvenance({ ...VALID_PROVENANCE, endpoint_url: "http://example.com" }),
    null,
  );
  // Localhost
  assert.notEqual(
    validateDeploymentProvenance({ ...VALID_PROVENANCE, endpoint_url: "https://localhost/x" }),
    null,
  );
  // Empty identity
  assert.notEqual(
    validateDeploymentProvenance({ ...VALID_PROVENANCE, identity: "" }),
    null,
  );
  // Missing configured_endpoint
  assert.notEqual(
    validateDeploymentProvenance({ ...VALID_PROVENANCE, configured_endpoint: "" }),
    null,
  );
  // Mismatched
  assert.notEqual(
    validateDeploymentProvenance({ ...VALID_PROVENANCE, configured_endpoint: "https://other.dev" }),
    null,
  );
  // Missing observed_at
  assert.notEqual(
    validateDeploymentProvenance({ ...VALID_PROVENANCE, observed_at: "" }),
    null,
  );
});
