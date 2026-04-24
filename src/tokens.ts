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

const TYPE_PREFIX = "org.opensentience.pulse";

export function ceTypeFor(kind: TokenKind): string {
  const snake = kind
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  return `${TYPE_PREFIX}.${snake}.v1`;
}

export interface EmitArgs {
  source: string;               // URI of emitter (e.g. "pulse://loops/graphonomous.continual_learning")
  token: TokenKind;
  data: TokenData;
  trace_id?: string;
  correlation_id?: string;
}

export function buildCloudEvent(args: EmitArgs): CloudEvent<TokenData> {
  const extensions: Record<string, string> = {};
  if (args.trace_id) extensions.traceid = args.trace_id;
  if (args.correlation_id) extensions.correlationid = args.correlation_id;

  return new CloudEvent<TokenData>({
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
