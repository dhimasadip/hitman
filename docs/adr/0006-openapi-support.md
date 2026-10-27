# ADR 0006 — OpenAPI parser and supported versions

- **Status:** Accepted
- **Date:** 2026-10-27
- **Owners:** Backend, API catalog workstream
- **PRD references:** §7.3, §9.3, §22 open decision 6, Phase 2 Spike B

## Decision

1. **Advertised support:** OpenAPI **3.0.x and 3.1.x**.
2. **3.2.x is experimental and not advertised.** The Phase 2 fixture with
   `additionalOperations: QUERY` and `itemSchema` was accepted by Redocly, but
   `@scalar/openapi-parser` rejected it and only one parser was tested. Enable
   after a broader corpus and client-tool compatibility review.
3. Use **`@redocly/openapi-core` 2.71.1** as the server-side parser/validator,
   with the `struct` rule set to `error`. It validated 3.0.3, 3.1.0, and the 3.2.1
   fixture, and reported actionable errors for a missing `info.title`.
4. Preserve the **raw document** exactly as imported (object storage or JSONB
   metadata plus raw object key), along with source kind, source ref, source
   commit SHA, content hash, and validation report. Parsed operations are a
   derived, replaceable projection.
5. Reject or strip **remote `$ref` URLs** at the application boundary. Only
   local files provided with the import bundle may be resolved. Enforce document
   size, ref depth, and parser time limits before Phase 6 import is enabled.
6. Invalid imports never destroy the last valid specification. The validation
   report is stored with the rejected document; the active specification is
   unchanged.
7. Operation identity uses the explicit `operationId` when present and a derived
   `METHOD path-template` key otherwise. Derived keys are documented as unstable
   when paths change.

## Evidence

| Parser                               | 3.0.3 | 3.1.0 | 3.2.1 fixture                   | 500 paths |
| ------------------------------------ | ----- | ----- | ------------------------------- | --------- |
| `@redocly/openapi-core` 2.71.1       | valid | valid | valid                           | ~278 ms   |
| `@scalar/openapi-parser` 0.29.16     | valid | valid | rejected `additionalOperations` | ~44 ms    |
| `@readme/openapi-parser` 10.0.0      | valid | valid | rejected                        | ~257 ms   |
| `@apidevtools/swagger-parser` 13.1.0 | valid | valid | rejected                        | ~262 ms   |

Times are single-run local measurements, not benchmarks. Full matrix and
fixtures: `spikes/02-openapi-compatibility/`.

## Consequences

- Phase 6 must add its own import-size/time limits and remote-ref rejection.
- 3.2 support is a future opt-in with new tests; do not infer it from the
  specification version alone.
