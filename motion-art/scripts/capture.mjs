// Screenshot a page with headless Chrome once the sketch has finished drawing.
// It is done when the sketch stopped looping (noLoop) or set window.__done = true.
// Usage: node capture.mjs <url> <out.png> <size>   (Node 22+, no dependencies: CDP over WebSocket)
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome } from "./chrome.mjs";

const [url, out, sizeArg] = process.argv.slice(2);
const size = +sizeArg || 1200;
const CHROME = findChrome();
const TIMEOUT_MS = +(process.env.TIMEOUT_MS || 600000);
const profile = mkdtempSync(join(tmpdir(), "motion-art-chrome-"));

const chrome = spawn(CHROME, [
  "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--hide-scrollbars", `--window-size=${size},${size}`, "--remote-debugging-port=0",
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
const fail = (m) => { console.error(m); cleanup(); process.exit(1); };
setTimeout(() => fail(`timeout after ${TIMEOUT_MS} ms: sketch never stopped looping / set __done`), TIMEOUT_MS);

// Chrome prints "DevTools listening on ws://..." on stderr.
const browserWs = await new Promise((res) => {
  let buf = "";
  chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/ws:\/\/\S+/); if (m) res(m[0]); });
});
const port = new URL(browserWs).port;
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  // A page error stops the p5 loop for good: fail now with the message instead of waiting out TIMEOUT_MS.
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    fail(`page error: ${d.exception?.description || d.text} (${d.url || ""}:${d.lineNumber + 1})`);
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });

const DONE = `(() => { if (window.__done) return true;
  return typeof isLooping === "function" && typeof frameCount === "number" && frameCount >= 1 && !isLooping(); })()`;
for (;;) {
  const r = await send("Runtime.evaluate", { expression: DONE, returnByValue: true });
  if (r.result?.result?.value === true) break;
  await new Promise((s) => setTimeout(s, 250));
}
await new Promise((s) => setTimeout(s, 300)); // let postdraw flush reach the compositor
const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
cleanup();
process.exit(0);
