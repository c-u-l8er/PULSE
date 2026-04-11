/**
 * The five canonical PULSE cross-loop tokens and helpers for wrapping them
 * in CloudEvents v1.0 envelopes.
 */
import { CloudEvent } from "cloudevents";
import crypto from "node:crypto";

export type TokenKind =
  | "TopologyContext"
  | "DeliberationResult"
  | "OutcomeSignal"
  | "ReputationUpdate"
  | "ConsolidationEvent";

export const TOKEN_KINDS: readonly TokenKind[] = [
  "TopologyContext",
  "DeliberationResult",
  "OutcomeSignal",
  "ReputationUpdate",
  "ConsolidationEvent",
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

export type TokenData =
  | TopologyContextData
  | DeliberationResultData
  | OutcomeSignalData
  | ReputationUpdateData
  | ConsolidationEventData;

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
