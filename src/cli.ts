#!/usr/bin/env node
/**
 * os-pulse CLI entrypoint.
 *
 * Parses argv, opens the SQLite database, and boots the MCP server.
 */
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import path from "node:path";
import os from "node:os";
import { mkdirSync } from "node:fs";
import { openDatabase } from "./db.js";
import { startServer } from "./server.js";

function expandHome(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .scriptName("os-pulse")
    .usage("$0 [options]")
    .option("db", {
      type: "string",
      describe: "SQLite database path",
      default: "~/.os-pulse/manifests.db",
    })
    .option("transport", {
      type: "string",
      choices: ["stdio", "http"] as const,
      describe: "MCP transport",
      default: "stdio",
    })
    .option("port", {
      type: "number",
      describe: "HTTP port (ignored for stdio)",
      default: 4710,
    })
    .option("log-level", {
      type: "string",
      choices: ["debug", "info", "warn", "error"] as const,
      describe: "Log verbosity",
      default: "info",
    })
    .option("schema-path", {
      type: "string",
      describe: "Override bundled PULSE manifest schema path",
    })
    .version()
    .help()
    .strict()
    .parseAsync();

  const dbPath = expandHome(argv.db);
  mkdirSync(path.dirname(dbPath), { recursive: true });

  // stderr logging only — stdout is reserved for JSON-RPC on stdio transport.
  const log = (level: string, msg: string) => {
    const order = ["debug", "info", "warn", "error"];
    if (order.indexOf(level) < order.indexOf(argv.logLevel)) return;
    process.stderr.write(`[os-pulse ${level}] ${msg}\n`);
  };
  log("info", `opening database ${dbPath}`);

  const db = openDatabase(dbPath);

  const transport = argv.transport as "stdio" | "http";
  log("info", `starting MCP server on ${transport} transport`);
  await startServer({
    db,
    transport,
    port: argv.port,
    schemaPath: argv.schemaPath,
    log,
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[os-pulse error] ${message}\n`);
  process.exit(1);
});
