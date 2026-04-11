/**
 * MCP resource registration for os-pulse.
 *
 * Resources are read-only projections of the SQLite database, addressable
 * by URI per MCP 2025-11-25.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Handle } from "./db.js";

export interface ResourceContext {
  db: Handle;
}

function jsonResource(uri: string, value: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function registerResources(server: McpServer, ctx: ResourceContext): void {
  server.resource(
    "health",
    "pulse://runtime/health",
    { mimeType: "application/json" },
    async (uri) => {
      const manifestCount = (ctx.db.prepare("SELECT COUNT(*) AS c FROM manifests").get() as any).c;
      const signalCount = (ctx.db.prepare("SELECT COUNT(*) AS c FROM signals").get() as any).c;
      const connCount = (ctx.db.prepare("SELECT COUNT(*) AS c FROM connections").get() as any).c;
      return jsonResource(uri.href, {
        status: "ok",
        package: "os-pulse",
        version: "0.1.0",
        counts: {
          manifests: manifestCount,
          signals: signalCount,
          connections: connCount,
        },
        timestamp: new Date().toISOString(),
      });
    },
  );

  server.resource(
    "recent-manifests",
    "pulse://manifests/recent",
    { mimeType: "application/json" },
    async (uri) => {
      const rows = ctx.db
        .prepare(
          `SELECT loop_id, version, owner, parent_loop_id, conformance_status, registered_at
           FROM manifests ORDER BY registered_at DESC LIMIT 20`,
        )
        .all();
      return jsonResource(uri.href, { count: rows.length, manifests: rows });
    },
  );

  server.resource(
    "recent-signals",
    "pulse://signals/recent",
    { mimeType: "application/json" },
    async (uri) => {
      const rows = ctx.db
        .prepare(
          `SELECT ce_id, ce_source, ce_type, ce_time, token_kind, delivered_to, received_at
           FROM signals ORDER BY received_at DESC LIMIT 30`,
        )
        .all();
      return jsonResource(uri.href, { count: rows.length, signals: rows });
    },
  );
}
