// <TITLE> — motion-art painting
// Brief: <one-line summary of the brief>
// Colour hint: <hint>
// Rendered with p5.js 2.x + p5.brush in WEBGL, 1200x1200.
//
// Template subject: a lemon on a paper ground. Replace the scene, keep the structure.

// ---------- scene constants ----------
const W = 1200, H = 1200;
const SEED = 4211;
const CX = 600, CY = 640;          // focal centre
const RX = 300, RY = 230;          // object radii
const Y_TABLE = CY + RY - 6;        // contact line (bottom of the object)
const LIGHT = normalize3([-0.45, -0.6, 0.66]);  // upper-left key light

const PAL = {
  paper: "#f1ebdd", paperWarm: "#e8dcc2", grain: "#d9cfbb",
  shadow: "#5b5368", contact: "#2e2838",
  base: "#f2c230", mid: "#d99a1c", deep: "#9a5a12", rim: "#6e4210",
  light: "#fff3b0", white: "#ffffff", ink: "#3a2b1a",
};

// ---------- helpers ----------
function normalize3(v) { const m = Math.hypot(...v) || 1; return v.map((x) => x / m); }
function resetBrushState() {
  brush.noStroke(); brush.noFill(); brush.noWash(); brush.noHatch(); brush.noMass(); brush.noField();
}
function ellipsePts(cx, cy, rx, ry, n = 56, rot = 0) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 360, x = rx * cos(a), y = ry * sin(a);
    return [cx + x * cos(rot) - y * sin(rot), cy + x * sin(rot) + y * cos(rot)];
  });
}
// washPoly and fillPoly clear ALL brush state (stroke too): call brush.set(...) again after them.
function washPoly(pts, col, a = 255, curv = 0) {
  if (!pts || pts.length < 3) return;
  resetBrushState(); brush.wash(col, a);
  brush.beginShape(curv); for (const p of pts) brush.vertex(p[0], p[1]); brush.endShape(true);
  brush.fill("#000", 1); brush.rect(-60, -60, 4, 4); brush.noFill(); // commit: see SKILL.md "Paint order"
  resetBrushState();
}
function fillPoly(pts, col, a, bleed = 0.2, dir = "out", tex = 0.5, border = 0.3) {
  resetBrushState(); brush.fill(col, a); brush.fillBleed(bleed, dir); brush.fillTexture(tex, border);
  brush.beginShape(0.3); for (const p of pts) brush.vertex(p[0], p[1]); brush.endShape(true);
  resetBrushState();
}
function safeSpline(pts, curv = 0.5) {
  const c = [pts[0]];
  for (const p of pts.slice(1)) if (dist(p[0], p[1], c.at(-1)[0], c.at(-1)[1]) > 0.6) c.push(p);
  if (c.length === 2) brush.line(c[0][0], c[0][1], c[1][0], c[1][1]);
  else if (c.length >= 3) brush.spline(c, curv);
}

// ---------- setup ----------
async function setup() {
  createCanvas(W, H, WEBGL);
  brush.scaleBrushes(3);           // before brush.add
  angleMode(DEGREES);
  randomSeed(SEED);
  noiseSeed(SEED);

  brush.add("soft_glaze", {
    type: "default", weight: 14, scatter: 1.1, sharpness: 0.08, grain: 3,
    opacity: 20, spacing: 0.22, pressure: [0.25, 1, 0.25], noise: 0.15,
  });
  brush.add("liner", {
    type: "default", weight: 1.4, scatter: 0.012, sharpness: 0.94, grain: 1,
    opacity: 235, spacing: 0.07, pressure: [0.06, 1, 0.04], noise: 0.03,
  });
  brush.add("pore_spray", {
    type: "spray", weight: 6, scatter: 3.2, opacity: 70, spacing: 0.3, pressure: [0.5, 1.1, 0.5],
  });
}

// ---------- draw: layers back to front ----------
function draw() {
  translate(-width / 2, -height / 2);
  background(PAL.paper);

  drawGround();        // 1. paper ground
  drawCastShadow();    // 2. cast + contact shadow
  drawBaseMass();      // 3. flat base of the object
  drawModelling();     // 4. glazes toward shadow side
  drawSurfaceDetail(); // 5. texture / pattern / tradition layer
  drawLineWork();      // 6. pencil and pen edges
  drawSpeculars();     // 7. highlights + glints, always last

  noLoop();
}

// ===== 1. GROUND =====
function drawGround() {
  fillPoly([[0, 0], [W, 0], [W, H], [0, H]], PAL.paperWarm, 30, 0.3, "out", 0.55, 0.25);
  resetBrushState();
  brush.set("2H", PAL.grain, 0.22);
  for (let i = 0; i < 30; i++) {
    const y = random(20, H - 20);
    brush.line(random(10, 200), y, random(W - 200, W - 10), y + random(-2, 2));
  }
}

// ===== 2. SHADOW =====
function drawCastShadow() {
  // Shadow falls away from LIGHT along the table plane.
  const dx = -LIGHT[0] * 140, sx = CX + dx;
  washPoly(ellipsePts(sx, Y_TABLE, RX * 1.05, 46), PAL.shadow, 70, 0.4);
  washPoly(ellipsePts(CX + dx * 0.3, Y_TABLE, RX * 0.7, 22), PAL.contact, 110, 0.4);
}

// ===== 3. BASE MASS =====
function drawBaseMass() {
  const body = ellipsePts(CX, CY, RX, RY, 64, -8);
  // Opaque base as wash. Do NOT put a brush.fill over a wash in the same frame: the fill
  // composites against what was under the wash, so the background shows through.
  washPoly(body, PAL.base, 255, 0.5);
}

// ===== 4. MODELLING GLAZES =====
function drawModelling() {
  // Successive smaller glazes pushed away from the light.
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const ox = -LIGHT[0] * 90 * t, oy = -LIGHT[1] * 70 * t;
    const col = t < 0.5 ? PAL.mid : PAL.deep;
    washPoly(ellipsePts(CX + ox, CY + oy, RX * (1 - 0.35 * t), RY * (1 - 0.3 * t), 56, -8), col, 22, 0.5);
  }
}

// ===== 5. SURFACE DETAIL =====
function drawSurfaceDetail() {
  resetBrushState();
  // Peel pores: short spray dabs, denser and darker on the shadow side.
  for (let i = 0; i < 420; i++) {
    const a = random(360), r = sqrt(random()) * 0.93;
    const x = CX + RX * r * cos(a), y = CY + RY * r * sin(a);
    const shade = (cos(a) * -LIGHT[0] + sin(a) * -LIGHT[1]) * r;   // > 0 = away from light
    brush.set("pore_spray", shade > 0.2 ? PAL.deep : PAL.mid, 1.2);
    brush.line(x, y, x + random(2, 5), y + random(-1, 2));
  }
}

// ===== 6. LINE WORK =====
function drawLineWork() {
  resetBrushState();
  const rim = ellipsePts(CX, CY, RX, RY, 64, -8);
  brush.set("2B", PAL.rim, 0.9);
  safeSpline([...rim.slice(8, 40)], 0.6);          // shadow-side edge, heavier
  brush.set("HB", PAL.ink, 0.5);
  safeSpline([...rim.slice(40), ...rim.slice(0, 9)], 0.6);
  // nub
  brush.set("liner", PAL.rim, 1.1);
  safeSpline([[CX + RX - 6, CY - 18], [CX + RX + 26, CY - 24], [CX + RX + 34, CY - 14]], 0.5);
}

// ===== 7. SPECULARS =====
function drawSpeculars() {
  const hx = CX + LIGHT[0] * RX * 0.5, hy = CY + LIGHT[1] * RY * 0.55;
  washPoly(ellipsePts(hx, hy, 70, 34, 32, -20), PAL.light, 150, 0.5);
  washPoly(ellipsePts(hx - 6, hy - 4, 30, 12, 24, -20), PAL.white, 220, 0.5);
  resetBrushState();
  for (const [gx, gy] of [[hx - 30, hy - 8], [hx + 26, hy + 4]]) {
    brush.set("liner", PAL.white, 0.9);
    brush.line(gx - 9, gy, gx + 9, gy);
    brush.line(gx, gy - 9, gx, gy + 9);
  }
}
