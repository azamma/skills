// Codewalk front: the Walks page (#/) and one walk (#/w/<id>). The server reads the walks and the code; what is only this browser's
// (which versions you saw, where you stopped reading, which folders are open) lives in localStorage.
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("cw." + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("cw." + k, JSON.stringify(v)); } catch { /* private window: per-visit only */ } },
};
const svg = (d, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  spark: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
  more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  loose: svg('<rect x="4" y="4" width="16" height="16" rx="3"/>'),
  chev: svg('<path d="m6 9 6 6 6-6"/>', 14),
  right: svg('<path d="m9 6 6 6-6 6"/>', 14),
  copy: svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>', 14),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 14),
  warn: svg('<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.01"/>', 13),
  file: svg('<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>', 13),
  prev: svg('<path d="m15 6-6 6 6 6"/>'), next: svg('<path d="m9 6 6 6-6 6"/>'),
  pause: svg('<path d="M9 5v14M15 5v14"/>'), play: svg('<path d="m7 4 13 8-13 8z"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>', 14), pin: svg('<path d="M12 21s7-6.1 7-11a7 7 0 0 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>', 13),
};
const BAD = new Set(["unresolved", "ambiguous", "missing"]);
const PLAYABLE = new Set(["ok", "changed"]);

let walks = null, folders = [], walksDir = "~/.codewalk/walks", known = null;
let view = { kind: "none" };
const home = { q: "", chip: "all", deleting: new Set() };

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

// ---------------------------------------------------------------- what a walk is to this browser

const seenMap = () => store.get("seen", {});
const isUnseen = (w) => seenMap()[w.id] !== w.version;
const markSeen = (ids) => { const s = seenMap(); for (const w of walks ?? []) if (ids.includes(w.id)) s[w.id] = w.version; store.set("seen", s); };
const markUnseen = (id) => { const s = seenMap(); delete s[id]; store.set("seen", s); };
const notFound = (w) => w.stops.filter((s) => s.status === "unresolved" || s.status === "ambiguous").length;
const changedN = (w) => w.stops.filter((s) => s.status === "changed" || s.status === "missing").length;
const visible = () => (walks ?? []).filter((w) => !home.deleting.has(w.id));

function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) { const d = Math.round(s / 86400); return d === 1 ? "yesterday" : `${d} days ago`; }
  return `${Math.round(s / 86400 / 7)} weeks ago`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const phraseHtml = (t) => String(t).split("`").map((x, i) => (i % 2 ? `<code>${esc(x)}</code>` : esc(x))).join("");

// How long a stop stays on screen on its own: its words at 200 per minute plus a little per line, never under 4 s.
const readingMs = (phrase, lines) => Math.max(4000, String(phrase).split(/\s+/).filter(Boolean).length * 300 + lines * 300);

// ---------------------------------------------------------------- toasts, menu, clipboard

function toast(html, { actions = [], ms = 8000 } = {}) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="msg">${html}</span>`;
  const close = () => el.remove();
  for (const a of actions) {
    const b = document.createElement("button");
    b.className = a.primary ? "btn primary" : a.icon ? "icon-btn" : "btn ghost";
    b.innerHTML = a.icon ?? esc(a.label);
    if (a.aria) b.setAttribute("aria-label", a.aria);
    b.onclick = () => { close(); a.run?.(); };
    el.append(b);
  }
  $("#toasts").append(el);
  if (ms) setTimeout(close, ms);
  return close;
}

async function copy(text, what = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(esc(what), { ms: 2500 }); }
  catch { toast("Your browser did not let the page copy. Select the text and copy it by hand.", { ms: 4000 }); }
}

let menuEl = null;
function closeMenu() {
  if (!menuEl) return;
  const btn = menuEl._btn;
  menuEl.remove(); menuEl = null;
  btn?.setAttribute("aria-expanded", "false");
  btn?.focus();
}
function openMenu(btn, items) {
  closeMenu();
  const m = document.createElement("div");
  m.className = "menu"; m.setAttribute("role", "menu"); m._btn = btn;
  m.innerHTML = items.map((it, i) => (it === "-" ? "<hr>" : `<button role="menuitem" tabindex="-1" data-i="${i}" class="${it.danger ? "danger" : ""}">${it.icon ?? ""}${esc(it.label)}${it.k ? `<span class="k">${esc(it.k)}</span>` : ""}</button>`)).join("");
  document.body.append(m);
  const r = btn.getBoundingClientRect();
  m.style.top = `${Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8)}px`;
  m.style.left = `${Math.max(8, r.right - m.offsetWidth)}px`;
  btn.setAttribute("aria-expanded", "true");
  const entries = [...m.querySelectorAll("[role=menuitem]")];
  entries[0].focus();
  m.addEventListener("click", (e) => { const b = e.target.closest("[role=menuitem]"); if (b) { const it = items[b.dataset.i]; closeMenu(); it.run(); } });
  m.addEventListener("keydown", (e) => {
    const i = entries.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); entries[(i + (e.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length].focus(); }
    else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); closeMenu(); }
  });
  menuEl = m;
}
document.addEventListener("pointerdown", (e) => { if (menuEl && !menuEl.contains(e.target) && e.target !== menuEl._btn) closeMenu(); });

// ---------------------------------------------------------------- requests for the agent

async function fixRequest(id) {
  const w = await api(`/api/walks/${id}`);
  const bad = w.stops.filter((s) => BAD.has(s.status) || s.status === "changed");
  const lines = bad.map((s) => `  stop ${s.n} ${s.repo} ${s.target}: ${s.status}${s.candidates?.length ? ` (candidates: ${s.candidates.join(", ")})` : ""}`);
  const lost = bad.some((s) => s.status === "unresolved" || s.status === "ambiguous");
  return [lost ? `Codewalk walk ${id} ("${w.title}") has stops it could not locate:` : `The code behind Codewalk walk ${id} ("${w.title}") changed since it was saved:`,
    ...lines, `Re-read the code for those stops and resend the whole walk with \`codewalk.py walk --id ${id}\`.`].join("\n");
}

// ---------------------------------------------------------------- the Walks page

const ASK = "Show me, as a walk, how an order is placed. Put it in the Checkout folder.";

function renderHome() {
  const v = $("#view");
  if (!$("#home", v)) {
    v.innerHTML = `
<div class="page" id="home">
  <div>
    <h1>Walks</h1>
    <p class="lede">What your agent sent you. New walks land here; nothing opens on its own.</p>
    <label class="filter">${ICON.search}<span class="sr">Filter walks</span>
      <input id="q" type="search" placeholder="Filter by title, repo, file or symbol" autocomplete="off" value="${esc(home.q)}"><kbd>/</kbd></label>
    <div class="chips-filter" id="chips" role="group" aria-label="Show"></div>
    <div id="lists"></div>
  </div>
  <aside>
    <section>
      <h2>Get a walk from your agent</h2>
      <p>Ask in your terminal and the walk shows up here.</p>
      <div class="prompt" id="ask">${esc(ASK)}</div>
      <button class="btn ghost" id="copy-ask">${ICON.copy}Copy this request</button>
      <details><summary>${ICON.right}How the agent saves it</summary><pre>codewalk.py walk --title "…" --folder "…" &lt; stops
  --folder NAME  file it in a folder (made if missing)
  --id ID        replace that walk: version + 1
  --open         also put it on screen

Each walk is a JSON file in ${esc(walksDir)}.</pre></details>
    </section>
    <section>
      <h2>What the labels mean</h2>
      <dl class="legend">
        <dt class="chip new">New</dt><dd>Sent since you last looked</dd>
        <dt class="chip upd">Updated</dt><dd>Your agent replaced it</dd>
        <dt class="chip warn">Not found</dt><dd>Stops it could not locate</dd>
        <dt class="chip stale">Changed</dt><dd>Code moved after saving</dd>
      </dl>
    </section>
  </aside>
</div>
<footer class="statusbar"><span class="dot" aria-hidden="true"></span><span id="watching">Watching ${esc(walksDir)}</span>
  <span class="keys"><span><kbd>j</kbd><kbd>k</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>/</kbd> filter</span><span><kbd>e</kbd> seen</span><span><kbd>⌫</kbd> delete</span></span></footer>`;
    $("#q").addEventListener("input", (e) => { home.q = e.target.value; renderLists(); });
    $("#copy-ask").onclick = () => copy(ASK, "Request copied: paste it in your agent's terminal");
    $("#chips").onclick = (e) => { const b = e.target.closest("button"); if (b) { home.chip = b.dataset.chip; renderLists(); } };
    $("#lists").addEventListener("click", onListClick);
  }
  renderLists();
}

function rowHtml(w) {
  const unseen = isUnseen(w), nf = notFound(w), ch = changedN(w), total = w.stops.length;
  const chips = [];
  if (unseen && seenMap()[w.id] === undefined) chips.push(`<span class="chip new">New</span>`);
  else if (unseen) chips.push(`<span class="chip upd">Updated · v${w.version}${w.previous_stops != null && w.previous_stops !== total ? ` · ${w.previous_stops}→${total} stops` : ""}</span>`);
  if (nf) chips.push(`<span class="chip warn">${ICON.warn}${nf} of ${plural(total, "stop")} not found</span>`);
  if (ch) chips.push(`<span class="chip stale">${ICON.file}${ch === total ? `All ${total} stops changed` : `${plural(ch, "stop")} changed since saved`}</span>`);
  const repos = w.repos.map((r) => `<span class="repo">${esc(r)}</span>`).join(`<span class="hop" aria-label="then">→</span>`);
  const fix = nf ? `<span class="fix-wrap">· <button class="fix" data-act="fix" data-id="${w.id}">Copy a fix request for your agent</button></span>`
    : ch ? `<span class="fix-wrap">· <button class="fix" data-act="fix" data-id="${w.id}">Copy a refresh request</button></span>` : "";
  const trail = w.stops.map((s) => (BAD.has(s.status) ? `<i class="miss" title="${esc(s.status)}">${esc(s.target)}</i>` : `<b>${esc(s.target)}</b>`)).join(" › ");
  return `<article class="walk${unseen ? " unseen" : ""}" data-id="${w.id}">
  <div class="title"><a class="name" href="#/w/${w.id}">${esc(w.title)}</a>${chips.join("")}</div>
  <div class="meta">${repos}<span>· ${plural(total, "stop")}</span>${w.folder && home.flat ? `<span>· ${esc(w.folder)}</span>` : ""}${fix}</div>
  <div class="trail">${trail}</div>
  <div class="side"><time datetime="${esc(w.updated)}">${ago(w.updated)}</time>
    <button class="more" data-act="menu" data-id="${w.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ${esc(w.title)}">${ICON.more}</button></div>
</article>`;
}

function group(title, list, { head = "", note = "", action = "" } = {}) {
  if (!list.length) return "";
  return `<section class="group"><div class="group-head">${head}<h2>${esc(title)}</h2><span class="n">${list.length}${note}</span>${action}</div>
    <div class="rows">${list.map(rowHtml).join("")}</div></section>`;
}

function resumeHtml(ws) {
  const reading = store.get("reading", {});
  const best = ws.map((w) => ({ w, r: reading[w.id] })).filter(({ w, r }) => r && r.version === w.version && r.n < w.stops.length && !isUnseen(w))
    .sort((a, b) => b.r.at - a.r.at)[0];
  if (!best) return "";
  const { w, r } = best, stop = w.stops[r.n - 1];
  const strip = w.stops.slice(0, 14).map((_, i) => `<i class="${i + 1 < r.n ? "done" : i + 1 === r.n ? "cur" : ""}"></i>`).join("");
  return `<section class="group"><div class="group-head"><h2>Continue reading</h2></div>
  <div class="resume"><span class="strip" aria-hidden="true">${strip}</span><span class="t">${esc(w.title)}</span>
  <span class="m">Stop ${r.n} of ${w.stops.length} · ${esc(stop?.target)} · you were here ${ago(new Date(r.at).toISOString())}</span>
  <a class="btn primary" href="#/w/${w.id}">Resume</a></div></section>`;
}

function renderLists() {
  if (!$("#lists") || !walks) return;
  const ws = visible(), q = home.q.trim().toLowerCase();
  const unseen = ws.filter(isUnseen), stale = ws.filter((w) => changedN(w) || notFound(w));
  $("#chips").innerHTML = [["all", "All"], ["unseen", `Unseen · ${unseen.length}`], ["refresh", `Needs a refresh · ${stale.length}`]]
    .map(([k, label]) => `<button data-chip="${k}" aria-pressed="${home.chip === k}">${label}</button>`).join("");
  const L = $("#lists");
  home.flat = false;
  if (!ws.length) {
    L.innerHTML = `<div class="empty"><h2>No walks yet</h2><p>Ask your agent to show you some code as a walk. It saves the walk here, and it stays until you delete it.</p>
      <button class="btn primary" data-act="copy-ask">${ICON.copy}Copy a request to start</button></div>`;
    return;
  }
  if (q) {
    home.flat = true;
    const hit = ws.filter((w) => [w.title, w.folder, ...w.repos, ...w.stops.map((s) => s.target)].some((x) => String(x ?? "").toLowerCase().includes(q)));
    L.innerHTML = group("Results", hit) || `<div class="empty"><p>No walk mentions “${esc(home.q)}”.</p></div>`;
    return;
  }
  if (home.chip === "unseen") { home.flat = true; L.innerHTML = group("Unseen", unseen) || `<div class="empty"><p>You have seen every walk.</p></div>`; return; }
  if (home.chip === "refresh") {
    home.flat = true;
    L.innerHTML = (stale.length ? `<p class="lede">The code moved after these were saved, or some stops were never found. Copy a request and your agent resends them.</p>` : "")
      + (group("Needs a refresh", stale) || `<div class="empty"><p>Every walk still matches the code.</p></div>`);
    return;
  }
  const fresh = group("New since you last looked", unseen,
    { head: `<span class="agent">${ICON.spark}</span>`, action: `<button class="link-btn" data-act="seen-all">Mark all as seen</button>` });
  const refresh = stale.filter((w) => !isUnseen(w));
  const open = new Set(store.get("open-folders", []));
  const byFolder = new Map();
  for (const w of ws) { const k = w.folder ?? ""; byFolder.set(k, [...(byFolder.get(k) ?? []), w]); }
  const keys = [...byFolder.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
  if (byFolder.has("")) keys.push("");
  const archive = keys.map((k) => {
    const list = byFolder.get(k), id = `f-${encodeURIComponent(k || "loose").replace(/%/g, "")}`, isOpen = open.has(k);
    const extra = [list.filter(isUnseen).length && `${list.filter(isUnseen).length} new`, list.filter((w) => changedN(w) || notFound(w)).length && `${list.filter((w) => changedN(w) || notFound(w)).length} ${list.filter((w) => changedN(w) || notFound(w)).length === 1 ? "needs" : "need"} a refresh`].filter(Boolean).join(" · ");
    return `<div class="fgroup"><h3 class="sr">${esc(k || "Not in a folder")}</h3>
      <button class="folder" data-act="folder" data-folder="${esc(k)}" aria-expanded="${isOpen}" aria-controls="${id}">
        <span class="chev">${ICON.chev}</span><span class="ficon">${k ? ICON.folder : ICON.loose}</span><b>${esc(k || "Not in a folder")}</b>
        <span class="n">${plural(list.length, "walk")}${extra ? " · " + extra : ""}</span><span class="when">changed ${ago(list[0].updated)}</span></button>
      <div class="folder-body rows" id="${id}" ${isOpen ? "" : "hidden"}>${isOpen ? list.map(rowHtml).join("") : ""}</div></div>`;
  }).join("");
  const nFolders = keys.filter(Boolean).length;
  L.innerHTML = fresh + resumeHtml(ws) + group("Needs a refresh", refresh, { note: " · the code changed after these were saved, or stops were not found" })
    + `<section class="group archive"><div class="group-head"><h2>All walks</h2><span class="n">${ws.length} · ${plural(nFolders, "folder")}${byFolder.has("") ? ` and ${byFolder.get("").length} loose` : ""}</span></div>${archive}</section>`;
}

function onListClick(e) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const id = b.dataset.id, w = walks?.find((x) => x.id === id);
  if (b.dataset.act === "fix") fixRequest(id).then((t) => copy(t, "Request copied: paste it in your agent's terminal")).catch((err) => toast(esc(err.message)));
  else if (b.dataset.act === "menu") openMenu(b, walkMenu(w));
  else if (b.dataset.act === "seen-all") { markSeen(visible().map((x) => x.id)); renderLists(); updateBadge(); }
  else if (b.dataset.act === "copy-ask") copy(ASK, "Request copied: paste it in your agent's terminal");
  else if (b.dataset.act === "folder") {
    const open = new Set(store.get("open-folders", [])), k = b.dataset.folder;
    open.has(k) ? open.delete(k) : open.add(k);
    store.set("open-folders", [...open]);
    renderLists();
    $(`[data-act=folder][data-folder="${CSS.escape(k)}"]`)?.focus();
  }
}

function walkMenu(w) {
  const unseen = isUnseen(w);
  return [
    { label: "Copy walk id", k: w.id, icon: ICON.copy, run: () => copy(w.id, `Copied ${w.id}`) },
    { label: "Move to folder…", k: "m", icon: ICON.folder, run: () => moveWalk(w) },
    { label: unseen ? "Mark as seen" : "Mark as unseen", k: "e", icon: ICON.spark, run: () => { unseen ? markSeen([w.id]) : markUnseen(w.id); renderLists(); updateBadge(); } },
    "-",
    { label: "Delete", k: "⌫", danger: true, icon: ICON.x, run: () => deleteWalk(w) },
  ];
}

function moveWalk(w) {
  const d = $("#move-dialog"), input = $("#move-input");
  $("#folder-list").innerHTML = folders.map((f) => `<option value="${esc(f)}">`).join("");
  input.value = w.folder ?? "";
  d.querySelector("[value=loose]").hidden = !w.folder;
  d.returnValue = "";
  d.onclose = async () => {
    if (d.returnValue !== "move" && d.returnValue !== "loose") return;
    const folder = d.returnValue === "loose" ? null : input.value.trim() || null;
    try { await api(`/api/walks/${w.id}/move`, { folder }); toast(folder ? `Moved to ${esc(folder)}` : "Taken out of its folder", { ms: 3000 }); poll(); }
    catch (err) { toast(`Could not move it: ${esc(err.message)}. A folder name has no / \\ : * ? " &lt; &gt; | and does not start with a dot.`); }
  };
  d.showModal();
}

function deleteWalk(w) {
  home.deleting.add(w.id);
  renderLists(); updateBadge();
  let undone = false;
  toast(`Deleted “${esc(w.title)}”`, { ms: 6000, actions: [{ label: "Undo", run: () => { undone = true; home.deleting.delete(w.id); renderLists(); updateBadge(); } }] });
  setTimeout(async () => {
    if (undone) return;
    try { await api(`/api/walks/${w.id}/delete`, {}); } catch (err) { toast(`Could not delete it: ${esc(err.message)}`); }
    home.deleting.delete(w.id);
    poll();
  }, 6000);
}

// ---------------------------------------------------------------- one walk

function renderWalkShell() {
  const { walk } = view;
  const repos = new Set(walk.stops.map((s) => s.repo)).size;
  $("#view").innerHTML = `
<div class="walkbar">
  <a class="crumb" href="#/">← Walks /</a><h1>${esc(walk.title)}</h1>
  <span class="info">${plural(repos, "repo")} · ${plural(walk.stops.length, "stop")} · v${walk.version} · saved ${ago(walk.updated)}${walk.folder ? ` · ${esc(walk.folder)}` : ""}</span>
  <div class="controls">
    <button class="icon-btn" data-act="prev" aria-label="Previous stop" title="Previous stop (←)">${ICON.prev}</button>
    <button class="icon-btn on" data-act="toggle" id="toggle" aria-label="Pause" title="Pause (Space)">${ICON.pause}</button>
    <button class="icon-btn" data-act="next" aria-label="Next stop" title="Next stop (→)">${ICON.next}</button>
    <span class="pos" id="pos" aria-live="polite"></span><span class="mode" id="mode"></span>
  </div>
</div>
<div class="stage">
  <nav class="files" id="files" aria-label="Files in this walk"></nav>
  <section class="editor" aria-label="Code"><div class="edhead" id="edhead"></div><div class="code" id="code" tabindex="0"></div></section>
  <nav class="stoplist" id="stoplist" aria-label="Stops"></nav>
</div>
<footer class="statusbar"><span class="dot" aria-hidden="true"></span><span>${esc(walk.repos.map((r) => `${r.name} @ ${r.branch ?? "detached"}`).join(" · "))}</span>
  <span class="keys"><span><kbd>←</kbd><kbd>→</kbd> step</span><span><kbd>Space</kbd> pause</span><span><kbd>Esc</kbd> back to Walks</span></span></footer>`;
  $("#view").onclick = onWalkClick;
  renderSides();
}

function renderSides() {
  const { walk } = view;
  const files = [];
  for (const s of walk.stops) {
    if (!s.file) continue;
    const f = files.find((x) => x.repo === s.repo && x.file === s.file);
    f ? f.ns.push(s.n) : files.push({ repo: s.repo, file: s.file, ns: [s.n] });
  }
  const order = [...new Set(files.map((f) => f.repo))];
  files.sort((x, y) => order.indexOf(x.repo) - order.indexOf(y.repo));
  let last = null;
  $("#files").innerHTML = files.map((f) => {
    const head = f.repo !== last ? `<h2>${esc(f.repo)}</h2>` : "";
    last = f.repo;
    const parts = f.file.split("/"), name = parts.pop();
    return `${head}<button data-act="file" data-n="${f.ns[0]}" data-key="${esc(f.repo + "\n" + f.file)}">${ICON.file}<span class="fname">${esc(name)}<span class="fdir">${esc(parts.join("/") || ".")}</span></span><span class="ns">${f.ns.join(" ")}</span></button>`;
  }).join("") || `<p class="lede">No file could be located.</p>`;
  let html = `<div class="lh"><h2>Walk</h2><span>${plural(walk.stops.length, "stop")}</span></div>`;
  walk.stops.forEach((s, i) => {
    if (i === 0 || walk.stops[i - 1].repo !== s.repo) html += `<h3>${esc(s.repo)}</h3>`;
    const cls = BAD.has(s.status) ? " bad" : s.status === "changed" ? " stale" : "";
    html += `<button class="stop${cls}" data-act="goto" data-i="${i}"><span class="num">${s.n}</span><span class="tg">${esc(s.target)}</span><span class="ph">${phraseHtml(s.phrase)}</span></button>`;
  });
  $("#stoplist").innerHTML = html;
}

function onWalkClick(e) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const a = b.dataset.act;
  if (a === "prev") step(-1);
  else if (a === "next") step(1);
  else if (a === "toggle") toggle();
  else if (a === "goto") go(Number(b.dataset.i), "manual");
  else if (a === "file") go(view.walk.stops.findIndex((s) => s.n === Number(b.dataset.n)), "manual");
  else if (a === "fix") fixRequest(view.walk.id).then((t) => copy(t, "Request copied: paste it in your agent's terminal"));
}

async function fileRows(s) {
  const key = `${view.walk.version}:${s.repo}:${s.file}`;
  view.files ??= new Map();
  if (!view.files.has(key)) view.files.set(key, api(`/api/walks/${view.walk.id}/stops/${s.n}/file`).then((r) => r.rows));
  return view.files.get(key);
}

const runsHtml = (runs) => runs.map(([t, c]) => (c ? `<span class="${c}">${esc(t)}</span>` : esc(t))).join("");

async function go(i, mode = view.mode) {
  const { walk } = view;
  if (i < 0 || i >= walk.stops.length) return;
  view.cur = i;
  view.mode = mode;
  view.seenStops.add(i);
  const s = walk.stops[i], ticket = (view.ticket = (view.ticket ?? 0) + 1);
  const reading = store.get("reading", {});
  reading[walk.id] = { n: s.n, version: walk.version, at: Date.now() };
  store.set("reading", reading);
  for (const el of document.querySelectorAll(".stop")) {
    const k = Number(el.dataset.i);
    el.toggleAttribute("aria-current", false);
    if (k === i) el.setAttribute("aria-current", "step");
    el.classList.toggle("seen", view.seenStops.has(k) && k !== i);
  }
  $(".stop[aria-current]")?.scrollIntoView({ block: "nearest" });
  for (const el of document.querySelectorAll(".files button")) el.setAttribute("aria-current", String(el.dataset.key === `${s.repo}\n${s.file}`));
  $("#pos").textContent = `Stop ${s.n} of ${walk.stops.length}`;
  const code = $("#code"), head = $("#edhead");
  if (!PLAYABLE.has(s.status)) {
    head.innerHTML = `<span class="path">${esc(s.repo)} · ${esc(s.target)}</span>`;
    code.innerHTML = noticeHtml(s);
    return restartTimer(0);
  }
  let rows;
  try { rows = await fileRows(s); } catch (err) {
    if (ticket === view.ticket) { code.innerHTML = noticeHtml({ ...s, status: "missing", why: err.message }); restartTimer(0); }
    return;
  }
  if (ticket !== view.ticket) return;
  const [a, b] = s.lines;
  head.innerHTML = `<span class="path">${esc(s.repo)} / ${esc(s.file)}</span><span class="loc">${ICON.pin}Stop ${s.n} · ${esc(s.target)} · ${a === b ? `line ${a}` : `lines ${a}–${b}`}</span>`;
  let html = "";
  rows.forEach((runs, k) => {
    const n = k + 1, inside = n >= a && n <= b;
    html += `<div class="ln${inside ? " in" : ""}" data-n="${n}"><span class="no">${n}</span><span class="tx">${runsHtml(runs) || " "}</span></div>`;
    if (n === b) html += bubbleHtml(s);
  });
  const sameFile = view.shownFile === `${walk.version}:${s.repo}:${s.file}`;
  code.innerHTML = html;
  view.shownFile = `${walk.version}:${s.repo}:${s.file}`;
  const first = code.querySelector(`.ln[data-n="${a}"]`);
  if (first) {
    const target = Math.max(0, first.offsetTop - code.clientHeight * 0.22);
    code.scrollTo({ top: target, behavior: sameFile && Math.abs(code.scrollTop - target) < code.clientHeight * 1.5 ? "smooth" : "instant" });
  }
  restartTimer(readingMs(s.phrase, b - a + 1));
}

function bubbleHtml(s) {
  const warn = s.status === "changed" ? `<p class="warn">The code changed since this walk was saved: these lines may be off. Copy a refresh request from Walks and your agent resends it.</p>` : "";
  return `<div class="bubble" role="note" aria-label="Stop ${s.n}"><div class="bh"><span class="spark">${ICON.spark}</span><b>${s.n} / ${view.walk.stops.length}</b><span>${esc(s.repo)} · ${esc(s.target)}</span></div>
  ${warn}<p class="phrase">${phraseHtml(s.phrase)}</p>
  <div class="bf"><span class="bar"><i id="bar"></i></span><span id="left"></span><span class="keys">← → step · Space pause</span></div></div>`;
}

function noticeHtml(s) {
  const head = { unresolved: "Not found", ambiguous: "More than one place matches", missing: "This code is gone" }[s.status] ?? "Cannot show this stop";
  const body = s.status === "ambiguous" ? "Your agent can resend the stop with one of these as its target:"
    : s.status === "missing" ? `The file or its lines are no longer there${s.why ? ` (${esc(s.why)})` : ""}. Your agent can resend the walk.`
      : `${esc(s.target)} is not in ${esc(s.repo)} as written: it may have been renamed, or live on another branch.`;
  return `<div class="notice"><h2>${head}</h2><p class="phrase">${phraseHtml(s.phrase)}</p><p>${body}</p>
    ${s.candidates?.length ? `<ul>${s.candidates.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    <button class="btn ghost" data-act="fix">${ICON.copy}Copy a fix request for your agent</button></div>`;
}

// The player: "auto" advances when a stop's reading time runs out (passing over stops that cannot show), "paused" holds it,
// "manual" is the person stepping, "done" is auto past the last stop.
function restartTimer(ms) {
  cancelAnimationFrame(view.raf);
  view.dwell = ms; view.elapsed = 0; view.t0 = performance.now();
  tick();
}
function tick() {
  if (view.kind !== "walk") return;
  const running = view.mode === "auto";
  const elapsed = view.elapsed + (running ? performance.now() - view.t0 : 0);
  const bar = $("#bar"), left = $("#left");
  if (bar) bar.style.width = `${view.dwell ? Math.min(100, (elapsed / view.dwell) * 100) : 0}%`;
  if (left) left.textContent = view.mode === "auto" ? `next in ${Math.max(1, Math.ceil((view.dwell - elapsed) / 1000))} s` : view.mode === "paused" ? "paused" : view.mode === "done" ? "end of the walk" : "manual";
  const mode = $("#mode");
  if (mode) {
    mode.className = `mode${view.mode === "auto" ? "" : " manual"}`;
    mode.textContent = { auto: "Auto-advance", paused: "Paused", manual: "Manual", done: "Done" }[view.mode];
  }
  const t = $("#toggle");
  if (t) { const playing = view.mode === "auto"; t.innerHTML = playing ? ICON.pause : ICON.play; t.setAttribute("aria-label", playing ? "Pause" : "Play"); t.classList.toggle("on", playing); }
  if (running && elapsed >= view.dwell) {
    const next = view.walk.stops.findIndex((s, i) => i > view.cur && PLAYABLE.has(s.status));
    if (next < 0) { view.mode = "done"; view.elapsed = elapsed; return tick(); }
    return go(next, "auto");
  }
  view.raf = requestAnimationFrame(tick);
}
function toggle() {
  if (view.mode === "auto") { view.elapsed += performance.now() - view.t0; view.mode = "paused"; }
  else { if (view.mode === "done") return go(Math.max(0, view.walk.stops.findIndex((s) => PLAYABLE.has(s.status))), "auto"); view.mode = "auto"; view.t0 = performance.now(); if (view.elapsed >= view.dwell) view.elapsed = 0; }
  tick();
}
const step = (d) => go(Math.min(Math.max(view.cur + d, 0), view.walk.stops.length - 1), "manual");

async function openWalk(id) {
  cancelAnimationFrame(view.raf);
  let walk;
  try { walk = await api(`/api/walks/${id}`); } catch {
    view = { kind: "none" };
    $("#view").innerHTML = `<div class="notice"><h2>No walk ${esc(id)}</h2><p>It may have been deleted, or the link is from another machine.</p><a class="btn ghost" href="#/">Back to Walks</a></div>`;
    return;
  }
  const reading = store.get("reading", {})[id];
  const resumeAt = reading && reading.version === walk.version ? walk.stops.findIndex((s) => s.n === reading.n) : -1;
  view = { kind: "walk", id, walk, cur: 0, mode: resumeAt > 0 ? "manual" : "auto", seenStops: new Set() };
  markSeen([id]); updateBadge();
  renderWalkShell();
  go(resumeAt > 0 ? resumeAt : Math.max(0, walk.stops.findIndex((s) => PLAYABLE.has(s.status))));
}

// The agent replaced the walk on screen: swap it in place and stay on the same stop (by repo and target), or the nearest one.
async function replaceLive(summaryW) {
  const old = view.walk, at = old.stops[view.cur];
  const walk = await api(`/api/walks/${view.id}`).catch(() => null);
  if (!walk || view.kind !== "walk" || walk.id !== view.id) return;
  let i = walk.stops.findIndex((s) => s.repo === at.repo && s.target === at.target);
  const kept = i >= 0;
  if (!kept) i = Math.min(view.cur, walk.stops.length - 1);
  view.walk = walk; view.files = new Map(); view.seenStops = new Set();
  markSeen([walk.id]); updateBadge();
  renderWalkShell();
  go(i, view.mode === "auto" ? "auto" : "manual");
  const counts = old.stops.length !== walk.stops.length ? ` · ${old.stops.length}→${walk.stops.length} stops` : "";
  const where = kept ? `You stay on ${esc(at.target)}, now stop ${walk.stops[i].n} of ${walk.stops.length}` : `${esc(at.target)} is gone; you are on stop ${walk.stops[i].n}`;
  toast(`<span class="spark">${ICON.spark}</span> Your agent updated this walk · v${summaryW.version}${counts}<br><small>${where}</small>`, { ms: 9000, actions: [{ icon: ICON.x, aria: "Dismiss" }] });
}

// ---------------------------------------------------------------- polling the server, routing, keys

function updateBadge() {
  const n = visible().filter(isUnseen).length, el = $("#unseen-count");
  el.hidden = !n; el.textContent = n; el.title = `${n} unseen`;
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const data = await api("/api/walks");
    $("#live-dot").className = "dot"; $("#live-text").textContent = "local · read-only";
    const before = new Map((walks ?? []).map((w) => [w.id, w]));
    const changed = JSON.stringify(data.walks) !== JSON.stringify(walks);
    walks = data.walks; folders = data.folders; walksDir = data.dir ?? walksDir;
    if (known) {
      for (const w of walks) {
        if (!known.has(w.id) && !(view.kind === "walk" && view.id === w.id)) {
          const nf = notFound(w);
          toast(`<span class="spark">${ICON.spark}</span> New walk: <b>${esc(w.title)}</b>${nf ? ` <span class="chip warn">${nf} not found</span>` : ""}`,
            { ms: 12000, actions: [{ label: "Open", primary: true, run: () => (location.hash = `#/w/${w.id}`) }, { icon: ICON.x, aria: "Dismiss; it stays in Walks" }] });
        }
      }
    }
    known = new Set(walks.map((w) => w.id));
    if (view.kind === "walk") {
      const mine = walks.find((w) => w.id === view.id);
      if (mine && mine.version !== view.walk.version && before.get(view.id)?.version !== mine.version) replaceLive(mine);
    }
    if (data.open) { location.hash = `#/w/${data.open}`; window.focus(); }
    if (changed && view.kind === "home" && !menuEl) renderLists();
    updateBadge();
  } catch {
    $("#live-dot").className = "dot off"; $("#live-text").textContent = "server stopped: run codewalk.py open";
  } finally {
    polling = false;
  }
}

async function route() {
  closeMenu();
  const m = location.hash.match(/^#\/w\/(w[0-9a-f]{6})$/);
  if (m) return openWalk(m[1]);
  cancelAnimationFrame(view.raf);
  view = { kind: "home" };
  if (!walks) await poll();
  renderHome();
}

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || menuEl || $("#move-dialog").open) return;
  const typing = e.target.closest?.("input, textarea");
  if (view.kind === "walk") {
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (e.key === " " && !e.target.closest("button, a")) { e.preventDefault(); toggle(); }
    else if (e.key === "Escape") location.hash = "#/";
    return;
  }
  if (view.kind !== "home") return;
  if (typing) { if (e.key === "Escape") e.target.blur(); return; }
  const rows = [...document.querySelectorAll("#lists .walk .name")];
  const at = rows.indexOf(document.activeElement);
  const w = at >= 0 && walks.find((x) => x.id === rows[at].closest(".walk").dataset.id);
  if (e.key === "/") { e.preventDefault(); $("#q").focus(); }
  else if (e.key === "j" || e.key === "k") { e.preventDefault(); rows[Math.min(Math.max(at + (e.key === "j" ? 1 : -1), 0), rows.length - 1)]?.focus(); }
  else if (e.key === "e" && w) { isUnseen(w) ? markSeen([w.id]) : markUnseen(w.id); renderLists(); updateBadge(); }
  else if ((e.key === "Backspace" || e.key === "Delete") && w) { e.preventDefault(); deleteWalk(w); }
  else if (e.key === "m" && w) moveWalk(w);
});

addEventListener("hashchange", route);
route();
setInterval(poll, 2000);
