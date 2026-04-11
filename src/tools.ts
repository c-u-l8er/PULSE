/**
 * MCP tool registration for os-pulse.
 *
 * All tools are registered against the high-level `McpServer` API exposed
 * by @modelcontextprotocol/sdk v1.x. Input schemas are zod; output is
 * application/json serialized into the first text content block.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Handle } from "./db.js";
import type { ManifestValidator } from "./schema.js";
import { runConformance } from "./conformance.js";
import { buildCloudEvent, TOKEN_KINDS, type TokenKind } from "./tokens.js";

export interface ToolContext {
  db: Handle;
  validator: ManifestValidator;
  log: (level: string, msg: string) => void;
}

function ok(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function err(message: string, extra?: Record<string, unknown>) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: message, ...extra }, null, 2),
      },
    ],
  };
}

const ManifestShape = z
  .object({
    pulse_protocol_version: z.string(),
    loop_id: z.string(),
    version: z.string(),
    phases: z.array(z.any()),
    closure: z.any(),
    cadence: z.any(),
    substrates: z.any(),
    invariants: z.any(),
  })
  .passthrough();

export function registerTools(server: McpServer, ctx: ToolContext): void {
  // --- register_manifest ----------------------------------------------------
  server.tool(
    "register_manifest",
    "Validate a PULSE manifest against the v0.1 schema, run the 12-test conformance suite, and persist it to the registry.",
    { manifest: ManifestShape },
    async ({ manifest }) => {
      const result = ctx.validator.check(manifest);
      if (!result.valid) {
        return err("schema validation failed", { errors: result.errors });
      }
      const report = runConformance(manifest, result);

      const stmt = ctx.db.prepare(`
        INSERT OR REPLACE INTO manifests
          (loop_id, version, pulse_protocol_version, owner, workspace_scope,
           manifest_json, parent_loop_id, registered_at, conformance_status, conformance_report)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const m = manifest as any;
      stmt.run(
        String(m.loop_id),
        String(m.version),
        String(m.pulse_protocol_version),
        m.owner ?? null,
        String(m.workspace_scope ?? "required"),
        JSON.stringify(manifest),
        m.nesting?.parent_loop ?? null,
        Math.floor(Date.now() / 1000),
        report.overall,
        JSON.stringify(report),
      );

      // Insert any declared connections.
      const conns: any[] = m.connections ?? [];
      if (conns.length > 0) {
        const delConn = ctx.db.prepare(
          "DELETE FROM connections WHERE from_loop_id = ?",
        );
        delConn.run(String(m.loop_id));
        const insConn = ctx.db.prepare(`
          INSERT INTO connections
            (from_loop_id, from_phase_id, to_loop_id, to_phase_id, token_kind, transport, cadence, delivery)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const c of conns) {
          insConn.run(
            String(m.loop_id),
            String(c.emit_phase ?? "unknown"),
            String(c.to_loop ?? "unknown"),
            c.to_phase ?? null,
            String(c.token ?? "OutcomeSignal"),
            String(c.envelope ?? "cloudevents.v1"),
            c.cadence ?? null,
            c.delivery ?? null,
          );
        }
      }

      return ok({
        status: "registered",
        loop_id: m.loop_id,
        version: m.version,
        conformance: report,
      });
    },
  );

  // --- validate_manifest (dry run) ------------------------------------------
  server.tool(
    "validate_manifest",
    "Validate a PULSE manifest against the v0.1 schema without persisting. Returns full conformance report.",
    { manifest: ManifestShape },
    async ({ manifest }) => {
      const result = ctx.validator.check(manifest);
      const report = runConformance(manifest, result);
      return ok({ schema_valid: result.valid, conformance: report });
    },
  );

  // --- list_loops -----------------------------------------------------------
  server.tool(
    "list_loops",
    "List registered loops, optionally filtered by owner or parent_loop.",
    {
      owner: z.string().optional(),
      parent_loop: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(50),
    },
    async ({ owner, parent_loop, limit }) => {
      const where: string[] = [];
      const params: any[] = [];
      if (owner) {
        where.push("owner = ?");
        params.push(owner);
      }
      if (parent_loop) {
        where.push("parent_loop_id = ?");
        params.push(parent_loop);
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const rows = ctx.db
        .prepare(
          `SELECT loop_id, version, pulse_protocol_version, owner, workspace_scope,
                  parent_loop_id, registered_at, conformance_status
           FROM manifests
           ${whereSql}
           ORDER BY registered_at DESC
           LIMIT ?`,
        )
        .all(...params, limit);
      return ok({ count: rows.length, loops: rows });
    },
  );

  // --- get_manifest ---------------------------------------------------------
  server.tool(
    "get_manifest",
    "Return the full manifest JSON for a registered loop.",
    {
      loop_id: z.string(),
      version: z.string().optional(),
    },
    async ({ loop_id, version }) => {
      const row = version
        ? ctx.db
            .prepare(
              "SELECT manifest_json, conformance_report FROM manifests WHERE loop_id = ? AND version = ?",
            )
            .get(loop_id, version)
        : ctx.db
            .prepare(
              `SELECT manifest_json, conformance_report FROM manifests
               WHERE loop_id = ? ORDER BY registered_at DESC LIMIT 1`,
            )
            .get(loop_id);
      if (!row) return err("loop not found", { loop_id, version });
      const r = row as { manifest_json: string; conformance_report: string | null };
      return ok({
        manifest: JSON.parse(r.manifest_json),
        conformance: r.conformance_report ? JSON.parse(r.conformance_report) : null,
      });
    },
  );

  // --- resolve_phase --------------------------------------------------------
  server.tool(
    "resolve_phase",
    "Return the declared phase definition and substrate URIs in scope for that phase.",
    {
      loop_id: z.string(),
      phase_id: z.string(),
      version: z.string().optional(),
    },
    async ({ loop_id, phase_id, version }) => {
      const row = version
        ? ctx.db
            .prepare(
              "SELECT manifest_json FROM manifests WHERE loop_id = ? AND version = ?",
            )
            .get(loop_id, version)
        : ctx.db
            .prepare(
              `SELECT manifest_json FROM manifests WHERE loop_id = ?
               ORDER BY registered_at DESC LIMIT 1`,
            )
            .get(loop_id);
      if (!row) return err("loop not found", { loop_id });
      const manifest = JSON.parse((row as { manifest_json: string }).manifest_json);
      const phase = (manifest.phases as any[]).find((p) => p.id === phase_id);
      if (!phase) return err("phase not found", { loop_id, phase_id });
      return ok({
        phase,
        substrates: manifest.substrates,
        invariants: manifest.invariants,
      });
    },
  );

  // --- emit_signal ----------------------------------------------------------
  server.tool(
    "emit_signal",
    "Package a token payload into a CloudEvents v1 envelope, persist it, and optionally route to a target loop for later pickup.",
    {
      source: z.string(),
      token: z.enum(TOKEN_KINDS as unknown as [TokenKind, ...TokenKind[]]),
      data: z.record(z.any()),
      trace_id: z.string().optional(),
      correlation_id: z.string().optional(),
      to_loop_id: z.string().optional(),
    },
    async ({ source, token, data, trace_id, correlation_id, to_loop_id }) => {
      const ce = buildCloudEvent({
        source,
        token,
        data: data as any,
        trace_id,
        correlation_id,
      });

      ctx.db
        .prepare(
          `INSERT INTO signals
             (ce_id, ce_source, ce_type, ce_time, token_kind, trace_id, correlation_id, data_json, received_at, delivered_to)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ce.id,
          ce.source,
          ce.type,
          ce.time as string,
          token,
          trace_id ?? null,
          correlation_id ?? null,
          JSON.stringify(ce.data ?? {}),
          Math.floor(Date.now() / 1000),
          to_loop_id ?? null,
        );

      return ok({ status: "emitted", envelope: ce.toJSON() });
    },
  );

  // --- receive_signal -------------------------------------------------------
  server.tool(
    "receive_signal",
    "Deliver pending CloudEvents envelopes addressed to a given loop_id. Marks them as delivered.",
    {
      loop_id: z.string(),
      limit: z.number().int().min(1).max(200).default(20),
    },
    async ({ loop_id, limit }) => {
      const rows = ctx.db
        .prepare(
          `SELECT id, ce_id, ce_source, ce_type, ce_time, token_kind, trace_id, correlation_id, data_json
           FROM signals
           WHERE delivered_to = ? AND delivered_at IS NULL
           ORDER BY received_at ASC
           LIMIT ?`,
        )
        .all(loop_id, limit) as any[];

      if (rows.length > 0) {
        const now = Math.floor(Date.now() / 1000);
        const stmt = ctx.db.prepare(
          "UPDATE signals SET delivered_at = ? WHERE id = ?",
        );
        for (const r of rows) stmt.run(now, r.id);
      }

      return ok({
        count: rows.length,
        signals: rows.map((r) => ({
          ce_id: r.ce_id,
          source: r.ce_source,
          type: r.ce_type,
          time: r.ce_time,
          token: r.token_kind,
          trace_id: r.trace_id,
          correlation_id: r.correlation_id,
          data: JSON.parse(r.data_json),
        })),
      });
    },
  );

  // --- trace_connection -----------------------------------------------------
  server.tool(
    "trace_connection",
    "Walk outbound connections from a loop to discover reachable downstream loops and the tokens exchanged.",
    {
      loop_id: z.string(),
      max_depth: z.number().int().min(1).max(10).default(3),
    },
    async ({ loop_id, max_depth }) => {
      const visited = new Set<string>();
      const edges: any[] = [];
      const stmt = ctx.db.prepare(
        "SELECT from_loop_id, from_phase_id, to_loop_id, to_phase_id, token_kind, cadence, delivery FROM connections WHERE from_loop_id = ?",
      );

      const walk = (id: string, depth: number) => {
        if (depth > max_depth) return;
        if (visited.has(id)) return;
        visited.add(id);
        const outs = stmt.all(id) as any[];
        for (const e of outs) {
          edges.push(e);
          walk(e.to_loop_id, depth + 1);
        }
      };
      walk(loop_id, 0);

      return ok({
        origin: loop_id,
        reachable_loops: [...visited].filter((v) => v !== loop_id),
        edges,
      });
    },
  );

  // --- run_conformance ------------------------------------------------------
  server.tool(
    "run_conformance",
    "Re-run the 12-test PULSE v0.1 conformance suite against a registered loop. Updates stored conformance report.",
    {
      loop_id: z.string(),
      version: z.string().optional(),
    },
    async ({ loop_id, version }) => {
      const row = version
        ? ctx.db
            .prepare(
              "SELECT manifest_json FROM manifests WHERE loop_id = ? AND version = ?",
            )
            .get(loop_id, version)
        : ctx.db
            .prepare(
              `SELECT manifest_json FROM manifests WHERE loop_id = ?
               ORDER BY registered_at DESC LIMIT 1`,
            )
            .get(loop_id);
      if (!row) return err("loop not found", { loop_id, version });
      const manifest = JSON.parse((row as { manifest_json: string }).manifest_json);
      const result = ctx.validator.check(manifest);
      const report = runConformance(manifest, result);

      ctx.db
        .prepare(
          `UPDATE manifests SET conformance_status = ?, conformance_report = ?
           WHERE loop_id = ?${version ? " AND version = ?" : ""}`,
        )
        .run(
          ...(version
            ? [report.overall, JSON.stringify(report), loop_id, version]
            : [report.overall, JSON.stringify(report), loop_id]),
        );

      return ok(report);
    },
  );

  // --- export_topology ------------------------------------------------------
  server.tool(
    "export_topology",
    "Export the full registered loop topology (nodes + connections + nesting) as a JSON graph or Graphviz DOT string.",
    {
      format: z.enum(["json", "dot"]).default("json"),
    },
    async ({ format }) => {
      const loops = ctx.db
        .prepare(
          "SELECT loop_id, version, parent_loop_id, conformance_status FROM manifests ORDER BY registered_at",
        )
        .all() as any[];
      const connections = ctx.db
        .prepare(
          "SELECT from_loop_id, from_phase_id, to_loop_id, to_phase_id, token_kind FROM connections",
        )
        .all() as any[];

      if (format === "json") {
        return ok({
          nodes: loops,
          edges: connections,
          nesting: loops
            .filter((l) => l.parent_loop_id)
            .map((l) => ({ parent: l.parent_loop_id, child: l.loop_id })),
        });
      }

      const lines: string[] = ["digraph pulse {"];
      lines.push('  rankdir="LR";');
      lines.push('  node [shape=box, style=rounded];');
      for (const l of loops) {
        const color =
          l.conformance_status === "pass"
            ? "green"
            : l.conformance_status === "fail"
            ? "red"
            : "gray";
        lines.push(`  "${l.loop_id}" [color=${color}];`);
      }
      for (const c of connections) {
        lines.push(
          `  "${c.from_loop_id}" -> "${c.to_loop_id}" [label="${c.token_kind}"];`,
        );
      }
      for (const l of loops) {
        if (l.parent_loop_id) {
          lines.push(
            `  "${l.parent_loop_id}" -> "${l.loop_id}" [style=dashed, label="nests"];`,
          );
        }
      }
      lines.push("}");
      return ok({ format: "dot", dot: lines.join("\n") });
    },
  );
}
