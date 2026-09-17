#!/bin/bash
set -euo pipefail

uid="$(id -u)"
launch_agents="$HOME/Library/LaunchAgents"
token_dir="/Library/Application Support/com.cloudflare.cloudflared"
token_file="$token_dir/token"

echo "This repairs the existing Belly Home and Cloudflare startup services."
echo "Copy the token only (the eyJ... value) from Cloudflare's Add a replica page."
IFS= read -r -s -p "Cloudflare tunnel token: " tunnel_token
echo

if [[ ! "$tunnel_token" =~ ^eyJ[A-Za-z0-9._-]+$ ]]; then
  unset tunnel_token
  echo "The value does not look like a Cloudflare tunnel token." >&2
  exit 1
fi

echo "Removing obsolete AlarmGateway startup services..."
launchctl bootout "gui/$uid/com.cc.alarm-gateway.gateway" 2>/dev/null || true
launchctl bootout "gui/$uid/com.cc.alarm-gateway.mcp-http" 2>/dev/null || true
rm -f \
  "$launch_agents/com.cc.alarm-gateway.gateway.plist" \
  "$launch_agents/com.cc.alarm-gateway.mcp-http.plist"

echo "Restoring the Cloudflare boot token..."
sudo mkdir -p "$token_dir"
printf '%s\n' "$tunnel_token" | sudo tee "$token_file" >/dev/null
unset tunnel_token
sudo chown root:wheel "$token_file"
sudo chmod 600 "$token_file"
sudo launchctl kickstart -k system/com.cloudflare.cloudflared

echo "Deploying the unified Belly Home service..."
node scripts/deploy-mcp-update.mjs

echo "Waiting for services..."
sleep 5

if lsof -nP -iTCP:8790 -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
  echo "Old port 8790 is still listening." >&2
  exit 1
fi

curl --fail --silent --show-error http://127.0.0.1:8787/health
echo

public_status="$(curl --silent --output /dev/null --write-out '%{http_code}' https://mcp.bellyjuris.com/mcp)"
if [[ "$public_status" != "405" ]]; then
  echo "Cloudflare is running, but the public MCP check returned HTTP $public_status instead of 405." >&2
  echo "Confirm mcp.bellyjuris.com points to http://localhost:8787 in Published application routes." >&2
  exit 1
fi

echo "Repair complete: one Gateway on 8787, Cloudflare connected, public MCP reachable."
