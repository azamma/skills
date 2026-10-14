#!/usr/bin/env bash
# Render a p5.brush sketch.js to PNG with headless Chrome. Waits until the sketch
# calls noLoop() or sets window.__done = true, so the capture is deterministic.
# Usage: [QUERY="frame=12"] render.sh <sketch.js> [out.png] [size=1200]
#        FRAMES=48 render.sh <sketch.js> <outDir> [size=480]   motion frames 1..48 as PNGs, one page load
# QUERY is appended to the page URL (e.g. to pick one motion frame, see references/motion.md).
# TIMEOUT_MS (default 600000): full pieces take 2-3 min each under SwiftShader. Run renders one at a time.
# CHROME=/path/to/chrome overrides the browser lookup (scripts/chrome.mjs).
# Also writes <out>.html next to the PNG: a self-contained page that opens in any browser.
set -euo pipefail

SKETCH="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT="${2:-${SKETCH%.js}.png}"
SIZE="${3:-1200}"
HERE="$(cd "$(dirname "$0")" && pwd)"
VENDOR="$HERE/../assets/vendor"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$VENDOR/p5.min.js" "$VENDOR/p5.brush.js" "$WORK/"
cp "$SKETCH" "$WORK/sketch.js"
cat > "$WORK/index.html" <<HTML
<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#111}canvas{display:block}</style>
<script src="p5.min.js"></script><script src="p5.brush.js"></script>
</head><body><script src="sketch.js"></script></body></html>
HTML

if [ -n "${FRAMES:-}" ]; then
  node "$HERE/frames.mjs" "file://$WORK/index.html" "$2" "$FRAMES" "${3:-480}" || { echo "frames failed" >&2; exit 1; }
  exit 0
fi

node "$HERE/capture.mjs" "file://$WORK/index.html${QUERY:+?$QUERY}" "$OUT" "$SIZE" \
  || { echo "capture failed" >&2; exit 1; }

# Standalone HTML (libs from CDN) for sharing / opening in a browser.
{
  echo '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#111}canvas{display:block;max-width:100vw;height:auto}</style>'
  echo '<script src="https://cdn.jsdelivr.net/npm/p5@2.3.1/lib/p5.min.js"></script>'
  echo '<script src="https://cdn.jsdelivr.net/npm/p5.brush@2.2.3/dist/p5.brush.js"></script>'
  echo '</head><body><script>'
  cat "$SKETCH"
  echo '</script></body></html>'
} > "${OUT%.png}.html"

echo "PNG  -> $OUT"
echo "HTML -> ${OUT%.png}.html"
