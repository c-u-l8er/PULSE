#!/usr/bin/env node
// conformance-deployed — runs deployed conformance against live endpoints.
import("../dist/deployed-conformance-cli.js").catch((err) => {
  console.error("[conformance-deployed] failed to start:", err);
  process.exit(1);
});
