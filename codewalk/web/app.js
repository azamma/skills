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
const home = { q: "", chip: "all", deleting: new Set(), rendered: new Set() };

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
    <p class="lede">What your agent sent you. New walks land here and never interrupt you.</p>
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
  // a walk enters once: the first time this page shows that version of it
  const enter = !home.rendered.has(`${w.id}:${w.version}`);
  home.rendered.add(`${w.id}:${w.version}`);
  return `<article class="walk${unseen ? " unseen" : ""}${enter ? " enter" : ""}" data-id="${w.id}">
  <div class="title"><a class="name" href="#/w/${w.id}">${esc(w.title)}</a>${chips.join("")}</div>
  <div class="meta">${repos}<span>· ${plural(total, "stop")}</span>${w.folder && home.flat ? `<span>· ${esc(w.folder)}</span>` : ""}${fix}</div>
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
  <div class="resume"><div class="aurora" aria-hidden="true"><i></i><i></i></div><span class="strip" aria-hidden="true">${strip}</span><span class="t">${esc(w.title)}</span>
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

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const MOVE_MS = { near: 120, cut: 150 };

// Top of the bubble in a view `viewH` tall, for a range from `top` to `bottom` (view pixels, either may be off screen): under the
// range when it fits, else above it, and always inside the view.
function bubbleTop({ top, bottom, height, viewH, gap = 10 }) {
  const y = bottom + gap + height <= viewH ? bottom + gap : top - gap - height >= 0 ? top - gap - height : viewH - height - gap;
  return Math.min(Math.max(y, 0), Math.max(0, viewH - height));
}

// A damped spring from 0 to 1 sampled into a CSS linear() easing: it overshoots and settles, the bubble going home.
function springEasing({ damping = 0.5, cycles = 2, samples = 40 } = {}) {
  const w = 2 * Math.PI * cycles, wd = w * Math.sqrt(1 - damping ** 2);
  const at = (t) => 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
  return `linear(${Array.from({ length: samples + 1 }, (_, i) => (i === samples ? 1 : +at(i / samples).toFixed(4))).join(", ")})`;
}
const SPRING = springEasing();

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
    <span class="pos" id="pos"></span><span class="mode" id="mode"></span>
  </div>
</div>
<div class="stage" id="stage">
  <nav class="files" id="files" aria-label="Files in this walk"></nav>
  <section class="editor" aria-label="Code">
    <div class="edhead" id="edhead"></div>
    <div class="edbody">
      <div class="code" id="code" tabindex="0"></div>
      <div class="bubble" id="bubble" role="status" aria-live="polite" hidden>
        <div class="glass" id="glass">
          <div class="aurora" aria-hidden="true"><i></i><i></i><i></i></div>
          <svg class="beam" aria-hidden="true"><linearGradient id="beam-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0"/><stop offset=".4"/><stop offset=".7"/><stop offset="1"/></linearGradient><rect class="glow"/><rect class="ring"/></svg>
          <span class="run halo" aria-hidden="true"><i></i></span><span class="run" aria-hidden="true"><i></i></span>
          <div class="bh"><span class="bn" id="b-n"></span><span class="bw" id="b-where"></span></div>
          <p class="phrase" id="b-phrase"></p>
          <p class="warn" id="b-warn" hidden></p>
          <ul class="cands" id="b-cands" hidden></ul>
          <div class="bar" id="b-bar"><i id="b-fill"></i></div>
          <div class="bf"><span class="state" id="b-state"></span>
            <button class="btn small ghost" data-act="fix" id="b-fix" hidden>${ICON.copy}Copy a fix request</button>
            <button class="btn small ghost" data-act="toggle" id="b-auto">Keep going</button>
            <button class="btn small" data-act="next" id="b-next">Next ⟩</button></div>
        </div>
      </div>
    </div>
  </section>
  <aside class="stoplist"><nav id="stoplist" aria-label="Stops"></nav><p class="note">At reading pace, about 200 words a minute. ← → or a click switches to manual; drag the note to see under it.</p></aside>
</div>
<footer class="statusbar"><span class="dot" aria-hidden="true"></span><span>${esc(walk.repos.map((r) => `${r.name} @ ${r.branch ?? "detached"}`).join(" · "))}</span>
  <span class="keys"><span><kbd>←</kbd><kbd>→</kbd> step</span><span><kbd>Space</kbd> pause</span><span><kbd>Esc</kbd> back to Walks</span></span></footer>`;
  $("#view").onclick = onWalkClick;
  view.shown = null;
  view.first = true;
  const code = $("#code");
  code.addEventListener("scroll", placeSoon, { passive: true });
  code.addEventListener("scrollend", () => { view.landing = null; placeSoon(); });
  new ResizeObserver(placeSoon).observe(code);
  new ResizeObserver(placeSoon).observe($("#bubble"));
  dragBubble($("#glass"));
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
    const parts = f.file.split("/"), name = parts.pop(), ns = f.ns.length > 3 ? `${f.ns[0]}…${f.ns.at(-1)}` : f.ns.join(" ");
    return `${head}<button data-act="file" data-n="${f.ns[0]}" data-key="${esc(f.repo + "\n" + f.file)}" title="${esc(f.file)}">${ICON.file}<span class="fname">${esc(name)}${parts.length ? `<span class="fdir">${esc(parts.join("/"))}</span>` : ""}</span><span class="ns" title="Stops ${f.ns.join(", ")}">${ns}</span></button>`;
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
const keyOf = (s) => `${view.walk.version}:${s.repo}:${s.file}`;

// How the screen goes from one stop to the next: "near" (same file, the range within reach: the view scrolls there, the bubble goes
// along and its text crossfades), "cut" (anything else: code and bubble fade out, the view jumps, they come back in) or "jump" (the
// first stop, or reduced motion). #stage[data-move] holds it while it lasts; the CSS does the fading.
function moveOf(s) {
  const code = $("#code"), row = view.shown === keyOf(s) ? code.querySelector(`.ln[data-n="${s.lines[0]}"]`) : null;
  return row && Math.abs(row.offsetTop - code.scrollTop) <= code.clientHeight * 1.5 ? "near" : "cut";
}

async function go(i, mode = view.mode) {
  const { walk } = view;
  if (i < 0 || i >= walk.stops.length) return;
  const back = i < view.cur;
  view.cur = i;
  view.mode = mode;
  view.seenStops.add(i);
  view.deadline = null;
  const s = walk.stops[i], token = (view.ticket = (view.ticket ?? 0) + 1), live = () => token === view.ticket && view.kind === "walk";
  const reading = store.get("reading", {});
  reading[walk.id] = { n: s.n, version: walk.version, at: Date.now() };
  store.set("reading", reading);
  paintStops();
  const playable = PLAYABLE.has(s.status);
  const move = view.first || still() ? "jump" : playable ? moveOf(s) : "cut";
  if (!view.first) $("#bubble").getAnimations({ subtree: true }).filter((a) => a.animationName === "glass-in").forEach((a) => a.finish());
  view.first = false;
  const stage = $("#stage"), gone = sleep(MOVE_MS[move] ?? 0);
  stage.dataset.move = move;
  const rows = playable && view.shown !== keyOf(s) ? fileRows(s).catch((err) => ({ error: err.message })) : null;
  await gone;
  if (!live()) return;
  const code = $("#code"), head = $("#edhead");
  let shownOk = playable;
  if (rows) {
    const r = await rows;
    if (!live()) return;
    if (r.error) { shownOk = false; s.why = r.error; }
    else {
      code.innerHTML = r.map((runs, k) => `<div class="ln" data-n="${k + 1}"><span class="no">${k + 1}</span><span class="tx">${runsHtml(runs) || " "}</span></div>`).join("");
      view.shown = keyOf(s);
    }
  }
  if (!shownOk) { code.innerHTML = ""; view.shown = null; view.range = []; }
  head.innerHTML = shownOk
    ? `<span class="path">${esc(s.repo)} / ${esc(s.file)}</span><span class="loc">${ICON.pin}Stop ${s.n} · ${s.lines[0] === s.lines[1] ? `line ${s.lines[0]}` : `lines ${s.lines[0]}–${s.lines[1]}`}</span>`
    : `<span class="path">${esc(s.repo)} · ${esc(s.target)}</span>`;
  if (shownOk) {
    code.querySelectorAll(".ln.in").forEach((r) => r.classList.remove("in"));
    view.range = [];
    for (let n = s.lines[0]; n <= s.lines[1]; n++) { const r = code.querySelector(`.ln[data-n="${n}"]`); if (r) { r.classList.add("in"); view.range.push(r); } }
    if (view.range.length) reveal(move !== "near");
  }
  $("#bubble").hidden = false;
  placeBubble();
  paintBubble(s, shownOk);
  placeBubble();
  void $("#bubble").offsetHeight;
  delete stage.dataset.move;
  // a cut comes in from the side the walk went to: from below going on, from above going back
  if (move === "cut" && !still()) for (const el of [code, $("#bubble")]) el.animate([{ translate: `0 ${back ? -8 : 8}px` }, { translate: "0 0" }], { duration: 250, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  restartDwell();
}

function paintStops() {
  const { walk, cur } = view, s = walk.stops[cur];
  for (const el of document.querySelectorAll(".stop")) {
    const k = Number(el.dataset.i);
    k === cur ? el.setAttribute("aria-current", "step") : el.removeAttribute("aria-current");
    el.classList.toggle("seen", view.seenStops.has(k) && k !== cur);
  }
  $(".stop[aria-current]")?.scrollIntoView({ block: "nearest", behavior: still() ? "auto" : "smooth" });
  for (const el of document.querySelectorAll(".files button")) el.setAttribute("aria-current", String(el.dataset.key === `${s.repo}\n${s.file}`));
  $("#pos").textContent = `Stop ${s.n} of ${walk.stops.length}`;
}

// The range starts a third of the way down; one taller than most of the view starts at its top instead.
function reveal(instant) {
  const code = $("#code"), a = view.range[0], z = view.range.at(-1);
  const at = z.offsetTop + z.offsetHeight - a.offsetTop > code.clientHeight * 0.6 ? a.offsetTop - 24 : a.offsetTop - code.clientHeight / 3;
  const to = Math.min(Math.max(0, at), code.scrollHeight - code.clientHeight);
  view.landing = instant || still() ? null : to;
  code.scrollTo({ top: to, behavior: view.landing === null ? "instant" : "smooth" });
}

// Until a smooth scroll lands, the bubble is placed for the range as it will be then: it glides once to its spot.
function placeBubble() {
  const bubble = $("#bubble"), code = $("#code");
  if (!bubble || bubble.hidden) return;
  if (!view.range?.length) return void (bubble.style.top = "16px");
  if (view.landing != null && Math.abs(code.scrollTop - view.landing) < 1) view.landing = null;
  const ahead = view.landing == null ? 0 : code.scrollTop - view.landing;
  const a = view.range[0], z = view.range.at(-1);
  bubble.style.top = `${bubbleTop({ top: a.offsetTop - code.scrollTop + ahead, bottom: z.offsetTop + z.offsetHeight - code.scrollTop + ahead, height: bubble.offsetHeight, viewH: code.clientHeight })}px`;
}
let placing = 0;
function placeSoon() { cancelAnimationFrame(placing); placing = requestAnimationFrame(placeBubble); }

// The phrase of a new stop comes in line by line, each line sliding up from behind its own mask. Once in, the masks go back to
// plain inline text, so it rewraps when the bubble changes width.
function say(phrase) {
  const el = $("#b-phrase");
  if (el.dataset.said === phrase) return;
  el.dataset.said = phrase;
  el.innerHTML = phraseHtml(phrase);
  if (still()) return;
  const words = [];
  for (const node of [...el.childNodes]) {
    if (node.nodeType !== 3) { words.push(node); continue; }
    for (const w of node.textContent.split(/(?<=\s)/)) if (w) words.push(Object.assign(document.createElement("span"), { textContent: w }));
  }
  el.replaceChildren(...words);
  const lines = [];
  for (const w of words) if (lines.at(-1)?.[0].offsetTop === w.offsetTop) lines.at(-1).push(w); else lines.push([w]);
  const masks = lines.map((ws, i) => {
    const mask = Object.assign(document.createElement("span"), { className: "say" }), line = document.createElement("span");
    line.style.animationDelay = `${i * 40}ms`;
    line.append(...ws);
    mask.append(line);
    return mask;
  });
  el.replaceChildren(...masks);
  setTimeout(() => masks.forEach((m) => m.removeAttribute("class")), 260 + lines.length * 40);
}

function paintBubble(s, shownOk) {
  const n = view.walk.stops.length, bad = !shownOk, last = view.cur === n - 1;
  const bubble = $("#bubble");
  bubble.toggleAttribute("data-bad", bad);
  $("#b-n").textContent = `${s.n} / ${n}`;
  $("#b-where").textContent = `${s.repo} · ${s.target}`;
  say(s.phrase);
  const why = !shownOk ? {
    unresolved: `Not found: ${s.target} is not in ${s.repo} as written. It may have been renamed, or live on another branch.`,
    ambiguous: "More than one place matches. Your agent can resend the stop with one of these as its target:",
    missing: "This code is gone: the file or its lines are no longer there.",
  }[s.status] ?? `This stop cannot show${s.why ? `: ${s.why}` : ""}.` : s.status === "changed" ? "The code changed since this walk was saved: these lines may be off." : "";
  $("#b-warn").hidden = !why;
  $("#b-warn").textContent = why;
  $("#b-cands").hidden = !(bad && s.candidates?.length);
  $("#b-cands").innerHTML = (s.candidates ?? []).map((c) => `<li>${esc(c)}</li>`).join("");
  $("#b-fix").hidden = !bad && s.status !== "changed";
  paintMode();
  $("#b-next").innerHTML = bad ? "Skip ⟩" : "Next ⟩";
  $("#b-next").disabled = last;
}

function paintMode() {
  const s = view.walk.stops[view.cur], ok = PLAYABLE.has(s.status), auto = view.mode === "auto";
  $("#b-bar").hidden = !(auto && ok);
  $("#b-auto").hidden = auto;
  $("#b-auto").textContent = view.mode === "done" ? "From the start" : "Keep going";
  $("#b-next").hidden = auto && ok;
  const mode = $("#mode");
  mode.className = `mode${auto ? "" : " manual"}`;
  mode.textContent = { auto: "Auto-advance", paused: "Paused", manual: "Manual", done: "End of the walk" }[view.mode];
  const t = $("#toggle");
  t.innerHTML = auto ? ICON.pause : ICON.play;
  t.setAttribute("aria-label", auto ? "Pause" : "Play");
  t.classList.toggle("on", auto);
  tickBubble();
}

// The reading time left: the bar and "next in N s" ("Paused" with a spinning ring while the bubble is held).
function tickBubble() {
  const s = view.walk.stops[view.cur], state = $("#b-state");
  if (!state) return;
  state.toggleAttribute("data-wait", view.held != null && view.mode === "auto");
  if (view.mode !== "auto" || view.deadline == null) { state.textContent = { paused: "Paused", manual: "", done: "End of the walk", auto: "" }[view.mode]; return; }
  const total = readingMs(s.phrase, s.lines ? s.lines[1] - s.lines[0] + 1 : 0), left = Math.max(0, view.deadline - performance.now());
  $("#b-fill").style.transform = `scaleX(${total ? 1 - left / total : 1})`;
  state.textContent = view.held != null ? "Paused" : `next in ${Math.ceil(left / 1000)} s · ← → by hand`;
}

// The player: "auto" advances when a stop's reading time runs out (passing over stops that cannot show), "paused" holds it,
// "manual" is the person stepping, "done" is auto past the last stop.
function restartDwell() {
  const s = view.walk.stops[view.cur];
  view.deadline = view.mode === "auto" && PLAYABLE.has(s.status) ? performance.now() + readingMs(s.phrase, s.lines[1] - s.lines[0] + 1) : null;
  if (view.mode === "auto" && !PLAYABLE.has(s.status)) view.deadline = performance.now() + 2500;
  paintMode();
  cancelAnimationFrame(view.raf);
  view.raf = requestAnimationFrame(tick);
}
function tick() {
  if (view.kind !== "walk") return;
  const now = performance.now();
  if (view.held != null) { if (view.deadline != null) view.deadline += now - view.held; view.held = now; }
  else if (view.mode === "auto" && view.deadline != null && now >= view.deadline) {
    const next = view.walk.stops.findIndex((s, i) => i > view.cur && PLAYABLE.has(s.status));
    if (next < 0) { view.mode = "done"; view.deadline = null; paintMode(); return; }
    return void go(next, "auto");
  }
  tickBubble();
  view.raf = requestAnimationFrame(tick);
}
function toggle() {
  if (view.mode === "auto") { view.left = view.deadline == null ? null : view.deadline - performance.now(); view.mode = "paused"; view.deadline = null; paintMode(); return; }
  if (view.mode === "done") return void go(Math.max(0, view.walk.stops.findIndex((s) => PLAYABLE.has(s.status))), "auto");
  const wasPaused = view.mode === "paused";
  view.mode = "auto";
  if (wasPaused && view.left != null) { view.deadline = performance.now() + view.left; paintMode(); cancelAnimationFrame(view.raf); view.raf = requestAnimationFrame(tick); }
  else restartDwell();
}
const step = (d) => go(Math.min(Math.max(view.cur + d, 0), view.walk.stops.length - 1), "manual");

// The person can pull the bubble off the code to see under it; let go and it springs back. While held, the reading time stops.
// It moves by `translate`, which composes with the levitation (transform) and the placement (top).
function dragBubble(glass) {
  glass.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault();
    const [x0 = 0, y0 = 0] = (getComputedStyle(glass).translate.match(/-?[\d.]+/g) ?? []).map(Number);
    glass.getAnimations().filter((a) => a.id === "home").forEach((a) => a.cancel());
    const sx = e.clientX - x0, sy = e.clientY - y0;
    const move = (m) => { glass.style.translate = `${m.clientX - sx}px ${m.clientY - sy}px`; };
    move(e);
    glass.setPointerCapture(e.pointerId);
    glass.classList.add("held");
    view.held = performance.now();
    glass.addEventListener("pointermove", move);
    glass.addEventListener("lostpointercapture", () => {
      glass.removeEventListener("pointermove", move);
      glass.classList.remove("held");
      if (view.deadline != null) view.deadline += performance.now() - view.held;
      view.held = null;
      const from = glass.style.translate || "0 0";
      glass.style.translate = "";
      glass.animate([{ translate: from }, { translate: "0 0" }], { id: "home", duration: still() ? 150 : 650, easing: still() ? "ease-out" : SPRING });
    }, { once: true });
  });
}

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
  view = { kind: "walk", id, walk, cur: 0, mode: resumeAt > 0 ? "manual" : "auto", seenStops: new Set(), held: null, range: [] };
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
