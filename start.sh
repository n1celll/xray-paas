#!/usr/bin/env bash
# Shell-runtime alternative to server.js: runs Xray directly on $PORT.
# Use this when the PaaS runs a start command / Procfile shell entry
# instead of a Node app. Plain GET / on $PORT returns Xray's 400/404,
# which is still a sign of life for TCP/HTTP health checks.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8080}"
UUID="${UUID:-a4bb38be-1d08-42e1-a9dd-934e55857b49}"
WS_PATH="${WS_PATH:-/px-3a0a}"

BIN_DIR="./xray-bin"
XRAY_BIN="$BIN_DIR/xray"
XRAY_ZIP_URL="https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip"

if [ ! -x "$XRAY_BIN" ]; then
  mkdir -p "$BIN_DIR"
  echo "[start] downloading Xray-core from official XTLS GitHub releases"
  curl -LfsS -o "$BIN_DIR/xray.zip" "$XRAY_ZIP_URL"
  if command -v unzip >/dev/null 2>&1; then
    unzip -o "$BIN_DIR/xray.zip" -d "$BIN_DIR" >/dev/null
  else
    python3 -m zipfile -e "$BIN_DIR/xray.zip" "$BIN_DIR"
  fi
  chmod +x "$XRAY_BIN"
  rm -f "$BIN_DIR/xray.zip"
fi

cat > config.generated.json <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": ${PORT},
      "protocol": "vless",
      "settings": {
        "clients": [{ "id": "${UUID}" }],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "ws",
        "security": "none",
        "wsSettings": { "path": "${WS_PATH}" }
      }
    }
  ],
  "outbounds": [{ "protocol": "freedom", "tag": "direct" }]
}
EOF

echo "[start] xray on :${PORT}, ws path ${WS_PATH}"
exec "$XRAY_BIN" run -config config.generated.json
