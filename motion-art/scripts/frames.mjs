// Capture motion frames 1..N of a moving sketch as numbered PNGs, from a single page load.
// The page paints once; then for each i it sets window.__mf = i, awaits redraw() (async in p5 2.x:
// reading the canvas without awaiting returns the previous frame) and reads the canvas back.
// Requires the motion.md scaffold: window.__done after the snapshot, and n = window.__mf ?? ...
// Usage: node frames.mjs <url> <outDir> <nFrames> [size=480]   (Node 22+, no dependencies)
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, outDir, nArg, sizeArg] = process.argv.slice(2);
const N = +nArg, SIZE = +sizeArg || 480;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TIMEOUT_MS = +(process.env.TIMEOUT_MS || 1800000);
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "motion-art-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--window-size=1200,1200", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] });
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
const fail = (m) => { console.error(m); cleanup(); process.exit(1); };
setTimeout(() => fail(`timeout after ${TIMEOUT_MS} ms`), TIMEOUT_MS);

const browserWs = await new Promise((res) => { let b = ""; chrome.stderr.on("data", (d) => { b += d; const m = b.match(/ws:\/\/\S+/); if (m) res(m[0]); }); });
const port = new URL(browserWs).port;
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === "Runtime.exceptionThrown") { const d = msg.params.exceptionDetails; fail(`page error: ${d.exception?.description || d.text}`); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 1200, deviceScaleFactor: 1, mobile: false });
await send("Runtime.enable");
await send("Page.navigate", { url });
while (!(await evaluate("!!window.__done"))) await new Promise((s) => setTimeout(s, 500));
await evaluate("noLoop(), true");

const GRAB = (i) => `(async () => { window.__mf = ${i}; await redraw();
  const src = document.querySelector("canvas"), c = document.createElement("canvas");
  c.width = c.height = ${SIZE}; c.getContext("2d").drawImage(src, 0, 0, ${SIZE}, ${SIZE});
  return c.toDataURL("image/png"); })()`;
const t0 = Date.now();
for (let i = 1; i <= N; i++) {           // motion frames 1..N (frame 0 is the still)
  const data = await evaluate(GRAB(i));
  writeFileSync(join(outDir, `f${String(i).padStart(4, "0")}.png`), Buffer.from(data.split(",")[1], "base64"));
}
console.log(`${N} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${outDir}`);
cleanup(); process.exit(0);
