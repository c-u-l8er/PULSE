/**
 * Ajv wrapper for the PULSE loop manifest schema.
 *
 * The schema file is loaded at startup (or overridden via `--schema-path`)
 * and compiled into a validator function. The compiled validator is the
 * authoritative conformance test T01 — if validation fails, the manifest
 * cannot be registered.
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction, Plugin } from "ajv";
import addFormatsImport from "ajv-formats";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ajv-formats is CJS: `module.exports = formatsPlugin` — TypeScript's NodeNext
// interop sees the namespace shape, so we coerce to the callable Plugin form.
const addFormats = addFormatsImport as unknown as Plugin<string[] | undefined>;

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA_PATH = path.resolve(
  here,
  "..",
  "schemas",
  "pulse-loop-manifest.v0.1.json",
);

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[];
  errorText: string;
}

export class ManifestValidator {
  private readonly ajv: Ajv2020;
  private readonly validate: ValidateFunction;
  public readonly schemaPath: string;

  constructor(schemaPath?: string) {
    this.schemaPath = schemaPath ?? DEFAULT_SCHEMA_PATH;
    const schemaJson = JSON.parse(readFileSync(this.schemaPath, "utf8"));

    this.ajv = new Ajv2020({
      strict: false,
      allErrors: true,
      allowUnionTypes: true,
    });
    addFormats(this.ajv);
    this.validate = this.ajv.compile(schemaJson);
  }

  check(manifest: unknown): ValidationResult {
    const valid = this.validate(manifest) as boolean;
    const errors = (this.validate.errors ?? []).slice();
    return {
      valid,
      errors,
      errorText: this.ajv.errorsText(errors, { separator: "; " }),
    };
  }
}
