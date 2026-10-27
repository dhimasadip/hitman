import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parsers } from "./adapters.js";

const fixtureDir = join(import.meta.dirname, "..", "fixtures");
const fixtures = ["openapi-3.0.yaml", "openapi-3.1.yaml", "openapi-3.2.yaml", "invalid.yaml"];

interface MatrixRow {
  fixture: string;
  parser: string;
  version: string;
  valid: boolean;
  errorCount: number;
  warningCount: number;
  operationCount: number;
  durationMs: number;
  errors: string[];
}

const rows: MatrixRow[] = [];

for (const fixture of fixtures) {
  const source = await readFile(join(fixtureDir, fixture), "utf8");
  for (const parser of parsers) {
    const outcome = await parser.evaluate(source);
    rows.push({ fixture, ...outcome });
  }
}

const largeDocument = {
  openapi: "3.1.0",
  info: { title: "Large fixture", version: "1.0.0" },
  paths: Object.fromEntries(
    Array.from({ length: 500 }, (_, index) => [
      `/api/v1/resource-${index}/{id}`,
      {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          operationId: `getResource${index}`,
          responses: {
            "200": {
              description: "Resource",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Resource" } },
              },
            },
          },
        },
      },
    ]),
  ),
  components: {
    schemas: {
      Resource: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
        },
      },
    },
  },
};

const largeSource = JSON.stringify(largeDocument);
for (const parser of parsers) {
  const outcome = await parser.evaluate(largeSource);
  rows.push({ fixture: "large-500-paths.json", ...outcome });
}

process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
