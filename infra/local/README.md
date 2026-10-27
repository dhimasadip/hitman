# Local infrastructure

The Phase 3 local runtime does not require containers:

- PostgreSQL is a user-owned cluster under `.dev/postgres` (port 5433), managed
  by `scripts/dev-db.sh`.
- API and worker run directly with `pnpm dev`.
- The web UI runs with Vite.

Container definitions live in `../deployment/` for staging parity. Once a
container runtime is available, the same images can be built locally from the
repository root:

```bash
docker build -f infra/deployment/Dockerfile.node --build-arg APP=server -t hitman-server:local .
docker build -f infra/deployment/Dockerfile.node --build-arg APP=worker -t hitman-worker:local .
docker build -f infra/deployment/Dockerfile.web -t hitman-web:local .
```

They were not built in the Phase 3 environment because Docker/Podman is not
available.
