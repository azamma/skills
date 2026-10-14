# p5.brush 2.2.x: the API this style uses

This reference covers the p5 build only (`p5.brush.js`), with p5.js 2.x and a WEBGL canvas.
Coordinates are in pixels after `translate(-width/2, -height/2)`. Angles follow `angleMode()`.
The corpus uses `angleMode(DEGREES)` almost everywhere.

## Setup
```js
async function setup() {
  createCanvas(1200, 1200, WEBGL);
  brush.scaleBrushes(3);          // 533/534 sketches use 3; it scales only brushes that exist now
  angleMode(DEGREES);
  randomSeed(SEED); noiseSeed(SEED);
  brush.add("name", {...});       // custom brushes AFTER scaleBrushes
}
function draw() { translate(-width/2, -height/2); background(PAL.ground); /* layers */ noLoop(); }
```

## State (sticky until turned off)
| Call | Effect |
|---|---|
| `brush.set(name, color, weight)` | Stroke brush. Turns stroke mode on. |
| `brush.stroke(c)` / `brush.strokeWeight(w)` / `brush.pick(name)` / `brush.noStroke()` | Change or disable the stroke. |
| `brush.fill(color, opacity)` / `brush.noFill()` | Watercolour fill. Slow, textured, bleeds. |
| `brush.fillBleed(strength 0–1, "out"\|"in", angle?)` | Edge diffusion. Corpus: `"out"` 0.18–0.35 for blooms, `"in"` 0.08–0.18 for tight shapes. |
| `brush.fillTexture(texture 0–1, border 0–1, scatter=true)` | Paper texture and edge darkening. Corpus: around `(0.45–0.55, 0.2–0.35)`. |
| `brush.wash(color, opacity)` / `brush.noWash()` | Fast flat fill with no bleed. Use it for marker, flat grounds and glazes. |
| `brush.hatch(dist, angle, {rand, continuous, gradient})` / `brush.noHatch()` | Hatch inside shapes. |
| `brush.hatchStyle(name, color, weight)` | Brush used for the hatch lines. |
| `brush.mass(name, color, {precision, strength, gradient, outline})` / `brush.noMass()` | Layered hand massing for charcoal or pastel darks. |
| `brush.field(name)` / `brush.noField()` / `brush.wiggle(n)` | Vector field that bends strokes. Built-in fields: `hand curved zigzag waves seabed spiral columns`. |
| `brush.addField(name, (t, field) => { field[col][row] = deg; return field; })` | Custom flow field. |
| `brush.clip([x1,y1,x2,y2])` / `brush.noClip()` | **Does nothing in the bundled 2.2.3** (`t.clip=function(t){return Q(),t}`). Keep marks inside a region by computing their end points, not by clipping. |

## Timing and paint order
The flush timing, the per-frame order (fills, washes, strokes), the wash commit and the
pigment mixing of strokes live in SKILL.md under **Paint order**. Read them before coding.

## Primitives
- `brush.line(x1,y1,x2,y2)` · `brush.flowLine(x,y,len,dir)` (follows the field)
- `brush.spline([[x,y,pressure?],...], curvature 0–1)`. Needs at least 3 distinct points to curve.
- `brush.beginStroke("curve"|"segments", x, y)` → `brush.move(angle, len, pressure)` … → `brush.endStroke(angle, pressure)`. Use it for gestural strokes such as comma strokes, pinstripes and hair.
- `brush.rect(x,y,w,h,"corner"|"center")` · `brush.circle(x,y,r, irregularity?)` · `brush.arc(x,y,r,a0,a1)` (stroke only)
- `brush.beginShape(curvature)` → `brush.vertex(x,y,pressure?)` … → `brush.endShape(true)` (true closes the shape)
- `brush.polygon([[x,y],...])`. Ignores vector fields. Returns a `brush.Polygon` that you can `.hatch()` or `.mass()` later.
- `brush.hatchArray(polys)` / `brush.massArray(polys)` apply one gesture across several polygons. Polygons inside the first one become holes (even-odd).

## Built-in brushes
`2H` (hard, faint), `HB`, `2B` (soft graphite), `cpencil` (coloured pencil), `pen`,
`rotring` (technical pen, crisp), `spray`, `marker`, `marker2`, `charcoal`, `pastel`, `hatch_brush`.

## brush.add parameters (ranges from 1,658 custom brushes in the corpus)
| param | p10 | median | p90 | notes |
|---|---|---|---|---|
| `type` | | `default` 67%, `marker` 13%, `spray` 12%, `custom` 7% | | |
| `weight` | 0.32 | 1.35 | 10 | canvas units |
| `scatter` | 0.015 | 0.08 | 1.8 | sideways wobble |
| `sharpness` | 0.15 | 0.82 | 0.95 | default type only |
| `grain` | 0.14 | 1 | 18 | higher gives a smoother line |
| `opacity` | 28 | 165 | 242 | 0–255 |
| `spacing` | 0.1 | 0.18 | 0.5 | stamp gap. Lower is denser. |
| `noise` | 0.08 | 0.25 | 0.75 | per-stroke opacity jitter |
| `pressure` | | `[0.2, 1, 0.2]` style | | `[start, mid, end]` or `t => v` |
| `rotate` | | | | `"none"` · `"natural"` · `"random"` |
| `markerTip` | | | | `false` removes end blobs from marker, custom and image types |

Archetypes:
- glaze or airbrush: weight 8–16, sharpness 0.07–0.15, opacity 18–30, spacing 0.2, pressure [0.25,1,0.25]
- crisp liner or pinstripe: weight 1–2.5, scatter 0.01, sharpness 0.9+, opacity 230+, spacing 0.07, pressure [0.05,1,0.04]
- grain or fibre: weight 0.5–1, grain 10+, opacity 40, noise 0.5
- flake or stipple spray: `type:"spray"`, weight 6–9, scatter 3–4, opacity 80

`type:"image"` returns a Promise: `await` it in an `async setup()`. The corpus never uses it,
so stay with procedural brushes.
