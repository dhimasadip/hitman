# WSL2 / Windows networking spike

Verifies loopback HTTP and outbound WSS from the local network namespace, plus
the procedure for the Windows-host portion that cannot run from this WSL2-only
environment.

## Run (WSL2)

```bash
cd spikes/02-networking
/home/$USER/.local/go/bin/go run .
```

The program starts a loopback HTTP server and a TLS 1.3 WSS echo server, tests
`127.0.0.1` and `localhost`, performs `runner.hello`/`runner.heartbeat` round
trips, and reconnects after a clean close. Results from 2026-10-27:

```json
{
  "generatedAt": "2026-10-27T06:48:09Z",
  "platform": "linux-wsl2",
  "checks": [
    { "name": "http.http://127.0.0.1:.../health", "status": "ok", "detail": "HTTP 200" },
    { "name": "http.http://localhost:.../health", "status": "ok", "detail": "HTTP 200" },
    { "name": "wss.hello", "status": "ok", "detail": "WSS echo round trip" },
    { "name": "wss.heartbeat", "status": "ok", "detail": "WSS echo round trip" },
    { "name": "wss.reconnect", "status": "ok", "detail": "reconnected after clean close" }
  ]
}
```

## Windows validation procedure (pending)

Run on a supported Windows 11 machine, with the signed runner build:

1. Start a test server bound **only** to Windows `127.0.0.1:39001`.
2. Install the Windows runner and enroll it as a Windows device.
3. Create a `local` target mapped to `http://127.0.0.1:39001` for the Windows
   device and run a request. Pass: reaches the Windows server. Fail: reaches a
   WSL2 service or leaves the machine.
4. In WSL2, start a test server bound only to WSL2 `127.0.0.1:39002`.
5. Install/enroll a separate WSL2 runner and target `http://127.0.0.1:39002`.
   Pass: reaches the WSL2 server. Fail: reaches Windows or another namespace.
6. Do not rely on `localhost` forwarding between Windows and WSL2. Use the
   target mapping per device.
7. Record results for:
   - laptop sleep/resume;
   - Wi-Fi change;
   - VPN connect/disconnect;
   - corporate proxy/no-proxy;
   - Windows firewall prompts;
   - WSL2 distribution restart and systemd service behavior.

These are release gates for Phase 11/12, not assumptions. The runner only makes
outbound connections; no inbound listener is opened.
