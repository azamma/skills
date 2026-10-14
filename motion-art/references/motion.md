# Moving paintings

Studied from the gallery's 26 moving paintings. Each is a finished still plus a
motion layer: **a one-shot clip of 2 s at 24 fps (48 frames), rendered offline to video**.
Frame 0 is the still. An impact starts the motion at about frame 2, and the scene settles by
frame 48. The clip simply repeats. Make a seamless loop only when the brief asks for
continuous motion (wind, breathing, tides).

Offline rendering means per-frame cost does not matter. Each frame combines two techniques:
1. **Move pixels** of the painted still (sprites, lifted regions, strip warps).
2. **Repaint the animated layers with p5.brush**, on top of the stamped still: the moving
   object's outlines and glints, and the scene's reactions to it.

Moving pixels alone reads as a cut-out puppet. The repainted reactions make the reels feel alive.

## 1. Whole-scene reaction

Write `// MOTION: <one sentence>` above the motion code. It is the motion brief.

- **Map every verb in the MOTION line to a layer.** Then add **at least three reactions the
  sentence does not name**: light (flash, glow, flicker, caustics), shadow (follows,
  stretches, softens), background (shimmer, steam, snow, dust, crumbs, sparks, wind
  streaks), reflections and glints, body squash and tilt. Reel layer names show the range:
  `drawNeonAndCounterSurge`, `drawHotOilAndWallShimmer`, `drawMultiLayerSnowfall`,
  `drawWaterCausticFlaresAndGlints`, `drawMorningSteam`, `drawFlyingCrumbs`,
  `renderExhaustHeatPlumes`, `drawBlinkingCrossingLightsAndGlow`.
- **Drive everything from one physical event.** An impact at t ≈ 0.04 s with a damped
  oscillation `A·exp(-k·t)·sin(ω·t)` (k ≈ 2–3, ω ≈ 400–650°/s), a second shudder near 1.1 s
  when a second action ends, then settling. Every secondary layer reads the same bump values
  (`dx, dy, rot`), so the scene moves as one system.
- **Overlap the actions** inside the 2 s. The gumball reel runs bump, eye whip, blink, knob
  turn and drop within the first second, and settles in the second.
- **Hold brush grain steady:** call `randomSeed(5000 + i·73)` before repainting element i, in
  every frame.
- **Repaint in the still's style:** the same `PAL` constants, brushes and outline weights.

Worked example, the gumball reel (`The bumped gumball globe churns as all eyeballs snap and
blink at the viewer, the coin knob turns, and an eyeball drops out the chute`). Each frame repaints:
- **Light:** a neon surge across the backdrop and counter, as translucent `wash` polygons with
  opacity `surge = sin(min(t/0.16,1)·90°)·(0.78+0.22·sin(t·420))`, plus specular streaks
  that slide with the bump.
- **Reflection and shadow:** the red pool under the machine widens and ripples with the
  rocking body, and the cast shadow follows it.
- **The whole object:** the globe contents rotate and bounce as one lifted disc, the body
  tilts, the rim highlights shift, the pinstripes flex.
- **The named actions:** the eyes whip, snap to the viewer and blink (eyelids in the gumball
  colours), the knob turns, one eyeball drops and settles.

## 2. Frame order and scaffold

**p5.brush flushes to the canvas when `draw()` returns** (its `postdraw` hook). Two consequences:
- Take a snapshot one frame after you paint. A `get()` in the painting frame returns the
  canvas as it was before that frame's brush calls.
- Inside one frame, brush strokes land on top of everything plain p5 drew (`image`, sprites,
  quads), whatever the call order. So order each frame as: stamp the still, move pixel layers,
  paint brush layers. Fills before washes, and commit each wash (SKILL.md, Paint order).

```js
const FPS = 24, LOOP_SECONDS = 2;
// Motion frame to render: window.__mf (set by frames.mjs), else ?frame=N / window.FRAME, else free-running.
const FRAME = (() => { const q = new URLSearchParams(location.search).get("frame");
  return q !== null ? +q : (typeof window.FRAME === "number" ? window.FRAME : null); })();

async function __origSetup() { /* createCanvas(1200,1200,WEBGL), pixelDensity(1), brushes, seeds */ }
function __origDraw() { /* translate(-w/2,-h/2); all layers of the still; no noLoop() */ }

let __still;
async function setup() { await __origSetup(); }
function draw() {
  if (frameCount === 1) { __origDraw(); return; }                // paint; brush flushes after draw()
  if (frameCount === 2) {
    __still = get();                                             // the painting is on the canvas now
    if (typeof motionSetup === "function") motionSetup(__still);
    if (FRAME === 0) { noLoop(); window.__done = true; }
    return;
  }
  const n = window.__mf ?? FRAME ?? frameCount - 2;              // motion frame index
  const t = (n / FPS) % LOOP_SECONDS;                            // seconds
  push(); resetMatrix(); image(__still, -width / 2, -height / 2, width, height); pop();
  push(); translate(-width / 2, -height / 2); motionDraw(t, __still); pop();
  if (FRAME !== null) noLoop();                                  // single deterministic frame
  window.__done = true;                                          // tells render.sh / frames.mjs it is ready
}
```

When the still takes several painting frames (one per layer or element, see section 3), the
finished canvas is a stack of snapshots. Render frame 0 through `motionDraw(0)` so the still
and the clip share one code path, and make `motionDraw(0)` equal the painted pose.

## 3. motionSetup(still): cut the moving parts out once

Call `pixelDensity(1)` in setup whenever you read `pixels[]`; the index math assumes density 1.
Make each moving box enclose every pixel of its layer, thin tips included, or the outside part
stays frozen as a fringe.

- **Two-pass difference** (the default for layers painted last: flowers, flags, steam). Paint
  the scene without the moving layers (CLEAN) on frame 1, snapshot it on frame 2, paint the
  moving layers on frame 2, snapshot STILL on frame 3. Re-seed before each pass. Sprite alpha
  = |STILL − CLEAN| per pixel, thresholded and feathered. No silhouettes, no inpainting.
- **Per-element sprites** (each flower with its own phase): paint one element per frame, back
  to front, each with its own seed. Track the min/max of every vertex you pass to the brush.
  At the start of the next frame, diff the new snapshot against the previous one inside that
  box: alpha 0 at diff ≤ 2, 255 at diff ≥ 8. 16 flowers take 17 painting frames.
- **Translucent layers** (foam, shadows, glazes): unmix against the layer's known colour,
  `alpha = |after − before| / |layerColour − before|`, per channel, clamped to 0–1. A plain
  threshold makes them opaque.
- **Hand-cut sprites:** copy each part into a `createGraphics` buffer clipped to its silhouette
  polygon (reuse the painting code's coordinates). Build the clean plate behind it by
  stretching nearby background rows across the hole (`drawImage(src, sx, y, 12, 2, dx, y, dw, 2)`,
  cross-faded with `globalAlpha`).

## 4. motionDraw(t, still): move pixels, then repaint

- **Strip-spine warp** (cloth, flowers, hair, flags): slice the sprite into strips about 5 px
  wide and 4 segments tall. Displace each segment by `disp(x, v, t)`, where v runs 0 at the
  anchor to 1 at the free end. Draw with `translate(p1); rotate(atan2(-dX, dY))` and 0.6 px overlap.
- **Rigid parts:** `translate` and `rotate` around a pivot (a head on its stem tip, a lever on its hinge).
- **Drift:** shift horizontal slices sideways at a speed per row (clouds, water).
- **Light:** `tint()` for flicker and glints; reset it to 255 after use.
- **Re-stamp occluders** from `still` after the moving layers (a jug lip in front of stems).
- **Envelope:** `env = smoothstep(t / 0.36)` makes frame 0 identical to the still.
- **Compositing:** for thousands of strips, draw into one `createGraphics` 2D buffer with
  `ctx.drawImage`, then `image(buffer, …)` once per frame. Round row offsets when motion is
  slow; sub-pixel offsets soften the sprite.

## 5. Special cases

**Reveal: wipe, clean, dry, melt.** A wiper, a cloth or a drying patch shows the **same scene,
sharper**. Paint a clear plate in motionSetup: the still's backdrop layers with the same
seeds and paper tone, minus the mist, drops or grime. Each frame, clip to the union of
everything revealed so far (for a wiper, the fan up to the largest angle reached) and draw
the clear plate inside it. Add at most a 6% glaze for wet-glass contrast. Brightness stays
continuous across the edge, so the reveal reads as clarity, not as a dark shape. (Gallery
windshield reel: `paintClearBackdrop(); clearSceneImg = get();`, then a clipped fan plus
`rgba(34,43,54,0.065)`.)

**Liquid sheets (swash, spills, tides).** Paint the water once as a plate, and a wet-ground
plate under it. Each frame, reveal the plate per 3 px column down to a lobed front (a sum of
sines across x, with a small time lag per column). Slide the texture with the mean front.
Wet ground fades as `exp(-age/τ)`, τ ≈ 4–5 s, with age = time since the front uncovered that
row. Leave a fading residue line at each column's peak. Carried objects move by
`m × (how far the front has passed them)`, m by weight (ball ≈ 0.6, bucket ≈ 0.07).

**Continuous loops (wind, breathing).** Make every displacement periodic in the loop length
T: `sin(TAU·(t/T)·k + phase)` with integer k. Use `sway(t) = f(t) − f(0)` so frame 0 equals
the still, and normalise f so `amp` is the peak in pixels. Give each element its own phase and
k (1 or 2), add a third harmonic and a gust front whose phase follows x. Amplitudes: 2–8 px
at the free end, 1–4° of head rotation.

## 6. Verify and deliver

The step is done when the report states these numbers:
- frame 0 against the still: pixels changed by more than 12 (expect about 0);
- for 2–3 motion frames against frame 0: pixels changed inside and outside the moving
  regions (outside ≈ 0; a fringe means a box missed a tip);
- for a loop, the last frame against frame 0.

Repainting is not bit-exact between runs (up to about 5 on a few dozen pixels), so count
changes above 12. `uv run --with pillow --with numpy python check.py` diffs without installs.

```bash
QUERY="frame=12" render.sh sketch.js f12.png     # one motion frame, full size
FRAMES=48 render.sh sketch.js frames/            # motion frames 1..48 from one page load
```
`FRAMES` sets `window.__mf` per frame and awaits p5's async `redraw()`, so file `fNNNN.png`
is motion frame NNNN. Encode the clip without a system ffmpeg:
`uv run --with imageio --with imageio-ffmpeg python -c '…iio.imwrite("clip.mp4", frames, fps=24, codec="libx264", quality=8)'`.
Judge smoothness in a real browser; headless SwiftShader is far too slow to tell.
