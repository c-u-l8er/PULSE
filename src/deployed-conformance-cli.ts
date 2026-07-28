#!/usr/bin/env node
/**
 * CLI for running deployed conformance against live PULSE and Graphonomous
 * MCP endpoints.
 *
 * Usage:
 *   npx os-pulse-deployed [options]
 *   npm run conformance:deployed [-- options]
 */
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  runDeployedConformance,
  DEFAULT_CONFIG,
  type DeployedConfig,
} from "./deployed-conformance.js";

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .scriptName("conformance-deployed")
    .usage("$0 [options]")
    .option("pulse-endpoint", {
      type: "string",
      describe: "PULSE MCP server base URL",
      default: DEFAULT_CONFIG.pulse_endpoint,
    })
    .option("graphonomous-endpoint", {
      type: "string",
      describe: "Graphonomous MCP server base URL",
      default: DEFAULT_CONFIG.graphonomous_endpoint,
    })
    .option("timeout", {
      type: "number",
      describe: "HTTP timeout in milliseconds",
      default: DEFAULT_CONFIG.timeout_ms,
    })
    .option("output-dir", {
      type: "string",
      describe: "Directory for report output",
      default: DEFAULT_CONFIG.output_dir,
    })
    .version()
    .help()
    .strict()
    .parseAsync();

  const config: DeployedConfig = {
    pulse_endpoint: argv.pulseEndpoint,
    graphonomous_endpoint: argv.graphonomousEndpoint,
    timeout_ms: argv.timeout,
    output_dir: argv.outputDir,
  };

  const report = await runDeployedConformance(config);

  // Summary to stdout
  const summary = {
    report_id: report.report_id,
    overall: report.conformance.overall,
    counts: report.conformance.counts,
    phases: `${report.phase_observation_counts.passed}/${report.phase_observation_counts.total} passed`,
    persistence: report.persistence.registered
      ? `registered, read-back=${report.persistence.read_back_matches}`
      : "not registered",
    doctrine: report.doctrine.assessment,
    digest: report.digest,
  };
  console.log(JSON.stringify(summary, null, 2));

  // Exit non-zero if conformance failed
  if (report.conformance.overall === "fail") {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[conformance-deployed error] ${msg}\n`);
  process.exit(1);
});
