---
name: motion-art
description: "Motion art in code (p5.js 2.x + p5.brush): hand-painted-looking pictures, still or moving, of one everyday hero object rendered hyperreal inside a named art tradition. Use for a painting from a brief + colour hint, a p5.brush painting, or a MOTION: line (a 2 s animated clip)."
---

<!-- argument-hint: [subject, full brief, or MOTION: line] [colour hint] -->

# Motion Art

Studied from the "Argon Paintings" gallery: 534 paintings and 26 moving ones. Each is one `sketch.js` (median
1,360 lines) built from a ~90-word **brief** and a **colour hint**. The look comes from a
method, not one algorithm: one ordinary object, observed obsessively, painted inside an
unexpected tradition, in layers of simulated natural media.

## Workflow

1. **Brief.** With only a subject or only a MOTION line, write the brief with
   [references/brief-grammar.md](references/brief-grammar.md); a MOTION line's nouns give
   the scene. With a human in the loop, show the brief and wait. Running on your own, put it
   in the sketch header and continue. Done when it names all seven parts of brief-grammar's Shape.
2. **Colour hint.** Take the user's, or pick one of the 8 below. The hint shifts the whole key
   and keeps the brief's named colours.
3. **Look.** Read [references/visual-signature.md](references/visual-signature.md) and open
   the 2–3 images in `assets/refs/` closest to the subject. The method alone gives flat,
   vector-looking results; the references set the mark density. When `assets/refs/` holds only
   its README, work from visual-signature.md's rules. Done when the plan names, for each
   reference, what you take from it.
4. **Plan.** At the top of the sketch, write a comment with the scene constants (horizon,
   focal centre, light direction, vanishing point), the `PAL` object and the numbered layer
   list for `draw()` (6–10 layers, back to front).
5. **Code.** Start from [assets/sketch-template.js](assets/sketch-template.js). Follow the
   code conventions below, the API in [references/p5brush-api.md](references/p5brush-api.md)
   and the recipes in [references/techniques.md](references/techniques.md).
6. **Render and critique.** `scripts/render.sh <sketch.js> <out.png>` (a test takes ~15 s, a
   full piece 2–3 min; render one at a time). It also writes `<out>.html` with CDN libraries.
   Read the PNG next to a reference, run the self-critique in visual-signature.md, fix, render
   again. Done after at least two fix passes, when every self-critique item passes or is listed
   as a known weakness in the report.
7. **Motion** (only if something must move). Finish the still first, then follow
   [references/motion.md](references/motion.md): a 2 s clip where every verb of the MOTION
   line gets a layer and the scene reacts (light, shadow, reflections, background). Done when
   the report carries the frame-diff numbers of motion.md section 6.
8. **Report.** Brief, colour hint, file paths, the numbers from step 7, and the known weaknesses.

## The style in rules

**Subject and composition**
- One hero object or a tight group that fills the frame or is cropped off the edges. The
  canvas is always square, 1200x1200.
- A deliberate viewpoint: low three-quarter, straight top-down, extreme crop, profile,
  frontal band. Name it in the brief and build it from explicit geometry constants.
- Real space math: vanishing points, sphere projection (`projectBall`), cast shadows from one
  `LIGHT` vector.

**The core tension: hyperreal against tradition**
- The object is hyperreal: scuffs, condensation, legible labels, specular glints, single
  fibres. About half the briefs use that word.
- The rendering language comes from a named tradition or print/craft process: Memphis
  laminate, Petrykivka comma strokes, Guna mola appliqué, riso two-drum overprint, thermal
  camera, motion-study plates, outsider art on kraft card, anime backgrounds, botanical
  plates, blueprints. The surprise is the clash.
- Realism lives in a few **hotspots**: a reflection, a meniscus, a glint. The rest stays loose.

**Media and their brushes** (share of briefs naming each)
- watercolour (41%): `brush.fill` + `fillBleed` + `fillTexture`, glazes stacked at low opacity.
- pencil (32%): `2H`, `HB`, `2B`, `cpencil` lines, hatching, construction lines.
- ink and fine pen (27%): `rotring`, `pen` for crisp edges and caustics.
- marker (24%): flat `wash` fills at high opacity, streak lines with `marker`.
- charcoal (16%): `charcoal` strokes, `brush.mass` for velvety darks.
- spray and airbrush (15%): `spray` and custom spray brushes for gradients, flake, stipple.

Most sketches add 3–8 custom brushes with `brush.add`, with evocative names (`mack_striper`,
`flake_spray`, `wood_grain`, `soft_glaze`).

**Ground.** A hard flat ground (`background()` plus a full-canvas `wash`), or a paper ground
(toned `fill` with texture, faint `2H` grain lines). Bare paper serves as the highlight
("leave paper bare where the sheen catches").

**Layer order** (median of 7 numbered steps in `draw()`)
1. Ground or background, atmosphere
2. Environment or surface (table, lane, wall), in perspective
3. Cast shadow and reflections on the surface
4. Base masses of the object (flat or soft washes)
5. Modelling glazes (shadow and turning edges, translucent layers)
6. Pattern or tradition layer (stripes, motifs, stitches, halftone)
7. Fine line work (pen, pencil edges, fibres, text)
8. Speculars, glints, final accents: last, white or near-white, crisp

## Code conventions

- `createCanvas(1200, 1200, WEBGL)`; `translate(-width/2, -height/2)` as the first line of `draw()`.
- `brush.scaleBrushes(3)` before `brush.add(...)`.
- One seed for the whole piece: `randomSeed(N); noiseSeed(N);`. Stills end `draw()` with
  `noLoop()`; moving pieces use the scaffold in motion.md.
- Build lookup tables that use p5 math (`cos`, `asin`, `random`) inside `setup()`; p5 globals
  exist only once the sketch starts.
- Geometry in named constants (`CX`, `CY`, `R`, `Y_HORIZON`, `LIGHT`), colours in `PAL`.
- One function per layer, `drawXxx()`, each under a `// ===== N. TITLE =====` banner.
- Start each layer from a clean brush state (`resetBrushState()`): a `fill`, `hatch` or
  `wash` left on bleeds into the next shape, the most common bug. `washPoly` and `fillPoly`
  clear the stroke too, so call `brush.set(...)` again after them.
- Route short polylines through `safeSpline`: `brush.spline` needs 3 distinct points.

**Paint order** (p5.brush 2.2.3, all reproduced)
- Brush output reaches the canvas when `draw()` returns. Read pixels (`get()`, `pixels[]`)
  on the next frame.
- Per frame: watercolour `fill`s first, `wash`es after, strokes last. A fill drawn over a
  same-frame wash shows the pre-wash ground through it. For opaque bodies, use wash plus wash glazes.
- Commit every `wash` with an invisible off-canvas fill; `washPoly` does it. Without the
  commit, any frame after the first drops a wash that a stroke follows.
- Strokes mix with the paint under them like pigment: light over dark goes grey. Build light
  opaque marks over dark (lettering on a drop shadow, highlights on a dark mass) from
  `brush.wash` polygons at 255.

## Colour hints

`muted earth tones`, `monochrome with one accent`, `cool palette`, `warm palette`,
`high contrast values`, `soft pastels`, `vivid and saturated`, `dusky twilight tones`.
Roughly evenly used. Even "candy-apple burgundy" under `cool palette` gets cool-shifted
surroundings, highlights and shadows.

## Other files

- `assets/refs/`: 6 full-size reference paintings plus 2 contact sheets of 64 thumbnails.
- `assets/vendor/`: p5 2.3.1 (LGPL-2.1) and p5.brush 2.2.3 (MIT); `render.sh` uses them offline and its
  standalone HTML loads the same versions from a CDN.
- `scripts/`: `render.sh` (PNG, one motion frame with `QUERY="frame=N"`, or all frames with
  `FRAMES=N`), backed by `capture.mjs` and `frames.mjs`.
