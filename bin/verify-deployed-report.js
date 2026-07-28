#!/usr/bin/env node
// verify-deployed-report — validates a deployed conformance report.
import("../dist/verify-deployed-report.js").catch((err) => {
  console.error("[verify-deployed-report] failed to start:", err);
  process.exit(1);
});
