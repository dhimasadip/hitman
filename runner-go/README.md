# Hitman Go Runner

The runner is the local execution agent for Windows and WSL2/Linux. In Phase 3
it provides build metadata, configuration validation, and the destination
policy foundation. Device enrollment and execution arrive in Phases 11–14.

## Build

```bash
bash ../scripts/run-go.sh build -o bin/hitman-runner ./cmd/hitman-runner
```

Version metadata is injected at build time:

```bash
bash ../scripts/run-go.sh build \
  -ldflags "-X github.com/hitman-api-hub/hitman/runner-go/internal/version.Version=0.1.0 \
            -X github.com/hitman-api-hub/hitman/runner-go/internal/version.Commit=$(git rev-parse HEAD) \
            -X github.com/hitman-api-hub/hitman/runner-go/internal/version.BuildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -o bin/hitman-runner ./cmd/hitman-runner
```

## Minimum supported toolchain

Go 1.27.3 (see `.go-version`).

## Current commands

- `version` — print version, commit, build time, Go version, platform, architecture.
- `doctor` — validate HTTPS server URL, log level, and state-directory permissions.
- `run` — intentionally unavailable until the protocol phase; it must not fake
  connectivity or execution.

## Invariants

- No inbound listener.
- No arbitrary shell execution.
- HTTPS/WSS only for the Hitman control plane.
- Loopback-only HTTP targets by default; LAN/private targets require explicit
  policy.
- Metadata service endpoints and URL credentials are always rejected.
