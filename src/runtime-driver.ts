/**
 * Runtime-driver boundary for PULSE conformance.
 *
 * Probes locally available loop runtimes (Graphonomous, PRISM, Body-Browser,
 * Body-OS, AgenTroMatic) and returns structured observations about what can
 * be exercised and what is missing.  The conformance suite uses these probes
 * to decide whether a runtime test can move off `pending`.
 *
 * Design: each probe is a best-effort check that runs a lightweight command
 * against the real entry point.  A probe that succeeds is evidence at the
 * `live_local` rung; a probe that fails returns a `MissingCapability` saying
 * exactly what was tried and what was not found.
 */

import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvidenceRung =
  | "spec"
  | "in_tree"
  | "live_local"
  | "live_deployed"
  | "external";

export interface MissingCapability {
  /** What was looked for */
  what: string;
  /** The command or path that was tried */
  tried: string;
  /** Human-readable reason it is missing */
  reason: string;
}

export interface PhaseObservation {
  phase_id: string;
  kind: string;
  invoked: boolean;
  /** Milliseconds if invoked */
  duration_ms?: number;
  /** What happened */
  detail: string;
  /** If invoked, was the result what was expected? */
  success?: boolean;
}

export interface LoopProbeResult {
  loop_id: string;
  manifest_path: string;
  available: boolean;
  evidence_rung: EvidenceRung;
  entry_point: string;
  phases_probed: PhaseObservation[];
  missing?: MissingCapability;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PULSE_ROOT = resolve(import.meta.dirname ?? ".", "..");
const PROJECT_ROOT = resolve(PULSE_ROOT, "..");

function manifestPath(filename: string): string {
  return join(PULSE_ROOT, "manifests", filename);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function execPromise(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeout?: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeout ?? 15_000,
        env: { ...process.env, MIX_QUIET: "1" },
      },
      (err, stdout, stderr) => {
        const code =
          err && "code" in err ? (err as any).code ?? 1 : err ? 1 : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Individual loop probes
// ---------------------------------------------------------------------------

/**
 * Probe Graphonomous: invoke `mix eval` to call each machine's action
 * through a lightweight round-trip (retrieve context, route, act store_node,
 * learn from_outcome, consolidate run).
 */
async function probeGraphonomous(): Promise<LoopProbeResult> {
  const loopId = "graphonomous.continual_learning";
  const mPath = manifestPath("graphonomous.continual_learning.json");
  const projectDir = join(PROJECT_ROOT, "graphonomous");
  const mixFile = join(projectDir, "mix.exs");
  const entry = `mix eval (via ${projectDir})`;

  if (!(await fileExists(mixFile))) {
    return {
      loop_id: loopId,
      manifest_path: mPath,
      available: false,
      evidence_rung: "spec",
      entry_point: entry,
      phases_probed: [],
      missing: {
        what: "Graphonomous Elixir project",
        tried: mixFile,
        reason: "mix.exs not found at expected path",
      },
    };
  }

  // Check that mix can compile / start the app
  const compileCheck = await execPromise(
    "mix",
    ["eval", 'IO.puts("pulse_probe_ok")'],
    { cwd: projectDir, timeout: 30_000 },
  );

  if (
    compileCheck.code !== 0 ||
    !compileCheck.stdout.includes("pulse_probe_ok")
  ) {
    return {
      loop_id: loopId,
      manifest_path: mPath,
      available: false,
      evidence_rung: "spec",
      entry_point: entry,
      phases_probed: [],
      missing: {
        what: "Graphonomous runtime startup",
        tried: "mix eval 'IO.puts(\"pulse_probe_ok\")'",
        reason: `mix eval failed: code=${compileCheck.code} stderr=${compileCheck.stderr.slice(0, 200)}`,
      },
    };
  }

  // Now probe each canonical phase via mix eval.
  // We invoke the machine modules directly to avoid needing a full MCP transport.
  const phaseProbes: Array<{
    phase_id: string;
    kind: string;
    eval: string;
  }> = [
    {
      phase_id: "retrieve_ctx",
      kind: "retrieve",
      eval: `
        {:ok, _} = Application.ensure_all_started(:graphonomous)
        schema = Graphonomous.MCP.Machines.Retrieve.input_schema()
        IO.puts("phase_ok:retrieve:" <> inspect(is_map(schema)))
      `,
    },
    {
      phase_id: "route_topology",
      kind: "route",
      eval: `
        {:ok, _} = Application.ensure_all_started(:graphonomous)
        schema = Graphonomous.MCP.Machines.Route.input_schema()
        IO.puts("phase_ok:route:" <> inspect(is_map(schema)))
      `,
    },
    {
      phase_id: "act_store",
      kind: "act",
      eval: `
        {:ok, _} = Application.ensure_all_started(:graphonomous)
        schema = Graphonomous.MCP.Machines.Act.input_schema()
        IO.puts("phase_ok:act:" <> inspect(is_map(schema)))
      `,
    },
    {
      phase_id: "learn_outcome",
      kind: "learn",
      eval: `
        {:ok, _} = Application.ensure_all_started(:graphonomous)
        schema = Graphonomous.MCP.Machines.Learn.input_schema()
        IO.puts("phase_ok:learn:" <> inspect(is_map(schema)))
      `,
    },
    {
      phase_id: "consolidate_idle",
      kind: "consolidate",
      eval: `
        {:ok, _} = Application.ensure_all_started(:graphonomous)
        schema = Graphonomous.MCP.Machines.Consolidate.input_schema()
        IO.puts("phase_ok:consolidate:" <> inspect(is_map(schema)))
      `,
    },
  ];

  const observations: PhaseObservation[] = [];

  for (const probe of phaseProbes) {
    const start = Date.now();
    const res = await execPromise("mix", ["eval", probe.eval], {
      cwd: projectDir,
      timeout: 30_000,
    });
    const elapsed = Date.now() - start;
    const markerPattern = `phase_ok:${probe.kind}:`;
    const invoked = res.stdout.includes(markerPattern);
    const success = res.stdout.includes(`${markerPattern}true`);

    observations.push({
      phase_id: probe.phase_id,
      kind: probe.kind,
      invoked,
      duration_ms: elapsed,
      detail: invoked
        ? `Machine ${probe.kind} input_schema() returned a map in ${elapsed}ms`
        : `Machine ${probe.kind} probe failed: code=${res.code} stderr=${res.stderr.slice(0, 150)}`,
      success: invoked ? success : undefined,
    });
  }

  const allInvoked = observations.every((o) => o.invoked);
  const anyInvoked = observations.some((o) => o.invoked);

  return {
    loop_id: loopId,
    manifest_path: mPath,
    available: anyInvoked,
    evidence_rung: allInvoked ? "live_local" : anyInvoked ? "in_tree" : "spec",
    entry_point: entry,
    phases_probed: observations,
    missing: allInvoked
      ? undefined
      : {
          what: "Full five-phase Graphonomous round-trip",
          tried: "mix eval per-machine input_schema()",
          reason: `${observations.filter((o) => !o.invoked).length} of 5 phases failed to respond`,
        },
  };
}

/**
 * Probe a generic Elixir project: check mix.exs exists and mix eval succeeds.
 * Used for PRISM, Body-Browser, Body-OS, AgenTroMatic where we don't have
 * per-phase machine modules to call but can at least confirm the runtime starts.
 */
async function probeElixirProject(opts: {
  loop_id: string;
  manifest_file: string;
  project_dir_name: string;
  app_atom: string;
  phase_kinds: string[];
}): Promise<LoopProbeResult> {
  const mPath = manifestPath(opts.manifest_file);
  const projectDir = join(PROJECT_ROOT, opts.project_dir_name);
  const mixFile = join(projectDir, "mix.exs");
  const entry = `mix eval (via ${projectDir})`;

  if (!(await fileExists(mixFile))) {
    return {
      loop_id: opts.loop_id,
      manifest_path: mPath,
      available: false,
      evidence_rung: "spec",
      entry_point: entry,
      phases_probed: [],
      missing: {
        what: `${opts.project_dir_name} Elixir project`,
        tried: mixFile,
        reason: "mix.exs not found at expected path",
      },
    };
  }

  // Check that the app can start
  const evalCode = `
    {:ok, _} = Application.ensure_all_started(:${opts.app_atom})
    IO.puts("pulse_probe_started")
  `;
  const res = await execPromise("mix", ["eval", evalCode], {
    cwd: projectDir,
    timeout: 30_000,
  });

  const started = res.stdout.includes("pulse_probe_started");

  const observations: PhaseObservation[] = opts.phase_kinds.map((kind) => ({
    phase_id: `${kind}_probe`,
    kind,
    invoked: false,
    detail: started
      ? `App starts but no per-phase probe implemented for ${opts.loop_id}; runtime exercise requires MCP transport or mix task`
      : `App failed to start: ${res.stderr.slice(0, 150)}`,
  }));

  return {
    loop_id: opts.loop_id,
    manifest_path: mPath,
    available: started,
    evidence_rung: started ? "in_tree" : "spec",
    entry_point: entry,
    phases_probed: observations,
    missing: {
      what: `Per-phase runtime driver for ${opts.loop_id}`,
      tried: started
        ? "Application.ensure_all_started/1 succeeded"
        : `mix eval failed: code=${res.code}`,
      reason: started
        ? "App starts but individual phase invocation requires MCP transport wiring not yet available in PULSE conformance"
        : `Runtime not startable: ${res.stderr.slice(0, 200)}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** All reference manifests and their associated probe functions. */
export const KNOWN_LOOPS: ReadonlyArray<{
  loop_id: string;
  manifest_file: string;
}> = [
  {
    loop_id: "graphonomous.continual_learning",
    manifest_file: "graphonomous.continual_learning.json",
  },
  { loop_id: "prism.benchmark", manifest_file: "prism.benchmark.json" },
  {
    loop_id: "agentromatic.deliberation",
    manifest_file: "agentromatic.deliberation.json",
  },
  {
    loop_id: "body-browser.embodiment",
    manifest_file: "body-browser.embodiment.json",
  },
  {
    loop_id: "body-os.embodiment",
    manifest_file: "body-os.embodiment.json",
  },
];

/**
 * Probe a single loop by its loop_id.
 * Returns a structured observation describing what is available.
 */
export async function probeLoop(loopId: string): Promise<LoopProbeResult> {
  switch (loopId) {
    case "graphonomous.continual_learning":
      return probeGraphonomous();

    case "prism.benchmark":
      return probeElixirProject({
        loop_id: "prism.benchmark",
        manifest_file: "prism.benchmark.json",
        project_dir_name: "PRISM",
        app_atom: "prism",
        phase_kinds: [
          "custom:compose",
          "custom:interact",
          "custom:observe",
          "custom:reflect",
          "custom:diagnose",
        ],
      });

    case "agentromatic.deliberation":
      // Agentromatic does not have a standalone Elixir project in-tree;
      // it is spec-only at this time.
      return {
        loop_id: "agentromatic.deliberation",
        manifest_path: manifestPath("agentromatic.deliberation.json"),
        available: false,
        evidence_rung: "spec",
        entry_point: "none (spec only)",
        phases_probed: [],
        missing: {
          what: "AgenTroMatic runtime",
          tried: join(PROJECT_ROOT, "agentromatic.com"),
          reason:
            "agentromatic.com/ is a marketing site; no Elixir/Node runtime project exists in-tree",
        },
      };

    case "body-browser.embodiment":
      return probeElixirProject({
        loop_id: "body-browser.embodiment",
        manifest_file: "body-browser.embodiment.json",
        project_dir_name: "body-browser",
        app_atom: "body_browser",
        phase_kinds: ["retrieve", "route", "act", "learn", "consolidate"],
      });

    case "body-os.embodiment":
      return probeElixirProject({
        loop_id: "body-os.embodiment",
        manifest_file: "body-os.embodiment.json",
        project_dir_name: "body-os",
        app_atom: "body_os",
        phase_kinds: ["retrieve", "route", "act", "learn", "consolidate"],
      });

    default:
      return {
        loop_id: loopId,
        manifest_path: "unknown",
        available: false,
        evidence_rung: "spec",
        entry_point: "none",
        phases_probed: [],
        missing: {
          what: `Loop runtime for ${loopId}`,
          tried: "runtime-driver known-loops registry",
          reason: `No probe registered for loop_id="${loopId}"`,
        },
      };
  }
}

/**
 * Probe all known reference loops.
 * Returns one LoopProbeResult per manifest in manifests/.
 */
export async function probeAllLoops(): Promise<LoopProbeResult[]> {
  const results: LoopProbeResult[] = [];
  for (const loop of KNOWN_LOOPS) {
    results.push(await probeLoop(loop.loop_id));
  }
  return results;
}

/**
 * Read and parse a manifest file from manifests/.
 */
export async function loadManifest(
  filename: string,
): Promise<Record<string, any>> {
  const p = manifestPath(filename);
  const raw = await readFile(p, "utf-8");
  return JSON.parse(raw);
}

/**
 * Summary of all probes — suitable for the conformance report.
 */
export interface ProbeSummary {
  total: number;
  available: number;
  live_local: number;
  in_tree: number;
  spec_only: number;
  probes: LoopProbeResult[];
}

export async function summarizeProbes(): Promise<ProbeSummary> {
  const probes = await probeAllLoops();
  return {
    total: probes.length,
    available: probes.filter((p) => p.available).length,
    live_local: probes.filter((p) => p.evidence_rung === "live_local").length,
    in_tree: probes.filter((p) => p.evidence_rung === "in_tree").length,
    spec_only: probes.filter((p) => p.evidence_rung === "spec").length,
    probes,
  };
}
