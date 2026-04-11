/**
 * os-pulse MCP server wiring.
 *
 * Boots the high-level `McpServer` from @modelcontextprotocol/sdk, registers
 * tools + resources, and connects a transport.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Handle } from "./db.js";
import { ManifestValidator } from "./schema.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";

export interface ServerOptions {
  db: Handle;
  transport: "stdio" | "http";
  port: number;
  schemaPath?: string;
  log: (level: string, msg: string) => void;
}

export async function startServer(opts: ServerOptions): Promise<void> {
  const validator = new ManifestValidator(opts.schemaPath);
  opts.log("info", `loaded PULSE schema from ${validator.schemaPath}`);

  const server = new McpServer({
    name: "os-pulse",
    version: "0.1.0",
  });

  registerTools(server, { db: opts.db, validator, log: opts.log });
  registerResources(server, { db: opts.db });

  if (opts.transport === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    opts.log("info", "os-pulse MCP server ready on stdio transport");
  } else {
    throw new Error(
      `HTTP transport is declared but not implemented in v0.1.0 — use --transport stdio`,
    );
  }
}
