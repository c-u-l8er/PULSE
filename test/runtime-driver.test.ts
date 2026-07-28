/**
 * Tests for the runtime-driver boundary.
 *
 * These tests probe real locally-available loop runtimes and verify the
 * structured observations returned by the driver.  They are intentionally
 * tolerant of unavailable runtimes — a missing runtime is a valid observation,
 * not a test failure.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  probeLoop,
  probeAllLoops,
  summarizeProbes,
  loadManifest,
  KNOWN_LOOPS,
  type LoopProbeResult,
  type EvidenceRung,
  type BehavioralObservation,
} from "../src/runtime-driver.ts";

const VALID_RUNGS: EvidenceRung[] = [
  "spec",
  "in_tree",
  "live_local",
  "live_deployed",
  "external",
];

test("KNOWN_LOOPS covers all manifests in manifests/", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const manifestDir = path.resolve(import.meta.dirname ?? ".", "..", "manifests");
  const files = await fs.readdir(manifestDir);
  const jsonFiles = files.filter((f: string) => f.endsWith(".json"));
  assert.equal(
    KNOWN_LOOPS.length,
    jsonFiles.length,
    `KNOWN_LOOPS has ${KNOWN_LOOPS.length} entries but manifests/ has ${jsonFiles.length} files`,
  );
  for (const loop of KNOWN_LOOPS) {
    assert.ok(
      jsonFiles.includes(loop.manifest_file),
      `KNOWN_LOOPS references ${loop.manifest_file} which is not in manifests/`,
    );
  }
});

test("probeLoop returns valid structure for each known loop", async () => {
  for (const loop of KNOWN_LOOPS) {
    const result = await probeLoop(loop.loop_id);
    assert.equal(result.loop_id, loop.loop_id);
    assert.ok(
      VALID_RUNGS.includes(result.evidence_rung),
      `${loop.loop_id}: evidence_rung "${result.evidence_rung}" not in valid set`,
    );
    assert.equal(typeof result.available, "boolean");
    assert.equal(typeof result.entry_point, "string");
    assert.ok(Array.isArray(result.phases_probed));

    // If not available, must have a missing capability explanation
    if (!result.available) {
      assert.ok(
        result.missing != null,
        `${loop.loop_id}: unavailable but no missing capability reported`,
      );
      assert.ok(result.missing!.what.length > 0);
      assert.ok(result.missing!.tried.length > 0);
      assert.ok(result.missing!.reason.length > 0);
    }
  }
});

test("probeLoop for unknown loop_id returns spec-level missing observation", async () => {
  const result = await probeLoop("nonexistent.loop");
  assert.equal(result.available, false);
  assert.equal(result.evidence_rung, "spec");
  assert.ok(result.missing != null);
  assert.ok(result.missing!.reason.includes("nonexistent.loop"));
});

test("probeAllLoops returns exactly one result per KNOWN_LOOPS entry", async () => {
  const results = await probeAllLoops();
  assert.equal(results.length, KNOWN_LOOPS.length);
  const ids = results.map((r: LoopProbeResult) => r.loop_id);
  for (const loop of KNOWN_LOOPS) {
    assert.ok(ids.includes(loop.loop_id), `missing probe for ${loop.loop_id}`);
  }
});

test("summarizeProbes counts sum to total", async () => {
  const summary = await summarizeProbes();
  assert.equal(summary.total, KNOWN_LOOPS.length);
  assert.equal(
    summary.live_local + summary.in_tree + summary.spec_only,
    summary.total,
    "live_local + in_tree + spec_only must sum to total",
  );
  assert.ok(summary.available >= 0);
  assert.ok(summary.available <= summary.total);
  // Behavioral counts must be non-negative and sum correctly
  assert.ok(summary.behavioral_observed >= 0);
  assert.ok(summary.behavioral_pending >= 0);
});

test("loadManifest reads and parses a real manifest", async () => {
  const m = await loadManifest("graphonomous.continual_learning.json");
  assert.equal(m.loop_id, "graphonomous.continual_learning");
  assert.ok(Array.isArray(m.phases));
  assert.ok(m.phases.length >= 5);
});

test("graphonomous probe reports phases when available", async () => {
  const result = await probeLoop("graphonomous.continual_learning");
  // We don't assert it must be available — the test runs in CI too.
  // But if it is available, the phases must be reported.
  if (result.available) {
    assert.ok(
      result.phases_probed.length > 0,
      "available but no phases probed",
    );
    for (const obs of result.phases_probed) {
      assert.ok(typeof obs.phase_id === "string");
      assert.ok(typeof obs.kind === "string");
      assert.ok(typeof obs.detail === "string");
      assert.ok(obs.detail.length > 0);
    }
    // If all five phases responded, evidence should be live_local
    const allInvoked = result.phases_probed.every(
      (p: { invoked: boolean }) => p.invoked,
    );
    if (allInvoked) {
      assert.equal(result.evidence_rung, "live_local");
    }
  }
});

test("graphonomous probe includes behavioral observations when available", async () => {
  const result = await probeLoop("graphonomous.continual_learning");
  if (result.available && result.evidence_rung === "live_local") {
    // When all five phases succeed, behavioral probes must be present
    assert.ok(
      result.behavioral != null && result.behavioral.length > 0,
      "live_local probe must include behavioral observations",
    );
    for (const obs of result.behavioral!) {
      assert.ok(typeof obs.property === "string" && obs.property.length > 0);
      assert.ok(typeof obs.observed === "boolean");
      assert.ok(
        VALID_RUNGS.includes(obs.evidence_rung),
        `behavioral ${obs.property}: evidence_rung "${obs.evidence_rung}" not valid`,
      );
      assert.ok(typeof obs.detail === "string" && obs.detail.length > 0);
      // observed=false must not claim live_local evidence
      if (!obs.observed) {
        assert.notEqual(
          obs.evidence_rung,
          "live_local",
          `behavioral ${obs.property}: not observed but claims live_local`,
        );
      }
    }
    // Must include at least the idempotency and routing probes
    const properties = result.behavioral!.map(
      (b: BehavioralObservation) => b.property,
    );
    assert.ok(
      properties.includes("phase_idempotency"),
      "missing phase_idempotency behavioral observation",
    );
    assert.ok(
      properties.includes("kappa_routing"),
      "missing kappa_routing behavioral observation",
    );
  }
});

test("agentromatic probe reports spec-only (no runtime in-tree)", async () => {
  const result = await probeLoop("agentromatic.deliberation");
  assert.equal(result.available, false);
  assert.equal(result.evidence_rung, "spec");
  assert.ok(result.missing != null);
});
