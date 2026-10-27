import SwaggerParser from "@apidevtools/swagger-parser";
import { validate as validateReadme } from "@readme/openapi-parser";
import { createConfig, lintFromString } from "@redocly/openapi-core";
import { dereference, validate as validateScalar } from "@scalar/openapi-parser";
import { parse as parseYaml } from "yaml";

export interface ParserOutcome {
  parser: string;
  version: string;
  valid: boolean;
  errorCount: number;
  warningCount: number;
  operationCount: number;
  durationMs: number;
  errors: string[];
}

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

function countOperations(document: unknown): number {
  if (!document || typeof document !== "object") return 0;
  const root = document as Record<string, unknown>;
  let count = 0;

  const countPathItem = (pathItem: unknown): void => {
    if (!pathItem || typeof pathItem !== "object") return;
    const item = pathItem as Record<string, unknown>;
    for (const key of Object.keys(item)) {
      if (HTTP_METHODS.has(key.toLowerCase())) count += 1;
      if (key === "additionalOperations" && item[key] && typeof item[key] === "object") {
        count += Object.keys(item[key] as Record<string, unknown>).length;
      }
    }
  };

  if (root.paths && typeof root.paths === "object") {
    for (const pathItem of Object.values(root.paths as Record<string, unknown>)) {
      countPathItem(pathItem);
    }
  }
  if (root.webhooks && typeof root.webhooks === "object") {
    for (const pathItem of Object.values(root.webhooks as Record<string, unknown>)) {
      countPathItem(pathItem);
    }
  }
  return count;
}

function detectVersion(source: string): string {
  try {
    const document = parseYaml(source) as { openapi?: unknown } | null;
    return typeof document?.openapi === "string" ? document.openapi : "unknown";
  } catch {
    return "unknown";
  }
}

export async function evaluateScalar(source: string): Promise<ParserOutcome> {
  const startedAt = performance.now();
  const result = await validateScalar(source);
  let operationCount = 0;
  if (result.specification) {
    operationCount = countOperations(result.specification);
    await dereference(source);
  }
  return {
    parser: "@scalar/openapi-parser",
    version: result.version ?? detectVersion(source),
    valid: result.valid,
    errorCount: result.errors?.length ?? 0,
    warningCount: 0,
    operationCount,
    durationMs: performance.now() - startedAt,
    errors: (result.errors ?? [])
      .map((error) => `${error.path ?? ""}: ${error.message}`)
      .slice(0, 10),
  };
}

export async function evaluateRedocly(source: string, filename: string): Promise<ParserOutcome> {
  const startedAt = performance.now();
  try {
    const config = await createConfig({ rules: { struct: "error" } });
    const problems = await lintFromString({ source, absoluteRef: filename, config });
    const errors = problems.filter((problem) => problem.severity === "error");
    const warnings = problems.filter((problem) => problem.severity === "warn");
    const document = parseYaml(source);
    return {
      parser: "@redocly/openapi-core",
      version: detectVersion(source),
      valid: errors.length === 0,
      errorCount: errors.length,
      warningCount: warnings.length,
      operationCount: countOperations(document),
      durationMs: performance.now() - startedAt,
      errors: errors.map((problem) => problem.message).slice(0, 10),
    };
  } catch (error) {
    return {
      parser: "@redocly/openapi-core",
      version: detectVersion(source),
      valid: false,
      errorCount: 1,
      warningCount: 0,
      operationCount: 0,
      durationMs: performance.now() - startedAt,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function evaluateReadme(source: string): Promise<ParserOutcome> {
  const startedAt = performance.now();
  try {
    const document = parseYaml(source);
    const result = await validateReadme(document);
    return {
      parser: "@readme/openapi-parser",
      version: detectVersion(source),
      valid: result.valid,
      errorCount: result.valid ? 0 : result.errors.length,
      warningCount: result.warnings.length,
      operationCount: countOperations(document),
      durationMs: performance.now() - startedAt,
      errors: result.valid ? [] : result.errors.map((error) => error.message).slice(0, 10),
    };
  } catch (error) {
    return {
      parser: "@readme/openapi-parser",
      version: detectVersion(source),
      valid: false,
      errorCount: 1,
      warningCount: 0,
      operationCount: 0,
      durationMs: performance.now() - startedAt,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function evaluateSwaggerParser(source: string): Promise<ParserOutcome> {
  const startedAt = performance.now();
  try {
    const document = parseYaml(source);
    const validated = await SwaggerParser.validate(document);
    return {
      parser: "@apidevtools/swagger-parser",
      version: detectVersion(source),
      valid: true,
      errorCount: 0,
      warningCount: 0,
      operationCount: countOperations(validated),
      durationMs: performance.now() - startedAt,
      errors: [],
    };
  } catch (error) {
    return {
      parser: "@apidevtools/swagger-parser",
      version: detectVersion(source),
      valid: false,
      errorCount: 1,
      warningCount: 0,
      operationCount: 0,
      durationMs: performance.now() - startedAt,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export const parsers = [
  { name: "scalar", evaluate: evaluateScalar },
  { name: "redocly", evaluate: (source: string) => evaluateRedocly(source, "fixture.yaml") },
  { name: "readme", evaluate: evaluateReadme },
  { name: "swagger-parser", evaluate: evaluateSwaggerParser },
] as const;
