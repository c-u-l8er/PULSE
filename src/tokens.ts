/**
 * The six canonical PULSE cross-loop tokens and helpers for wrapping them
 * in CloudEvents v1.0 envelopes. SurpriseSignal added in PULSE v0.1.1 for OS-011
 * (Embodiment Protocol) forward-model-prediction-error emission.
 */
import { CloudEvent } from "cloudevents";
import crypto from "node:crypto";

export type TokenKind =
  | "TopologyContext"
  | "DeliberationResult"
  | "OutcomeSignal"
  | "ReputationUpdate"
  | "ConsolidationEvent"
  | "SurpriseSignal";

export const TOKEN_KINDS: readonly TokenKind[] = [
  "TopologyContext",
  "DeliberationResult",
  "OutcomeSignal",
  "ReputationUpdate",
  "ConsolidationEvent",
  "SurpriseSignal",
];

/**
 * Vendor-namespaced token (PULSE v0.1.2). A downstream protocol (e.g. OS-012
 * SCOPE) declares its own cross-loop tokens without forking PULSE, using the
 * form `<vendor>.v<N>.<TokenName>` — e.g. `scope.v1.SpatialClaim`. The vendor
 * segment is lowercase snake; the token name is PascalCase. The prefixes
 * `pulse`, `opensentience`, and `os` are reserved for canonical use.
 */
export const VENDOR_TOKEN_RE = /^[a-z][a-z0-9_]*\.v[0-9]+\.[A-Z][A-Za-z0-9]*$/;
const RESERVED_VENDOR_PREFIXES = new Set(["pulse", "opensentience", "os"]);

/** A PULSE cross-loop token: a canonical kind or a vendor-namespaced string. */
export type PulseToken = TokenKind | (string & {});

export function isCanonicalToken(token: string): token is TokenKind {
  return (TOKEN_KINDS as readonly string[]).includes(token);
}

export function isVendorToken(token: string): boolean {
  if (!VENDOR_TOKEN_RE.test(token)) return false;
  const vendor = token.slice(0, token.indexOf("."));
  return !RESERVED_VENDOR_PREFIXES.has(vendor);
}

/** True for any token the v0.1.2 schema would accept in `connection.token`. */
export function isValidToken(token: string): boolean {
  return isCanonicalToken(token) || isVendorToken(token);
}

export interface TopologyContextData {
  scc_count: number;
  max_kappa: number;
  dag_nodes?: string[];
  sccs?: unknown[];
  routing?: "fast" | "deliberate";
}

export interface DeliberationResultData {
  verdict: string;
  evidence: unknown[];
  dissent?: unknown[];
  confidence: number;
}

export interface OutcomeSignalData {
  action_id: string;
  status: "success" | "partial_success" | "failure" | "timeout";
  causal_parent_ids: string[];
  evidence?: unknown;
}

export interface ReputationUpdateData {
  subject: string;
  delta: number;
  calibration?: number;
  reason?: string;
}

export interface ConsolidationEventData {
  merged_nodes: string[];
  convergence_status: "converged" | "diverged" | "partial";
  stats?: Record<string, number>;
}

/**
 * SurpriseSignal — OS-011 Embodiment Protocol v0.1
 *
 * Emitted by a `&body.*` provider when an actual environment observation after
 * `act()` diverges materially from the forward model's prediction. Consumed by
 * `&memory.episodic` novelty detection, PRISM forward-model-calibration scoring,
 * and FleetPrompt SkillCandidate confidence adjustment on cross-machine replay.
 */
export interface SurpriseSignalData {
  /** ULID or UUID of the InteractionTrace this edge belongs to. */
  trace_id: string;
  /** Monotonic edge_id within the trace. */
  edge_id: number;
  /** Which &body.* subtype emitted. */
  body_subtype: "browser" | "os" | "vision" | "voice" | "motor";
  /** TypedAction.type that produced the surprise. */
  action_type: string;
  /** Forward-model predicted state hash (prefix like "sha256:..."). */
  predicted_state_hash: string;
  /** Observed state hash after act (prefix like "sha256:..."). */
  actual_state_hash: string;
  /** Normalized divergence magnitude in [0, 1]; 0=perfect prediction, 1=maximal. */
  surprise_magnitude: number;
  /** Controlled vocabulary describing the kind of divergence. */
  surprise_kind:
    | "unexpected_navigation"
    | "unexpected_unchanged"
    | "unexpected_structure"
    | "unexpected_error"
    | "unexpected_permission"
    | "unexpected_latency"
    | "other";
  /** Subtype-specific evidence supporting the surprise classification. */
  evidence?: unknown;
}

export type TokenData =
  | TopologyContextData
  | DeliberationResultData
  | OutcomeSignalData
  | ReputationUpdateData
  | ConsolidationEventData
  | SurpriseSignalData;

/**
 * Payload carried by a token. Canonical tokens use one of the typed shapes
 * above; vendor-namespaced tokens (v0.1.2) carry a vendor-defined object that
 * PULSE treats as opaque.
 */
export type PulseTokenData = TokenData | Record<string, unknown>;

const TYPE_PREFIX = "org.opensentience.pulse";

const toSnake = (name: string): string =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/**
 * Derive the CloudEvents `type` for a token.
 *
 * Canonical tokens map to `org.opensentience.pulse.<snake>.v1`. Vendor tokens
 * (`<ns>.v<N>.<Name>`, PULSE v0.1.2) map to `<ns>.<snake(Name)>.v<N>` so the
 * vendor keeps its own type namespace rather than squatting on the canonical
 * `org.opensentience.pulse` prefix.
 */
export function ceTypeFor(token: PulseToken): string {
  if (isCanonicalToken(token)) {
    return `${TYPE_PREFIX}.${toSnake(token)}.v1`;
  }
  if (isVendorToken(token)) {
    const [ns, ver, name] = token.split(".");
    return `${ns}.${toSnake(name)}.${ver}`;
  }
  throw new Error(`invalid PULSE token: ${token}`);
}

export interface EmitArgs {
  source: string;               // URI of emitter (e.g. "pulse://loops/graphonomous.continual_learning")
  token: PulseToken;
  data: PulseTokenData;
  trace_id?: string;
  correlation_id?: string;
}

export function buildCloudEvent(args: EmitArgs): CloudEvent<PulseTokenData> {
  const extensions: Record<string, string> = {};
  if (args.trace_id) extensions.traceid = args.trace_id;
  if (args.correlation_id) extensions.correlationid = args.correlation_id;

  return new CloudEvent<PulseTokenData>({
    id: crypto.randomUUID(),
    source: args.source,
    type: ceTypeFor(args.token),
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    specversion: "1.0",
    data: args.data,
    ...extensions,
  });
}
