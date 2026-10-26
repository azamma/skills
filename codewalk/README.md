<p align="center"><img src="assets/readme/hero.svg" width="100%" alt="codewalk: your agent shows you the code behind its answer, as a walk that waits for you"></p>

**English** · [Español](README.es.md)

Ask your coding agent "where is X?" or "walk me through Y" and it answers with a **walk**: a few stops through the real
code, each with one sentence on what to notice. The walk lands in a local Walks page and waits there until you open it.

## What you get

**The Walks page** is an inbox. New and updated walks come first, then the one you were reading, then the ones whose code
changed since they were saved, then every walk by folder. Nothing opens on its own: a new walk shows a notice.

<p align="center"><img src="assets/readme/walks.png" width="100%" alt="The Walks page: a new walk with two stops not found, an updated walk that went from 3 to 5 stops, a walk to continue reading, one whose code changed, and the folders"></p>

**A walk** plays at reading pace, or step by step with ← →. The code of each stop is highlighted and the agent's sentence
sits right under it. If the agent replaces the walk you are reading, the new version swaps in and you stay on the same stop.

<p align="center"><img src="assets/readme/walk.png" width="100%" alt="A walk on stop 3 of 5: the files on the left, lines 27 to 31 highlighted with the agent's sentence under them, the stops on the right"></p>

## How it works

1. You ask. The agent writes the stops, one per line: `<repo> <target> <phrase>`.
2. It resolves them with `codewalk.py walk -n` and fixes any it could not place, before you see anything.
3. It saves the walk as a JSON file in `~/.codewalk/walks/`, in a folder if it fits one.
4. The open Walks tab picks it up. With no tab open, the agent gives you the link.

A target can be a path with lines or a symbol, in any language: the CLI finds the definition with `git grep` and reads
where it ends with [Pygments](https://pygments.org/).

| Target | Example |
|---|---|
| Type, method or function | `OrderService#place`, `User#valid?`, `Stock#Reserve` |
| Part of one | `OrderService#place:+4..+12` |
| Function in a module or package | `slugs#slugify`, `parser#Parse` |
| Path with lines | `config/limits.yml:3-8` |

## For someone without the repos

When the answer goes into an artifact, `block` renders the same walk as one self-contained HTML block: code highlighted,
always dark, with a peak stop and a closing line.

<p align="center"><img src="assets/readme/block.png" width="100%" alt="A block with two stops, each with its sentence on the left and its highlighted code on the right, the second marked as the peak, and the closing line"></p>

## Install

Needs [`uv`](https://docs.astral.sh/uv/) and `git`. Put the folder where your agent looks for skills, for example:

```bash
git clone https://github.com/azamma/skills.git
ln -s "$PWD/skills/codewalk" ~/.claude/skills/codewalk
```

The skill triggers on its own. By hand, from its folder:

```bash
uv run scripts/codewalk.py open        # the Walks page
uv run scripts/codewalk.py list        # saved walks and their ids
uv run scripts/codewalk.py walk --title "How an order is placed" --folder "Checkout" < stops.txt
uv run scripts/codewalk.py block -o block.html < stops.txt
uv run scripts/codewalk.py selftest
```

## Good to know

- **Local and read-only.** The server binds to `127.0.0.1`, refuses other hosts and cross-site requests, and only serves
  files a walk names that git tracks in that repo. It never writes to a repo.
- **Finding symbols is a heuristic.** Definitions are known by keyword (`def`, `fn`, `func`, `class`, `struct`, `impl`…),
  by C-like declarations and by JS/TS methods; where one ends comes from braces or indentation. A stop it cannot place comes
  back `unresolved`, or `ambiguous` with candidates, and the agent resends it as a path.
- **Walks stay until you delete them.** What you saw and where you stopped reading live in your browser, not with the walks.
- Files over 1 MB and binary files are not shown.
