/**
 * Supersampled rendering — the implementation behind the `supersample` option of
 * `renderScene` and of `render --supersample`.
 *
 * WHY THIS IS A MODULE
 * --------------------
 * A wire drawn straight to the delivered resolution came out as a gear-toothed
 * band, a small ink circle came out as a polygon, and connector lines as
 * polylines. The workaround — in the project script that hit it — was a
 * hand-rolled `board(w, h, 3)` that drew into a 3x canvas and averaged it down.
 * Draw-at-3x-and-reduce is not a script's private trick; it is an engine
 * capability, so it lives here where every scene can reach it, and so it can be
 * tested directly rather than through one script's output.
 *
 * WHAT IT BUYS ON THIS RASTERISER, MEASURED
 * -----------------------------------------
 * The backend is Skia, whose path rasteriser already computes near-exact area
 * coverage for a straight edge at 1x. So the gain is NOT "more antialiased
 * pixels", and a test that asserted "fewer blend pixels" would be asserting
 * something false here. Measured on a 79.5px circle at fractional coordinates:
 *
 *   blend pixels (partial ink)                    285 -> 300
 *   a 3px line at exactly 45 degrees              324 -> 646
 *
 * The 45-degree line is the extreme case and it is worth stating: its edges run
 * along pixel diagonals, which 1x resolves EXACTLY, and which the averaged 3x
 * version cannot. Supersampling is not a free improvement on every edge.
 *
 * What it does buy is where the edge LANDS. For the same circle, against the
 * exact analytic area the circle covers in each pixel (computed from the circle,
 * not from a rasteriser):
 *
 *   worst pixel's coverage error      89/255 (35%)  ->  19/255 (7.6%)
 *   mean coverage error               0.211/255     ->  0.041/255
 *   pixels off by >10% of a pixel     159            ->  0
 *
 * Those 159 pixels are the ones that make a circle read as a polygon, and they
 * are what a curve in a design is judged on. The curve-flattening tolerance the
 * rasteriser works to is in DEVICE pixels, so drawing at 3x makes it three times
 * finer relative to the artwork — which is the whole mechanism, stated plainly.
 *
 * THE THREE RULES
 * ---------------
 * 1. LENGTHS. The scene is copied and every ABSOLUTE length in it is multiplied
 *    by the factor, so the larger canvas draws the same picture with finer
 *    sampling. Fractional lengths need no multiplication — they are resolved
 *    against the canvas, which is already the larger one — so the rule is exactly
 *    the inverse of `resolveLength`: a value in `0..1` is a fraction and is left
 *    alone, anything else (including a NEGATIVE offset, which `resolveLength`
 *    documents as pixels) is multiplied.
 *
 *    This is deliberately NOT `scaleScene` from `src/scale.mjs`, which solves a
 *    different problem and would be wrong here for four separate reasons:
 *
 *      * it scales values `> 1` only, which is right for a draft (a 1px hairline
 *        stays 1px) and wrong for this (a 1px hairline must become 3 device px,
 *        or the delivered line is a third of its declared width);
 *      * it treats a negative coordinate as a fraction and leaves it unscaled,
 *        which is the one case `resolveLength` calls out as a found defect;
 *      * it misses keys the renderer really resolves — `originX`/`originY`,
 *        bezier control points `c1`/`c2`, `dash`, a halftone `cell`, a
 *        text-on-path `{cx, cy, r}` — and it would scale `font.width`, which is a
 *        font variation axis and not a length at all;
 *      * it mutates the scene it is given. `renderScene` does not own the caller's
 *        scene, and a scene left at 3x its declared size would disagree with the
 *        `report.canvas` that says what was delivered.
 *
 * 2. DOWNSAMPLE. A real box average over each factor x factor block, weighted by
 *    alpha. See `downsampleRGBA` for why the weighting is not optional.
 *
 * 3. CAPTURE. `captureLayers` is honoured, and the captured layers are reduced to
 *    the delivered size. See `captureLayer` in `src/render.mjs` for that decision.
 *
 * WHAT IS NOT CARRIED ACROSS, AND WHY THAT IS THE HONEST ANSWER
 * -------------------------------------------------------------
 * Two things are generated in device pixels and therefore differ at 3x in a way
 * no multiplication fixes:
 *
 *   * GRAIN is noise at device resolution, averaged down with everything else, so
 *     at 3x it is finer and lower in amplitude. Multiplying its `amount` would
 *     change how much noise there is; the honest statement is that film grain at
 *     3x is grain at three times the frequency, which is closer to what film does.
 *   * A HALFTONE dot screen keeps its declared cell size in delivered pixels (the
 *     cell is multiplied, so the delivered frequency is unchanged) but its dots
 *     are resolved three times as finely, which makes the dot edges rounder — a
 *     gain, not a difference to correct.
 *
 * `radius` is the one key that means two things in this vocabulary: a corner
 * radius on a shape, resolved as a FRACTION when it is `0..1`, and a blur radius
 * on a filter, which is always pixels. It follows the fraction rule, so a FILTER
 * with an explicit radius of 1 or less is not multiplied. At that size the blur
 * is under one device pixel and is a no-op at any factor, so the boundary is
 * stated rather than worked around.
 *
 * WHAT IT COSTS
 * -------------
 * Memory, and quadratically in the factor, because every buffer in this renderer is
 * full-canvas: the composite, the layer being drawn, and a scratch buffer per mask or
 * effect. For a 2420x1336 document (the storyboard fixture) one full-canvas buffer is
 *
 *   1x    13 MB      2420x1336
 *   2x    52 MB      4840x2672
 *   3x   116 MB      7260x4008
 *   4x   207 MB      9680x5344
 *
 * and several are alive at once, so a 3x render of that document peaks in the
 * hundreds of MB. `renderScene` prints that arithmetic when an allocation fails and
 * REFUSES the render; it does not fall back to 1x, because a supersample request
 * that quietly does nothing is the silent failure this codebase keeps paying for.
 * `SUPERSAMPLE_LIMIT` is 4 for the same reason: beyond it the cost is no longer
 * something a caller can be surprised by safely.
 */

/** Largest accepted factor. */
export const SUPERSAMPLE_LIMIT = 4

/**
 * Keys read through `resolveLength`: a canvas fraction in `0..1`, pixels
 * otherwise. `cx`/`cy`/`r`/`r0` are in here for the same reason twice over — a
 * radial gradient reads them as fractions of the shape's box, and a text-on-path
 * arc reads them as pixels — and the `0..1` test separates the two correctly.
 */
const FRACTIONAL_KEYS = ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2', 'originX', 'originY', 'lineHeight', 'radius', 'cx', 'cy', 'r', 'r0']

/** Keys that are pixels whatever their value: stroke widths, blur radii, offsets. */
const PIXEL_KEYS = ['width', 'height', 'size', 'cell', 'blur', 'spread', 'distance', 'choke', 'dx', 'dy']

/** Arrays whose members are pixels, whole-list. */
const PIXEL_ARRAYS = ['dash', 'rampOrigin', 'rampSize']

/** Arrays of points, each coordinate following the fraction rule. */
const POINT_ARRAYS = ['points', 'c1', 'c2']

/**
 * Validate a requested supersample factor.
 *
 * @param {number|undefined} value
 * @returns {number} the factor, 1 when nothing was asked for
 */
export function resolveSupersample(value) {
  if (value === undefined || value === null) return 1
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`supersample must be a whole number, got ${JSON.stringify(value)}`)
  }
  if (!Number.isInteger(value)) {
    throw new Error(`supersample must be a whole number — the reduction averages whole blocks of that many pixels — got ${value}`)
  }
  if (value < 1) throw new Error(`supersample must be at least 1, got ${value}`)
  if (value > SUPERSAMPLE_LIMIT) {
    // Stated as a fact rather than left to be discovered as an out-of-memory kill.
    // Layer buffers are full-canvas, and the renderer holds several at once: for a
    // 2400x1350 document one buffer is 13 MB at 1x, 116 MB at 3x, and 207 MB at 4x.
    throw new Error(
      `supersample ${value} is above the limit of ${SUPERSAMPLE_LIMIT}. Every buffer this renderer holds is `
      + `full-canvas and is held at the supersampled size, so the cost is the whole document multiplied by the `
      + `factor squared (a 2400x1350 document needs 116 MB per buffer at 3x and 207 MB at 4x), several times over.`,
    )
  }
  return value
}

/**
 * Copy a scene with its canvas and every absolute length multiplied by `factor`.
 *
 * The canvas is rounded to whole delivered pixels FIRST and then multiplied, so
 * the internal canvas is always an exact multiple of the factor and every
 * reduction block is complete. A scene declaring `width: 800.4` already rounds to
 * 800 today; at 3x it must round to 2400 and not to 2401, or the last column of
 * blocks would be short and the delivered width would drift.
 *
 * @param {object} scene
 * @param {number} factor
 * @returns {object} a new scene; the input is not touched
 */
export function inflateScene(scene, factor) {
  if (factor === 1) return scene
  const out = scaleValue(scene, factor, new WeakMap(), null)
  // The canvas is rounded to whole delivered pixels FIRST and then multiplied, so the
  // copy declares exactly the canvas the renderer will size — the same arithmetic
  // `renderScene` uses, and the reason it takes the delivered size from the caller's
  // declaration and not from this copy. A scene declaring 800.4 already rounds to 800
  // today, and at 3x has to be 2400 rather than 2401: a canvas that is not a whole
  // number of blocks would need a partial block at its right edge, and the reduction
  // refuses one rather than silently averaging a short block.
  if (out.canvas !== null && typeof out.canvas === 'object') {
    out.canvas = {
      width: Math.round(scene.canvas.width) * factor,
      height: Math.round(scene.canvas.height) * factor,
    }
  }
  return out
}

/**
 * Clone `value`, multiplying lengths. `seen` keeps a scene that shares a subtree
 * (two layers pointing at the same style object) from being duplicated, and keeps
 * a cyclic one from recursing forever.
 */
function scaleValue(value, factor, seen, parentKey) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number') return scaleNumber(value, parentKey, factor)
    return value
  }
  if (seen.has(value)) return seen.get(value)

  if (Array.isArray(value)) {
    const pointLike = POINT_ARRAYS.includes(parentKey)
    const pixelLike = PIXEL_ARRAYS.includes(parentKey)
    const out = []
    seen.set(value, out)
    for (const entry of value) {
      if (typeof entry === 'number' && pixelLike) out.push(entry * factor)
      else if (typeof entry === 'number' && pointLike) out.push(scaleAsFraction(entry, factor))
      // A bare number in any OTHER array is left alone, because the key alone cannot
      // say what it is: `size` is a pixel count on a layer or an effect and a
      // FRACTION PAIR on a scope ramp (`{type:'ramp', size: [1, 1]}`), where
      // multiplying would stretch a gradient scope to three canvases. The arrays
      // whose members are lengths are named above; objects inside an array are still
      // walked, so `shapes`, `effects` and `stops` are scaled as usual.
      else if (typeof entry === 'number') out.push(entry)
      else out.push(scaleValue(entry, factor, seen, parentKey))
    }
    return out
  }

  const out = {}
  seen.set(value, out)
  for (const [key, entry] of Object.entries(value)) {
    // A `font` object is the one place a length key is not a length: `width` is a
    // variation axis, `lineHeight` and `tracking` are em ratios, and only `size`
    // is pixels. Walking it as ordinary data would turn `width: 75` into 225 and
    // silently restyle the type.
    if (key === 'font') {
      out[key] = scaleFont(entry, factor, seen)
      continue
    }
    // SVG path data. Scaling it needs a path, not string surgery — the numbers are
    // not all lengths (`a` carries two flags) — so the path layer applies the
    // factor to its Path2D at draw time, in `drawLeaf`.
    if (key === 'd') {
      out[key] = entry
      continue
    }
    out[key] = scaleValue(entry, factor, seen, key)
  }
  return out
}

/** A font spec: only `size` is a pixel length. */
function scaleFont(font, factor, seen) {
  if (font === null || typeof font !== 'object' || Array.isArray(font)) return scaleValue(font, factor, seen, 'font')
  if (seen.has(font)) return seen.get(font)
  const out = { ...font }
  seen.set(font, out)
  if (typeof font.size === 'number') out.size = font.size * factor
  return out
}

/** One number, under the rule for the key it sits on. */
function scaleNumber(value, key, factor) {
  if (PIXEL_KEYS.includes(key)) return value * factor
  if (FRACTIONAL_KEYS.includes(key)) return scaleAsFraction(value, factor)
  return value
}

/** A value that is a canvas fraction in `0..1` and pixels otherwise — `resolveLength`'s rule, inverted. */
function scaleAsFraction(value, factor) {
  return value >= 0 && value <= 1 ? value : value * factor
}

/**
 * Multiply the pixel-valued keys of an effect spec.
 *
 * Only for a spec whose values came from CODE (an effect's registered defaults)
 * rather than from the scene: a scene's own values have already been through
 * `inflateScene`, and scaling those twice is the exact defect `src/scale.mjs`
 * documents.
 *
 * @param {object} spec
 * @param {number} factor
 * @returns {object} a new spec
 */
export function scalePixelKeys(spec, factor) {
  const out = {}
  for (const [key, value] of Object.entries(spec)) {
    out[key] = typeof value === 'number' && PIXEL_KEYS.includes(key) ? value * factor : value
  }
  return out
}

/**
 * Reduce an RGBA image by an integer factor, averaging each block of
 * `factor x factor` pixels.
 *
 * COLOUR IS AVERAGED WEIGHTED BY ALPHA, AND THAT IS NOT A DETAIL
 * --------------------------------------------------------------
 * A block at the edge of a shape holds ink at some alpha and empty pixels at
 * alpha 0, and an empty pixel's RGB is whatever the buffer left there — zero, in
 * a cleared canvas. Averaging RGB with equal weight therefore mixes that zero
 * into the ink and darkens the edge: ink at 30% coverage over a transparent
 * background comes out at 30% of its own brightness instead of 30% alpha of the
 * full ink, which is a dark fringe around every mark, and it is invisible against
 * white paper and obvious against anything else.
 *
 * So the average is taken over PREMULTIPLIED colour — sum(c * a) / sum(a) — which
 * is the coverage-weighted mean of the ink that is actually there, and alpha is
 * averaged separately. `blurRGBA` in `src/effects.mjs` makes the opposite choice
 * on purpose, and the difference is worth stating: a blur SPREADS ink over a
 * neighbourhood and the author's colour is meant to persist through the falloff,
 * so unpremultiplied RGB is what keeps a coloured glow from going grey. A
 * reduction is not a spread — it is one output pixel standing for the area of
 * several, so what must be preserved is the ink's area and its colour together,
 * which is exactly what premultiplied averaging does.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {number} factor
 * @returns {{width:number,height:number,data:Uint8ClampedArray}} a new image
 */
export function downsampleRGBA(img, factor) {
  if (factor === 1) return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }
  if (img.width % factor !== 0 || img.height % factor !== 0) {
    throw new Error(
      `a ${img.width}x${img.height} image is not a whole number of ${factor}x${factor} blocks; `
      + 'the renderer sizes its canvas to an exact multiple, so a partial block here means the caller did the sizing',
    )
  }
  const outW = img.width / factor
  const outH = img.height / factor
  const src = img.data
  const out = new Uint8ClampedArray(outW * outH * 4)
  const inW = img.width
  const blocks = factor * factor

  for (let y = 0; y < outH; y++) {
    const rowStart = y * factor * inW
    for (let x = 0; x < outW; x++) {
      let a = 0
      let r = 0
      let g = 0
      let b = 0
      const colStart = (rowStart + x * factor) * 4
      for (let sy = 0; sy < factor; sy++) {
        let i = colStart + sy * inW * 4
        for (let sx = 0; sx < factor; sx++, i += 4) {
          const av = src[i + 3]
          a += av
          r += src[i] * av
          g += src[i + 1] * av
          b += src[i + 2] * av
        }
      }
      const o = (y * outW + x) * 4
      out[o + 3] = a / blocks
      if (a > 0) {
        out[o] = r / a
        out[o + 1] = g / a
        out[o + 2] = b / a
      }
    }
  }
  return { width: outW, height: outH, data: out }
}
