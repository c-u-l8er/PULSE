/**
 * Basic smoke tests for the os-pulse conformance suite.
 *
 * Run with `npm test` (uses Node's built-in test runner with experimental
 * type stripping).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ManifestValidator } from "../src/schema.ts";
import { runConformance } from "../src/conformance.ts";

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
