# Architecture Decision Records

| ADR                                        | Decision                                                                   | Status   |
| ------------------------------------------ | -------------------------------------------------------------------------- | -------- |
| [0001](0001-identity-and-authorization.md) | Hitman-native auth, OAuth 2.1 authorization server, future SAML federation | Accepted |
| [0002](0002-mcp-transport-and-auth.md)     | MCP TypeScript SDK v2, Streamable HTTP, stateless business state           | Accepted |
| [0003](0003-runner-credentials.md)         | Ed25519 device keypair plus short-lived device tokens                      | Accepted |
| [0004](0004-http-execution-safety.md)      | Loopback-first target policy, redirects denied by default, no shell        | Accepted |
| [0005](0005-durable-jobs.md)               | PostgreSQL job records, `SKIP LOCKED` claim, leases, `outcome_unknown`     | Accepted |
| [0006](0006-openapi-support.md)            | OpenAPI 3.0.x/3.1.x advertised; Redocly parser; 3.2 experimental           | Accepted |
| [0007](0007-gitlab-authentication.md)      | Configurable PAT or OAuth app; webhook secret plus reconciliation          | Accepted |
| [0008](0008-runtime-and-deployment.md)     | Modular monolith, local Node/PostgreSQL, container staging manifests       | Accepted |

The PRD remains the product source of truth. These ADRs record implementation
choices approved during Phase 0 and the evidence that supports them.
