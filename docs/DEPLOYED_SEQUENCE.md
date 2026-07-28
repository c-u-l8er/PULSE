# Deployed MCP Sequence Reference

Exact HTTP/MCP sequences the conformance harness can execute against the
deployed PULSE and Graphonomous instances on Fly.io. This document is the
contract that `conformance:deployed` implements against.

## Deployed endpoints

| Service | Fly app | Public URL | Health |
|---|---|---|---|
| **PULSE** (os-pulse) | `os-pulse-mcp` | `https://os-pulse-mcp.fly.dev/mcp` | `https://os-pulse-mcp.fly.dev/health` |
| **Graphonomous** | `graphonomous-mcp` | `https://graphonomous-mcp.fly.dev/mcp` | `https://graphonomous-mcp.fly.dev/health` |

Both accept the StreamableHTTP MCP transport (POST JSON-RPC to `/mcp`).
Responses may arrive as direct JSON or SSE-wrapped (`data: {...}\n`).
Session state is tracked via the `mcp-session-id` response/request header.

### Cold-start behavior

- **Graphonomous**: `min_machines_running = 1` — always warm.
- **PULSE**: `min_machines_running = 0` — cold-starts on first request
  (`auto_start_machines = true`). The harness must tolerate 5–15 s TTFB on the
  initialize call.

---

## 1. Health check (pre-flight)

Before MCP initialization, hit `/health` on each endpoint to confirm the
instance is alive and capture identity + version.

```
GET https://os-pulse-mcp.fly.dev/health
→ 200 { "status": "ok", "name": "os-pulse", "version": "0.1.0" }

GET https://graphonomous-mcp.fly.dev/health
→ 200 { "status": "ok", "name": "graphonomous", "version": "0.2.0" }
```

The harness records `name` and `version` from each response as the deployed
identity. Fly.io also exposes `fly-request-id` in response headers — capture
it as the deployment/request identifier.

---

## 2. MCP initialization sequence

Both servers implement MCP StreamableHTTP. The initialization handshake is
identical for both:

### 2a. `initialize` (POST, id: 1)

```http
POST /mcp HTTP/1.1
Host: os-pulse-mcp.fly.dev
Content-Type: application/json
Accept: application/json, text/event-stream

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": { "name": "pulse-conformance-deployed", "version": "0.1.0" }
  }
}
```

Response (may be SSE-wrapped):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": { ... },
    "serverInfo": { "name": "os-pulse", "version": "0.1.0" }
  }
}
```

**Capture** the `mcp-session-id` header from the response. All subsequent
requests in this session must include it.

### 2b. `notifications/initialized` (POST, no id)

```http
POST /mcp HTTP/1.1
Content-Type: application/json
Accept: application/json, text/event-stream
mcp-session-id: <session-id-from-step-2a>

{
  "jsonrpc": "2.0",
  "method": "notifications/initialized",
  "params": {}
}
```

No response body expected (or empty 2xx).

### 2c. `tools/list` (POST, id: 2) — optional identity verification

```http
POST /mcp HTTP/1.1
...
mcp-session-id: <session-id>

{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

Response confirms the tool surface. For deployed identity verification,
the harness checks that expected tools are present.

**PULSE tools**: `register_manifest`, `validate_manifest`, `list_loops`,
`get_manifest`, `resolve_phase`, `emit_signal`, `receive_signal`,
`trace_connection`, `run_conformance`, `export_topology`

**Graphonomous tools** (5 machines): `retrieve`, `route`, `act`, `learn`,
`consolidate`

---

## 3. Graphonomous phase-call sequence

The harness calls all 5 canonical Graphonomous machines through the deployed
MCP endpoint. Each call is a `tools/call` JSON-RPC request.

### 3a. RETRIEVE phase

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "tools/call",
  "params": {
    "name": "retrieve",
    "arguments": {
      "action": "context",
      "query": "pulse conformance deployed test"
    }
  }
}
```

### 3b. ROUTE phase

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "method": "tools/call",
  "params": {
    "name": "route",
    "arguments": {
      "action": "topology",
      "query": "pulse conformance deployed test"
    }
  }
}
```

### 3c. ACT phase

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "tools/call",
  "params": {
    "name": "act",
    "arguments": {
      "action": "store_node",
      "content": "PULSE conformance deployed test node",
      "node_type": "semantic",
      "source": "pulse-conformance",
      "confidence": 0.9
    }
  }
}
```

### 3d. LEARN phase

```json
{
  "jsonrpc": "2.0",
  "id": 13,
  "method": "tools/call",
  "params": {
    "name": "learn",
    "arguments": {
      "action": "from_outcome",
      "status": "success",
      "confidence": 0.8
    }
  }
}
```

### 3e. CONSOLIDATE phase

```json
{
  "jsonrpc": "2.0",
  "id": 14,
  "method": "tools/call",
  "params": {
    "name": "consolidate",
    "arguments": {
      "action": "run"
    }
  }
}
```

For each phase call, record:
- `started_at` (UTC ISO-8601) and `finished_at`
- `success` (no `error` in response)
- Redacted request (arguments without large payloads)
- Redacted response (first 500 chars of `result.content[0].text`)
- `fly-request-id` from response headers

---

## 4. PULSE persistence sequence

After collecting Graphonomous phase observations, the harness registers the
manifest with evidence on the deployed PULSE instance.

### 4a. `register_manifest` — persist report

```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "method": "tools/call",
  "params": {
    "name": "register_manifest",
    "arguments": {
      "manifest": <graphonomous.continual_learning.json with observations>
    }
  }
}
```

The PULSE server validates the manifest, runs the 12-test conformance suite,
persists the report to its SQLite database at `/data/manifests.db`, and
returns:

```json
{
  "status": "registered",
  "loop_id": "graphonomous.continual_learning",
  "version": "0.4.0",
  "conformance": { <ConformanceReport> }
}
```

**Important**: The `register_manifest` tool does not accept a separate
`observations` parameter. Runtime observations must be injected by calling
`run_conformance` on a previously-registered manifest (see alternative
path below) or by using a harness-side conformance run and storing the
report via a different mechanism.

**Alternative persistence path** — register-then-rerun:
1. Call `register_manifest` with the bare manifest (no observations) →
   persists with `pending` status.
2. The harness cannot inject observations into the deployed PULSE server's
   `run_conformance` tool either — it re-runs against the stored manifest
   and does not accept external observations.

**Actual available path**: The harness runs `runConformance()` locally with
deployed observations, then calls `register_manifest` to persist the manifest
(the deployed PULSE stores the manifest + its own conformance run). The
harness-side report with deployed evidence is the authoritative artifact;
the deployed PULSE persistence proves the manifest is registered and
retrievable.

### 4b. `get_manifest` — deployed read-back

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "method": "tools/call",
  "params": {
    "name": "get_manifest",
    "arguments": {
      "loop_id": "graphonomous.continual_learning",
      "version": "0.4.0"
    }
  }
}
```

Response:
```json
{
  "manifest": { <full manifest JSON> },
  "conformance": { <ConformanceReport as persisted by PULSE> }
}
```

The harness verifies that `manifest.loop_id` and `manifest.version` match
what was registered. The deployed PULSE's own conformance report (without
deployed observations) confirms persistence. The harness's local report
(with deployed observations) is the evidence-bearing artifact.

---

## 5. Response parsing: JSON vs SSE

Both servers may respond with:
- **Direct JSON**: `Content-Type: application/json` — parse directly.
- **SSE envelope**: `Content-Type: text/event-stream` — extract `data:` lines.

The e2e-dashboard's `parseMcpResponse()` handles both:
```
1. Try JSON.parse(body) directly
2. If that fails, scan for lines starting with "data:" and parse each
```

The harness must implement the same dual-parse logic.

---

## 6. Protocol details

### Transport differences

| | PULSE (Node.js) | Graphonomous (Elixir) |
|---|---|---|
| **HTTP server** | Node `http.createServer` | Bandit (Elixir) |
| **MCP transport** | `StreamableHTTPServerTransport` (@modelcontextprotocol/sdk) | `Anubis.Server.Transport.StreamableHTTP.Plug` (vendored) |
| **Session ID** | `sessionIdGenerator: undefined` (stateless per-request) | Managed per-connection with SSE keepalive |
| **CORS** | Yes (`*`) | Yes (`*`) |
| **MCP protocol version** | `2024-11-05` / `2025-06-18` | `2025-03-26` / `2025-06-18` |

### PULSE session caveat

PULSE's HTTP handler creates a **new** `StreamableHTTPServerTransport` per
POST request with `sessionIdGenerator: undefined`. This means:
- Each request is effectively stateless
- `mcp-session-id` may not be returned or may differ per request
- The harness should still send the header if received, but must not rely on
  server-side session state between requests

### Graphonomous session model

Graphonomous's Anubis transport supports persistent SSE connections with
keepalive pings. For the conformance harness (which uses sequential POST
requests), the session ID from `initialize` should be propagated but each
`tools/call` is self-contained.

---

## 7. Evidence rung mapping for deployed observations

The current `conformance.ts` maps evidence rungs as follows:
- `source` in `VERIFIED_SUBSTRATES` → `live_local`
- All other sources → `in_tree`

There is **no** `live_deployed` rung assignment in the current code. To
produce `live_deployed` evidence, the harness must:

1. Verify the observation came from a deployed HTTPS endpoint (not localhost)
2. Apply a new evidence function or extend `evidenceRungFor()` to accept
   a deployment context flag

The conformance harness will need to either:
- Add a `deployed: boolean` flag to `RuntimeObservation` and modify
  `evidenceRungFor()`, or
- Post-process the report to upgrade `live_local` → `live_deployed` when
  the observation source URL is a deployed endpoint

---

## 8. Report structure

The persisted report must contain:

```typescript
interface DeployedConformanceReport {
  // Endpoint identities
  pulse_endpoint: string;           // "https://os-pulse-mcp.fly.dev/mcp"
  graphonomous_endpoint: string;    // "https://graphonomous-mcp.fly.dev/mcp"
  pulse_identity: { name: string; version: string };
  graphonomous_identity: { name: string; version: string };

  // Deployment identifiers
  fly_request_ids: Record<string, string>;  // step → fly-request-id

  // Timestamps
  started_at: string;  // UTC ISO-8601
  finished_at: string;

  // PULSE conformance (12 tests)
  conformance: ConformanceReport;  // from runConformance()

  // Phase observations (5 phases)
  phase_observations: PhaseObservation[];

  // Evidence integrity
  report_id: string;    // UUID
  digest: string;       // SHA-256 of canonical JSON

  // Doctrine assessment
  doctrine: {
    assessment: "advanced" | "contradicted" | "proposed" | "none";
    claim?: string;
    old_rung?: string;
    new_rung?: string;
    evidence?: string;
  };
}
```

---

## 9. Sequence diagram (full deployed run)

```
Harness                      PULSE (Fly)              Graphonomous (Fly)
  │                             │                          │
  ├─GET /health────────────────►│                          │
  │◄───── 200 {name,version}───┤                          │
  │                             │                          │
  ├─GET /health───────────────────────────────────────────►│
  │◄───── 200 {name,version}──────────────────────────────┤
  │                             │                          │
  ├─POST /mcp initialize──────────────────────────────────►│
  │◄───── {serverInfo, session}───────────────────────────┤
  ├─POST /mcp initialized─────────────────────────────────►│
  │                             │                          │
  ├─POST /mcp tools/call retrieve─────────────────────────►│
  │◄───── {result}────────────────────────────────────────┤
  ├─POST /mcp tools/call route────────────────────────────►│
  │◄───── {result}────────────────────────────────────────┤
  ├─POST /mcp tools/call act──────────────────────────────►│
  │◄───── {result}────────────────────────────────────────┤
  ├─POST /mcp tools/call learn────────────────────────────►│
  │◄───── {result}────────────────────────────────────────┤
  ├─POST /mcp tools/call consolidate──────────────────────►│
  │◄───── {result}────────────────────────────────────────┤
  │                             │                          │
  │  [harness runs runConformance() locally with           │
  │   observations from deployed Graphonomous calls]       │
  │                             │                          │
  ├─POST /mcp initialize──────►│                          │
  │◄───── {serverInfo, session}┤                          │
  ├─POST /mcp initialized─────►│                          │
  │                             │                          │
  ├─POST /mcp tools/call       │                          │
  │  register_manifest────────►│                          │
  │◄───── {registered, report}─┤                          │
  │                             │                          │
  ├─POST /mcp tools/call       │                          │
  │  get_manifest─────────────►│                          │
  │◄───── {manifest, conform.}─┤                          │
  │                             │                          │
  │  [harness verifies read-back matches registration]     │
  │  [harness writes report to disk with digest]           │
```

---

## 10. Named gaps

1. **`live_deployed` evidence rung**: `conformance.ts` has no code path that
   produces `live_deployed`. The harness must extend the evidence model or
   post-process results. This is the primary gap between `live_local` and
   `live_deployed` for the runtime claim.

2. **Observation injection on deployed PULSE**: Neither `register_manifest`
   nor `run_conformance` accepts external runtime observations over MCP.
   The harness must run conformance locally and persist the report as a
   local artifact, using the deployed PULSE only for manifest persistence
   and read-back verification.

3. **PULSE stateless sessions**: Each POST creates a new transport instance.
   The harness cannot rely on server-side state between calls. Each
   `tools/call` to the deployed PULSE effectively stands alone.

4. **Response format uncertainty**: Deployed responses may be JSON or SSE
   depending on server version and transport negotiation. The harness must
   parse both.
