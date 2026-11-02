# xray-paas

Minimal Xray server for PaaS deploys (Velixir / FadeHost style). The PaaS
edge terminates TLS on the platform subdomain, so inside the app Xray runs
plain VLESS + WebSocket with no TLS of its own.

## Structure (chosen layout)

- `package.json` — `npm start` runs `node server.js`. This is the standard
  entry for Node-based PaaS git builders.
- `server.js` — main entry. On boot it:
  1. Downloads the official Xray-core release (XTLS GitHub releases) into
     `xray-bin/` if the binary is missing.
  2. Generates `config.generated.json` from env vars.
  3. Spawns Xray on an internal port (127.0.0.1 only).
  4. Serves the public `$PORT` itself: `GET /` and `GET /health` return
     `200 ok` for health checks, and WebSocket upgrade requests on
     `WS_PATH` are raw-proxied to Xray.
- `Procfile` — `web: node server.js`, for Procfile-based platforms.
- `start.sh` — alternative for shell runtimes: downloads Xray the same
  way, generates the same config inline, and `exec`s Xray directly on
  `$PORT` (no Node proxy; a plain `GET /` then returns Xray's 400/404,
  which is still a sign of life). The config template it inlines is also
  kept as `config.template.json` with `__UUID__` / `__PORT__` /
  `__WS_PATH__` placeholders.

Only the official release is used:
`https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip`
No third-party one-click scripts.

## Env vars

| Name      | Default                              | Meaning                          |
|-----------|--------------------------------------|----------------------------------|
| `UUID`    | `a4bb38be-1d08-42e1-a9dd-934e55857b49` | VLESS client UUID              |
| `WS_PATH` | `/px-3a0a`                           | WebSocket path                   |
| `PORT`    | `8080` (platform usually sets this)  | Public port the app listens on   |
| `XRAY_PORT` | `10001`                            | Internal Xray port (server.js only) |

Defaults above are the ones generated for this package. Override `UUID`
(and ideally `WS_PATH`) in the platform's env settings for a real deploy.

## Clash client parameters (VLESS node)

- server: `<your-app-subdomain>` (e.g. `your-app.velixir.run` or
  `your-app.fadehost.app`)
- port: `443`
- tls: `true`
- servername (SNI): the same app subdomain
- network: `ws`
- ws path: `/px-3a0a` (or your `WS_PATH`)
- ws Host header: the same app subdomain
- uuid: `a4bb38be-1d08-42e1-a9dd-934e55857b49` (or your `UUID`)
- udp: `true`

Example Clash proxy entry:

```yaml
- name: paas-vless
  type: vless
  server: your-app.velixir.run
  port: 443
  uuid: a4bb38be-1d08-42e1-a9dd-934e55857b49
  tls: true
  servername: your-app.velixir.run
  network: ws
  udp: true
  ws-opts:
    path: /px-3a0a
    headers:
      Host: your-app.velixir.run
```

## Local test performed (2026-11-02, on the build VM)

- Server via `PORT=18080 node server.js`: Xray 26.10.31 downloaded from
  the official XTLS release, `GET /` returned 200 `ok`.
- A second Xray ran as client (SOCKS5 127.0.0.1:11080, VLESS+WS outbound
  to 127.0.0.1:18080, default UUID/path). Through it, a loopback HTTP
  origin returned its body correctly — the VLESS+WS tunnel itself
  (including the Node upgrade proxy in `server.js`, and separately the
  `start.sh` direct-Xray layout on :18081) is verified working.
- External HTTPS note: this particular VM forces all direct egress
  through a sandbox HTTP proxy, so Xray's `freedom` direct dial stalls
  here (that is a property of this sandbox, not of the config). For the
  external check only, a throwaway server copy in /tmp chained its
  outbound through that sandbox proxy: `https://www.google.com/generate_204`
  then returned **204** and `https://example.com/` returned **200**
  through the SOCKS5→VLESS+WS chain (~0.45 s each). On a normal PaaS
  host with direct egress, the shipped `freedom` outbound does this
  directly. All test processes were killed afterwards.
