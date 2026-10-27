import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsers } from "../src/adapters.js";

const fixtures = join(import.meta.dirname, "..", "fixtures");

describe("OpenAPI parser compatibility matrix", () => {
  it("identifies a valid OpenAPI 3.0 document", async () => {
    const source = await readFile(join(fixtures, "openapi-3.0.yaml"), "utf8");
    const outcome = await parsers[0].evaluate(source);
    expect(outcome.valid).toBe(true);
    expect(outcome.version).toBe("3.0");
    expect(outcome.operationCount).toBe(2);
  });

  it("identifies a valid OpenAPI 3.1 document", async () => {
    const source = await readFile(join(fixtures, "openapi-3.1.yaml"), "utf8");
    const outcome = await parsers[0].evaluate(source);
    expect(outcome.valid).toBe(true);
    expect(outcome.version).toBe("3.1");
    expect(outcome.operationCount).toBe(3);
  });

  it("reports whether each parser understands OpenAPI 3.2 constructs", async () => {
    const source = await readFile(join(fixtures, "openapi-3.2.yaml"), "utf8");
    const outcomes = await Promise.all(parsers.map((parser) => parser.evaluate(source)));
    for (const outcome of outcomes) {
      expect(outcome.version.startsWith("3.2")).toBe(true);
      expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    }
    // Scalar exposes 3.2 types but currently rejects additionalOperations;
    // Redocly accepts the OpenAPI 3.2.1 fixture. 3.2 remains unadvertised.
    const scalar = outcomes[0];
    const redocly = outcomes[1];
    expect(scalar?.valid).toBe(false);
    expect(redocly?.valid).toBe(true);
  });

  it("returns actionable errors for invalid documents", async () => {
    const source = await readFile(join(fixtures, "invalid.yaml"), "utf8");
    const outcomes = await Promise.all(parsers.map((parser) => parser.evaluate(source)));
    for (const outcome of outcomes) {
      expect(outcome.valid).toBe(false);
      expect(outcome.errorCount).toBeGreaterThan(0);
      expect(outcome.errors.length).toBeGreaterThan(0);
    }
  });
});
