# Techniques and recipes

Each pattern below appears in many sketches of the corpus. The numbers in parentheses count
the sketches that define the helper.

## Helpers worth always having
```js
function resetBrushState() {            // call between layers (resetBrushState/resetBrush: 29)
  brush.noStroke(); brush.noFill(); brush.noWash(); brush.noHatch(); brush.noMass(); brush.noField();
}
function washPoly(pts, col, a = 255, curv = 0) {   // flat marker or glaze polygon (washPoly/polyWash: 58)
  if (!pts || pts.length < 3) return;
  resetBrushState(); brush.wash(col, a);
  brush.beginShape(curv); for (const p of pts) brush.vertex(p[0], p[1]); brush.endShape(true);
  brush.fill("#000", 1); brush.rect(-60, -60, 4, 4); brush.noFill(); // commit: see SKILL.md "Paint order"
  resetBrushState();
}
function fillPoly(pts, col, a, bleed = 0.2, dir = "out", tex = 0.5, border = 0.3) { // watercolour
  resetBrushState(); brush.fill(col, a); brush.fillBleed(bleed, dir); brush.fillTexture(tex, border);
  brush.beginShape(0.3); for (const p of pts) brush.vertex(p[0], p[1]); brush.endShape(true);
  resetBrushState();
}
function hatchPoly(pts, name, col, w, dist, angle, opts = { rand: 0.08 }) {
  resetBrushState(); brush.hatchStyle(name, col, w); brush.hatch(dist, angle, opts);
  brush.polygon(pts); resetBrushState();
}
function safeSpline(pts, curv = 0.5) {   // drop near-duplicate points; splines with < 3 points break (40)
  const c = [pts[0]];
  for (const p of pts.slice(1)) if (dist(p[0], p[1], c.at(-1)[0], c.at(-1)[1]) > 0.6) c.push(p);
  if (c.length === 2) brush.line(c[0][0], c[0][1], c[1][0], c[1][1]);
  else if (c.length >= 3) brush.spline(c, curv);
}
function ellipsePts(cx, cy, rx, ry, n = 48, rot = 0) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 360, x = rx * cos(a), y = ry * sin(a);
    return [cx + x * cos(rot) - y * sin(rot), cy + x * sin(rot) + y * cos(rot)];
  });
}
const lerpPt = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
```

## Grounds
- **Paper**: background in a warm or cool off-white; a large `fill` rect at about 30 opacity
  with `fillTexture(0.55, 0.25)`; 2–3 big soft circles of a second paper tone; 40–80 faint
  `2H` lines at weight 0.2 with a slight random tilt for fibre.
- **Hard flat**: `background(c)` plus a full-canvas `wash(c, 255)`, then a soft vignette made
  of large low-opacity washes of a darker tone near the edges.
- **Toned / kraft / black lacquer**: put a mid-tone ground first and paint the lights *up*
  with opaque wash and white pencil (`cpencil` in white).

## Volume and light
- Define one `LIGHT = normalize3([-0.4, -0.55, 0.73])` and derive every shadow and highlight from it.
- **Sphere / bulb / fruit**: parametrise the surface with `projectBall(u, v)` (below). Use
  concentric washes that shrink and shift toward the light for the shading.
  ```js
  // u = longitude, v = latitude (radians); BALL = { cx, cy, r, tilt }. Orthographic view.
  function projectBall(u, v) {
    const x = cos(v) * sin(u), y = sin(v), z = cos(v) * cos(u);
    const yt = y * cos(BALL.tilt) - z * sin(BALL.tilt), zt = y * sin(BALL.tilt) + z * cos(BALL.tilt);
    return { x: BALL.cx + BALL.r * x, y: BALL.cy - BALL.r * yt, nx: x, ny: -yt, nz: zt, visible: zt > 0 };
  }
  ```
  Decoration on the surface (stripes, labels) is sampled in (u, v) and projected, so it wraps
  around the form correctly.
- **Shading by glazes**: stack 4–10 translucent washes (opacity 15–40), each one smaller and
  offset toward the shadow side. Do not use one gradient fill.
- **Cast shadow**: a dark wash ellipse squashed along the ground plane at about 60–120
  opacity, then a smaller, darker contact shadow under the touch point.
- **Reflection on gloss surfaces** (lanes, tables, water): redraw the object's key shapes
  flipped about the contact line at 20–35% opacity, plus a few streaks that follow the
  surface direction.

## Material recipes
- **Glass / liquid / lacquer**: base wash, then 2–3 colour glazes, then a hard-edged window
  reflection (white wash at about 200 inside a projected quad), a 1px white `rotring`
  hairline along the rim, and glints last.
- **Metal (chrome, steel)**: high-contrast bands that follow the form (dark, light, dark),
  sharp transitions, and a reflected environment in miniature. Brushed steel adds dense
  parallel `2H` lines at low opacity.
- **Fabric / silk**: fold ridges as bare paper or a pale wash, troughs as layered glazes plus
  `brush.mass("charcoal", …)` in the deepest folds.
- **Wood**: plank washes with per-board tone jitter (`noise(b * 0.7)`) and a custom
  `wood_grain` brush (weight 0.75, grain 11, opacity 42, noise 0.55) along the perspective lines.
- **Fur / feathers / hair**: hundreds of short `beginStroke`/`move` strokes or splines with
  tapered pressure `[0.06, 1, 0.04]`, directed by a field or by a hand-built angle function.
- **Water droplets / condensation**: a small dark-edged ellipse with a light-side white
  crescent, a dark core offset away from the light, and a tiny cast shadow (8 sketches define
  `drawWaterDroplet`).
- **Metal flake / terrazzo / stipple**: custom `spray` brush (weight about 8, scatter about
  3.5, opacity about 80), or loops of tiny circles with random palette picks.
- **Print looks (riso, screenprint, halftone)**: flat `wash` layers per ink at 180–230, a
  2–6 px offset between inks for misregistration, and a spray-grain overlay.

## Glints (always last)
A star made of 2–4 crisp lines with a `rotring` or a custom liner at weight about 1: one
horizontal and one vertical line of about 18 px, plus a shorter diagonal pair in a tinted
white. Put 3–6 of them on the brightest edges facing the light. Never put them in shadow.

## Text and labels
To get legible tiny text without fonts, draw the letterforms from short lines, or draw
the marks as dashes of uneven length so they read as text. Labels, logos and registration
marks are a large part of the "hyperreal up close" effect.

## Common bugs
- A fill, wash or hatch left on from a previous layer floods the next shape. Fix: `resetBrushState()`.
- Custom brushes look too thin because `scaleBrushes` was called after `brush.add`.
- `brush.arc` ignores fill, so use `beginShape` for filled sectors.
- `brush.clip` does not clip fills. Clip the polygon itself (e.g. `clipPolyHalfPlane`, used in 8 sketches).
- Very long sketches (more than 2,500 strokes with `fill`) render slowly. Use `wash` for big flat areas.
