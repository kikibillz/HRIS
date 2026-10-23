#!/usr/bin/env bash
# Repeatable Codespaces startup; keeps SQLite and account data intact.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

export HRIS_PREVIEW_PORT="${HRIS_PREVIEW_PORT:-3000}"
if [[ ! "$HRIS_PREVIEW_PORT" =~ ^[0-9]{1,5}$ ]] || ((10#$HRIS_PREVIEW_PORT<1 || 10#$HRIS_PREVIEW_PORT>65535)); then
  echo 'HRIS_PREVIEW_PORT must be a port number from 1 to 65535.' >&2
  exit 1
fi

# An existing Codespace may still have its original Node version.
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
  nvm_script="${NVM_DIR:-/usr/local/share/nvm}/nvm.sh"
  if [[ ! -s "$nvm_script" ]]; then
    echo 'Node.js 24 is required. In Codespaces run: Command Palette → Codespaces: Rebuild Container.' >&2
    exit 1
  fi
  set +u
  source "$nvm_script"
  nvm install 24
  nvm use 24
  set -u
fi

# Require the real app response, not simply an open port.
healthy() {
  node --input-type=module -e '
    try {
      const response=await fetch(`http://127.0.0.1:${process.env.HRIS_PREVIEW_PORT}/login`,{signal:AbortSignal.timeout(1500)});
      const html=await response.text();
      process.exit(response.ok && html.includes("PeopleOS") && (html.includes("Welcome back.") || html.includes("Make this workspace yours.")) ? 0 : 1);
    } catch {process.exit(1)}
  '
}
show_ready() {
  echo "PeopleOS is ready. Open port $HRIS_PREVIEW_PORT from the Codespaces Ports panel (keep it Private)."
  if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
    echo "App: https://${CODESPACE_NAME}-${HRIS_PREVIEW_PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}/"
  fi
}
if healthy; then
  show_ready
  exit 0
fi
# Do not replace an unrelated process that is using this port.
if node --input-type=module -e 'import net from "node:net"; const s=net.connect(Number(process.env.HRIS_PREVIEW_PORT),"127.0.0.1");s.on("connect",()=>{s.destroy();process.exit(0)});s.on("error",()=>process.exit(1))'; then
  echo "Port $HRIS_PREVIEW_PORT is occupied but PeopleOS is not responding correctly. Check the existing server terminal; this script will not stop another process." >&2
  exit 1
fi

mkdir -p data
lock_dir="data/.preview-start.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo 'Another preview start is already running. Wait for it to finish.' >&2
  exit 1
fi
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT
# Lock before installation: simultaneous starts must not replace each other’s dependencies.
if [[ "${HRIS_PREVIEW_REINSTALL:-0}" != "1" ]] && node scripts/preview-dependencies.mjs check; then
  echo 'Reusing verified dependencies; dependency files and Node runtime are unchanged.'
else
  npm ci --cache /tmp/hris-npm-cache
  node scripts/preview-dependencies.mjs record
fi
# Detach from the lifecycle/terminal session so the server survives its exit.
nohup env HRIS_ALLOW_SETUP=1 npm run dev -- --port "$HRIS_PREVIEW_PORT" > data/preview.log 2>&1 < /dev/null &
preview_pid=$!
printf '%s\n' "$preview_pid" > data/preview.pid
for ((attempt=0; attempt<60; attempt++)); do
  if healthy; then
    show_ready
    exit 0
  fi
  if ! kill -0 "$preview_pid" 2>/dev/null; then
    echo 'The server exited. Last startup messages:' >&2
    tail -n 35 data/preview.log >&2
    exit 1
  fi
  sleep 0.5
done
echo 'The server is still starting or has a startup error. Last messages:' >&2
tail -n 35 data/preview.log >&2
echo 'Run npm run preview:check for read-only diagnostics.' >&2
exit 1
