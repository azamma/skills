---
name: codewalk
description: Show a person the code behind your answer as a walk through stops in their local Walks page, or as an HTML block inside an artifact. Use for "where is X", "walk me through Y", when you found something in the code the person should see, and when the answer goes into an artifact for someone without the repos.
---

# Codewalk

A **walk** takes the person through the **stops** that hold up your answer: each stop is a range of real code with your
phrase about it. You save it with the CLI; it lands in the person's Walks page (`http://127.0.0.1:8777/`), local and
read-only, and stays there until they open it. Symbols resolve in any language.

Run every command from this skill's folder. Needs `uv` and `git`.

## Steps

1. **Pick the output.** The person has the repos on this machine: a walk (steps 2-4). The answer goes into an artifact for
   someone without the repos: a block, read [`block.md`](block.md) and stop here.
2. **Write the stops**, one per line: `<repo> <target> <phrase>`. `<repo>` is a git work tree directly under the root
   (`--root`, default: the parent of the repo you are in). Up to 50 stops.

   | Target | Example | Lands on |
   |---|---|---|
   | `Name#member` | `OrderService#place` | The whole definition, decorators and annotations included |
   | `Name#member:+A..+B` | `OrderService#place:+3..+9` | Lines A to B of it; `+1` is its first line (the first decorator, if any) |
   | `Name` | `OrderMapper` | The type's whole definition |
   | `qual.Name#member` | `billing.Invoice#total` | The same, when two places share the name: the qualifier must appear in the path or the file |
   | `module#function` | `slugs#slugify`, `parser#Parse` | A function in a file or folder with that name (Python module, Go package, JS file) |
   | `path:L`, `path:A-B` | `config/limits.yml:3-8` | Those lines, relative to the repo root |

   A target is a symbol when it has `#` or its last name starts in uppercase; anything else is a path.

   Done when the stops follow the code as it runs (entry, decision, effect) and every phrase says what the person should
   notice in those lines, not what the code is: required, up to 300 characters, `` `identifiers` `` in backticks.
3. **Resolve them** with `-n`, which saves nothing:

   ```bash
   uv run scripts/codewalk.py walk -n --json <<'EOF'
   shop OrderController#place Takes the cart and checks stock before anything else
   shop OrderService#place:+4..+12 Here it decides whether the order can be paid in installments
   shop config/limits.yml:3-8 The per-customer limits live here
   EOF
   ```

   Done when it exits 0. Exit 1 `STOPS_UNRESOLVED` lists the stops in `error.details.stops`: an `ambiguous` one takes one
   of its `candidates` as its target, as written; an `unresolved` one takes a path with the lines you read (`path:A-B`) or a
   qualified name. Fix and run `-n` again. A stop that stays unresolved after you read the code goes as a path.
4. **Save it:** the same command without `-n`, plus:
   - `--title TEXT`: what the walk answers, as the person would say it.
   - `--folder NAME`: files it with related walks (one level, made if missing). Use the folder the person named, or the one
     earlier walks on the topic use (`uv run scripts/codewalk.py list`). Without it the walk stays loose.
   - `--id ID`: replaces a saved walk (same id, version + 1, same folder). Use it to fix a walk, for a change the person
     asks for, and for the fix or refresh requests they copy from the Walks page: those name the id. A tab showing the walk
     swaps in the new version and stays on the same stop.
   - `--open`: puts the walk on screen even when a Walks tab is open (that tab switches to it). Pass it only when the
     person asked to see it now. Without it an open tab keeps what it shows and gets a notice; with no tab open the walk
     opens in the browser either way.
   - `--no-browser`: in a session with no browser (remote, CI): nothing opens, and you give the person the URL.

   Done when it exits 0 and you told the person where to look, with `data.url` in your message every time:
   - `browser`: it opened in a new browser tab.
   - `tab`: it is in their open Walks tab, with a notice; one click opens it.
   - `link` (`--no-browser`): nothing opened; they open `data.url`.

   On failure the last stderr line is `{"ok": false, "error": {code, message, fix, details}}`:

   | Exit | Code | What to do |
   |---|---|---|
   | 1 | `STOPS_UNRESOLVED` | The code moved since step 3. The walk is saved with those stops marked: fix them as in step 3 and resend with `--id <error.details.id>` |
   | 1 | `STOP_NOT_FOUND`, `REPO_NOT_FOUND`, `WALK_NOT_FOUND` | Fix what `details.problems` or `message` names, and resend |
   | 2 | `BAD_USAGE` | `details.problems` lists every bad line with its number: fix them all and resend |
   | 75 | `SERVER_TIMEOUT`, `NETWORK` | Retry; it is safe |
   | 78 | `GIT_MISSING` | Tell the person to install git |

Deleting walks and moving them between folders is the person's call, from the Walks page. When they ask how the page or a
walk works, the answer is in [`ui.md`](ui.md).
