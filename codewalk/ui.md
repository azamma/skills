# What the person sees

Answers for when the person asks how the Walks page or a walk works.

## The Walks page

`uv run scripts/codewalk.py open` opens it; `status` says whether the server runs and whether a tab is open.

- **New since you last looked:** walks sent or replaced since they last opened them. `New` is a walk they never opened,
  `Updated · vN · a→b stops` one the agent replaced.
- **Continue reading:** the last walk they left halfway, at the stop where they left it.
- **Needs a refresh:** walks whose code changed after saving (a stop shows `changed` when its lines differ, `missing` when
  the file or the lines are gone) or that have stops not found. "Copy a fix request" or "Copy a refresh request" copies a
  message for the agent naming the walk id and the stops.
- **All walks:** by folder, then the loose ones.
- The `⋯` menu of a walk: copy its id, move it to a folder (a new name makes the folder), mark it as seen or unseen, delete
  it (with 6 seconds to undo).
- Keys: `/` filter, `j` `k` move between walks, `↵` open, `e` seen or unseen, `⌫` delete, `m` move.

Which walks they saw, and where they stopped reading, live in their browser (localStorage), not with the walks.

## A walk

The stops advance at reading pace, passing over the ones that cannot show. `←` `→` or a click on a stop switch to manual,
`Space` pauses or resumes, `Esc` goes back to Walks. A stop not found shows why, with its candidates when there are several,
and a button to copy a fix request.

## Where walks live

`~/.codewalk/walks/[folder/]<id>.json` (`CODEWALK_HOME` moves it). They stay until the person deletes them. The server
log is `~/.codewalk/server.log`.
