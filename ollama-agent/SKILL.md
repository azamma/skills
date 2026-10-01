---
name: ollama-agent
description: Run a full Claude Code agent (tools, MCP servers, file access, multi-turn loop) on a non-Anthropic model served by Ollama — DeepSeek, GLM, Kimi, Qwen, gpt-oss or any `*:cloud` model — by launching `claude -p` against Ollama's Anthropic-compatible endpoint. Use it whenever the user asks to delegate, hand off, or "mandá a un DeepSeek / GLM / Kimi / modelo de Ollama / modelo cloud" a task that needs tools: editing a design file through an MCP server, reading code to cite file:line, writing a plan or premortem to a file, reviewing a diff, or fanning out several cheap agents in parallel. Also use it when the user names any Ollama cloud model for agentic work, even without saying "Ollama". For text-only jobs where the whole input fits in the prompt (summarize, classify, rewrite), prefer a plain HTTP call to Ollama (or the `ollama-delegate` skill if installed) instead.
---

# Ollama agent

Claude Code can run on any model behind an Anthropic-compatible Messages API.
Ollama exposes one at `http://localhost:11434`, for local models and for
Ollama Cloud models (`<name>:cloud`). Pointing `claude -p` there gives the
model the whole Claude Code harness: Read/Grep/Write, Bash if allowed, and every
MCP server configured for this user. Your own Agent tool can't
do this — its `model` field only accepts Anthropic models — so this is the way
to get a non-Anthropic *agent*, not just a completion.

## Pick the path

| The task needs… | Use |
|---|---|
| tools: files, code search, MCP servers, writing outputs | this skill (`claude -p` on Ollama) |
| only text you can paste in full (summaries, classification, rewrites) | a plain call to Ollama's `/api/chat` (or `ollama-delegate`): faster, no harness |
| deep reasoning, risky multi-file code changes | a Claude subagent (Sonnet/Opus) |

Cloud flash models are good at bounded, well-specified work: replicate an
approved design across frames, measure a canvas, draft a plan, run a premortem,
review against a checklist. They are weaker at long ambiguous instructions and
at judging their own output — so the spec must be concrete and you verify the
result.

## Where the data goes

- **Local models** (no `:cloud` suffix) run on this machine: prompts, files the
  agent reads and tool output stay here.
- **`:cloud` models run on Ollama's servers.** Everything the agent sends to the
  model — the spec, and every file or tool result it reads — leaves the machine.
  Before delegating work on private code or data to a cloud model, tell the user
  and get an OK, unless they already chose that model for that task. Prefer a
  local model when the content is sensitive.
- Any other gateway set with `OLLAMA_AGENT_URL` follows its own data policy.
- The skill itself reads no credentials and writes only the output files you name.

## Before the first call

1. Ollama is up: `curl -fsS --max-time 5 http://localhost:11434/api/version`.
   If not, ask the user to start it; don't install anything.
2. Pick the model. Use the name the user gave, exactly. If they gave none,
   run `scripts/models.sh` and ask them to choose: it prints what the local
   daemon has, then Ollama Cloud's public catalog (`https://ollama.com/api/tags`,
   names without the suffix — run them as `<name>:cloud`). The local list is not
   proof of availability: a cloud model that was never used doesn't appear there
   and still works.
3. Smoke-test it before real work:
   `scripts/run.sh <model> - <<<"Reply with the single word: pong"` → expect `pong`.
   A catalog name with its own tag (e.g. `name:0813`) may need a different
   suffix; the smoke test tells you.
   Other Anthropic-compatible gateways work the same way: set `OLLAMA_AGENT_URL`
   (and `OLLAMA_AGENT_KEY` if the gateway needs a real key).

## Running an agent

Write the task to a spec file in a temp directory, then run the bundled script (the path is relative to this skill's folder):

```bash
scripts/run.sh <model> <spec.md> [out-prefix] \
  --tools "Read Grep Glob Write mcp__<server>__<tool>" --max-turns 200
```

The script sets `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`, runs `claude -p` with
`--output-format json`, saves `<out-prefix>.out` (JSON) and `.err`, and prints
the final text plus `turns`, `is_error` and `subtype`. Run it with
`run_in_background: true` for anything longer than a minute; you get notified
when it exits.

Everything the model needs goes in the spec — it can't see this conversation:
goal, the files/frames/ids to touch, what not to touch, the rules that apply
(link the repo docs by path so it reads them), how to verify, and where to write
the report. Tell it the output language.

### Traps already paid for

- **Prompt before `--allowedTools`.** That flag takes every following argument;
  a prompt placed after it becomes a "tool". `run.sh` handles the order.
- **Close stdin** (`< /dev/null`). Otherwise `claude -p` waits 3 s for piped input
  and warns. `run.sh` does it.
- **Not errors:** `[claude-code:unrecognized_model]` (pricing lookup) and
  "claude.ai connectors are disabled" (the Ollama key takes precedence, so the
  user's claude.ai-hosted connectors are unavailable to the child; MCP servers
  configured locally still work).
- **Cost in the JSON is fake**: it's computed with Anthropic prices. Ollama Cloud
  bills its own way.
- **Turn budget.** A model that runs out of turns exits "successfully" without
  writing its output (`subtype: error_max_turns`, or the out file missing). Give
  generous `--max-turns`, ask it to write the file early and update it, and check
  the file exists. Resuming works: `--resume <session_id>` from the JSON.
- **Least tools.** Grant only what the task needs. Read-only work (plans,
  premortems, reviews) gets `Read Grep Glob Write` with the output path spelled
  out; no `Bash`, no `Edit` on the repo.

## Parallel work and shared state

Several agents can run at once (one background call each). Two rules keep them
from corrupting each other:

- **One writer per shared resource.** A design file edited through MCP, a single file, the git
  index: run writers in sequence (a `for` loop over batches), readers in parallel.
- **Code changes go through git hygiene.** Tell each agent its own files, to `git
  add` only those, and to retry if the index is locked. For bigger code changes,
  prefer a Claude subagent or a `git worktree` per agent.

Independent reviewers (e.g. two premortems) must not see each other's output:
separate out files, same spec.

## After it returns

The final text is a claim, not a result. Before reporting to the user:

1. Check `is_error`, `subtype` and that the promised files exist.
2. Verify the substance yourself: re-read the edited nodes, run the tests, open
   the exported PNG, spot-check `file:line` citations.
3. Report what you verified and what you didn't. Relay open questions with your
   own recommendation, not the model's by default.

## Example spec skeleton

```markdown
You are working in <repo path>. <One-line goal>.
Read first: <doc paths>. Rules: <the few that matter, concrete>.
Touch only: <ids / files>. Never: <what must stay untouched>.
Do: <ordered steps>.
Verify: <how, in a separate call>.
Write your report in <language> to <absolute path>: <sections wanted>.
```
