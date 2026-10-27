# OpenAPI compatibility spike

Tests four parsers against 3.0.3, 3.1.0, a 3.2.1 fixture, an invalid document,
and a generated 500-path document.

## Run

```bash
cd spikes/02-openapi-compatibility
pnpm test
pnpm exec tsx src/evaluate.ts > results/matrix-2026-10-27.json
```

## Result summary

- **Chosen:** `@redocly/openapi-core` 2.71.1 with `rules: { struct: "error" }`.
  Supports 3.0/3.1 and the tested 3.2 constructs; actionable errors.
- Scalar is faster on large documents but rejected the 3.2
  `additionalOperations` fixture.
- `@readme/openapi-parser` and `@apidevtools/swagger-parser` accepted 3.1 but
  rejected 3.2.
- Advertised support remains 3.0.x/3.1.x. 3.2.x is experimental (ADR 0006).

The matrix includes single-run local timings; do not treat them as benchmarks.
