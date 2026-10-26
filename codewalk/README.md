<p><img src="assets/readme/walks.png" width="100%" alt="The Walks page: new and updated walks first, one with two stops not found, a walk to continue reading, one whose code changed, and the folders"></p>

# codewalk

**English** · [Español](README.es.md)

Your agent shows you the code behind its answer as a **walk**: a few stops through real code, each with one sentence
about what to notice. Walks land in a local Walks page and wait there until you open them. When the answer is for someone
without the repos, the same walk comes out as an HTML block to paste into an artifact.

<p><img src="assets/readme/walk.png" width="100%" alt="A walk on stop 3 of 5: the files on the left, the code with the stop's lines highlighted and the agent's sentence under them, the stops on the right"></p>

## What it does

- **`walk`** saves a walk as a JSON file in `~/.codewalk/walks/`, optionally in a folder, and tells the agent right away
  which stops it could not locate, so it fixes them before you look.
- **The Walks page** (`http://127.0.0.1:8777/`) is an inbox: new and updated walks first, the one you were reading, the
  ones whose code changed since they were saved, and every walk by folder. Nothing opens on its own; a new walk shows a
  notice. You move walks between folders, delete them, and copy a ready-made request for the agent to fix or refresh one.
- **A walk** plays at reading pace, or step by step. If the agent replaces the walk you are reading, the new version swaps
  in and you stay on the same stop.
- **`block`** renders a walk as one self-contained HTML block (code highlighted, always dark) for an artifact.

Any language: stops can name a symbol (`OrderService#place`, `parser#Parse`, `User#valid?`) and the CLI finds its
definition with `git grep` and Pygments, or a path with lines (`config/limits.yml:3-8`).

## How to use it

It triggers on its own when you ask "where is X", "walk me through Y", or when the agent finds something in the code you
should see. By hand, from the skill's folder:

```bash
uv run scripts/codewalk.py walk --title "How an order is placed" --folder "Checkout" <<'EOF'
shop OrderController#place Takes the cart and checks stock before anything else
shop config/limits.yml:3-8 The per-customer limits live here
EOF
uv run scripts/codewalk.py open             # the Walks page
uv run scripts/codewalk.py list             # saved walks and their ids
uv run scripts/codewalk.py block -o block.html < stops.txt
uv run scripts/codewalk.py selftest
```

Needs `uv` and `git`. `uv` installs the one dependency, [Pygments](https://pygments.org/) (BSD), on the first run.

## Good to know

- **Read-only and local.** The server binds to `127.0.0.1`, refuses other hosts and cross-site requests, and only serves
  files a walk names that git tracks in that repo. It never writes to a repo.
- **Finding symbols is a heuristic.** It knows definitions by keyword (`def`, `fn`, `func`, `class`, `struct`, `impl`…), by
  C-like declarations and by JS/TS methods; the end of a definition comes from braces or indentation. A stop it cannot place
  comes back `unresolved` or `ambiguous` with candidates, and the agent resends it as a path.
- **What you saw and where you stopped reading** are kept in your browser (localStorage), not with the walks.
- Files over 1 MB and binary files are not shown.
- The screens were designed in Open Design (project *Codewalk*).
