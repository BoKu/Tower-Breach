#!/usr/bin/env bash
# TOWER BREACH: play co-op over the internet with one command.
#   npm run online            (or: bash scripts/play-online.sh [port])
# Builds the game, starts the game server (game files + multiplayer relay) and opens a free Cloudflare quick
# tunnel to it. Share the printed https://….trycloudflare.com link: everyone opens it in a browser, one player
# hosts a squad and shares the 5-letter code. Ctrl+C stops the server and the tunnel.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-${PORT:-8080}}"

# 1. cloudflared (one-time install via Homebrew)
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared (Cloudflare's free tunnel tool) is not installed."
  if command -v brew >/dev/null 2>&1; then
    read -r -p "Install it now with Homebrew? [Y/n] " yn
    if [[ "${yn:-Y}" =~ ^[Yy]?$ ]]; then brew install cloudflared; else echo "Aborted."; exit 1; fi
  else
    echo "Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ and re-run."; exit 1
  fi
fi

# 2. build
echo "Building the game…"
npm run build --silent

# 3. game server
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "Port $PORT is already in use. Pass another port: npm run online -- 8090"; exit 1; fi
LOG_DIR="$(mktemp -d)"
PORT="$PORT" node server/server.mjs > "$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!
TUNNEL_PID=""
cleanup() { echo; echo "Stopping…"; [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" 2>/dev/null || true; kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$LOG_DIR"; }
trap cleanup EXIT INT TERM
for _ in $(seq 1 50); do curl -fs "http://localhost:$PORT/" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fs "http://localhost:$PORT/" >/dev/null || { echo "Game server failed to start:"; cat "$LOG_DIR/server.log"; exit 1; }

# 4. tunnel
echo "Opening the Cloudflare tunnel…"
cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" > "$LOG_DIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!
URL=""
for _ in $(seq 1 150); do
  URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1 || true)"
  [[ -n "$URL" ]] && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || break
  sleep 0.2
done
[[ -n "$URL" ]] || { echo "Could not open the tunnel:"; tail -20 "$LOG_DIR/tunnel.log"; exit 1; }

cat <<EOF

  ┌──────────────────────────────────────────────────────────────┐
    TOWER BREACH is online
    Share this link:  $URL
    (also on this machine: http://localhost:$PORT)

    1. Everyone opens the link.
    2. One player: Co-op → Host a squad, then shares the code.
    3. Friends: Co-op → enter the code → Join squad.

    Ctrl+C to stop. A new link is made each time you run this.
  └──────────────────────────────────────────────────────────────┘

EOF
command -v pbcopy >/dev/null 2>&1 && printf '%s' "$URL" | pbcopy && echo "  (link copied to the clipboard)"
wait "$TUNNEL_PID"
