#!/usr/bin/env bash
# List models: what the local daemon has, and Ollama Cloud's public catalog.
# usage: models.sh [local|cloud|all]   (default: all)
set -uo pipefail
which="${1:-all}"
host="${OLLAMA_AGENT_URL:-http://localhost:11434}"

names() { python3 -c 'import json,sys; [print(m["name"]) for m in json.load(sys.stdin).get("models", [])]'; }

if [[ "$which" != cloud ]]; then
  echo "# local ($host/api/tags): pulled or already used on this machine"
  curl -fsS --max-time 5 "$host/api/tags" | names || echo "(daemon not reachable at $host)"
fi
if [[ "$which" != local ]]; then
  [[ "$which" == all ]] && echo
  # Only fetches the public catalog; nothing about this machine is sent.
  echo "# cloud (https://ollama.com/api/tags): run locally as <name>:cloud, smoke-test before use"
  curl -fsS --max-time 8 https://ollama.com/api/tags | names || echo "(catalog not reachable)"
fi
