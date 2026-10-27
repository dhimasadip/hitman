# ADR 0003 — Runner identity and credentials

- **Status:** Accepted
- **Date:** 2026-10-27
- **Owners:** Security, runner workstream
- **PRD references:** §8.6, §11, §15.1, §22 open decision 3

## Decision

1. On first enrollment, the runner generates an **Ed25519 keypair** locally.
   The private key never leaves the device and is stored in the OS-supported
   secure store where practical:
   - Windows: DPAPI/CNG-protected user store.
   - Linux/WSL2: kernel keyring or a permission-restricted (0600) state file
     with a documented fallback; libsecret integration is preferred when
     available.
2. Enrollment uses a **single-use, short-lived code** scoped to one user and
   organization. Only a hash of the code is stored. The code expires after
   10 minutes and is invalidated on use or revocation.
3. The runner proves possession of its private key during enrollment and when
   requesting device tokens. Hitman stores the public key and a credential
   identifier, never the private key.
4. Hitman issues **short-lived, device-scoped access tokens** for API calls and
   WSS authentication. Job execution additionally receives an
   attempt-bound authorization/lease token. Tokens are audience- and
   device-bound, revocable, and never shared between Windows and WSL2 devices.
5. Windows and WSL2 are **separate devices**, even when owned by the same user.
   Each has independent keys, tokens, version, last-seen state, and target
   mappings.
6. Revocation marks the device revoked, invalidates tokens and pending
   enrollment, rejects future claims, and audits the action. An in-flight job is
   cancelled only where the runner can confirm the HTTP request was not sent;
   otherwise the attempt becomes `outcome_unknown`.
7. The runner exposes **no inbound listener** and executes only approved HTTP
   jobs. It has no shell, filesystem write, SSH, or arbitrary TCP capability.
8. Protocol messages carry an explicit protocol version. Unsupported versions
   receive a safe error; they are not best-effort interpreted.

## Consequences

- Phase 11 must implement key storage, enrollment, token issuance, reconnect,
  and revocation together.
- Key rotation is a planned operation, not an emergency-only path.
- Loss of the private key requires re-enrollment; loss of the Hitman-side public
  key record is recoverable only through an audited rotation flow.
