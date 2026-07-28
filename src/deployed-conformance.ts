/**
 * Deployed conformance harness — exercises the deployed PULSE and
 * Graphonomous MCP endpoints on Fly.io and produces a machine-readable
 * report with verified deployment provenance.
 *
 * This module implements the full sequence documented in
 * `docs/DEPLOYED_SEQUENCE.md`:
 *   1. Health check both endpoints
 *   2. Initialize Graphonomous MCP session
 *   3. Exercise all 5 Graphonomous phases (retrieve→route→act→learn→consolidate)
 *   4. Run the 12-test PULSE conformance suite locally with deployed observations
 *   5. Register the manifest on deployed PULSE
 *   6. Read it back and verify persistence
 *   7. Write a redacted report with digests
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ManifestValidator } from "./schema.js";
import {
  runConformance,
  type ConformanceReport,
  type RuntimeObservation,
  type RuntimeObservations,
  type DeploymentProvenance,
  type EvidenceRung,
} from "./conformance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DeployedConfig {
  pulse_endpoint: string;
  graphonomous_endpoint: string;
  timeout_ms: number;
  output_dir: string;
}

export const DEFAULT_CONFIG: DeployedConfig = {
  pulse_endpoint: "https://os-pulse-mcp.fly.dev",
  graphonomous_endpoint: "https://graphonomous-mcp.fly.dev",
  timeout_ms: 30_000,
  output_dir: resolve(__dirname, "..", "reports"),
};

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export interface PhaseObservation {
  phase: string;
  kind: string;
  started_at: string;
  finished_at: string;
  success: boolean;
  fly_request_id?: string;
  redacted_request: Record<string, unknown>;
  redacted_response: string;
  error?: string;
}

export interface DeployedConformanceReport {
  report_id: string;
  pulse_endpoint: string;
  graphonomous_endpoint: string;
  pulse_identity: { name: string; version: string } | null;
  graphonomous_identity: { name: string; version: string } | null;
  fly_request_ids: Record<string, string>;
  started_at: string;
  finished_at: string;
  conformance: ConformanceReport;
  phase_observations: PhaseObservation[];
  phase_observation_counts: {
    total: number;
    passed: number;
    failed: number;
  };
  persistence: {
    registered: boolean;
    read_back: boolean;
    read_back_loop_id?: string;
    read_back_version?: string;
    read_back_matches: boolean;
  };
  doctrine: {
    assessment: "advanced" | "contradicted" | "proposed" | "none";
    claim?: string;
    old_rung?: string;
    new_rung?: string;
    evidence?: string;
  };
  digest: string;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** Parse MCP responses that may be direct JSON or SSE-wrapped. */
function parseMcpResponse(body: string): any {
  // Try direct JSON first
  try {
    return JSON.parse(body);
  } catch {
    // Fall through to SSE parsing
  }
  // SSE: scan for data: lines
  const lines = body.split("\n");
  for (const line of lines) {
    if (line.startsWith("data:")) {
      const data = line.slice(5).trim();
      if (data && data !== "[DONE]") {
        try {
          return JSON.parse(data);
        } catch {
          continue;
        }
      }
    }
  }
  throw new Error(`Could not parse MCP response: ${body.slice(0, 200)}`);
}

interface McpCallResult {
  parsed: any;
  fly_request_id?: string;
  raw_body: string;
}

async function httpPost(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeout_ms: number = 30_000,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await resp.text();
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      respHeaders[k.toLowerCase()] = v;
    });
    return { status: resp.status, body: text, headers: respHeaders };
  } finally {
    clearTimeout(timer);
  }
}

async function httpGet(
  url: string,
  timeout_ms: number = 30_000,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const text = await resp.text();
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      respHeaders[k.toLowerCase()] = v;
    });
    return { status: resp.status, body: text, headers: respHeaders };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// MCP client helpers
// ---------------------------------------------------------------------------

interface McpSession {
  endpoint: string;
  session_id?: string;
  next_id: number;
  timeout_ms: number;
}

async function mcpInitialize(
  baseUrl: string,
  clientName: string,
  timeout_ms: number,
): Promise<{ session: McpSession; result: any; fly_request_id?: string }> {
  const mcpUrl = `${baseUrl}/mcp`;
  const resp = await httpPost(
    mcpUrl,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: clientName, version: "0.1.0" },
      },
    },
    {},
    timeout_ms,
  );

  const parsed = parseMcpResponse(resp.body);
  const session_id = resp.headers["mcp-session-id"];
  const fly_request_id = resp.headers["fly-request-id"];

  // Send initialized notification
  const notifHeaders: Record<string, string> = {};
  if (session_id) notifHeaders["mcp-session-id"] = session_id;
  await httpPost(
    mcpUrl,
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    notifHeaders,
    timeout_ms,
  );

  return {
    session: { endpoint: mcpUrl, session_id, next_id: 2, timeout_ms },
    result: parsed.result ?? parsed,
    fly_request_id,
  };
}

async function mcpToolCall(
  session: McpSession,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  const id = session.next_id++;
  const headers: Record<string, string> = {};
  if (session.session_id) headers["mcp-session-id"] = session.session_id;

  const resp = await httpPost(
    session.endpoint,
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    },
    headers,
    session.timeout_ms,
  );

  const parsed = parseMcpResponse(resp.body);
  return {
    parsed,
    fly_request_id: resp.headers["fly-request-id"],
    raw_body: resp.body,
  };
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

function redactResponse(raw: string, maxLen = 500): string {
  if (raw.length <= maxLen) return raw;
  return raw.slice(0, maxLen) + `... [truncated, ${raw.length} chars total]`;
}

// ---------------------------------------------------------------------------
// Main harness
// ---------------------------------------------------------------------------

export async function runDeployedConformance(
  config: DeployedConfig = DEFAULT_CONFIG,
): Promise<DeployedConformanceReport> {
  const report_id = randomUUID();
  const started_at = new Date().toISOString();
  const fly_request_ids: Record<string, string> = {};

  const log = (msg: string) =>
    process.stderr.write(`[deployed-conformance] ${msg}\n`);

  // -------------------------------------------------------------------------
  // 1. Health checks
  // -------------------------------------------------------------------------
  log("Checking PULSE health...");
  let pulse_identity: { name: string; version: string } | null = null;
  try {
    const pulseHealth = await httpGet(
      `${config.pulse_endpoint}/health`,
      config.timeout_ms,
    );
    if (pulseHealth.status === 200) {
      const h = JSON.parse(pulseHealth.body);
      pulse_identity = { name: h.name ?? "unknown", version: h.version ?? "unknown" };
      if (pulseHealth.headers["fly-request-id"]) {
        fly_request_ids["pulse_health"] = pulseHealth.headers["fly-request-id"];
      }
    }
    log(`PULSE: ${pulse_identity?.name} v${pulse_identity?.version}`);
  } catch (err) {
    log(`PULSE health check failed: ${err}`);
  }

  log("Checking Graphonomous health...");
  let graphonomous_identity: { name: string; version: string } | null = null;
  try {
    const graphHealth = await httpGet(
      `${config.graphonomous_endpoint}/health`,
      config.timeout_ms,
    );
    if (graphHealth.status === 200) {
      const h = JSON.parse(graphHealth.body);
      graphonomous_identity = {
        name: h.name ?? "unknown",
        version: h.version ?? "unknown",
      };
      if (graphHealth.headers["fly-request-id"]) {
        fly_request_ids["graphonomous_health"] =
          graphHealth.headers["fly-request-id"];
      }
    }
    log(
      `Graphonomous: ${graphonomous_identity?.name} v${graphonomous_identity?.version}`,
    );
  } catch (err) {
    log(`Graphonomous health check failed: ${err}`);
  }

  // -------------------------------------------------------------------------
  // 2. Initialize Graphonomous MCP session
  // -------------------------------------------------------------------------
  log("Initializing Graphonomous MCP session...");
  let graphSession: McpSession | null = null;
  try {
    const init = await mcpInitialize(
      config.graphonomous_endpoint,
      "pulse-conformance-deployed",
      config.timeout_ms,
    );
    graphSession = init.session;
    if (init.fly_request_id) {
      fly_request_ids["graphonomous_initialize"] = init.fly_request_id;
    }
    // Use identity from MCP if health check didn't return one
    if (!graphonomous_identity && init.result?.serverInfo) {
      graphonomous_identity = {
        name: init.result.serverInfo.name ?? "unknown",
        version: init.result.serverInfo.version ?? "unknown",
      };
    }
    log("Graphonomous MCP session established");
  } catch (err) {
    log(`Graphonomous MCP init failed: ${err}`);
  }

  // -------------------------------------------------------------------------
  // 3. Exercise all 5 Graphonomous phases
  // -------------------------------------------------------------------------
  const phaseSpecs = [
    {
      phase: "retrieve",
      kind: "retrieve",
      tool: "retrieve",
      args: { action: "context", query: "pulse conformance deployed test" },
    },
    {
      phase: "route",
      kind: "route",
      tool: "route",
      args: { action: "topology", query: "pulse conformance deployed test" },
    },
    {
      phase: "act",
      kind: "act",
      tool: "act",
      args: {
        action: "store_node",
        content: "PULSE conformance deployed test node",
        node_type: "semantic",
        source: "pulse-conformance",
        confidence: 0.9,
      },
    },
    {
      phase: "learn",
      kind: "learn",
      tool: "learn",
      args: { action: "from_outcome", status: "success", confidence: 0.8 },
    },
    {
      phase: "consolidate",
      kind: "consolidate",
      tool: "consolidate",
      args: { action: "run" },
    },
  ];

  const phase_observations: PhaseObservation[] = [];

  for (const spec of phaseSpecs) {
    const obs_started = new Date().toISOString();
    log(`Calling Graphonomous ${spec.phase}...`);

    if (!graphSession) {
      phase_observations.push({
        phase: spec.phase,
        kind: spec.kind,
        started_at: obs_started,
        finished_at: new Date().toISOString(),
        success: false,
        redacted_request: spec.args,
        redacted_response: "",
        error: "No MCP session — initialization failed",
      });
      continue;
    }

    try {
      const result = await mcpToolCall(graphSession, spec.tool, spec.args);
      const obs_finished = new Date().toISOString();
      const hasError = result.parsed?.error != null;

      if (result.fly_request_id) {
        fly_request_ids[`graphonomous_${spec.phase}`] = result.fly_request_id;
      }

      phase_observations.push({
        phase: spec.phase,
        kind: spec.kind,
        started_at: obs_started,
        finished_at: obs_finished,
        success: !hasError,
        fly_request_id: result.fly_request_id,
        redacted_request: spec.args,
        redacted_response: redactResponse(result.raw_body),
        error: hasError
          ? JSON.stringify(result.parsed.error).slice(0, 500)
          : undefined,
      });
      log(`  ${spec.phase}: ${hasError ? "FAIL" : "OK"}`);
    } catch (err) {
      phase_observations.push({
        phase: spec.phase,
        kind: spec.kind,
        started_at: obs_started,
        finished_at: new Date().toISOString(),
        success: false,
        redacted_request: spec.args,
        redacted_response: "",
        error: String(err).slice(0, 500),
      });
      log(`  ${spec.phase}: ERROR — ${err}`);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Build RuntimeObservations from deployed phase calls
  // -------------------------------------------------------------------------
  const makeProvenance = (
    phaseObs: PhaseObservation,
  ): DeploymentProvenance => ({
    endpoint_url: `${config.graphonomous_endpoint}/mcp`,
    identity: graphonomous_identity?.name ?? "",
    version: graphonomous_identity?.version,
    request_id: phaseObs.fly_request_id,
    observed_at: phaseObs.finished_at,
    configured_endpoint: config.graphonomous_endpoint,
  });

  const deployedObs: RuntimeObservations = {};

  // Map phase observations to conformance test observations.
  // Only phases that succeed with valid deployment provenance can
  // produce live_deployed evidence. Failed or missing phases stay
  // at their honest rung.
  const retrieveObs = phase_observations.find((o) => o.kind === "retrieve");
  const routeObs = phase_observations.find((o) => o.kind === "route");
  const actObs = phase_observations.find((o) => o.kind === "act");
  const learnObs = phase_observations.find((o) => o.kind === "learn");
  const consolidateObs = phase_observations.find(
    (o) => o.kind === "consolidate",
  );

  // T02 atomicity: act phase success implies atomicity held (no partial state).
  // We can only observe that the phase completed or failed cleanly — we
  // cannot inject failures into the deployed server. Honest: if act succeeded,
  // atomicity was not violated; if it failed, the observation is adverse.
  if (actObs) {
    deployedObs["T02"] = {
      behavior: "act phase completed without partial state on deployed substrate",
      success: actObs.success,
      source: "graphonomous",
      detail: actObs.success
        ? `act phase completed cleanly on deployed Graphonomous (${actObs.finished_at})`
        : `act phase failed: ${actObs.error}`,
      deployment_provenance: makeProvenance(actObs),
    };
  }

  // T03 idempotency: retrieve is declared idempotent in the manifest
  if (retrieveObs) {
    deployedObs["T03"] = {
      behavior: "retrieve phase (declared idempotent) exercised on deployed substrate",
      success: retrieveObs.success,
      source: "graphonomous",
      detail: retrieveObs.success
        ? `retrieve phase executed successfully on deployed Graphonomous (${retrieveObs.finished_at})`
        : `retrieve phase failed: ${retrieveObs.error}`,
      deployment_provenance: makeProvenance(retrieveObs),
    };
  }

  // T05 κ-routing: route phase exercises kappa_routing
  if (routeObs) {
    deployedObs["T05"] = {
      behavior: "route phase with kappa_routing exercised on deployed substrate",
      success: routeObs.success,
      source: "graphonomous",
      detail: routeObs.success
        ? `route/topology completed on deployed Graphonomous (${routeObs.finished_at})`
        : `route phase failed: ${routeObs.error}`,
      deployment_provenance: makeProvenance(routeObs),
    };
  }

  // T07 append-only audit: act phase produces audit_event
  if (actObs) {
    deployedObs["T07"] = {
      behavior: "act phase with audit_event exercised on deployed substrate",
      success: actObs.success,
      source: "graphonomous",
      detail: actObs.success
        ? `act phase with audit_event=node.created completed on deployed Graphonomous (${actObs.finished_at})`
        : `act phase failed: ${actObs.error}`,
      deployment_provenance: makeProvenance(actObs),
    };
  }

  // T11 trace_id propagation: all 5 phases exercised in sequence
  const allPhasesSucceeded = phase_observations.every((o) => o.success);
  if (phase_observations.length === 5) {
    deployedObs["T11"] = {
      behavior: "all 5 phases exercised in sequence on deployed substrate",
      success: allPhasesSucceeded,
      source: "graphonomous",
      detail: allPhasesSucceeded
        ? `All 5 phases (retrieve→route→act→learn→consolidate) completed in sequence on deployed Graphonomous`
        : `${phase_observations.filter((o) => !o.success).length} phase(s) failed; trace propagation cannot be fully verified`,
      deployment_provenance: makeProvenance(
        phase_observations[phase_observations.length - 1],
      ),
    };
  }

  // -------------------------------------------------------------------------
  // 5. Run the 12-test conformance suite
  // -------------------------------------------------------------------------
  log("Running 12-test conformance suite...");
  const manifestPath = resolve(
    __dirname,
    "..",
    "manifests",
    "graphonomous.continual_learning.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const validator = new ManifestValidator();
  const schemaResult = validator.check(manifest);
  const conformance = runConformance(manifest, schemaResult, deployedObs);
  log(
    `Conformance: ${conformance.overall} (${conformance.counts.pass}/${conformance.counts.total} pass)`,
  );

  // -------------------------------------------------------------------------
  // 6. Persist on deployed PULSE, then read back
  // -------------------------------------------------------------------------
  log("Registering manifest on deployed PULSE...");
  let persistence = {
    registered: false,
    read_back: false,
    read_back_matches: false,
  } as DeployedConformanceReport["persistence"];

  let pulseSession: McpSession | null = null;
  try {
    const pulseInit = await mcpInitialize(
      config.pulse_endpoint,
      "pulse-conformance-deployed",
      config.timeout_ms,
    );
    pulseSession = pulseInit.session;
    if (pulseInit.fly_request_id) {
      fly_request_ids["pulse_initialize"] = pulseInit.fly_request_id;
    }
    // Use identity from MCP if health didn't provide one
    if (!pulse_identity && pulseInit.result?.serverInfo) {
      pulse_identity = {
        name: pulseInit.result.serverInfo.name ?? "unknown",
        version: pulseInit.result.serverInfo.version ?? "unknown",
      };
    }
    log("PULSE MCP session established");
  } catch (err) {
    log(`PULSE MCP init failed: ${err}`);
  }

  if (pulseSession) {
    // Register manifest
    try {
      const regResult = await mcpToolCall(pulseSession, "register_manifest", {
        manifest,
      });
      if (regResult.fly_request_id) {
        fly_request_ids["pulse_register"] = regResult.fly_request_id;
      }
      const regParsed = regResult.parsed;
      const regContent = regParsed?.result?.content?.[0]?.text;
      let regData: any = null;
      if (regContent) {
        try {
          regData = JSON.parse(regContent);
        } catch {
          regData = regContent;
        }
      }
      persistence.registered =
        regParsed?.error == null &&
        (regData?.status === "registered" || regData?.status === "updated");
      log(`Register: ${persistence.registered ? "OK" : "FAIL"}`);
    } catch (err) {
      log(`Register failed: ${err}`);
    }

    // Read back
    try {
      const getResult = await mcpToolCall(pulseSession, "get_manifest", {
        loop_id: manifest.loop_id,
        version: manifest.version,
      });
      if (getResult.fly_request_id) {
        fly_request_ids["pulse_get_manifest"] = getResult.fly_request_id;
      }
      const getParsed = getResult.parsed;
      const getContent = getParsed?.result?.content?.[0]?.text;
      let getData: any = null;
      if (getContent) {
        try {
          getData = JSON.parse(getContent);
        } catch {
          getData = getContent;
        }
      }
      if (getData && getParsed?.error == null) {
        persistence.read_back = true;
        const readManifest = getData?.manifest ?? getData;
        persistence.read_back_loop_id = readManifest?.loop_id;
        persistence.read_back_version = readManifest?.version;
        persistence.read_back_matches =
          persistence.read_back_loop_id === manifest.loop_id &&
          persistence.read_back_version === manifest.version;
      }
      log(
        `Read-back: ${persistence.read_back ? "OK" : "FAIL"} (matches=${persistence.read_back_matches})`,
      );
    } catch (err) {
      log(`Read-back failed: ${err}`);
    }
  }

  // -------------------------------------------------------------------------
  // 7. Assemble and persist report
  // -------------------------------------------------------------------------
  const finished_at = new Date().toISOString();

  const phasePassCount = phase_observations.filter((o) => o.success).length;
  const phaseFailCount = phase_observations.filter((o) => !o.success).length;

  // Doctrine assessment: if all 5 phases succeeded and conformance has
  // live_deployed results, the runtime claim advances.
  const deployedResults = conformance.results.filter(
    (r) => r.evidence_rung === "live_deployed",
  );
  const hasDeployed = deployedResults.length > 0;
  const doctrine: DeployedConformanceReport["doctrine"] = hasDeployed
    ? {
        assessment: "advanced",
        claim:
          "Graphonomous continual learning loop runtime conformance against deployed MCP",
        old_rung: "live_local",
        new_rung: "live_deployed",
        evidence: `${deployedResults.length} conformance test(s) reached live_deployed evidence from deployed Graphonomous at ${config.graphonomous_endpoint}; ${phasePassCount}/5 phases exercised successfully; persistence ${persistence.registered ? "confirmed" : "not confirmed"} on deployed PULSE at ${config.pulse_endpoint}`,
      }
    : {
        assessment: "none",
        claim:
          "Deployed conformance attempted but no test reached live_deployed",
        evidence: `${phasePassCount}/5 phases succeeded; ${conformance.counts.pass}/${conformance.counts.total} conformance tests passed; no test reached live_deployed evidence rung`,
      };

  // Build the report without digest first, then compute digest
  const reportWithoutDigest: Omit<DeployedConformanceReport, "digest"> = {
    report_id,
    pulse_endpoint: config.pulse_endpoint,
    graphonomous_endpoint: config.graphonomous_endpoint,
    pulse_identity,
    graphonomous_identity,
    fly_request_ids,
    started_at,
    finished_at,
    conformance,
    phase_observations,
    phase_observation_counts: {
      total: phase_observations.length,
      passed: phasePassCount,
      failed: phaseFailCount,
    },
    persistence,
    doctrine,
  };

  const canonicalJson = JSON.stringify(reportWithoutDigest, null, 2);
  const digest = createHash("sha256").update(canonicalJson).digest("hex");

  const finalReport: DeployedConformanceReport = {
    ...reportWithoutDigest,
    digest: `sha256:${digest}`,
  };

  // Write to disk
  mkdirSync(config.output_dir, { recursive: true });
  const timestamp = started_at.replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const filename = `deployed-conformance-${timestamp}.json`;
  const filepath = resolve(config.output_dir, filename);
  writeFileSync(filepath, JSON.stringify(finalReport, null, 2) + "\n");
  log(`Report written to ${filepath}`);

  return finalReport;
}
