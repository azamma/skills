"""Pure model of a walk's stops: the grammar, its validation and the folder and id rules. No I/O.

One stop per line: `<repo> <target> <phrase>`, where target is `Name#member[:+A..+B]`, `Name`, `qual.Name#member` or
`path:L[-L]`. Blank lines and `#` lines are skipped.
"""

import re
from dataclasses import dataclass
from pathlib import PurePosixPath, PureWindowsPath

MAX_STOPS = 50
MAX_PHRASE = 300
MAX_TITLE = 200
WALK_ID_RE = re.compile(r"w[0-9a-f]{6}")
_IDENT = r"[^\W\d]\w*[?!]?"  # `valid?` and `save!` are Ruby method names
SYMBOL_RE = re.compile(rf"(?P<cls>{_IDENT}(?:\.{_IDENT})*)(?:#(?P<member>{_IDENT})(?::\+(?P<a>[0-9]+)\.\.\+(?P<b>[0-9]+))?)?")
PATH_RE = re.compile(r"(?P<path>.+):(?P<a>[0-9]+)(?:-(?P<b>[0-9]+))?")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


class TooLong(ValueError):
    """A path range over the `max_span` of `parse_stops`."""

    def __init__(self, n: int, target: str, lines: int, limit: int):
        super().__init__(f"range of {lines} lines (max {limit})")
        self.n, self.target, self.lines = n, target, lines


class StopsError(ValueError):
    """Every bad line of a stops text at once: `.errors` is [(line number, message)], line 0 for the text as a whole;
    `.long` is [(line number, TooLong)], the ranges over the limit (they are in `.errors` too)."""

    def __init__(self, errors: list[tuple[int, str]], long: list[tuple[int, TooLong]] = ()):
        self.errors, self.long = errors, list(long)
        super().__init__("; ".join(f"line {n}: {msg}" if n else msg for n, msg in errors))


@dataclass(frozen=True)
class Stop:
    n: int  # 1-based position among the stops (blank and comment lines do not count)
    repo: str
    target: str  # as written
    phrase: str
    kind: str  # "symbol" or "path"
    path: str | None  # path stops: relative to the repo root, as written
    cls: str | None  # symbol stops: the container (type, module, package), maybe qualified
    member: str | None  # symbol stops: the function or method, if any
    span: tuple[int, int] | None  # path stops: lines A-B; symbol stops: the `+A..+B` offsets, if any


def default_title(n: int) -> str:
    return f"Walk of {n} stop" + ("" if n == 1 else "s")


def valid_folder(name) -> bool:
    """A folder of walks: one level, a name a person types (`Loan assignment`), safe as a directory name on every OS."""
    return (isinstance(name, str) and 0 < len(name) <= 80 and name == name.strip() and not name.startswith(".")
            and not _CONTROL_RE.search(name) and not any(c in name for c in '/\\:*?"<>|'))


def parse_stops(text: str, *, paths_only: bool = False, max_stops: int = MAX_STOPS, max_span: int | None = None) -> list[Stop]:
    """The stops, in order; raises StopsError with every bad line instead of stopping at the first.
    `paths_only` refuses symbol targets and `max_span` ranges of more lines (what a `block` takes)."""
    stops: list[Stop] = []
    errors: list[tuple[int, str]] = []
    long: list[tuple[int, TooLong]] = []
    seen = 0
    for lineno, raw in enumerate(text.split("\n"), 1):  # not splitlines(): it breaks on characters an editor does not count
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        seen += 1
        if seen == max_stops + 1:
            errors.append((lineno, f"too many stops (max {max_stops})"))
        try:
            stops.append(_parse_stop(seen, line, paths_only, max_span))
        except TooLong as exc:
            errors.append((lineno, str(exc)))
            long.append((lineno, exc))
        except ValueError as exc:
            errors.append((lineno, str(exc)))
    if not errors and not stops:
        errors.append((0, "no stops: expected at least one `<repo> <target> <phrase>` line"))
    if errors:
        raise StopsError(errors, long)
    return stops


def _parse_stop(n: int, line: str, paths_only: bool = False, max_span: int | None = None) -> Stop:
    parts = line.split(None, 2)
    if len(parts) < 3:
        raise ValueError(f"expected `<repo> <target> <phrase>` (the phrase is required), got {len(parts)} field(s)")
    repo, target, phrase = parts
    if _CONTROL_RE.search(repo) or ".." in repo or repo == "." or any(c in repo for c in "/\\~"):
        raise ValueError("repo must be one folder name, without `..`, `/`, `\\` or `~`")
    if len(phrase) > MAX_PHRASE:
        raise ValueError(f"phrase has {len(phrase)} characters (max {MAX_PHRASE})")
    stop = Stop(n, repo, target, phrase, *_parse_target(target))
    if paths_only and stop.kind != "path":
        raise ValueError(f"`{target}` is a symbol: here the target is a path with its lines, `path:A-B` or `path:L`")
    if max_span and stop.kind == "path" and (lines := stop.span[1] - stop.span[0] + 1) > max_span:
        raise TooLong(n, target, lines, max_span)
    return stop


def _parse_target(target: str):
    """(kind, path, cls, member, span) of a target; ValueError when it is none of the grammar's forms."""
    if _CONTROL_RE.search(target):
        raise ValueError("target has a control character")
    m = SYMBOL_RE.fullmatch(target)
    # a symbol has a `#`, or its last name starts in uppercase; otherwise `main.go` or `utils` is a path
    if m and ("#" in target or m["cls"].rsplit(".", 1)[-1][0].isupper()):
        span = (int(m["a"]), int(m["b"])) if m["a"] else None
        if span and not 1 <= span[0] <= span[1]:
            raise ValueError(f"bad range `:+{span[0]}..+{span[1]}`: expected 1 <= A <= B")
        return "symbol", None, m["cls"], m["member"], span
    if "#" in target and ":" not in target:
        raise ValueError("bad symbol: expected `Name#member` or `Name#member:+A..+B`")
    m = PATH_RE.fullmatch(target)
    path = m["path"] if m else target
    if path.startswith(("\\", "~")) or PurePosixPath(path).is_absolute() or PureWindowsPath(path).anchor:
        raise ValueError("path must be relative to the repo: no absolute path, no leading `\\` or `~`")
    if ".." in re.split(r"[/\\]", path):
        raise ValueError("path must stay inside the repo: no `..`")
    if not m:
        raise ValueError("a path needs its lines: `path:L` or `path:A-B`")
    a, b = int(m["a"]), int(m["b"] or m["a"])
    if not 1 <= a <= b:
        raise ValueError(f"bad lines {a}-{b}: expected 1 <= A <= B")
    return "path", path, None, None, (a, b)


def demo():
    s = parse_stops("# comment\n\nshop OrderService#place:+2..+9 Checks stock first\nshop src/app.py:4-7 The limits live here\n")
    assert [(x.n, x.kind, x.cls, x.member, x.span, x.path) for x in s] == [
        (1, "symbol", "OrderService", "place", (2, 9), None), (2, "path", None, None, (4, 7), "src/app.py")]
    assert parse_stops("api utils#slugify Lowercases the title")[0].cls == "utils"
    assert parse_stops("api User#valid? Checks the email")[0].member == "valid?"
    for bad in ("a ../x:1 p", "a /etc/passwd:1 p", "a main.go p", "a x:3-1 p", "../a X p", "a X"):
        try:
            parse_stops(bad)
        except StopsError:
            continue
        raise AssertionError(bad)
    try:
        parse_stops("a x.py:1-50 p", paths_only=True, max_span=40)
    except StopsError as exc:
        assert exc.long and exc.long[0][1].lines == 50
    assert valid_folder("Loan assignment") and not valid_folder("a/b") and not valid_folder("..") and not valid_folder(" x")


if __name__ == "__main__":
    demo()
