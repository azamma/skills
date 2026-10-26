#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pygments>=2.17"]
# ///
"""Codewalk: show a person the code behind an answer, as a walk through stops in a local web page, or as an HTML block.

    uv run scripts/codewalk.py walk [--title T] [--folder F] [--id ID] [--open] [--root DIR] [-n] < stops
    uv run scripts/codewalk.py block [--title T] [--peak N] [--close T] [-o FILE] [-n] < stops
    uv run scripts/codewalk.py list | open [--id ID] | status | serve | selftest

Walks are JSON files under ~/.codewalk/walks/[folder/]. The server binds to 127.0.0.1, reads repos with git and never writes to them.
"""

import argparse
import contextlib
import functools
import hashlib
import json
import mimetypes
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime, timezone
from html import escape as esc
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from pygments.lexers import get_lexer_for_filename
from pygments.token import Comment, Keyword, Name, Number, String, Token
from pygments.util import ClassNotFound

import stops as grammar  # next to this script, stdlib only

VERSION = "1.0.0"
SCHEMA = 1
SCRIPTS = Path(__file__).resolve().parent
WEB_DIR = SCRIPTS.parent / "web"
MARKER, VERSION_HEADER = "X-Codewalk", "X-Codewalk-Version"
CSP = "default-src 'self'"
MAX_FILE = 1 << 20
MAX_BODY = 16 << 10
DEFAULT_PORT, DEFAULT_TIMEOUT = 8777, 20.0
TAB_FRESH = 8  # seconds since its last poll that a tab still counts as open (it polls every 2)
BLOCK_MAX_STOPS, BLOCK_MAX_LINES = 12, 40
TEST_RE = re.compile(r"(^|/)(tests?|specs?|__tests__|testing)/|(^|/)test_[^/]*$|_test\.[^/]+$|Tests?\.[^/]+$|\.(spec|test)\.[^/]+$")
COMMENT_START = ("//", "#", "*", "/*", "--", ";", "%", "<!--")


class CliError(Exception):
    """A failure the CLI reports: handlers raise it, only `main()` prints it and picks the exit code."""

    def __init__(self, code, message, fix, exit=1, details=None):
        super().__init__(message)
        self.code, self.message, self.fix, self.exit, self.details = code, message, fix, exit, details


def usage(message, details=None):
    return CliError("BAD_USAGE", message, "uv run scripts/codewalk.py <command> --help", 2, details)


def home():
    return Path(os.environ.get("CODEWALK_HOME") or "~/.codewalk").expanduser()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------- git, read-only

def git(cwd, *args):
    """stdout bytes of a read-only git call in `cwd`; CalledProcessError on failure, FileNotFoundError without git."""
    cmd = ["git", "-C", str(cwd), "--no-pager", "-c", "color.ui=false", "-c", "core.quotepath=false", "--literal-pathspecs", *args]
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"}
    return subprocess.run(cmd, capture_output=True, check=True, timeout=60, env=env).stdout


def git_top(d):
    try:
        return Path(git(d, "rev-parse", "--show-toplevel").decode().strip()).resolve()
    except subprocess.CalledProcessError:
        return None


def branch_head(top):
    def out(*args):
        try:
            return git(top, *args).decode().strip() or None
        except subprocess.CalledProcessError:
            return None
    return out("symbolic-ref", "--short", "-q", "HEAD"), out("rev-parse", "--verify", "-q", "HEAD")


def tracked(d):
    """Paths git lists in the work tree at `d` (tracked, or untracked and not ignored)."""
    raw = git(d, "ls-files", "-z", "-co", "--exclude-standard")
    return {n for n in (x.decode(errors="ignore") for x in raw.split(b"\0")) if n}


def repo_file(base, rel):
    """The regular file `rel` under the repo `base`, or None when it is gone, a symlink or outside `base`."""
    try:
        p = base / rel
        if p.is_symlink():
            return None
        p = p.resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    return p if p.is_relative_to(base) and p.is_file() else None


@functools.lru_cache(maxsize=256)
def _read(path, stamp):
    with open(path, "rb") as f:
        data = f.read(MAX_FILE + 1)
    if len(data) > MAX_FILE or b"\0" in data[:8000]:
        return None
    return data.decode("utf-8", "replace").replace("\r\n", "\n").expandtabs(4)


def read_text(p):
    """Text of the file at `p` (tabs expanded, \\r\\n folded), None when it is binary or over 1 MB; cached by mtime and size."""
    st = p.stat()
    return _read(str(p), (st.st_mtime_ns, st.st_size))


def split_lines(text):
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return lines


def need_git():
    if not shutil.which("git"):
        raise CliError("GIT_MISSING", "git is not in the PATH", "install git and retry", 78)


def walk_repos(root, names):
    """`({name: dir}, {name: why})`: which repos are git work trees directly under `root`."""
    ok, bad = {}, {}
    for name in names:
        try:
            d = (root / name).resolve()
            good = d.is_relative_to(root) and d != root and d.is_dir() and git_top(d) == d
        except (OSError, RuntimeError, ValueError):
            good = False
        (ok.__setitem__(name, d) if good else bad.__setitem__(name, f"{name!r} is not a git work tree directly under {root}"))
    return ok, bad


# ---------------------------------------------------------------- lexing: highlight rows and block ends, any language Pygments knows

def lexer_for(path):
    try:
        return get_lexer_for_filename(path, stripnl=False, ensurenl=False)
    except ClassNotFound:
        return None


def tokens(path, text):
    """[(line index, ttype, value)] of the whole file; a value never spans lines."""
    lx = lexer_for(path)
    out, line = [], 0
    for _, ttype, value in (lx.get_tokens_unprocessed(text) if lx else [(0, Token.Text, text)]):
        for j, part in enumerate(value.split("\n")):
            if j:
                out.append((line, Token.Text, "\n"))
                line += 1
            if part:
                out.append((line, ttype, part))
    return out


def token_class(ttype, value, nxt, markup):
    """The `syn-*` class of a token ("" = plain); `nxt` is the text right after it."""
    if ttype in Comment:
        return "syn-doc" if value.startswith(("/**", '"""')) else "syn-comment"
    if ttype in String.Doc:
        return "syn-doc"
    if ttype in String:
        return "syn-string"
    if ttype in Number:
        return "syn-number"
    if ttype in Keyword:
        return "syn-keyword"
    if ttype in Name.Decorator:
        return "syn-annotation"
    if ttype in Name.Function or ttype in Name.Class:
        return "syn-function"
    if ttype in Name.Tag:  # an XML/HTML element, or a key in YAML, JSON, TOML
        return "syn-keyword" if markup else "syn-property"
    if ttype in Name.Constant or (ttype in (Name, Name.Attribute) and re.fullmatch(r"[A-Z][A-Z0-9_]+", value)):
        return "syn-static"
    return "syn-function" if ttype is Name and nxt.startswith("(") else ""


def code_rows(path, text):
    """Every line of the file, highlighted: [[[text, class], ...] per line]."""
    lx = lexer_for(path)
    markup = bool(lx) and any(a in lx.aliases for a in ("xml", "html", "vue", "svelte"))
    toks = tokens(path, text)
    rows = [[] for _ in split_lines(text)] or [[]]
    for i, (line, ttype, value) in enumerate(toks):
        if value == "\n" or line >= len(rows):
            continue
        cls = token_class(ttype, value, toks[i + 1][2] if i + 1 < len(toks) else "", markup)
        runs = rows[line]
        if runs and runs[-1][1] == cls:
            runs[-1][0] += value
        else:
            runs.append([value, cls])
    return rows


def block_end(path, text, start):
    """Last line index of the definition whose header starts at line index `start`. Braces (outside strings and comments) when the
    header opens one; one line when it ends in `;`; else indentation, plus a closing `end` (Python, Ruby, Elixir, Lua)."""
    lines = split_lines(text)
    depth = 0
    header_end, mode = start, None
    toks = [t for t in tokens(path, text) if t[0] >= start]
    for k, (line, ttype, value) in enumerate(toks):
        if ttype in String or ttype in Comment:
            continue
        if value == "\n":
            if depth == 0 and lines[line].rstrip().endswith(":"):
                mode = "indent"
            header_end = line
            nxt = lines[line + 1].strip() if line + 1 < len(lines) else ""
            if mode or (depth == 0 and not nxt.startswith("{")):  # the header ends here, unless `{` opens on the next line (Allman)
                break
            continue
        for ch in value:
            if ch in "([":
                depth += 1
            elif ch in ")]":
                depth = max(0, depth - 1)
            elif depth == 0 and ch == "{":
                mode = "brace"
            elif depth == 0 and ch == ";":
                return line
            if mode:
                break
        if mode == "brace":
            return brace_end(toks[k:], lines)
    base = indent(lines[start])
    end = header_end
    for i in range(header_end + 1, len(lines)):
        if not lines[i].strip():
            continue
        if indent(lines[i]) <= base:
            return i if re.match(r"(end|\}|\))\b", lines[i].strip()) or lines[i].strip() in ("}", ")") else end
        end = i
    return end


def brace_end(toks, lines):
    depth = 0
    for line, ttype, value in toks:
        if ttype in String or ttype in Comment:
            continue
        for ch in value:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return line
    return len(lines) - 1


def indent(line):
    return len(line) - len(line.lstrip())


def with_decorators(lines, start):
    """`start` moved up over the annotations and decorators right above it (`@Transactional`, `@app.get(...)`, `#[test]`)."""
    while start > 0 and lines[start - 1].lstrip().startswith(("@", "#[")):
        start -= 1
    return start


# ---------------------------------------------------------------- resolving a symbol stop, language-agnostic

CONTAINER_KW = (r"(?:class|struct|interface|enum|trait|type|object|record|module|protocol|union|namespace|defmodule|actor|extension"
                r"|impl(?:<[^>]*>)?(?:\s+[\w:<>, ]+\s+for)?)")
MEMBER_KW = r"(?:def|defp|defmacro|fn|func|function|fun|sub|proc|macro|async\s+def|async\s+function|async\s+fn)"
STATEMENTS = {"return", "new", "throw", "else", "await", "yield", "if", "while", "for", "switch", "case", "do", "not", "and", "or",
              "in", "echo", "print", "go", "defer", "delete", "typeof", "assert", "raise", "await", "elif", "when"}


def container_re(name):
    return re.compile(rf"(?<![\w.]){CONTAINER_KW}\s+(?:[\w.]+\.)?{re.escape(name)}(?![\w])")


def is_member_def(line, member):
    """Whether `line` defines `member`: a keyword form (`def`, `fn`, `func (r *T)`, `function`), a C-like declaration
    (`public Loan assign(`), a JS/TS method (`assign(id) {`) or a function bound to a name (`const assign = (`)."""
    s = line.strip()
    if not s or s.startswith(COMMENT_START) and not s.startswith("#["):
        return False
    m = re.escape(member)
    if re.search(rf"(?<![\w.]){MEMBER_KW}\s+(?:\([^)]*\)\s*)?(?:[\w.:<>]+[.:])?{m}(?![\w?!])", s):
        return True
    c = re.match(rf"((?:[\w@<>\[\],.?*&:]+\s+)+)(?:[\w:]+::)?{m}\s*(?:<[^>]*>)?\s*\(", s)
    if c and "=" not in c[1] and c[1].split()[0] not in STATEMENTS and not s.endswith(";"):
        return True
    if re.match(rf"(?:(?:async|static|public|private|protected|override|get|set|readonly)\s+)*\*?{m}\s*\(.*\{{\s*$", s):
        return True
    return bool(re.search(rf"(?:^|\b(?:const|let|var|export)\s+)(?:this\.|self\.)?{m}\s*[:=]\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|\w+\s*=>)", s))


def resolve_symbol(d, files, stop):
    """`{status, file, lines, candidates}` of a symbol stop in the repo at `d` (`files`: what git lists there).
    A member counts when it sits inside a definition of the container, in a file or folder named like it (a module, a package),
    or when its own line names the container (a Go receiver, `Name::member`, `fun Name.member`)."""
    name = stop.cls.rsplit(".", 1)[-1]
    qual = stop.cls[: -len(name) - 1] or None
    word = stop.member or name
    try:
        hits = git(d, "grep", "--untracked", "-n", "-w", "-I", "-F", "-e", word).decode(errors="replace")
    except subprocess.CalledProcessError:
        hits = ""
    texts, spans = {}, {}

    def text_of(f):
        if f not in texts:
            p = repo_file(d, f) if f in files else None
            texts[f] = p and read_text(p)
        return texts[f]

    def containers(f):  # [(start, end)] of every definition of `name` in the file
        if f not in spans:
            t = text_of(f) or ""
            rx = container_re(name)
            ls = split_lines(t)
            spans[f] = [(i, block_end(f, t, i)) for i, l in enumerate(ls)
                        if rx.search(l) and not l.strip().startswith(COMMENT_START)]
        return spans[f]

    found = []
    for hit in hits.splitlines():
        f, _, rest = hit.partition(":")
        no, _, line = rest.partition(":")
        if f not in files or not no.isdigit():
            continue
        i = int(no) - 1
        t = text_of(f)
        if not t:
            continue
        if stop.member:
            if not is_member_def(line, stop.member):
                continue
            stem_dirs = f.split("/")[:-1] + [Path(f).stem]
            scoped = (any(a <= i <= b for a, b in containers(f)) or name in stem_dirs
                      or re.search(rf"\b{re.escape(name)}\b.*\b{re.escape(stop.member)}", line))
            if not scoped:
                continue
        elif not container_re(name).search(line) or line.strip().startswith(COMMENT_START):
            continue
        if qual and qual.replace(".", "/") not in f and qual not in t:
            continue
        ls = split_lines(t)
        a = with_decorators(ls, i)
        found.append((f, a, block_end(f, t, i)))
    found = sorted(set(found))
    if any(not TEST_RE.search(f) for f, _, _ in found):
        found = [x for x in found if not TEST_RE.search(x[0])]
    if stop.span:
        found = [(f, a + stop.span[0] - 1, a + stop.span[1] - 1) for f, a, b in found if a + stop.span[1] - 1 <= b]
    if len(found) == 1:
        f, a, b = found[0]
        return {"status": "ok", "file": f, "lines": [a + 1, b + 1], "candidates": []}
    if not found:
        return {"status": "unresolved", "file": None, "lines": None, "candidates": []}
    return {"status": "ambiguous", "file": None, "lines": None, "candidates": [f"{f}:{a + 1}-{b + 1}" for f, a, b in found]}


def stop_digest(d, file, lines):
    """sha256 of the stop's lines as they read now, or None when the file or the lines are gone: what tells a stop changed."""
    p = repo_file(d, file)
    t = p and read_text(p)
    if t is None:
        return None
    ls = split_lines(t)
    a, b = lines
    return hashlib.sha256("\n".join(ls[a - 1:b]).encode()).hexdigest()[:16] if b <= len(ls) else None


def check_path(d, files, stop):
    """Why a path stop cannot be shown in the repo at `d`, or None."""
    p = repo_file(d, stop.path) if stop.path in files else None
    if p is None:
        return "no such file in the work tree (or git ignores it)"
    t = read_text(p)
    if t is None:
        return "the file is binary or over 1 MB"
    n = len(split_lines(t))
    return None if stop.span[1] <= n else f"lines {stop.span[0]}-{stop.span[1]} are past the end ({n} lines)"


def resolve_walk(root, stops):
    """`(repos, resolved stops)`: every repo a git work tree under `root`, every path stop on disk (REPO_NOT_FOUND / STOP_NOT_FOUND
    list every miss); symbol stops come back ok, ambiguous or unresolved, each ok stop with the digest of its lines."""
    need_git()
    dirs, bad = walk_repos(root, dict.fromkeys(s.repo for s in stops))
    if bad:
        raise CliError("REPO_NOT_FOUND", "; ".join(bad.values()), "clone it there, or point --root at the folder that holds the repos")
    files = {name: tracked(d) for name, d in dirs.items()}
    missing = [f"stop {s.n} ({s.repo} {s.target}): {why}" for s in stops if s.kind == "path" and (why := check_path(dirs[s.repo], files[s.repo], s))]
    if missing:
        raise CliError("STOP_NOT_FOUND", "; ".join(missing), "fix the path or the lines: both are relative to the repo root", 1, {"problems": missing})
    out = []
    for s in stops:
        r = ({"status": "ok", "file": s.path, "lines": list(s.span), "candidates": []} if s.kind == "path"
             else resolve_symbol(dirs[s.repo], files[s.repo], s))
        r["digest"] = stop_digest(dirs[s.repo], r["file"], r["lines"]) if r["status"] == "ok" else None
        out.append({"n": s.n, "repo": s.repo, "target": s.target, "phrase": s.phrase, **r})
    repos = [{"name": n, "path": str(d), **dict(zip(("branch", "head"), branch_head(d)))} for n, d in dirs.items()]
    return repos, out


# ---------------------------------------------------------------- the walks on disk: ~/.codewalk/walks/[folder/]<id>.json

def walks_dir():
    return home() / "walks"


def walk_files():
    """{id: path} of every saved walk, loose or one folder down."""
    base = walks_dir()
    if not base.is_dir():
        return {}
    found = {}
    for p in [*base.glob("w*.json"), *base.glob("*/w*.json")]:
        if grammar.WALK_ID_RE.fullmatch(p.stem) and not p.parent.name.startswith("."):
            found[p.stem] = p
    return found


def load_walk(path):
    try:
        w = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return w if isinstance(w, dict) and isinstance(w.get("stops"), list) else None


def write_json(path, data):
    """Write `data` to `path` atomically: a reader sees the old walk or the new one, never half of it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def save_walk(*, title, folder, wid, root, repos, stops):
    """Write the walk and return it. `wid` replaces that walk (same id, version + 1, same folder unless `folder` says another)."""
    files = walk_files()
    old = None
    if wid:
        if wid not in files or not (old := load_walk(files[wid])):
            raise CliError("WALK_NOT_FOUND", f"no saved walk {wid}", "run `codewalk.py list` for the ids, or drop --id to save a new walk")
    else:
        wid = "w" + os.urandom(3).hex()
        while wid in files:
            wid = "w" + os.urandom(3).hex()
    folder = folder if folder is not None else (old or {}).get("folder")
    stamp = now_iso()
    walk = {"schema": SCHEMA, "id": wid, "version": old["version"] + 1 if old else 1, "title": title, "folder": folder,
            "created": old["created"] if old else stamp, "updated": stamp,
            "previous_stops": len(old["stops"]) if old else None, "root": str(root), "repos": repos, "stops": stops}
    dest = walks_dir() / folder / f"{wid}.json" if folder else walks_dir() / f"{wid}.json"
    write_json(dest, walk)
    if old and files[wid] != dest:
        drop(files[wid])
    return walk, dest


def drop(path):
    """Remove a walk file, and its folder when that leaves it empty: a folder exists while it holds a walk."""
    path.unlink(missing_ok=True)
    with contextlib.suppress(OSError):
        if path.parent != walks_dir():
            path.parent.rmdir()


def live_status(walk):
    """The walk's stops as the code reads now: an ok stop whose lines changed is `changed`, one whose file is gone is `missing`."""
    dirs = {r["name"]: Path(r["path"]) for r in walk.get("repos", [])}
    out = []
    for s in walk["stops"]:
        s = dict(s)
        if s.get("status") == "ok" and s["repo"] in dirs:
            try:
                now = stop_digest(dirs[s["repo"]], s["file"], s["lines"])
            except OSError:
                now = None
            if now is None:
                s["status"] = "missing"
            elif s.get("digest") and now != s["digest"]:
                s["status"] = "changed"
        out.append(s)
    return {**walk, "stops": out}


def summary(walk):
    w = live_status(walk)
    keep = ("id", "version", "title", "folder", "created", "updated", "previous_stops")
    return {**{k: w.get(k) for k in keep}, "repos": [r["name"] for r in w.get("repos", [])],
            "stops": [{k: s.get(k) for k in ("n", "repo", "target", "status")} for s in w["stops"]]}


def folders():
    base = walks_dir()
    return sorted(p.name for p in base.iterdir() if p.is_dir() and grammar.valid_folder(p.name)) if base.is_dir() else []


def move_walk(wid, folder):
    files = walk_files()
    if wid not in files:
        raise ApiError(404, {"error": "unknown walk"})
    if folder is not None and not grammar.valid_folder(folder):
        raise ApiError(400, {"error": "bad folder name"})
    w = load_walk(files[wid])
    if w is None:
        raise ApiError(404, {"error": "unreadable walk"})
    w["folder"] = folder
    dest = walks_dir() / folder / f"{wid}.json" if folder else walks_dir() / f"{wid}.json"
    write_json(dest, w)
    if files[wid] != dest:
        drop(files[wid])
    return {"ok": True}


def delete_walk(wid):
    files = walk_files()
    if wid not in files:
        raise ApiError(404, {"error": "unknown walk"})
    drop(files[wid])
    return {"ok": True}


# ---------------------------------------------------------------- the server

class ApiError(Exception):
    def __init__(self, status, body):
        super().__init__(body)
        self.status, self.body = status, body


def api_walks(srv):
    srv.tab_seen = time.monotonic()
    walks = [w for p in walk_files().values() if (w := load_walk(p))]
    walks.sort(key=lambda w: w.get("updated", ""), reverse=True)
    with srv.lock:
        opening, srv.opening = srv.opening, None
    shown = str(walks_dir()).replace(str(Path.home()), "~", 1)
    return {"walks": [summary(w) for w in walks], "folders": folders(), "open": opening, "dir": shown}


def api_walk(srv, wid):
    p = walk_files().get(wid)
    w = p and load_walk(p)
    if not w:
        raise ApiError(404, {"error": "unknown walk"})
    return live_status(w)


def api_file(srv, wid, n):
    """`{file, rows}`: the whole file of stop `n`, highlighted. Only a file a stop of the walk names, inside its repo, tracked by git."""
    w = api_walk(srv, wid)
    s = next((s for s in w["stops"] if str(s["n"]) == n), None)
    repo = s and next((r for r in w.get("repos", []) if r["name"] == s["repo"]), None)
    if not (s and repo and s.get("file")):
        raise ApiError(404, {"error": "no file for that stop"})
    d = Path(repo["path"])
    p = repo_file(d, s["file"]) if git_top(d) == d.resolve() and s["file"] in tracked(d) else None
    text = p and read_text(p)
    if text is None:
        raise ApiError(404, {"error": "file gone, binary or over 1 MB"})
    return {"file": s["file"], "repo": s["repo"], "rows": code_rows(s["file"], text)}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if self.server.verbose:
            super().log_message(fmt, *args)

    def _send(self, status, body, ctype="application/json"):
        self.send_response(status)
        for k, v in {"Content-Type": ctype, "Content-Length": str(len(body)), "Content-Security-Policy": CSP,
                     "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache", "Referrer-Policy": "no-referrer",
                     MARKER: "1", VERSION_HEADER: VERSION}.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _call(self, fn, *args):
        try:
            out = fn(self.server, *args)
        except ApiError as exc:
            return self._send(exc.status, json.dumps(exc.body).encode())
        except Exception as exc:  # noqa: BLE001 - a bug answers 500 and the server keeps serving
            traceback.print_exc()
            return self._send(500, json.dumps({"error": f"{type(exc).__name__}: {exc}"}).encode())
        self._send(200, json.dumps(out).encode())

    def _trusted(self, post=False):
        """Only this machine's pages: the Host is ours (no DNS rebinding), no cross-site fetch, and a POST must be JSON (no form CSRF)."""
        port = self.server.server_address[1]
        ok = self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}") and self.headers.get("Sec-Fetch-Site") != "cross-site"
        return ok and (not post or self.headers.get("Content-Type", "").startswith("application/json"))

    def _static(self, rel):
        root = WEB_DIR.resolve()
        try:
            target = (root / rel).resolve()
        except ValueError:
            target = root
        if not target.is_relative_to(root) or not target.is_file():
            return self._send(404, b'{"error": "not found"}')
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self._send(200, target.read_bytes(), ctype + ("; charset=utf-8" if ctype.startswith("text/") or ctype.endswith("javascript") else ""))

    def do_GET(self):
        if not self._trusted():
            return self._send(403, b"forbidden", "text/plain")
        path = unquote(urlsplit(self.path).path)
        if path == "/":
            return self._static("index.html")
        if path.startswith("/static/"):
            return self._static(path[len("/static/"):])
        if path == "/api/walks":
            return self._call(api_walks)
        if path == "/api/status":
            return self._call(lambda srv: {"tab": tab_open(srv), "walks": len(walk_files())})
        if m := re.fullmatch(r"/api/walks/(w[0-9a-f]{6})", path):
            return self._call(api_walk, m[1])
        if m := re.fullmatch(r"/api/walks/(w[0-9a-f]{6})/stops/([0-9]{1,3})/file", path):
            return self._call(api_file, m[1], m[2])
        self._send(404, b'{"error": "not found"}')

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not self._trusted(post=True) or n > MAX_BODY:
            self.close_connection = True
            return self._send(403, b"forbidden", "text/plain")
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self._send(400, b'{"error": "bad json"}')
        path = urlsplit(self.path).path
        if m := re.fullmatch(r"/api/walks/(w[0-9a-f]{6})/move", path):
            return self._call(lambda srv: move_walk(m[1], body.get("folder") if isinstance(body, dict) else ""))
        if m := re.fullmatch(r"/api/walks/(w[0-9a-f]{6})/delete", path):
            return self._call(lambda srv: delete_walk(m[1]))
        if path == "/api/open" and isinstance(body, dict) and grammar.WALK_ID_RE.fullmatch(str(body.get("id"))):
            def ask(srv):
                with srv.lock:
                    srv.opening = body["id"]
                return {"ok": True}
            return self._call(ask)
        self._send(404, b'{"error": "not found"}')


def tab_open(srv):
    return bool(srv.tab_seen) and time.monotonic() - srv.tab_seen <= TAB_FRESH


def make_server(port):
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    srv.daemon_threads = True
    srv.lock, srv.opening, srv.tab_seen, srv.verbose = threading.Lock(), None, 0.0, False
    return srv


def probe(port):
    """The version of a codewalk server on `port`, else None."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status", timeout=2) as resp:
            headers = resp.headers
    except urllib.error.HTTPError as err:
        headers = err.headers
    except OSError:
        return None
    return headers.get(VERSION_HEADER) if headers.get(MARKER) == "1" else None


def locate(port):
    for p in range(port, port + 20):
        if probe(p):
            return p
    return None


def start_server(port, timeout):
    """Spawn a detached `serve` (it outlives this process, log at ~/.codewalk/server.log) and wait until it answers: its port."""
    home().mkdir(parents=True, exist_ok=True)
    log = home() / "server.log"
    detach = {"creationflags": 0x00000008 | 0x00000200} if os.name == "nt" else {"start_new_session": True}
    with log.open("ab") as f:
        proc = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "serve", "--port", str(port)],
                                stdin=subprocess.DEVNULL, stdout=f, stderr=f, **detach)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if found := locate(port):
            return found
        if proc.poll() is not None:
            raise CliError("SERVER_FAILED", f"the server exited with {proc.returncode}", f"see {log}")
        time.sleep(0.2)
    raise CliError("SERVER_TIMEOUT", f"the server did not answer in {timeout:g}s", f"retry with a larger --timeout; log: {log}", 75)


def call_server(port, path, timeout, body=None):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", None if body is None else json.dumps(body).encode(),
                                 {"Content-Type": "application/json"}, method="GET" if body is None else "POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.load(resp)
    except OSError as exc:
        raise CliError("NETWORK", f"cannot reach the codewalk server on port {port}: {exc}", "retry (safe)", 75) from exc


def ensure_server(opts):
    """`(port, started)`: the running server near --port, or a new one."""
    found = locate(opts.port)
    return (found, False) if found else (start_server(opts.port, opts.timeout), True)


def show(opts, wid):
    """Put walk `wid` (or the Walks list) in front of the person: through the open tab, else a new browser tab.
    -> (url, delivered): `tab`, `browser`, or `link` when --no-browser."""
    port, _ = ensure_server(opts)
    url = f"http://127.0.0.1:{port}/" + (f"#/w/{wid}" if wid else "")
    if opts.no_browser:
        return url, "link"
    if wid and call_server(port, "/api/status", opts.timeout)["tab"]:
        call_server(port, "/api/open", opts.timeout, {"id": wid})
        return url, "tab"
    webbrowser.open(url)
    return url, "browser"


# ---------------------------------------------------------------- block: the walk as one HTML block for an artifact

def svg_icon(size, paths):
    return (f'<svg viewBox="0 0 24 24" width="{size}" height="{size}" fill="none" stroke="currentColor" stroke-width="2" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths}</svg>')


BLOCK_ICONS = {
    "link": svg_icon(13, '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    "route": svg_icon(16, '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>'),
    "copy": svg_icon(13, '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
    "flag": svg_icon(14, '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>'),
    "commit": svg_icon(14, '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>'),
}


def window_rows(path, text, a, b, ctx=3):
    """Lines a-ctx..b+ctx highlighted, the common indentation removed: [{no, runs, in}], `in` for a..b. The whole file is
    lexed, so a comment or string that opens before the range still colors it."""
    rows = code_rows(path, text)
    lines = split_lines(text)
    lo, hi = max(1, a - ctx), min(len(lines), b + ctx)
    cut = min((indent(l) for l in lines[lo - 1:hi] if l.strip()), default=0)
    out = []
    for no in range(lo, hi + 1):
        runs, skip = [], cut
        for t, cls in rows[no - 1] if no <= len(rows) else []:
            if skip < len(t):
                runs.append([t[skip:], cls])
            skip = max(0, skip - len(t))
        out.append({"no": no, "runs": runs, "in": a <= no <= b})
    return out


def phrase_idents(text):
    return text.split("`")[1::2]


def ident_re(idents):
    return re.compile("(?<!\\w)(?:" + "|".join(re.escape(i) for i in sorted(set(idents), key=len, reverse=True)) + ")(?!\\w)") if idents else None


def stop_kinds(stop):
    """{identifier: syn-class} of the phrase's `identifiers`, from the token they sit in inside the range."""
    kinds = {}
    for i in phrase_idents(stop["phrase"]):
        pat = ident_re([i])
        for row in stop["rows"]:
            for text, cls in row["runs"] if row["in"] else []:
                if cls and pat.search(text):
                    kinds.setdefault(i, cls)
    return kinds


def missing_idents(stop):
    seen = "\n".join("".join(t for t, _ in r["runs"]) for r in stop["rows"] if r["in"])
    return [i for i in dict.fromkeys(phrase_idents(stop["phrase"])) if not ident_re([i]).search(seen)]


def idents_html(text, kinds):
    return "".join(f'<code class="{esc(kinds.get(x, "syn-function"))}">{esc(x)}</code>' if i % 2 else esc(x) for i, x in enumerate(text.split("`")))


def cut_mid(s, n=24):
    return s if len(s) <= n else s[: n - 7] + "…" + s[-6:]


def block_line(row, refs):
    """One code row: indentation past the common one goes to `--i` (a wrapped line hangs under it); the range gets `<wbr>` and the underlined identifiers."""
    text = "".join(t for t, _ in row["runs"])
    ind = skip = indent(text)
    runs = []
    for t, cls in row["runs"]:
        k = min(skip, len(t))
        skip -= k
        if t[k:]:
            runs.append((t[k:], cls))
    parts = []
    for t, cls in runs:
        pieces = [(t, False)]
        if row["in"] and refs:
            pieces, at = [], 0
            for m in refs.finditer(t):
                pieces += [(t[at:m.start()], False), (m.group(), True)]
                at = m.end()
            pieces.append((t[at:], False))
        for piece, ref in pieces:
            if not piece:
                continue
            e = esc(piece)
            e = e.replace(".", "<wbr>.").replace("(", "(<wbr>") if row["in"] else e
            klass = " ".join(c for c in (cls, "ref" if ref else "") if c)
            parts.append(f'<span class="{klass}">{e}</span>' if klass else e)
    return f'<div class="l{" in" if row["in"] else ""}" data-n="{row["no"]}" style="--i:{ind}">{"".join(parts) or " "}</div>'


def block_stop(bid, s, total, prev, seen, peak):
    n, repo, path = s["n"], s["repo"], s["path"]
    fname = path.rsplit("/", 1)[-1]
    rng = f'{s["a"]}-{s["b"]}' if s["b"] != s["a"] else str(s["a"])
    ref = f"{path}:{s['a']}"
    nos = [r["no"] for r in s["rows"]]
    refs = ident_re(phrase_idents(s["phrase"]))
    change = ""
    if prev and prev != repo:
        back = repo in seen
        change = f'<p class="cw-change{" back" if back else ""}">↳ {"back to" if back else "on to"} {esc(repo)}</p>'
    sid = f"cw-{bid}-stop-{n}"
    return f"""
  <li class="cw-stop" id="{sid}" data-n="{n}" data-ref="{esc(ref)}" data-repo="{esc(repo)}" data-file="{esc(fname)}" data-range="{rng}"{" data-peak" if peak == n else ""}>
    {change}
    <div class="cw-meta">
      <span class="cw-n" aria-hidden="true">{n}</span>
      <span class="cw-where" title="{esc(repo)}/{esc(path)}:{rng}">{esc(cut_mid(fname))}:{rng}</span>
      <a class="cw-anchor" href="#{sid}" aria-label="Link to stop {n}">{BLOCK_ICONS["link"]}</a>
    </div>
    <p class="cw-phrase"><span class="sr-only">Stop {n} of {total}. </span>{idents_html(s["phrase"], stop_kinds(s))}</p>
    <figure class="cw-fig">
      <figcaption><span class="cw-chip">{esc(repo)}</span> <span class="cw-file">{esc(fname)}</span><span class="cw-rng">:{rng}</span>
        <span class="sr-only">. Focus on lines {s["a"]} to {s["b"]}.</span>
        <button class="cw-copy" type="button" data-ref="{esc(ref)}" title="Copies the path with its line, to paste in your editor's go-to-file box"
          aria-label="Copy reference: {esc(fname)} line {s["a"]}">{BLOCK_ICONS["copy"]}<span>Copy ref</span></button>
        <span class="cw-count" aria-hidden="true"><b>{n}</b> / {total}</span></figcaption>
      <div class="cw-pre" tabindex="0" role="region" aria-label="Code of {esc(fname)}, lines {nos[0]} to {nos[-1]}">
        {"".join(block_line(r, refs) for r in s["rows"])}
      </div>
    </figure>
  </li>"""


def render_block(data, block_id):
    """The HTML of a walk block (`scripts/block.html`): style, the block and its script, to paste into an artifact.
    `block_id` prefixes every id, so several blocks live in one page. Pure: it reads only the template."""
    if not re.fullmatch(r"[\w-]+", block_id):
        raise ValueError(f"bad block id {block_id!r}")
    stops, total = data["stops"], len(data["stops"])
    title = data.get("title") or "A walk through the code"
    noun = "stop" if total == 1 else "stops"
    route = [s["repo"] for k, s in enumerate(stops) if k == 0 or s["repo"] != stops[k - 1]["repo"]]
    items, seen = [], set()
    for k, s in enumerate(stops):
        items.append(block_stop(block_id, s, total, stops[k - 1]["repo"] if k else None, seen, data.get("peak")))
        seen.add(s["repo"])
    snap = " · ".join(f'{r["name"]} @ {r["branch"]} {r["head"]}' for r in data["repos"])
    dirty = [r["name"] for r in data["repos"] if r["dirty"]]
    close = data.get("close")
    kinds = {k: v for s in reversed(stops) for k, v in stop_kinds(s).items()}
    block = f"""<section class="cw" id="cw-{block_id}" aria-label="{esc(title)}, {total} {noun}">
<header class="cw-head">{BLOCK_ICONS["route"]}<strong>{esc(title)}</strong>
  <span>{total} {noun} · {esc(" → ".join(route))} · snapshot of {esc(data["date"])}</span></header>
<div class="cw-body">
  <div class="cw-sky" aria-hidden="true"></div>
  <svg class="cw-route" aria-hidden="true"><defs><linearGradient id="cw-{block_id}-g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="var(--cw-blue)"/><stop offset="1" stop-color="var(--cw-orange)"/></linearGradient></defs>
    <path class="rest"/><path class="done" stroke="url(#cw-{block_id}-g)"/><circle class="spark" r="4"/></svg>
  <ol class="cw-stops">{"".join(items)}
  </ol>
</div>
{f'<p class="cw-close">{BLOCK_ICONS["flag"]}<span>{idents_html(close, kinds)}</span></p>' if close else ""}
<p class="cw-foot">{BLOCK_ICONS["commit"]}<span>Code snapshot · {esc(snap)} · read on {esc(data["date"])}{esc(" · with uncommitted changes in " + ", ".join(dirty)) if dirty else ""}</span></p>
</section>"""
    return (SCRIPTS / "block.html").read_text(encoding="utf-8").replace("<!--BLOCK-->", block)


def block_stops(text, peak=None):
    """The stops of a `block`: paths only, at most 12, ranges of at most 40 lines, `peak` among them. BAD_USAGE lists every problem;
    RANGE_TOO_LONG when the ranges are the only fault."""
    errors, long = [], []
    try:
        stops = grammar.parse_stops(text, paths_only=True, max_stops=BLOCK_MAX_STOPS, max_span=BLOCK_MAX_LINES)
    except grammar.StopsError as exc:
        stops, errors, long = [], list(exc.errors), exc.long
    total = sum(1 for l in text.split("\n") if l.strip() and not l.strip().startswith("#"))
    if peak is not None and not 1 <= peak <= total:
        errors.append((0, f"--peak {peak} is out of range: 1 to {total}"))
    if len(errors) > len(long):
        problems = [f"line {n}: {msg}" if n else msg for n, msg in errors]
        raise CliError("BAD_USAGE", f"{len(problems)} problem{'s' * (len(problems) != 1)} in the stops",
                       f"a block target is `path:A-B`; more than {BLOCK_MAX_STOPS} stops go in several blocks", 2, {"problems": problems})
    if long:
        raise CliError("RANGE_TOO_LONG", f"{len(long)} range{'s' * (len(long) != 1)} over {BLOCK_MAX_LINES} lines", f"narrow each to at most {BLOCK_MAX_LINES} lines",
                       2, {"stops": [{"n": e.n, "target": e.target, "lines": e.lines} for _, e in long]})
    return stops


def block_target(opts, text):
    """Everything `block` does but print and write: `{html, stops, repos, bytes, warnings}`; with --dry-run no html."""
    root = Path(opts.root)
    if not root.is_dir():
        raise usage(f"root {opts.root!r} is not a directory (--root, or CODEWALK_ROOT)")
    stops = block_stops(text, opts.peak)
    need_git()
    dirs, bad = walk_repos(root, dict.fromkeys(s.repo for s in stops))
    if bad:
        raise CliError("REPO_NOT_FOUND", "; ".join(bad.values()), "clone it there, or point --root at the folder that holds the repos")
    files = {n: tracked(d) for n, d in dirs.items()}
    missing = [f"stop {s.n} ({s.repo} {s.target}): {why}" for s in stops if (why := check_path(dirs[s.repo], files[s.repo], s))]
    if missing:
        raise CliError("STOP_NOT_FOUND", "; ".join(missing), "fix the path or the lines: both are relative to the repo root", 1, {"problems": missing})
    rows = [{"n": s.n, "repo": s.repo, "path": s.path, "a": s.span[0], "b": s.span[1], "phrase": s.phrase,
             "rows": window_rows(s.path, read_text(repo_file(dirs[s.repo], s.path)), *s.span)} for s in stops]
    repos, warnings = [], []
    for name, d in dirs.items():
        branch, head = branch_head(d)
        dirty = bool(git(d, "status", "--porcelain", "--", *(s.path for s in stops if s.repo == name)).strip())
        repos.append({"name": name, "branch": branch or "(no branch)", "head": head[:8] if head else "(no commits)", "dirty": dirty})
        if dirty:
            warnings.append(f"{name} has uncommitted changes in the stops' files: the block shows the disk")
    for r in rows:
        if lost := missing_idents(r):
            warnings.append(f"stop {r['n']} ({r['repo']} {r['path']}:{r['a']}-{r['b']}): phrase names what the range does not show: {', '.join(lost)}")
    data = {"title": opts.title, "close": opts.close, "peak": opts.peak, "date": datetime.now().strftime("%Y-%m-%d"), "stops": rows, "repos": repos}
    out = {"stops": [{"n": s["n"], "repo": s["repo"], "ref": f"{s['path']}:{s['a']}-{s['b']}", "peak": opts.peak == s["n"]} for s in rows],
           "repos": repos, "warnings": warnings}
    if opts.dry_run:
        return out
    key = json.dumps([opts.title, opts.close, opts.peak, [[s["repo"], s["path"], s["a"], s["b"], s["phrase"]] for s in rows]], ensure_ascii=False)
    html = render_block(data, hashlib.sha256(key.encode()).hexdigest()[:8])
    return {"html": html, **out, "bytes": len(html.encode())}


# ---------------------------------------------------------------- the CLI

STOPS_DOC = """\
One stop per line on stdin (or --file): `<repo> <target> <phrase>`. Blank lines and `#` lines are skipped.
  repo     a git work tree directly under --root
  target   Name#member   Name#member:+A..+B   Name   qual.Name#member   path:L   path:A-B
  phrase   what the person should notice in those lines (max 300 characters); max 50 stops

examples:
  codewalk.py walk --title "How an order is placed" --folder "Checkout" <<'EOF'
  shop OrderController#place Takes the cart and checks stock first
  shop src/config/limits.yml:3-8 The per-customer limits live here
  EOF
  codewalk.py walk --id w8c41e --title "How an order is placed" < stops.txt   replace that walk (version + 1)
  codewalk.py walk -n --json < stops.txt                                     resolve and print, save nothing
"""
BLOCK_DOC = """\
One stop per line on stdin: `<repo> path:A-B <phrase>`. No symbols: a block takes the lines you already read.
At most 12 stops of at most 40 lines each. `identifiers` between backticks in a phrase are underlined in its range.

examples:
  codewalk.py block --peak 2 --close "It all hangs on `PAID`" -o block.html < stops.txt
  codewalk.py block -n --json < stops.txt     validate and list, write nothing
"""
EXIT_DOC = """\
exit codes:
  0    ok
  1    STOPS_UNRESOLVED (the walk was saved; resend with --id), REPO_NOT_FOUND, STOP_NOT_FOUND, WALK_NOT_FOUND,
       OUTPUT_FAILED, SERVER_FAILED, NO_PORT
  2    BAD_USAGE, RANGE_TOO_LONG
  75   SERVER_TIMEOUT, NETWORK (safe to retry)
  78   GIT_MISSING
  130  interrupted

environment: CODEWALK_HOME (default ~/.codewalk), CODEWALK_ROOT, CODEWALK_PORT (default 8777). A flag wins.
stdout carries the data only. With --json, success is {"ok": true, "schema": 1, "data"} on stdout; a failure leaves stdout
empty and ends stderr with {"ok": false, "schema": 1, "error": {code, message, fix, details?}}.
"""
COMMON = [
    (("-q", "--quiet"), dict(action="store_true", help="no informational stderr lines")),
    (("--json",), dict(action="store_true", help='machine output: {"ok", "schema": 1, "data" | "error"}')),
    (("--no-color",), dict(action="store_true", help="no ANSI color (also NO_COLOR, TERM=dumb)")),
    (("--port",), dict(type=int, metavar="N", help=f"first port to use or look at (default {DEFAULT_PORT}, env CODEWALK_PORT)")),
    (("--timeout",), dict(type=float, metavar="SEC", help=f"server start and call timeout (default {DEFAULT_TIMEOUT:g})")),
]


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise usage(message)


def build_parser():
    common = argparse.ArgumentParser(add_help=False)
    for flags, kw in COMMON:
        common.add_argument(*flags, default=argparse.SUPPRESS, **kw)
    raw = argparse.RawDescriptionHelpFormatter
    ap = Parser(prog="codewalk.py", description=__doc__, epilog=EXIT_DOC, formatter_class=raw, parents=[common])
    ap.add_argument("--version", action="version", version=f"%(prog)s {VERSION}")
    sub = ap.add_subparsers(dest="cmd", metavar="command")
    root_help = "where `<repo>` lives (default env CODEWALK_ROOT; else the parent of the git repo you are in; else here)"
    w = sub.add_parser("walk", parents=[common], formatter_class=raw, help="save a walk; it shows up in the Walks page",
                       description=STOPS_DOC, epilog=EXIT_DOC)
    w.add_argument("--root", metavar="DIR", help=root_help)
    w.add_argument("--title", metavar="TEXT", help="the walk's title (default: Walk of N stops)")
    w.add_argument("--folder", metavar="NAME", help="file it in this folder of Walks (created if missing; one level)")
    w.add_argument("--id", metavar="ID", help="replace this saved walk: same id, version + 1, same folder unless --folder")
    w.add_argument("--open", action="store_true", help="also put it on screen: in the open tab, else a new browser tab")
    w.add_argument("--file", metavar="PATH", help="read the stops from PATH instead of stdin")
    w.add_argument("-n", "--dry-run", action="store_true", help="resolve and print; save nothing, start nothing")
    w.add_argument("--no-browser", action="store_true", help="with --open: print the URL instead of launching a browser")
    b = sub.add_parser("block", parents=[common], formatter_class=raw, help="an HTML block of a walk, to paste into an artifact",
                       description=BLOCK_DOC, epilog=EXIT_DOC)
    b.add_argument("--root", metavar="DIR", help=root_help)
    b.add_argument("--title", metavar="TEXT", help="header title (default: A walk through the code)")
    b.add_argument("--peak", type=int, metavar="N", help="the stop where the outcome is decided, in orange")
    b.add_argument("--close", metavar="TEXT", help="the conclusion in one sentence; `identifiers` go as code")
    b.add_argument("--file", metavar="PATH", help="read the stops from PATH instead of stdin")
    b.add_argument("-o", "--output", metavar="FILE", help="write the HTML to FILE and print its path (default: HTML on stdout)")
    b.add_argument("-n", "--dry-run", action="store_true", help="validate and list the stops; no HTML")
    sub.add_parser("list", parents=[common], help="the saved walks: id, version, folder, title, stops")
    o = sub.add_parser("open", parents=[common], help="start the server if needed and open the Walks page, or one walk")
    o.add_argument("--id", metavar="ID", help="open this walk")
    o.add_argument("--no-browser", action="store_true", help="print the URL instead of launching a browser")
    sub.add_parser("status", parents=[common], help="is the server running, and is a tab open?")
    sub.add_parser("serve", parents=[common], help="run the server in the foreground")
    sub.add_parser("selftest", parents=[common], help="run the self checks (needs git)")
    ap.subs = {"walk": w, "block": b}
    return ap


def settle(opts, env):
    """Fill what a flag left unset: flags > env > defaults."""
    d = vars(opts)
    for k in ("quiet", "json", "no_color"):
        d.setdefault(k, False)
    if "port" not in d:
        try:
            d["port"] = int(env.get("CODEWALK_PORT") or DEFAULT_PORT)
        except ValueError:
            raise usage(f"CODEWALK_PORT must be a number, got {env['CODEWALK_PORT']!r}") from None
    d.setdefault("timeout", DEFAULT_TIMEOUT)
    if not 1 <= opts.port <= 65535 or opts.timeout <= 0:
        raise usage("--port must be 1-65535 and --timeout greater than 0")
    if opts.cmd in ("walk", "block"):
        root = d["root"] or env.get("CODEWALK_ROOT")
        if not root:
            top = git_top(Path.cwd()) if shutil.which("git") else None
            root = top.parent if top else Path.cwd()
        d["root"] = str(Path(root).expanduser().resolve())
    if opts.cmd == "walk":
        if opts.title is not None and not 0 < len(opts.title) <= grammar.MAX_TITLE:
            raise usage(f"--title must have 1 to {grammar.MAX_TITLE} characters")
        if opts.folder is not None and not grammar.valid_folder(opts.folder):
            raise usage(f"bad --folder {opts.folder!r}: up to 80 characters, no / \\ : * ? \" < > |, not starting with a dot")
        if opts.id is not None and not grammar.WALK_ID_RE.fullmatch(opts.id):
            raise usage(f"bad --id {opts.id!r}: a walk id is `w` and 6 hex digits, as `list` prints it")
    return opts


def read_stops(opts, stdin):
    try:
        return Path(opts.file).read_text(encoding="utf-8") if opts.file and opts.file != "-" else stdin.read()
    except (OSError, UnicodeDecodeError) as exc:
        raise usage(f"cannot read the stops from {opts.file or 'stdin'}: {exc}") from exc


RESEND_FIX = ("resend the whole walk{id}: an `ambiguous` stop takes one of its candidates as its target, "
              "an `unresolved` one a path with lines (path:A-B) or a qualified name")


def walk_cmd(opts, text):
    """Resolve, save and deliver a walk: `{id, version, url, path, folder, delivered, stops}`. Unresolved stops are saved too,
    then reported as STOPS_UNRESOLVED so the agent resends them with --id."""
    try:
        stops = grammar.parse_stops(text)
    except grammar.StopsError as exc:
        raise usage(f"{len(exc.errors)} bad line(s) in the stops", {"problems": [f"line {n}: {m}" if n else m for n, m in exc.errors]}) from exc
    root = Path(opts.root)
    if not root.is_dir():
        raise usage(f"root {opts.root!r} is not a directory (--root, or CODEWALK_ROOT)")
    repos, resolved = resolve_walk(root, stops)
    title = opts.title or grammar.default_title(len(stops))
    brief = [{k: s[k] for k in ("n", "repo", "target", "status", "file", "lines", "candidates")} for s in resolved]
    bad = [{k: s[k] for k in ("n", "target", "status", "candidates") if k != "candidates" or s[k]} for s in brief if s["status"] != "ok"]
    if opts.dry_run:
        if bad:
            raise CliError("STOPS_UNRESOLVED", f"{len(bad)} of {len(brief)} stops did not resolve; nothing was saved", RESEND_FIX.format(id=""), 1, {"stops": bad})
        return {"id": opts.id, "version": None, "url": None, "path": None, "folder": opts.folder, "delivered": "none", "title": title, "stops": brief}
    if opts.id and opts.id not in walk_files():
        raise CliError("WALK_NOT_FOUND", f"no saved walk {opts.id}", "run `codewalk.py list` for the ids, or drop --id to save a new walk")
    walk, path = save_walk(title=title, folder=opts.folder, wid=opts.id, root=root, repos=repos, stops=resolved)
    if opts.open:
        url, delivered = show(opts, walk["id"])
    else:
        port = locate(opts.port)
        tab = bool(port) and call_server(port, "/api/status", opts.timeout)["tab"]
        port = port or start_server(opts.port, opts.timeout)
        url, delivered = f"http://127.0.0.1:{port}/#/w/{walk['id']}", "tab" if tab else "link"
    data = {"id": walk["id"], "version": walk["version"], "url": url, "path": str(path), "folder": walk["folder"],
            "delivered": delivered, "title": title, "stops": brief}
    if bad:
        raise CliError("STOPS_UNRESOLVED", f"{len(bad)} of {len(brief)} stops did not resolve; walk {walk['id']} v{walk['version']} is saved with them marked",
                       RESEND_FIX.format(id=f" with --id {walk['id']}"), 1, {**{k: data[k] for k in ("id", "version", "url")}, "stops": bad})
    return data


def list_cmd():
    rows = []
    for p in walk_files().values():
        if w := load_walk(p):
            rows.append({"id": w["id"], "version": w.get("version", 1), "folder": w.get("folder"), "title": w.get("title"),
                         "stops": len(w["stops"]), "updated": w.get("updated")})
    return sorted(rows, key=lambda r: r["updated"] or "", reverse=True)


def status_cmd(port):
    found = locate(port)
    if not found:
        return {"running": False, "url": None, "tab": False}
    return {"running": True, "url": f"http://127.0.0.1:{found}/", "tab": call_server(found, "/api/status", 3)["tab"]}


def serve(opts, say):
    for p in range(opts.port, opts.port + 20):
        try:
            srv = make_server(p)
            break
        except OSError:
            if probe(p):
                say(f"already running at http://127.0.0.1:{p}/")
                return {"url": f"http://127.0.0.1:{p}/", "stopped": False}
    else:
        raise CliError("NO_PORT", f"no free port in {opts.port}-{opts.port + 19}", "free a port or pass --port N")
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    say(f"listening on {url}")
    with contextlib.suppress(ValueError, OSError, AttributeError):
        signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=srv.shutdown, daemon=True).start())
    try:
        srv.serve_forever()
    finally:
        srv.server_close()
    return {"url": url, "stopped": True}


def human(cmd, data):
    """The stdout text of a success outside --json: the datum itself."""
    if cmd == "walk":
        return data["url"] or "\n".join(f'{s["n"]:>2} {s["status"]:<10} {s["repo"]} {s["file"] or s["target"]}' +
                                        (f':{s["lines"][0]}-{s["lines"][1]}' if s["lines"] else "") for s in data["stops"])
    if cmd == "block":
        return data.get("path") or data.get("html") or "\n".join(f'{s["n"]} {s["repo"]} {s["ref"]}' for s in data["stops"])
    if cmd == "list":
        return "\n".join(f'{r["id"]} v{r["version"]:<3} {(r["folder"] or "-")[:24]:<24} {r["stops"]:>2} stop{"s" * (r["stops"] != 1)}  {r["title"]}' for r in data) or None
    if cmd == "status":
        return f'running {data["url"]}' + ("  (tab open)" if data["tab"] else "") if data["running"] else "stopped"
    if cmd == "open":
        return data["url"]
    return data.get("summary") or data.get("url")


def walk_line(data, dry):
    n = len(data["stops"])
    where = f' in "{data["folder"]}"' if data["folder"] else ""
    if dry:
        return f"resolved {n} stop{'s' * (n != 1)}; nothing saved"
    tell = {"tab": "the open tab lists it under Walks, with a notice", "browser": "opened in the browser",
            "link": "no tab is open: give the person the URL"}[data["delivered"]]
    return f'walk {data["id"]} v{data["version"]} · {n} stop{"s" * (n != 1)}{where} · {tell}'


def main(argv=None, out=None, err=None, env=None, stdin=None):
    """Parse, run one command, print. Returns the exit code."""
    argv = list(sys.argv[1:] if argv is None else argv)
    out, err, env, stdin = out or sys.stdout, err or sys.stderr, os.environ if env is None else env, stdin or sys.stdin
    for stream in (stdin, out, err):  # phrases and HTML carry non-ASCII: the terminal's locale must not decide
        getattr(stream, "reconfigure", lambda **_: None)(encoding="utf-8")
    as_json = "--json" in argv
    color = lambda: not (as_json or "--no-color" in argv or env.get("NO_COLOR") or env.get("TERM") == "dumb") and err.isatty()
    try:
        ap = build_parser()
        opts = ap.parse_args(argv)
        if opts.cmd is None:
            ap.print_help(out)
            return 0
        settle(opts, env)
        say = (lambda m: print(m, file=err)) if not (opts.quiet or opts.json) else (lambda m: None)
        if opts.cmd in ("walk", "block"):
            if not opts.file and stdin.isatty():
                ap.subs[opts.cmd].print_help(err)
                raise usage("no stops on stdin: pipe `<repo> <target> <phrase>` lines in, or pass --file")
            text = read_stops(opts, stdin)
        if opts.cmd == "walk":
            data = walk_cmd(opts, text)
            say(walk_line(data, opts.dry_run))
        elif opts.cmd == "block":
            data = block_target(opts, text)
            if not opts.json:
                for w in data["warnings"]:
                    print(f"warning: {w}", file=err)
            if opts.output and not opts.dry_run:
                p = Path(opts.output).expanduser().resolve()
                try:
                    p.write_text(data.pop("html"), encoding="utf-8")
                except OSError as exc:
                    raise CliError("OUTPUT_FAILED", f"cannot write {p}: {exc.strerror or exc}", "check the folder exists and is writable") from exc
                data["path"] = str(p)
        elif opts.cmd == "list":
            data = list_cmd()
        elif opts.cmd == "open":
            if opts.id and opts.id not in walk_files():
                raise CliError("WALK_NOT_FOUND", f"no saved walk {opts.id}", "run `codewalk.py list` for the ids")
            url, delivered = show(opts, opts.id)
            data = {"url": url, "delivered": delivered}
        elif opts.cmd == "status":
            data = status_cmd(opts.port)
        elif opts.cmd == "serve":
            data = serve(opts, say)
        else:
            data = {"summary": selftest()}
        text = json.dumps({"ok": True, "schema": SCHEMA, "data": data}, ensure_ascii=False) if opts.json else human(opts.cmd, data)
        if text:
            print(text, file=out)
        return 0
    except CliError as e:
        print(fmt_err(e, as_json, color()), file=err)
        return e.exit
    except KeyboardInterrupt:
        print(fmt_err(CliError("INTERRUPTED", "interrupted", "run it again", 130), as_json, False), file=err)
        return 130
    except Exception as exc:  # noqa: BLE001 - a failure always ends with the error line
        traceback.print_exc(file=err)
        print(fmt_err(CliError("INTERNAL", f"{type(exc).__name__}: {exc}", "run it again; if it persists, report it"), as_json, False), file=err)
        return 1


def fmt_err(e, as_json, color):
    body = {"code": e.code, "message": e.message, "fix": e.fix, **({"details": e.details} if e.details else {})}
    if as_json:
        return json.dumps({"ok": False, "schema": SCHEMA, "error": body}, ensure_ascii=False)
    head = f"error: {e.code}: {e.message}"
    lines = [f"\033[31m{head}\033[0m" if color else head]
    for p in (e.details or {}).get("problems", []):
        lines.append(f"  {p}")
    for s in (e.details or {}).get("stops", []):
        lines.append(f'  stop {s["n"]} {s["target"]}: {s.get("status", "")}' + "".join(f"\n    candidate {c}" for c in s.get("candidates", [])))
    if (e.details or {}).get("url"):
        lines.append(f"  saved: {e.details['url']}")
    lines.append(f"fix: {e.fix}")
    return "\n".join(lines)


# ---------------------------------------------------------------- self checks

def selftest():
    """Grammar, resolution in several languages, the store and the block, against throwaway repos. Returns a one-line summary."""
    grammar.demo()
    files = {
        "src/loans/loan_service.py": "import x\n\nclass LoanService:\n    @transactional\n    def assign(self, member):\n        if not member:\n            raise ValueError()\n        return 1\n\n    def other(self):\n        assign(1)\n",
        "svc/stock.go": "package svc\n\ntype Stock struct {\n\tn int\n}\n\nfunc (s *Stock) Reserve(id string) error {\n\tif id == \"\" {\n\t\treturn nil\n\t}\n\treturn nil\n}\n",
        "app/Order.java": "package com.example.app;\n\npublic class Order {\n    @Override\n    public int place(String id) {\n        String s = \"{\";\n        return 1;\n    }\n    void other() { place(\"x\"); }\n}\n",
        "lib/user.rb": "class User\n  def valid?\n    email.include?(\"@\")\n  end\nend\n",
        "web/cart.ts": "export class Cart {\n  total(items: Item[]): number {\n    return items.length;\n  }\n}\nexport const empty = (c: Cart) => {\n  return true;\n};\n",
        "util/slug.py": "def slugify(s):\n    return s.lower()\n",
        "tests/test_loan_service.py": "class LoanService:\n    def assign(self):\n        pass\n",
    }
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp).resolve()
        repo = root / "shop"
        for rel, text in files.items():
            (repo / rel).parent.mkdir(parents=True, exist_ok=True)
            (repo / rel).write_text(text)
        git(repo.parent, "init", "-q", str(repo))
        cases = {
            "LoanService#assign": ("src/loans/loan_service.py", [4, 8]),
            "LoanService#assign:+2..+3": ("src/loans/loan_service.py", [5, 6]),
            "Stock#Reserve": ("svc/stock.go", [7, 12]),
            "Order#place": ("app/Order.java", [4, 8]),
            "com.example.app.Order#place": ("app/Order.java", [4, 8]),
            "User#valid?": ("lib/user.rb", [2, 4]),
            "Cart#total": ("web/cart.ts", [2, 4]),
            "cart#empty": ("web/cart.ts", [6, 8]),
            "slug#slugify": ("util/slug.py", [1, 2]),
            "Order": ("app/Order.java", [3, 10]),
        }
        text = "\n".join(f"shop {t} phrase" for t in [*cases, "Order#missing"])
        repos, got = resolve_walk(root, grammar.parse_stops(text))
        for s, (target, want) in zip(got, [*cases.items(), ("Order#missing", None)]):
            assert (s["file"], s["lines"]) == want if want else s["status"] == "unresolved", (target, s)
        old_home = os.environ.get("CODEWALK_HOME")
        os.environ["CODEWALK_HOME"] = str(root / "home")
        try:
            w, p = save_walk(title="t", folder="Loans", wid=None, root=root, repos=repos, stops=got[:2])
            w2, p2 = save_walk(title="t2", folder=None, wid=w["id"], root=root, repos=repos, stops=got[:3])
            assert (w2["version"], w2["previous_stops"], w2["folder"], p2.parent.name, p.exists()) == (2, 2, "Loans", "Loans", True)
            (repo / "src/loans/loan_service.py").write_text(files["src/loans/loan_service.py"].replace("raise ValueError()", "raise KeyError()"))
            assert [s["status"] for s in live_status(load_walk(p2))["stops"]] == ["changed", "ok", "ok"]
            move_walk(w["id"], None)
            assert list(walk_files().values())[0].parent == walks_dir() and not (walks_dir() / "Loans").exists()
            delete_walk(w["id"])
            assert not walk_files()
        finally:
            os.environ.pop("CODEWALK_HOME") if old_home is None else os.environ.__setitem__("CODEWALK_HOME", old_home)
        opts = argparse.Namespace(root=str(root), title=None, close="It hangs on `assign`", peak=1, dry_run=False)
        block = block_target(opts, "shop src/loans/loan_service.py:4-8 Here `assign` raises\nshop svc/stock.go:7-9 Then `nothing`")
        assert 'class="cw"' in block["html"] and "<!--BLOCK-->" not in block["html"] and any("nothing" in x for x in block["warnings"]), block["warnings"]
    return f"ok: grammar, {len(cases) + 1} resolutions, store, block"


if __name__ == "__main__":
    sys.exit(main())
