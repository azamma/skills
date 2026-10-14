// Locate a Chrome or Chromium binary: $CHROME first, then the usual install paths, then $PATH.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

export function findChrome() {
  if (process.env.CHROME) {
    if (existsSync(process.env.CHROME)) return process.env.CHROME;
    console.error(`CHROME=${process.env.CHROME} does not exist.`); process.exit(1);
  }
  const paths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const found = paths.find((p) => existsSync(p));
  if (found) return found;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    try { return execFileSync("which", [name], { encoding: "utf8" }).trim(); } catch {}
  }
  console.error("Chrome not found. Install Google Chrome or Chromium, or set CHROME=/path/to/chrome.");
  process.exit(1);
}
