// Minimal PaaS entry point:
// - Ensures an official Xray-core binary exists (downloads it if missing)
// - Generates the Xray config from env vars
// - Runs Xray on an internal port (127.0.0.1 only)
// - Serves the public PORT itself: health page on / and a raw
//   WebSocket-upgrade proxy to Xray for WS_PATH
// This lets a PaaS edge terminate TLS and forward wss:// traffic to $PORT,
// while a plain GET / returns 200 as a health/liveness signal.
'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PORT = parseInt(process.env.PORT || '8080', 10);
const UUID = process.env.UUID || 'a4bb38be-1d08-42e1-a9dd-934e55857b49';
const WS_PATH = process.env.WS_PATH || '/px-3a0a';
let XRAY_PORT = parseInt(process.env.XRAY_PORT || '10001', 10);
if (XRAY_PORT === PORT) XRAY_PORT = PORT + 1;

const ROOT = __dirname;
const BIN_DIR = path.join(ROOT, 'xray-bin');
const XRAY_BIN = path.join(BIN_DIR, 'xray');
const XRAY_ZIP_URL =
  'https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip';
const CONFIG_PATH = path.join(ROOT, 'config.generated.json');

function ensureXray() {
  if (fs.existsSync(XRAY_BIN)) return;
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const zip = path.join(BIN_DIR, 'xray.zip');
  console.log('[app] downloading Xray-core from official XTLS GitHub releases');
  execFileSync('curl', ['-LfsS', '-o', zip, XRAY_ZIP_URL], { stdio: 'inherit' });
  try {
    execFileSync('unzip', ['-o', zip, '-d', BIN_DIR], { stdio: 'inherit' });
  } catch (_) {
    execFileSync('python3', ['-m', 'zipfile', '-e', zip, BIN_DIR], { stdio: 'inherit' });
  }
  fs.chmodSync(XRAY_BIN, 0o755);
  fs.unlinkSync(zip);
}

function writeConfig() {
  const cfg = {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        listen: '127.0.0.1',
        port: XRAY_PORT,
        protocol: 'vless',
        settings: {
          clients: [{ id: UUID }],
          decryption: 'none',
        },
        streamSettings: {
          network: 'ws',
          security: 'none',
          wsSettings: { path: WS_PATH },
        },
      },
    ],
    outbounds: [{ protocol: 'freedom', tag: 'direct' }],
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let xray = null;
function startXray() {
  try {
    ensureXray();
    writeConfig();
  } catch (e) {
    console.log(`[app] xray setup failed: ${e && e.message ? e.message : e}`);
    process.exit(1);
  }
  xray = spawn(XRAY_BIN, ['run', '-config', CONFIG_PATH], { stdio: 'inherit' });
  xray.on('exit', (code, signal) => {
    console.log(`[app] xray exited code=${code} signal=${signal}`);
    process.exit(code == null ? 1 : code);
  });
}

const server = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0];
  if (url === '/' || url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok\n');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found\n');
});

server.on('upgrade', (req, socket, head) => {
  const url = (req.url || '').split('?')[0];
  if (url !== WS_PATH) {
    socket.destroy();
    return;
  }
  const upstream = net.connect(XRAY_PORT, '127.0.0.1', () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    raw += '\r\n';
    upstream.write(raw);
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[app] listening on :${PORT}, ws path ${WS_PATH}, xray internal :${XRAY_PORT}`);
  setImmediate(startXray);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    try { if (xray) xray.kill(sig); } catch (_) {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
