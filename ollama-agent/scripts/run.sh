#!/usr/bin/env bash
# Run a Claude Code agent on an Ollama (or any Anthropic-compatible) model.
# usage: run.sh <model> <spec-file|-> [out-prefix] [--tools "A B C"] [--max-turns N] [-- extra claude args]
set -euo pipefail

model="${1:?model}"; spec="${2:?spec file or -}"; shift 2
out=""
if [[ $# -gt 0 && "$1" != --* ]]; then out="$1"; shift; fi
tools="Read Grep Glob"; turns=100; extra=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tools) tools="$2"; shift 2 ;;
    --max-turns) turns="$2"; shift 2 ;;
    --) shift; extra=("$@"); break ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ "$spec" == "-" ]]; then prompt="$(cat)"; else prompt="$(cat "$spec")"; fi
out="${out:-${TMPDIR:-/tmp}/ollama-agent-$$}"
read -r -a tool_list <<<"$tools"

# Prompt goes before --allowedTools: that flag swallows every argument after it.
ANTHROPIC_BASE_URL="${OLLAMA_AGENT_URL:-http://localhost:11434}" \
ANTHROPIC_API_KEY="${OLLAMA_AGENT_KEY:-ollama}" \
claude -p "$prompt" --model "$model" --output-format json --max-turns "$turns" \
  ${extra[@]+"${extra[@]}"} --allowedTools "${tool_list[@]}" \
  < /dev/null > "$out.out" 2> "$out.err" || true

python3 - "$out.out" <<'EOF'
import json, sys
p = sys.argv[1]
try:
    d = json.load(open(p))
except Exception as e:
    print(f"[ollama-agent] no JSON in {p}: {e}; see {p[:-4]}.err"); sys.exit(1)
print(d.get("result", ""))
print(f"\n[ollama-agent] turns={d.get('num_turns')} is_error={d.get('is_error')} "
      f"subtype={d.get('subtype')} session={d.get('session_id')} out={p}")
EOF
