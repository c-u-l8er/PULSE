#!/usr/bin/env node
// os-pulse — thin JS shim that loads the compiled TypeScript entrypoint.
import("../dist/cli.js").catch((err) => {
  console.error("[os-pulse] failed to start:", err);
  process.exit(1);
});
