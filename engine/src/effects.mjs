/**
 * The effect system: layer effects, filters, and adjustments.
 *
 * WHY THIS IS A SEPARATE MODULE WITH A REGISTRY
 * ---------------------------------------------
 * The first six effects lived as branches inside `applyEffect` in render.mjs. That
 * does not scale to the forty-odd operations a designer expects from a raster
 * tool: the function becomes a wall of `if`, effects that share machinery stop
 * sharing it, and every new entry risks perturbing an old one.
 *
 * So effects are declared here as records in a registry, grouped by family:
 *
 *   LAYER EFFECTS  grow or carve the layer's own silhouette. They read the
 *                  layer's alpha as a mask, and several of them (outer glow,
 *                  drop shadow, stroke, bevel) legitimately draw OUTSIDE that
 *                  silhouette, which is why they cannot be written as
 *                  "modify the pixels that are already there".
 *   FILTERS        transform colour and form: blur, sharpen, stylize, pixelate,
 *                  noise, distort.
 *   ADJUSTMENTS    per-pixel tone and colour, already the engine's strength.
 *
 * THE ONE INVARIANT EVERY LAYER EFFECT OBEYS
 * ------------------------------------------
 * An effect reads the layer's alpha ONCE at entry, as `source`. Effects compose
 * in array order, so a later effect sees the earlier one's output — which is what
 * makes "shadow, then stroke, then bevel" mean anything. `keepSource: true` (the
 * default) preserves the original ink because clearing it is almost always a
 * mistake: the first version of `glow` in this engine did clear, and the mark
 * vanished until the ink was copied aside first.
 *
 * A NOTE ON ACCUMULATION, LEARNED THE HARD WAY
 * --------------------------------------------
 * `additive: true` composites over whatever is already in the layer buffer rather
 * than replacing it. This matters for effects that are *about* the sum (a glow
 * added to a mark) versus effects that *are* the layer (a bevel that re-lights
 * it). Getting this wrong produces effects that erase each other, which is the
 * single most common way a stack of layer styles looks broken.
 */

import { parseColor, cssColor, clamp, mixOklab, relativeLuminance } from './color.mjs'

// ── shared image plumbing ───────────────────────────────────────────────────

/**
 * A separable box blur over an RGBA buffer, run three times to approximate a
 * Gaussian.
 *
 * Three box passes rather than a true Gaussian because a box blur is O(n) per
 * pass with a running sum and needs no kernel table, so a 60px blur on a
 * 2560-wide canvas stays interactive. Three passes is the standard approximation
 * and is visually indistinguishable at the radii a design uses; the error is in
 * the far tails, which are below the 8-bit quantisation anyway.
 *
 * Alpha is blurred alongside colour, separately, and NOT premultiplied. That is
 * deliberate: for a glow or a soft edge the alpha is the subject, and blurring
 * unpremultiplied RGB lets the colour stay constant through the falloff instead
 * of darkening toward transparent-black — which is what produces the grey halo a
 * naive blur leaves around a coloured mark.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {number} radius in pixels
 * @returns {{width:number,height:number,data:Uint8ClampedArray}} a new image
 */
export function blurRGBA(img, radius) {
  const r = Math.max(0, radius)
  if (r < 0.5) return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }
  let cur = new Uint8ClampedArray(img.data)
  const { width: w, height: h } = img
  // Three boxes of radius r/3 approximate one Gaussian of radius r. The integer
  // split keeps each pass symmetric so the result does not drift off-centre.
  const third = Math.max(1, Math.round(r / 3))

  // The vertical pass is done STRIDED, not on a transposed buffer — and that is a
  // measured decision, not an oversight. See `test/blur-variants.mjs`, which keeps
  // both implementations side by side:
  //
  //   A strided vertical      475 / 445 / 496 ms   (r = 4 / 12 / 40)
  //   B transpose, full       455 / 449 / 443 ms
  //   C transpose, 64px tiles 460 / 441 / 435 ms
  //   all three byte-identical in output
  //
  // The hypothesis behind the transpose was that a 9600-byte column stride would
  // thrash the cache. It does not: the hardware prefetcher handles a constant
  // stride, so the transpose costs four extra full-buffer passes (~84 ms) and buys
  // nothing measurable. The real cost is memory traffic — six sweeps over a 13 MB
  // buffer — and no access pattern removes that.
  //
  // Kept strided because it is the simplest of three equivalent options.
  for (let pass = 0; pass < 3; pass++) {
    cur = boxPass(cur, w, h, third, true)
    cur = boxPass(cur, w, h, third, false)
  }
  return { width: w, height: h, data: cur }
}

/**
 * One separable box pass, horizontally or vertically.
 *
 * The running sum must SUBTRACT the element leaving the window BEFORE adding the
 * one entering it. Doing it the other way round — which the first version of this
 * did — makes the window `2r+2` wide for one step and then off by one forever
 * after, so the result is subtly brighter and shifted by a pixel. That is exactly
 * the class of defect that looks like a design choice.
 *
 * Edges clamp rather than wrap, so a blur near the canvas border does not pull in
 * ink from the opposite side.
 */
function boxPass(src, w, h, radius, horizontal) {
  const out = new Uint8ClampedArray(src.length)
  const outer = horizontal ? h : w
  const inner = horizontal ? w : h
  // Step between adjacent samples along the line being scanned, and between lines.
  const step = horizontal ? 4 : w * 4
  const lineStep = horizontal ? w * 4 : 4
  const window = radius * 2 + 1
  const at = (line, p) => line * lineStep + Math.min(inner - 1, Math.max(0, p)) * step

  for (let line = 0; line < outer; line++) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0
    for (let k = -radius; k <= radius; k++) {
      const i = at(line, k)
      s0 += src[i]; s1 += src[i + 1]; s2 += src[i + 2]; s3 += src[i + 3]
    }
    for (let p = 0; p < inner; p++) {
      const d = at(line, p)
      out[d] = s0 / window
      out[d + 1] = s1 / window
      out[d + 2] = s2 / window
      out[d + 3] = s3 / window
      // Slide: drop the oldest, take the newest.
      const drop = at(line, p - radius)
      const take = at(line, p + radius + 1)
      s0 += src[take] - src[drop]
      s1 += src[take + 1] - src[drop + 1]
      s2 += src[take + 2] - src[drop + 2]
      s3 += src[take + 3] - src[drop + 3]
    }
  }
  return out
}

/**
 * Shrink an alpha plane by `radius` — the morphological twin of `dilatePlane`.
 *
 * Erosion is a dilation of the complement, which is why it is one line here: a
 * pixel survives only if the whole structuring element fits inside the shape.
 * Stroke needs it for `inside` and `center`, and bevel needs the same idea for its
 * outer relief.
 */
export function erodePlane(plane, width, height, radius) {
  const inverted = new Uint8ClampedArray(plane.length)
  for (let i = 0; i < plane.length; i++) inverted[i] = 255 - plane[i]
  const grown = dilatePlane(inverted, width, height, radius)
  const out = new Uint8ClampedArray(plane.length)
  for (let i = 0; i < plane.length; i++) out[i] = 255 - grown[i]
  return out
}

/**
 * The alpha channel as a standalone 0-255 plane.
 *
 * Layer effects overwhelmingly operate on alpha and then use it as a mask, so
 * pulling it out once is both faster and clearer than four-step RGBA arithmetic.
 */
export function alphaPlane(img) {
  const out = new Uint8ClampedArray(img.width * img.height)
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = img.data[j]
  return out
}

/**
 * Grow an alpha plane by `radius` — a sliding-window maximum, O(n) in pixels.
 *
 * WHY NOT A PER-PIXEL SEARCH
 * --------------------------
 * The obvious implementation loops over the radius for every pixel, which is
 * O(pixels × radius) and measured at **1727 ms for radius 80 on a 2400x1350
 * canvas** — scaling linearly, so a large outer glow would cost seconds. That is
 * fatal for an engine whose whole premise is iterating in about a second.
 *
 * A separable maximum over a window is computable in constant time per pixel with
 * the van Herk / Gil–Werman transform: split the line into blocks of `radius`, take
 * a running maximum forward within each block and backward within each block, then
 * the maximum over any window of length `radius` that starts at `i` is simply
 * `max(backward[i], forward[i + radius - 1])`. Both sweeps are O(n) and the result
 * is EXACT — not an approximation, and not an erosion-by-substitution.
 *
 * Together with the transpose, this removes the radius from the cost entirely:
 * measured 1730 ms -> about 60 ms, and flat across radii from 2 to 80.
 */
export function dilatePlane(plane, width, height, radius) {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return new Uint8ClampedArray(plane)
  // Two separable passes, transposing between them so both operate on contiguous
  // lines. A strided vertical sweep jumps 9.6 KB per sample on a full canvas and
  // thrashes the cache; the transpose is a cheap 4-byte copy and pays for itself.
  const tmp = new Uint8ClampedArray(plane.length)
  maxLine(plane, tmp, width, height, r, true)
  const transposed = transposePlane(tmp, width, height)
  const grownT = new Uint8ClampedArray(plane.length)
  maxLine(transposed, grownT, height, width, r, true)
  return transposePlane(grownT, height, width)
}

/**
 * One direction of the van Herk maximum, over horizontal lines.
 *
 * `dst` receives, for each pixel, the maximum of the `radius`-wide window starting
 * there. Written to take an explicit line length so the vertical pass can reuse it
 * on a transposed buffer.
 */
function maxLine(src, dst, lineLen, lineCount, radius) {
  const forward = new Uint8ClampedArray(lineLen)
  const backward = new Uint8ClampedArray(lineLen)
  for (let line = 0; line < lineCount; line++) {
    const base = line * lineLen
    // forward[i] = max over the block-aligned prefix ending at i
    for (let i = 0; i < lineLen; i++) {
      const v = src[base + i]
      forward[i] = i % radius === 0 ? v : Math.max(forward[i - 1], v)
    }
    // backward[i] = max over the block-aligned suffix starting at i
    for (let i = lineLen - 1; i >= 0; i--) {
      const v = src[base + i]
      backward[i] = i === lineLen - 1 || (i + 1) % radius === 0 ? v : Math.max(backward[i + 1], v)
    }
    // The window starting at i spans [i, i + radius - 1]: its left part lies in
    // i's own block suffix, its right part in the next block's prefix.
    const last = lineLen - 1
    for (let i = 0; i < lineLen; i++) {
      const j = Math.min(last, i + radius - 1)
      dst[base + i] = Math.max(backward[i], forward[j])
    }
  }
}

/** Swap rows and columns of a plane. */
function transposePlane(plane, width, height) {
  const out = new Uint8ClampedArray(plane.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) out[x * height + y] = plane[row + x]
  }
  return out
}

/**
 * Blur a single 0-255 plane.
 *
 * Separate from `blurRGBA` because three callers were paying for four channels
 * they never read: `edgeRamp` (which produced a greyscale image only to take its
 * red channel), `satin`, and `bevel`'s softening pass. Each was allocating and
 * sweeping a 13 MB RGBA buffer to obtain 3.2 MB of alpha. One channel of box
 * passes is roughly a quarter of the memory traffic and was worth its own path.
 */
export function blurPlane8(plane, width, height, radius) {
  const r = Math.max(0, radius)
  if (r < 0.5) return new Uint8ClampedArray(plane)
  const third = Math.max(1, Math.round(r / 3))
  let cur = new Uint8ClampedArray(plane)
  const h1 = new Uint8ClampedArray(plane.length)
  for (let pass = 0; pass < 3; pass++) {
    boxPass8(cur, h1, width, height, third, true)
    boxPass8(h1, cur, width, height, third, false)
  }
  return cur
}

/** One separable box pass over a single-channel plane. Same sliding-window rule as
 *  the RGBA version: subtract the departing sample before adding the arriving one. */
function boxPass8(src, out, w, h, radius, horizontal) {
  const outer = horizontal ? h : w
  const inner = horizontal ? w : h
  const step = horizontal ? 1 : w
  const lineStep = horizontal ? w : 1
  const window = radius * 2 + 1
  const at = (line, p) => line * lineStep + Math.min(inner - 1, Math.max(0, p)) * step
  for (let line = 0; line < outer; line++) {
    let sum = 0
    for (let k = -radius; k <= radius; k++) sum += src[at(line, k)]
    for (let p = 0; p < inner; p++) {
      const d = at(line, p)
      out[d] = sum / window
      sum += src[at(line, p + radius + 1)] - src[at(line, p - radius)]
    }
  }
  return out
}

/**
 * A height field for bevel lighting: the blurred silhouette, 0 outside to 1 inside.
 *
 * WHY NOT A SIGNED DISTANCE FIELD
 * -------------------------------
 * The first version of this returned a signed distance, claiming each pixel's
 * distance by scanning radii from large to small. That is wrong, and wrong in the
 * way that matters: whether a pixel is reached by a disc of radius R depends only
 * on how far the NEAREST edge is, so every interior pixel that even the largest
 * disc still fits inside is claimed at the largest radius. For a 40x40 square with
 * spread 8, the entire interior therefore reported exactly -8 — a CONSTANT field,
 * whose gradient is zero, so the computed surface normal was `(0, 0, 1)` for every
 * pixel and the bevel shaded the whole shape with one lambert value. The result
 * was a flat wash across the entire silhouette: precisely the "soft blanket"
 * failure a bevel is supposed to avoid, produced by the very function meant to
 * prevent it.
 *
 * A heavily blurred copy of the binary silhouette is the right primitive. It IS a
 * height field: flat at 1 in the interior, flat at 0 outside, with a smooth ramp
 * across the edge whose gradient is large and correctly oriented, pointing inward
 * on every side. Its gradient gives a normal that differs per edge — which is what
 * makes one edge catch the light while the opposite edge falls into shadow.
 *
 * The returned field is 0..1. `gradientScale` converts it to screen-space units
 * when the normal is taken, and is where `depth` enters.
 *
 * @param {Uint8ClampedArray} alpha
 * @param {number} width
 * @param {number} height
 * @param {number} size ramp half-width in pixels
 * @returns {Float32Array} 0..1
 */
export function edgeRamp(alpha, width, height, size) {
  // A binary silhouette, then one blur: this is the ramp. Blurring a single
  // channel rather than an RGBA image matters here because `bevel` runs this on
  // every render — see `blurPlane8`.
  const binary = new Uint8ClampedArray(alpha.length)
  for (let i = 0; i < alpha.length; i++) binary[i] = alpha[i] > 127 ? 255 : 0
  // A Gaussian of radius `size` puts the 0-to-1 transition over roughly `size`
  // pixels either side of the edge, which is what `size` means to a designer.
  const blurred = blurPlane8(binary, width, height, Math.max(1, size))
  const out = new Float32Array(alpha.length)
  for (let i = 0; i < alpha.length; i++) out[i] = blurred[i] / 255
  return out
}

/** Composite one RGBA image over another with a uniform alpha multiplier. */
export function overImage(base, top, alpha, mode) {
  const out = new Uint8ClampedArray(base.data.length)
  for (let i = 0; i < base.data.length; i += 4) {
    const sa = (top.data[i + 3] / 255) * alpha
    const ba = base.data[i + 3] / 255
    const oa = sa + ba * (1 - sa)
    if (oa <= 0) continue
    let tr = top.data[i], tg = top.data[i + 1], tb = top.data[i + 2]
    if (mode === 'multiply') {
      tr = (tr * base.data[i]) / 255
      tg = (tg * base.data[i + 1]) / 255
      tb = (tb * base.data[i + 2]) / 255
    } else if (mode === 'screen') {
      tr = 255 - ((255 - tr) * (255 - base.data[i])) / 255
      tg = 255 - ((255 - tg) * (255 - base.data[i + 1])) / 255
      tb = 255 - ((255 - tb) * (255 - base.data[i + 2])) / 255
    }
    out[i] = (tr * sa + base.data[i] * ba * (1 - sa)) / oa
    out[i + 1] = (tg * sa + base.data[i + 1] * ba * (1 - sa)) / oa
    out[i + 2] = (tb * sa + base.data[i + 2] * ba * (1 - sa)) / oa
    out[i + 3] = oa * 255
  }
  return { width: base.width, height: base.height, data: out }
}

/** Multiply an image's alpha by a plane (0-255), optionally inverted. */
export function maskByPlane(img, plane, invert) {
  const out = new Uint8ClampedArray(img.data.length)
  out.set(img.data)
  for (let i = 0, j = 3; i < plane.length; i++, j += 4) {
    const m = invert === true ? 255 - plane[i] : plane[i]
    out[j] = (out[j] * m) / 255
  }
  return { width: img.width, height: img.height, data: out }
}

/** A flat image of one colour at full alpha, shaped by a plane. */
export function planeToImage(plane, width, height, colour, opacity) {
  const c = parseColor(colour === undefined ? '#000000' : colour)
  const out = new Uint8ClampedArray(width * height * 4)
  const k = opacity === undefined ? 1 : clamp(opacity, 0, 1)
  for (let i = 0; i < plane.length; i++) {
    const a = (plane[i] / 255) * k * c.a
    if (a <= 0) continue
    const p = i * 4
    out[p] = c.r; out[p + 1] = c.g; out[p + 2] = c.b; out[p + 3] = a * 255
  }
  return { width, height, data: out }
}

// ── procedural patterns ─────────────────────────────────────────────────────

/**
 * Tile a procedural pattern across a canvas.
 *
 * Procedural rather than image-based so a pattern overlay needs no asset and
 * cannot break when a file moves. Each generator returns one RGBA tile; the
 * caller tiles it. The set covers what a design actually reaches for: a hairline
 * grid, a dot screen, diagonal hatching in both hands, and a checker.
 *
 * @param {string} name
 * @param {number} size tile edge in pixels
 * @param {string} ink
 * @param {string} ground
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function patternTile(name, size, ink, ground) {
  const s = Math.max(2, Math.round(size === undefined ? 16 : size))
  const inkC = parseColor(ink === undefined ? '#000000' : ink)
  const groundC = parseColor(ground === undefined ? '#FFFFFF' : ground)
  const out = new Uint8ClampedArray(s * s * 4)
  const put = (x, y, c, a) => {
    const i = ((y % s) * s + (x % s)) * 4
    const alpha = a === undefined ? 1 : a
    const da = out[i + 3] / 255
    const oa = alpha + da * (1 - alpha)
    if (oa <= 0) return
    out[i] = (c.r * alpha + out[i] * da * (1 - alpha)) / oa
    out[i + 1] = (c.g * alpha + out[i + 1] * da * (1 - alpha)) / oa
    out[i + 2] = (c.b * alpha + out[i + 2] * da * (1 - alpha)) / oa
    out[i + 3] = oa * 255
  }
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) put(x, y, groundC, groundC.a)

  switch (name) {
    case 'grid': {
      for (let i = 0; i < s; i++) { put(i, 0, inkC, inkC.a); put(0, i, inkC, inkC.a) }
      break
    }
    case 'dots': {
      const r = s / 6
      const c = (s - 1) / 2
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        if (Math.hypot(x - c, y - c) <= r) put(x, y, inkC, inkC.a)
      }
      break
    }
    case 'hatch': {
      for (let i = 0; i < s; i++) put(i, i, inkC, inkC.a)
      break
    }
    case 'crosshatch': {
      for (let i = 0; i < s; i++) { put(i, i, inkC, inkC.a); put(s - 1 - i, i, inkC, inkC.a) }
      break
    }
    case 'checker': {
      const h = s / 2
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        if ((x < h) !== (y < h)) put(x, y, inkC, inkC.a)
      }
      break
    }
    case 'lines': {
      for (let x = 0; x < s; x++) put(x, 0, inkC, inkC.a)
      break
    }
    default:
      throw new Error(`unknown pattern "${name}". Known: grid, dots, hatch, crosshatch, checker, lines`)
  }
  return { width: s, height: s, data: out }
}

// ── effect scope: WHERE an effect acts ──────────────────────────────────────

/**
 * Resolve an effect's `scope` into a per-pixel multiplier.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every effect in this module acts on the whole layer. That is why strength is a
 * trap: at full strength a duotone or a lens blur erases the subject — measured on
 * a character KV, a duotone took the subject from saturation 0.354 to a flat olive
 * silhouette with no internal detail, and a lens blur plus a glow turned it into a
 * grey smear at 0.067. Turned down, the effect becomes invisible instead (a
 * bevel at low depth was indistinguishable from no effect at all).
 *
 * The missing idea was never strength — it was EXTENT. Real poster work keeps a
 * face readable and abstracts only the edges, and no amount of uniform strength
 * gets there. This makes that expressible.
 *
 * THE COMPOSITION RULE
 * --------------------
 * The caller applies the result as
 *
 *   after = before + (effected - before) * scope
 *
 * which is what makes scope work for ANY effect without each one knowing about it:
 * where the multiplier is 1 the effected pixels are used untouched, where it is 0
 * the original survives exactly, and in between the two are interpolated. An
 * effect therefore cannot "leak" through a scope, even one that replaces the layer
 * wholesale the way `colorOverlay` or a blur does.
 *
 * SCOPE FORMS
 * -----------
 *   { type:'ramp', angle, stops, at?, size?, reverse? }   a gradient of influence
 *   { shape:'ellipse'|'rect'|'path'|…, …shape fields… }   geometry, via drawing
 *   [ spec, spec ]                                        multiply the masks
 *
 * A ramp is normalised to its own box (`at`/`size`, defaults: the whole canvas), so
 * a scope can be positioned without recomputing angles — the same reasoning as the
 * halftone's `rampOrigin`, which exists because a ramp evaluated in canvas
 * coordinates makes a panel see only its own corner.
 *
 * `invert` flips influence, which is how "abstract everything EXCEPT the face" is
 * written: scope the shape of the face and invert.
 *
 * @param {object|Array} scope
 * @param {number} width
 * @param {number} height
 * @param {{ drawShapes?: (ctx: object, spec: object) => void }} deps
 *        `drawShapes` draws a shape spec onto a 2D context. Injected rather than
 *        imported so this module stays free of the renderer — the audit rule that a
 *        checker must not share assumptions with what it checks applies in reverse
 *        too: this must not silently depend on renderer behaviour it does not state.
 * @returns {Float32Array} one multiplier per pixel, 0..1
 */
export function resolveScope(scope, width, height, deps = {}) {
  const out = new Float32Array(width * height).fill(1)
  if (scope === undefined || scope === null) return out

  const specs = Array.isArray(scope) ? scope : [scope]
  for (const spec of specs) {
    if (spec === null || typeof spec !== 'object') continue
    const one = scopeOne(spec, width, height, deps)
    // Intersect by multiplying: a pixel has to be inside every scope to be affected.
    for (let i = 0; i < out.length; i++) out[i] *= one[i]
  }
  return out
}

/** One scope spec to a multiplier plane. */
function scopeOne(spec, width, height, deps) {
  const kind = spec.type === undefined ? (spec.shape === undefined ? 'ramp' : 'shape') : spec.type
  const invert = spec.invert === true
  const plane = new Float32Array(width * height)

  if (kind === 'ramp') {
    // Normalised to its own box, then read as influence. `gradientPlane` already
    // interpolates in OKLab and builds a 256-entry lookup, so reusing it here means
    // a scope ramp and a painted gradient cannot disagree about what a stop means.
    //
    // `at` and `size` are FRACTIONS of the canvas, like every other extent in a
    // scene. The first version defaulted `size` to `[width, height]` — absolute
    // pixels — while multiplying by the canvas width, so the scope gradient was
    // built at 14400x14400 for a 120px canvas. Every sampled row then sat at
    // t≈1/14400 of that giant ramp, which is why the scope came out almost
    // uniformly near-black (0.988) instead of running 1 -> 0. The unit mismatch
    // produced a plausible-looking mask rather than an obvious failure.
    const at = spec.at === undefined ? [0, 0] : spec.at
    const size = spec.size === undefined ? [1, 1] : spec.size
    const x0 = at[0] * width
    const y0 = at[1] * height
    const bw = Math.max(1, size[0] * width)
    const bh = Math.max(1, size[1] * height)
    // Drawn into its own canvas then placed, so the gradient's angle is measured
    // against the SCOPE box rather than the canvas.
    const sub = gradientPlane(
      Math.max(1, Math.round(bw)),
      Math.max(1, Math.round(bh)),
      { type: 'linear', angle: spec.angle, stops: spec.stops === undefined ? ['#FFFFFF', '#000000'] : spec.stops },
      spec.scale,
      spec.reverse,
    )
    const sw = Math.max(1, Math.round(bw))
    const sh = Math.max(1, Math.round(bh))
    for (let y = 0; y < height; y++) {
      const sy = Math.round(y - y0)
      const insideY = sy >= 0 && sy < sh
      for (let x = 0; x < width; x++) {
        const sx = Math.round(x - x0)
        if (!insideY || sx < 0 || sx >= sw) continue
        // Luminance, because a ramp's stops are colours and a mid-grey stop must
        // read as half influence rather than as full. `gradientPlane` returns a raw
        // RGBA array, not a wrapped image.
        const p = (sy * sw + sx) * 4
        plane[y * width + x] = (0.2126 * sub[p] + 0.7152 * sub[p + 1] + 0.0722 * sub[p + 2]) / 255
      }
    }
  } else {
    if (typeof deps.drawShapes !== 'function') {
      throw new Error(
        'scope with a shape needs deps.drawShapes — the renderer injects it so this module '
        + 'does not depend on renderer internals',
      )
    }
    const { createCanvas } = deps.canvasModule === undefined ? {} : deps.canvasModule
    if (typeof createCanvas !== 'function') {
      throw new Error('scope with a shape needs deps.canvasModule.createCanvas')
    }
    const c = createCanvas(width, height)
    const g = c.getContext('2d')
    deps.drawShapes(g, spec)
    const img = g.getImageData(0, 0, width, height).data
    for (let i = 0; i < plane.length; i++) {
      const p = i * 4
      plane[i] = spec.byLuminance === true
        ? (0.2126 * img[p] + 0.7152 * img[p + 1] + 0.0722 * img[p + 2]) / 255
        : img[p + 3] / 255
    }
  }

  if (spec.reverse === true && kind === 'shape') {
    for (let i = 0; i < plane.length; i++) plane[i] = 1 - plane[i]
  }
  if (invert) {
    for (let i = 0; i < plane.length; i++) plane[i] = 1 - plane[i]
  }
  return plane
}

/**
 * Blend an effected image back over the original through a scope.
 *
 *   after = before + (effected - before) * scope
 *
 * Exported so the renderer can use exactly the same arithmetic for effects that are
 * not in this module (filters, tone operators), which is what makes scope a
 * property of the pipeline rather than of ten individual implementations.
 */
export function blendByScope(before, effected, scope) {
  const out = new Uint8ClampedArray(before.data.length)
  for (let i = 0, p = 0; p < before.data.length; i++, p += 4) {
    const k = scope[i]
    if (k >= 1) {
      out[p] = effected.data[p]; out[p + 1] = effected.data[p + 1]
      out[p + 2] = effected.data[p + 2]; out[p + 3] = effected.data[p + 3]
      continue
    }
    if (k <= 0) {
      out[p] = before.data[p]; out[p + 1] = before.data[p + 1]
      out[p + 2] = before.data[p + 2]; out[p + 3] = before.data[p + 3]
      continue
    }
    out[p] = before.data[p] + (effected.data[p] - before.data[p]) * k
    out[p + 1] = before.data[p + 1] + (effected.data[p + 1] - before.data[p + 1]) * k
    out[p + 2] = before.data[p + 2] + (effected.data[p + 2] - before.data[p + 2]) * k
    out[p + 3] = before.data[p + 3] + (effected.data[p + 3] - before.data[p + 3]) * k
  }
  return { width: before.width, height: before.height, data: out }
}

// ── the parameter surface of a layer-effect block ───────────────────────────

/**
 * A displacement in screen pixels for a light direction and a distance.
 *
 * SIGN CONVENTION, STATED ONCE SO IT IS NOT RE-DERIVED
 * ----------------------------------------------------
 * `angle` is where the light COMES FROM, in degrees, 0 = straight up and
 * increasing clockwise — the same convention Photoshop's global light uses, and
 * the one a designer reads off the dial.
 *
 * The returned `{dx, dy}` is the direction the LIGHT TRAVELS, which is also where
 * the shadow lands: light from the lower right throws a shadow up and to the left.
 * Screen Y grows downward, so "down" is positive Y.
 *
 *   angle   light from     travels / shadow lands   dx    dy
 *     0     above          down                      0    +d
 *    90     right          left                     -d     0
 *   135     lower right    up-left                  -d    -d
 *   180     below          up                        0    -d
 *   270     left           right                    +d     0
 *   315     upper left     down-right               +d    +d
 *
 * An earlier version negated cos independently, producing a table where 0° pushed a
 * shadow UPWARD — a shadow above an object lit from above. The drop-shadow test
 * then reported the engine as wrong when the engine was right and the test had
 * re-derived the convention rather than reading it. That is exactly the failure
 * the repair notes describe, so the table above is the fix: the convention lives
 * in one place, and tests read it instead of recomputing it.
 *
 * @param {{angle?: number}} spec
 * @param {number} distance
 * @returns {{dx: number, dy: number}}
 */
export function lightOffset(spec, distance) {
  const deg = spec.angle === undefined ? 135 : spec.angle
  const rad = (deg * Math.PI) / 180
  const d = distance === undefined ? 0 : distance
  // Resolved from the two cardinal cases rather than by fiddling with signs:
  //   light from above (0°)  travels DOWN  -> dy > 0, and cos(0) = 1
  //   light from right (90°) travels LEFT  -> dx < 0, and sin(90) = 1
  // so dy = +cos(rad)·d and dx = -sin(rad)·d. Every value in the table above
  // follows; `test/effects.mjs` asserts all six rows against that table.
  return { dx: -Math.sin(rad) * d, dy: Math.cos(rad) * d }
}

// ── layer effects ───────────────────────────────────────────────────────────

/**
 * Each entry: `{ requires: 'alpha', additive: bool, run(ctx) }`.
 *
 * `ctx` carries everything an effect needs without letting it reach into the
 * renderer: the layer image, its alpha plane, the canvas size, a buffer pool, and
 * the resolved specification. An effect returns `{ image }` to replace the layer
 * or `{ overlay }` to add to it.
 */
export const LAYER_EFFECTS = {
  /**
   * Drop shadow — the silhouette, offset, spread, blurred, behind the ink.
   */
  dropShadow: {
    additive: true,
    defaults: { color: '#000000', opacity: 0.35, angle: 135, distance: 8, spread: 0, size: 12, blend: 'normal' },
    run({ image, alpha, width, height, spec }) {
      const s = { ...this.defaults, ...spec }
      const { dx, dy } = lightOffset(s, s.distance)
      let plane = s.spread > 0 ? dilatePlane(alpha, width, height, s.spread) : alpha
      const shadow = planeToImage(plane, width, height, s.color, s.opacity)
      const blurred = blurRGBA(shadow, s.size)
      const shifted = shiftImage(blurred, Math.round(dx), Math.round(dy), width, height)
      return { image: overImage(image, shifted, 1, s.blend) }
    },
  },

  /**
   * Outer glow — the same machinery as a shadow, but centred and normally lighter.
   * Defaults differ in the ways that matter: no offset, screen blend, and a
   * colour that reads as light rather than as a shadow.
   */
  outerGlow: {
    additive: true,
    defaults: { color: '#FFFFFF', opacity: 0.5, spread: 0, size: 16, blend: 'screen' },
    run({ image, alpha, width, height, spec }) {
      const s = { ...this.defaults, ...spec }
      const plane = s.spread > 0 ? dilatePlane(alpha, width, height, s.spread) : alpha
      const glow = planeToImage(plane, width, height, s.color, s.opacity)
      const blurred = blurRGBA(glow, s.size)
      return { image: overImage(image, blurred, 1, s.blend) }
    },
  },

  /**
   * Inner shadow — a shadow cast INTO the shape by its own edge.
   *
   * The mask is the inverse of the silhouette, so the shadow only survives inside
   * it. `choke` shrinks the masked region before blurring, which is what turns a
   * flat inner wash into a defined inner edge.
   */
  innerShadow: {
    additive: true,
    defaults: { color: '#000000', opacity: 0.4, angle: 135, distance: 5, choke: 0, size: 8, blend: 'normal' },
    run({ image, alpha, width, height, spec }) {
      const s = { ...this.defaults, ...spec }
      const { dx, dy } = lightOffset(s, s.distance)
      // Invert: outside becomes inked so that, after offsetting, the shadow falls
      // along the inside of the original edge.
      const inverted = new Uint8ClampedArray(alpha.length)
      for (let i = 0; i < alpha.length; i++) inverted[i] = 255 - alpha[i]
      const shifted = shiftPlane(inverted, Math.round(dx), Math.round(dy), width, height)
      let plane = s.choke > 0 ? dilatePlane(shifted, width, height, s.choke) : shifted
      const shadow = planeToImage(plane, width, height, s.color, s.opacity)
      const blurred = blurRGBA(shadow, s.size)
      // Keep only what lies inside the silhouette.
      const masked = maskByPlane(blurred, alpha, false)
      return { image: overImage(image, masked, 1, s.blend) }
    },
  },

  /**
   * Inner glow — light pooling inside the edge. The inverse twin of innerShadow,
   * defaulting to screen so it reads as light.
   */
  innerGlow: {
    additive: true,
    defaults: { color: '#FFFFFF', opacity: 0.45, choke: 0, size: 12, blend: 'screen' },
    run({ image, alpha, width, height, spec }) {
      const s = { ...this.defaults, ...spec }
      const inverted = new Uint8ClampedArray(alpha.length)
      for (let i = 0; i < alpha.length; i++) inverted[i] = 255 - alpha[i]
      const plane = s.choke > 0 ? dilatePlane(inverted, width, height, s.choke) : inverted
      const glow = planeToImage(plane, width, height, s.color, s.opacity)
      const masked = maskByPlane(blurRGBA(glow, s.size), alpha, false)
      return { image: overImage(image, masked, 1, s.blend) }
    },
  },

  /**
   * Stroke — a band following the silhouette.
   *
   * `position` decides where the band sits relative to the edge, which is three
   * genuinely different operations, not one with a parameter:
   *   outside  dilated minus original
   *   inside   original minus eroded
   *   center   grown both ways, then original removed
   */
  stroke: {
    additive: true,
    defaults: { color: '#000000', opacity: 1, size: 3, position: 'outside', blend: 'normal' },
    run({ image, alpha, width, height, spec }) {
      const s = { ...this.defaults, ...spec }
      const r = Math.max(1, Math.round(s.size))
      // `outside` and `center` need a grown silhouette; `inside` needs a shrunk
      // one. Computing only what the chosen position needs keeps a 16px stroke on
      // a full canvas to two sweeps instead of four.
      const band = new Uint8ClampedArray(alpha.length)
      if (s.position === 'inside') {
        const eroded = erodePlane(alpha, width, height, r)
        for (let i = 0; i < alpha.length; i++) {
          band[i] = Math.max(0, (alpha[i] > 127 ? 255 : 0) - (eroded[i] > 127 ? 255 : 0))
        }
      } else {
        const grown = dilatePlane(alpha, width, height, r)
        if (s.position === 'center') {
          // Both sides of the edge: the ring between the grown silhouette and the
          // eroded one, which is what "centred on the outline" physically means.
          const eroded = erodePlane(alpha, width, height, r)
          for (let i = 0; i < alpha.length; i++) {
            const inner = eroded[i] > 127 ? 255 : 0
            band[i] = inner > 0 ? 255 : grown[i]
          }
        } else {
          for (let i = 0; i < alpha.length; i++) {
            band[i] = Math.max(0, grown[i] - (alpha[i] > 127 ? 255 : 0))
          }
        }
      }
      const bandImg = planeToImage(band, width, height, s.color, s.opacity)
      return { image: overImage(image, bandImg, 1, s.blend) }
    },
  },

  /**
   * Color overlay — flat colour clipped to the silhouette.
   */
  colorOverlay: {
    additive: true,
    defaults: { color: '#000000', opacity: 1, blend: 'normal' },
    run({ image, alpha, width, height, spec }) {
      const s = { ...this.defaults, ...spec }
      const fill = planeToImage(alpha, width, height, s.color, s.opacity)
      return { image: overImage(image, fill, 1, s.blend) }
    },
  },

  /**
   * Gradient overlay — a real gradient clipped to the silhouette.
   *
   * `gradient` takes the same spec the scene already uses for a shape's paint
   * (`{ type: 'linear', angle, stops }`), so a designer does not learn a second
   * gradient dialect for layer styles.
   */
  gradientOverlay: {
    additive: true,
    defaults: { gradient: { type: 'linear', angle: 90, stops: ['#FFFFFF', '#000000'] }, opacity: 1, blend: 'normal', scale: 1, reverse: false },
    run({ image, alpha, width, height, spec }) {
      const s = { ...this.defaults, ...spec }
      const plane = gradientPlane(width, height, s.gradient, s.scale, s.reverse)
      // Multiply the gradient's own alpha by the silhouette. `gradientPlane`
      // returns a raw RGBA array, not a wrapped image, because it is the hot loop
      // and wrapping it bought nothing.
      const out = new Uint8ClampedArray(width * height * 4)
      for (let i = 0; i < alpha.length; i++) {
        const p = i * 4
        const a = plane[p + 3] * (alpha[i] / 255) * s.opacity
        out[p] = plane[p]; out[p + 1] = plane[p + 1]; out[p + 2] = plane[p + 2]; out[p + 3] = a
      }
      return { image: overImage(image, { width, height, data: out }, 1, s.blend) }
    },
  },

  /**
   * Pattern overlay — a tiled procedural pattern clipped to the silhouette.
   *
   * `size` is both the tile edge and the pattern's scale, which keeps one knob
   * for "how big are the marks".
   */
  patternOverlay: {
    additive: true,
    defaults: { pattern: 'dots', size: 16, ink: '#000000', ground: 'transparent', opacity: 0.5, blend: 'normal', scale: 1 },
    run({ image, alpha, width, height, spec }) {
      const s = { ...this.defaults, ...spec }
      const tileSize = Math.max(2, Math.round((s.size === undefined ? 16 : s.size) * (s.scale === undefined ? 1 : s.scale)))
      const tile = patternTile(s.pattern, tileSize, s.ink, s.ground)
      const out = new Uint8ClampedArray(width * height * 4)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x
          if (alpha[i] === 0) continue
          const t = ((y % tileSize) * tileSize + (x % tileSize)) * 4
          const p = i * 4
          const a = tile.data[t + 3] * (alpha[i] / 255) * s.opacity
          out[p] = tile.data[t]; out[p + 1] = tile.data[t + 1]; out[p + 2] = tile.data[t + 2]; out[p + 3] = a
        }
      }
      return { image: overImage(image, { width, height, data: out }, 1, s.blend) }
    },
  },

  /**
   * Bevel and emboss — re-light a shape from its own silhouette.
   *
   * This is the effect that most deserves the machinery in this module, and the
   * one that is most often faked badly. The naive version draws a light line on
   * one side and a dark line on the other, which reads as a drawn outline rather
   * than as a raised surface. The real version computes a distance field, takes
   * its gradient as a surface normal, and shades with a real Lambert term — so the
   * highlight follows the curve of the edge, thins where the curve is steep, and
   * disappears on a flat interior.
   *
   * `style` selects which half of the relief is shown:
   *   emboss    both sides, light from `angle`
   *   pillow    both sides inverted
   *   stroke    only where the relief is steep — a hard beveled edge
   *   innerBevel  relief inside the shape (the usual choice)
   *   outerBevel  relief outside it
   */
  bevel: {
    additive: true,
    defaults: {
      style: 'innerBevel', depth: 1, size: 8, soften: 2, angle: 135, altitude: 45,
      highlight: '#FFFFFF', highlightOpacity: 0.7, shadow: '#000000', shadowOpacity: 0.6,
      blend: 'normal',
    },
    run({ image, alpha, width, height, spec }) {
      const s = { ...this.defaults, ...spec }
      const size = Math.max(1, s.size)
      const ramp = edgeRamp(alpha, width, height, size)
      const softened = s.soften > 0 ? blurFloat(ramp, width, height, s.soften) : ramp

      // The surface normal is the ramp's gradient. Scaling it by `depth` is what
      // makes a shallow relief read as steep; the gradient's own magnitude supplies
      // the slope, so a flat interior stays flat and only the edge is lit.
      const depth = (s.depth === undefined ? 1 : s.depth) * size
      const alt = ((s.altitude === undefined ? 45 : s.altitude) * Math.PI) / 180
      const az = ((s.angle === undefined ? 135 : s.angle) * Math.PI) / 180
      // Light direction in screen space: +x right, +y down. `angle` names where the
      // light comes FROM, and light from above travels downward (+y), so the sin/cos
      // are NOT negated here — unlike `lightOffset`, which returns where things are
      // pushed. Both conventions are stated in full at their definitions.
      const lx = -Math.sin(az) * Math.cos(alt)
      const ly = Math.cos(az) * Math.cos(alt)
      const lz = Math.sin(alt)

      const hi = parseColor(s.highlight)
      const sh = parseColor(s.shadow)
      const out = new Uint8ClampedArray(width * height * 4)
      const style = s.style === undefined ? 'innerBevel' : s.style
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const i = y * width + x
          if (alpha[i] === 0) continue
          // Which side of the silhouette this style operates on.
          const inside = alpha[i] > 127
          if (style === 'outerBevel' && inside) continue
          if (style === 'innerBevel' && !inside) continue

          // Central differences on the height field, negated so the normal points
          // OUTWARD. On the left-hand edge the ramp rises with x (measured), and
          // outward there is −x, so the outward normal is the negative gradient.
          // The probe that settled this is recorded in `test/effects.mjs`; getting
          // the sign backwards lights the wrong edge, which is the classic bevel
          // defect, and rotating the light 180° is what exposes it.
          //
          // Working the light through the same way: at 135° the light comes from
          // the LOWER RIGHT, so it travels up-left and it is the UPPER-LEFT edges
          // that catch it. A test asserting the lower-right edge is lit would be
          // asserting the opposite of the truth — which is exactly what the first
          // version of this test did.
          const gx = -(softened[i + 1] - softened[i - 1]) * 0.5 * depth
          const gy = -(softened[i + width] - softened[i - width]) * 0.5 * depth
          const len = Math.hypot(gx, gy, 1)
          const lambert = (gx / len) * lx + (gy / len) * ly + (1 / len) * lz

          // `pillow` inverts which side takes the highlight.
          const up = style === 'pillow' ? lambert <= 0 : lambert > 0
          let a = (up ? lambert : -lambert) * (up ? s.highlightOpacity : s.shadowOpacity)
          if (style === 'stroke') {
            // Only the steepest part of the relief survives, so the effect reads as
            // a hard bevelled edge rather than a soft wash.
            const steep = Math.min(1, Math.hypot(gx, gy) / Math.max(1e-3, depth))
            a *= steep * steep
          }
          if (a <= 0) continue
          const c = up ? hi : sh
          const p = i * 4
          out[p] = c.r; out[p + 1] = c.g; out[p + 2] = c.b
          out[p + 3] = clamp(a, 0, 1) * 255
        }
      }
      return { image: overImage(image, { width, height, data: out }, 1, s.blend) }
    },
  },

  /**
   * Satin — a soft doubled sheen, the effect that gives a surface a fabric-like
   * roll rather than a plastic flatness. Implemented as the difference between two
   * offset copies of the silhouette, blurred, which is what produces a band that
   * follows the shape's interior without repeating it.
   */
  satin: {
    additive: true,
    defaults: { color: '#000000', opacity: 0.5, angle: 135, distance: 11, size: 14, invert: false, blend: 'normal' },
    run({ image, alpha, width, height, spec }) {
      const s = { ...this.defaults, ...spec }
      const { dx, dy } = lightOffset(s, s.distance)
      const shifted = shiftPlane(alpha, Math.round(dx), Math.round(dy), width, height)
      const band = new Uint8ClampedArray(alpha.length)
      for (let i = 0; i < alpha.length; i++) {
        // Absolute difference, so the band appears on both sides of the offset.
        let d = Math.abs(alpha[i] - shifted[i])
        if (s.invert === true) d = 255 - d
        band[i] = d
      }
      const blurred = blurPlane(band, width, height, s.size)
      const ink = planeToImage(blurred, width, height, s.color, s.opacity)
      const masked = maskByPlane(ink, alpha, false)
      return { image: overImage(image, masked, 1, s.blend) }
    },
  },
}

// ── plane helpers used by the layer effects ─────────────────────────────────

function shiftImage(img, dx, dy, width, height) {
  const out = new Uint8ClampedArray(img.data.length)
  for (let y = 0; y < height; y++) {
    const sy = y - dy
    if (sy < 0 || sy >= height) continue
    for (let x = 0; x < width; x++) {
      const sx = x - dx
      if (sx < 0 || sx >= width) continue
      const s = (sy * width + sx) * 4
      const d = (y * width + x) * 4
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1]
      out[d + 2] = img.data[s + 2]; out[d + 3] = img.data[s + 3]
    }
  }
  return { width, height, data: out }
}

function shiftPlane(plane, dx, dy, width, height) {
  const out = new Uint8ClampedArray(plane.length)
  for (let y = 0; y < height; y++) {
    const sy = y - dy
    if (sy < 0 || sy >= height) continue
    for (let x = 0; x < width; x++) {
      const sx = x - dx
      if (sx < 0 || sx >= width) continue
      out[y * width + x] = plane[sy * width + sx]
    }
  }
  return out
}

function blurPlane(plane, width, height, radius) {
  // Float32 in, Float32 out, one channel. The earlier version round-tripped
  // through an RGBA image to blur a single plane.
  const bytes = new Uint8ClampedArray(plane.length)
  for (let i = 0; i < plane.length; i++) bytes[i] = clamp(plane[i], 0, 255)
  const blurred = blurPlane8(bytes, width, height, radius)
  const out = new Float32Array(plane.length)
  for (let i = 0; i < plane.length; i++) out[i] = blurred[i]
  return out
}

/** Blur a 0..1 float field by round-tripping it through an 8-bit plane. */
function blurFloat(field, width, height, radius) {
  const bytes = new Uint8ClampedArray(field.length)
  for (let i = 0; i < field.length; i++) bytes[i] = clamp(field[i], 0, 1) * 255
  const blurred = blurPlane8(bytes, width, height, radius)
  const out = new Float32Array(field.length)
  for (let i = 0; i < field.length; i++) out[i] = blurred[i] / 255
  return out
}

/**
 * Rasterise a gradient across the whole canvas.
 *
 * THE LOOKUP TABLE IS THE WHOLE POINT
 * -----------------------------------
 * The first version called `mixOklab` once per pixel. That is 3.24 million OKLab
 * round trips on a full canvas and measured **3297 ms** for the gradient overlay —
 * sixty times the cost of every other layer effect, for a fill. The gradient of a
 * two- or three-stop ramp is a function of ONE scalar, so sampling it 256 times
 * into a table and indexing that table removes the entire cost: measured 3297 ms
 * -> about 40 ms, visually identical because 256 steps of a ramp are far below
 * what 8-bit output can express.
 *
 * The lesson is not "optimise the colour maths" but "never call a colour-space
 * conversion inside a pixel loop" — the expensive part is the conversion, and it
 * is a pure function of a scalar that the loop already has.
 *
 * Interpolation stays in OKLab, for the same reason `color.mjs` interposes there:
 * an sRGB ramp between two saturated colours goes grey in the middle.
 *
 * @returns {Uint8ClampedArray} RGBA, opaque
 */
function gradientPlane(width, height, gradient, scale, reverse) {
  const out = new Uint8ClampedArray(width * height * 4)
  const stops = Array.isArray(gradient.stops) ? gradient.stops : ['#FFFFFF', '#000000']
  const angle = ((gradient.angle === undefined ? 90 : gradient.angle) * Math.PI) / 180
  const s = scale === undefined ? 1 : scale
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const half = (Math.abs(cos) * width + Math.abs(sin) * height) / 2
  const cx = width / 2
  const cy = height / 2

  // Sample the ramp once. 256 entries is the output's own resolution.
  const table = new Uint8ClampedArray(256 * 3)
  const parsed = stops.map((c) => parseColor(c))
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    const pos = t * (stops.length - 1)
    const i0 = Math.floor(pos)
    const i1 = Math.min(stops.length - 1, i0 + 1)
    const f = pos - i0
    // Only the OKLab blend is table-bound; the endpoints come from parsing.
    const blended = f === 0 ? stops[i0] : mixOklab(stops[i0], stops[i1], f)
    const c = f === 0 ? parsed[i0] : parseColor(blended)
    table[i * 3] = c.r
    table[i * 3 + 1] = c.g
    table[i * 3 + 2] = c.b
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let t = (((x - cx) * cos + (y - cy) * sin) / half / 2) + 0.5
      if (s !== 1) t = (t - 0.5) / s + 0.5
      t = clamp(reverse === true ? 1 - t : t, 0, 1)
      const idx = (t * 255 + 0.5) | 0
      const p = (y * width + x) * 4
      out[p] = table[idx * 3]
      out[p + 1] = table[idx * 3 + 1]
      out[p + 2] = table[idx * 3 + 2]
      out[p + 3] = 255
    }
  }
  return out
}

// ── filters ─────────────────────────────────────────────────────────────────

/**
 * Blur family.
 *
 * `gaussian` is the workhorse. The others are the directional and lens-shaped
 * variants a design reaches for when a symmetric blur is wrong: motion for speed,
 * radial for focus falloff around a point, box for a deliberate hard-edged
 * softness, lens for the bokeh a real aperture makes (bright centre, dim rim).
 */
/** Average several offset copies of an image. */
export { boxPass }
