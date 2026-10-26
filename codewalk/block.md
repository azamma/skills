# A walk as an HTML block (`block`)

When the reader does not have the repos (a dev on another team, QA, a PM) and your answer goes into an artifact, the walk
goes in as a block: one self-contained HTML fragment with the code already highlighted, its own style and a small script.
It is always dark and paints its own background, so it sits in any page.

```bash
uv run scripts/codewalk.py block --json --peak 2 --close 'It all hangs on `PAID`' -o block.html <<'EOF'
shop src/billing/invoice.py:41-48 If the invoice is not `PAID`, the order is cancelled
shop config/billing.yml:3-5 The currency comes from `currency`
EOF
```

- **Stops:** `<repo> path:A-B <phrase>` (or `path:L`), with the lines you already read. A block takes no symbols: resolve
  them first, with `walk -n --json` if you need to.
- **Phrase:** required. Its `` `identifiers` `` are underlined inside the range; one the range does not show gives a warning,
  a sign the phrase talks about other lines.
- **Limits:** 12 stops (more: split into several blocks), 40 lines per range (`RANGE_TOO_LONG`: narrow it), 3 lines of
  context on each side.
- **Peak and close:** `--peak N` marks in orange the stop where the outcome is decided; `--close` is the conclusion in one
  sentence. `--title` sets the header.
- **Into the artifact:** concatenate your HTML with the file from `-o` (or stdout without `-o`), alone or around your text.
  Different blocks share a page; two identical ones collide (the id comes from the content).

You are done when the exit code is 0 and every line of `data.warnings` is fixed or told to the person. There are two kinds:
an identifier outside its range, and uncommitted changes in a stop's file (the block shows the disk, not what was pushed;
its footer says so too). On failure, `error.fix` says what to change, and `BAD_USAGE` lists each problem in
`error.details.problems`.
