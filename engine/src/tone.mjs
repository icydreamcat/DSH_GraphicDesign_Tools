/**
 * Tone and texture operations.
 *
 * This is the module that decides whether a design reads as *designed* or as
 * *assembled*, because the single most transferable finding from the previous
 * attempt's review was:
 *
 *   > The reference's complexity comes from HIGH FREQUENCY, LOW CONTRAST —
 *   > very many elements, each extremely faint. What was produced instead was
 *   > LOW FREQUENCY, HIGH CONTRAST — few elements, each heavy. That is why it
 *   > looked clumsy.
 *
 * Texture is how frequency is raised without raising contrast. A halftone dot
 * field at 6% opacity, a 2% grain, a 4%-strength tint wipe: each adds an order
 * of magnitude more visual events per square centimetre while leaving the
 * overall tonal range almost untouched. None of it is achievable with flat
 * fills, and all of it is what separates a vector-looking composition from a
 * printed one.
 *
 * Everything here operates on raw RGBA `Uint8ClampedArray` buffers rather than
 * on canvas drawing calls, because these are per-pixel operations. Keeping them
 * pure — buffer in, buffer out — also makes them testable without a canvas,
 * which matters for the verification path.
 */

import { parseColor, clamp, relativeLuminance } from './color.mjs'

/**
 * Ordered-dither threshold matrix (8x8 Bayer).
 *
 * Bayer rather than random because the resulting dot field has a regular
 * lattice, which is what makes a halftone read as a *screen* (a deliberate
 * print artifact) rather than as noise (film grain). The two are different
 * design decisions and the engine offers both.
 */
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
]

/**
 * Classic AM halftone screen: variable-radius dots on a rotated lattice.
 *
 * This is the real thing rather than a dither approximation, because the
 * reference language uses halftone as a *tonal* tool — dots that grow with
 * darkness and fade out where the field should disappear.
 *
 * TWO THINGS THAT ARE EASY TO GET WRONG, AND WERE
 * ----------------------------------------------
 * 1. **How big the dots are.** A dot of radius r covers πr² of its cell². For
 *    a dot to reach 50% ink on a square lattice it needs r ≈ 0.4·cell, NOT
 *    r ≈ cell — at r = 0.63·cell the disc already spills past the cell and
 *    neighbouring discs merge, which produces a solid field rather than a dot
 *    screen. The first version of this function used a default maximum of
 *    0.72·cell and consequently turned any dark source into ~99% ink, which is
 *    precisely the "few elements, each heavy" failure this engine exists to
 *    avoid. `maxTone` now caps the radius by *area*, so the number means what a
 *    designer expects: maxTone 0.3 covers at most 30% of the cell.
 *
 * 2. **What drives the dot size.** Dot radius must follow the *tone* being
 *    depicted, not the luminance of the ink colour. Deriving it from the ink
 *    makes a dark ink produce huge dots and a pale ink tiny ones, which
 *    inverts the intent — a dark olive field should not be 99% ink. `tone`
 *    therefore selects what drives the radius, and the ink colour only decides
 *    what colour the dots are.
 *
 * As a texture overlay the intended use is `maxTone` around 0.15-0.35 with a
 * low-alpha ink: many small marks, barely visible. That combination is what
 * raises spatial frequency without raising contrast.
 *
 * @param {{width:number, height:number, data:Uint8ClampedArray}} target
 * @param {object} spec
 * @returns {{dots:number, coverage:number, maxTone:number, toneSource:string}}
 */
export function halftoneScreen(target, spec) {
  const cell = spec.cell === undefined ? 6 : spec.cell
  const angle = ((spec.angle === undefined ? 45 : spec.angle) * Math.PI) / 180
  const gamma = spec.gamma === undefined ? 1 : spec.gamma
  const color = parseColor(spec.color === undefined ? '#000000' : spec.color)
  const maxTone = clamp(spec.maxTone === undefined ? 0.35 : spec.maxTone, 0.001, 1)
  // Radius for a target *area* fraction: πr² = maxTone·cell².
  const maxRadius = cell * Math.sqrt(maxTone / Math.PI)
  const invert = spec.invert === true
  const alphaScale = spec.alpha === undefined ? 1 : spec.alpha
  const toneSource = spec.tone === undefined ? 'source' : typeof spec.tone === 'number' ? 'flat' : 'gradient'
  const flatTone = typeof spec.tone === 'number' ? clamp(spec.tone, 0, 1) : null

  const { width, height, data } = target
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  // The shape's own coverage, captured before anything else reads the buffer.
  //
  // `applyToneInBox` implements "the dot screen replaces the shape's fill" by
  // filling the whole RGBA buffer with zero — which also wipes the alpha
  // channel. The per-pixel `sourceInk < 0.03` guard further down then skips
  // every pixel, because in a cleared buffer there is no ink anywhere, and the
  // screen draws NOTHING. Measured on a 2400x3394 sheet with an ink rect and a
  // coverage ramp: `{dots: 0, coverage: 0}` — while every other line of the
  // render report looked correct, so nothing flagged it.
  //
  // Reusing the destroyed buffer's alpha is impossible, so the coverage is
  // captured here instead. That is also the behaviour the docs describe: the
  // screen takes the SHAPE's silhouette, which is how a screen declared over a
  // cutout follows the figure's outline rather than its bounding rectangle.
  //
  // When the caller has already cleared the buffer (`replace: true`), nothing
  // survives to measure — and for a shape that was solid ink, every pixel in its
  // box is covered, so the correct reading is "fully covered" rather than
  // "empty". That is exactly the case the old code got backwards.
  //
  // The reading cannot be recovered from a cleared buffer, so a caller that clears it
  // supplies the pre-clear pixels here as `spec.shapeSource`. Two things then come
  // from the original layer rather than the emptied one:
  //
  //   * the SILHOUETTE, which decides where a screen exists at all;
  //   * the SOURCE TONE, since `tone: 'source'` reads luminance and a cleared buffer
  //     is black everywhere — so the screen would be uniformly dense instead of
  //     following the artwork.
  //
  // Measured without this: `replace: true` produced byte-identical output to no
  // replace at all, because the screen saw an empty silhouette and drew no dots,
  // while still reporting 7007 of them.
  const shapeSource = spec.shapeSource === undefined ? data : spec.shapeSource
  const shapeCoverage = new Uint8Array(width * height)
  let shapeAlphaPresent = false
  for (let i = 0, p = 3; i < width * height; i++, p += 4) {
    const a = shapeSource[p]
    shapeCoverage[i] = a
    if (a > 8) shapeAlphaPresent = true
  }

  // An optional coverage ramp, applied to the derived tone before the radius is
  // computed. Because radius goes as sqrt(tone) and area as tone, shaping the
  // ramp here shapes the dot AREA — which is what "fade the field out" means
  // tonally, as opposed to fading the ink alpha, which only makes the same dots
  // paler. A ramp that reaches zero before the shape's own edge is how a dot
  // field is given no visible boundary at all.
  const coverage = Array.isArray(spec.coverage) && spec.coverage.length >= 2 ? spec.coverage : null

  // Rotated lattice bounds: iterate the lattice in its own space and map back,
  // so the pitch and angle stay exact instead of being skewed by the raster.
  const diag = Math.ceil(Math.hypot(width, height) / cell) + 2
  let dots = 0
  let inkPixels = 0

  for (let gy = -diag; gy <= diag; gy++) {
    for (let gx = -diag; gx <= diag; gx++) {
      const lx = gx * cell
      const ly = gy * cell
      const px = cos * lx - sin * ly + width / 2
      const py = sin * lx + cos * ly + height / 2
      if (px < -cell || py < -cell || px > width + cell || py > height + cell) continue

      // Position along the tone axis, normalised to the shape being drawn.
      //
      // This must be computed against the SHAPE's box, not the buffer's. Tone
      // operations run on a full-canvas buffer, so a panel occupying 28% of the
      // canvas has its local 0-1 mapped onto 0.60-0.88 of the buffer — meaning a
      // coverage ramp written as "0 at the start, 1 by 42%" was being evaluated
      // at 0.6 and was already saturated before the panel began. That is why a
      // field intended to fade to nothing across its own width stayed at full
      // strength right up to its edge. `rampOrigin`/`rampSize` carry the shape's
      // box in buffer pixels so the ramp means what it reads as.
      const originX = spec.rampOrigin === undefined ? 0 : spec.rampOrigin[0]
      const originY = spec.rampOrigin === undefined ? 0 : spec.rampOrigin[1]
      const sizeX = spec.rampSize === undefined ? width : spec.rampSize[0]
      const sizeY = spec.rampSize === undefined ? height : spec.rampSize[1]
      const u = clamp((px - originX) / Math.max(1e-6, sizeX), 0, 1)
      const v = clamp((py - originY) / Math.max(1e-6, sizeY), 0, 1)

      const sx = clamp(Math.round(px), 0, width - 1)
      const sy = clamp(Math.round(py), 0, height - 1)
      const idx = (sy * width + sx) * 4
      // A transparent pixel is not a dark pixel, and it is not a place to put
      // ink either.
      //
      // This check has to run for EVERY tone source, not only the source-driven
      // one. When the screen is declared on a shape whose ink is the figure
      // itself, a gradient-driven tone would otherwise paint its dots across the
      // shape's whole bounding box — including the empty area around the figure
      // — and the "screen over the subject" would read as a rectangle of dots
      // with a silhouette knocked out of it.
      //
      // `shapeCoverage` (captured at the top of this function) is the authority,
      // not the live buffer: under `replace` the live alpha has already been
      // zeroed by the caller, and reading it here skipped every pixel and drew
      // no screen at all.
      const sourceInk = shapeAlphaPresent ? shapeCoverage[sy * width + sx] / 255 : 1
      if (spec.respectAlpha !== false && shapeAlphaPresent && sourceInk < 0.03) continue

      let tone
      if (flatTone !== null) {
        tone = flatTone
      } else if (toneSource === 'gradient') {
        // A linear ramp across the shape, independent of the content — the way
        // a decorative dot field is usually laid down. 90 degrees (the default)
        // runs top to bottom, matching the scene gradient convention.
        const rad = ((spec.toneAngle === undefined ? 90 : spec.toneAngle) * Math.PI) / 180
        // Modulated by the source's own ink, so the gradient decides where the
        // screen is dense while the subject decides where it exists at all.
        tone = clamp(u * Math.cos(rad) + v * Math.sin(rad), 0, 1) * sourceInk
      } else {
        // Source tone: how dark the underlying pixel is, 0 (white) to 1 (black).
        // Read from `shapeSource` so a cleared buffer does not make the screen
        // uniformly black — without this, `replace` turned the tone into a constant.
        const lum = (0.2126 * shapeSource[idx] + 0.7152 * shapeSource[idx + 1] + 0.0722 * shapeSource[idx + 2]) / 255
        tone = invert ? lum : 1 - lum
      }
      tone = Math.pow(clamp(tone, 0, 1), gamma)
      // Shape the dot AREA through an optional coverage ramp. Applied after
      // gamma and before the radius, so the ramp describes how much ink the
      // field carries at each tone rather than how opaque the ink is.
      if (coverage !== null) tone = applyRamp(coverage, tone)
      const radius = maxRadius * Math.sqrt(tone)
      if (radius < 0.35) continue

      dots++
      // Rasterise the dot by direct pixel writes: at typical dot sizes this is
      // a few dozen pixels each, far cheaper than a canvas path per dot, and it
      // avoids the antialiasing seams that thousands of tiny paths produce.
      const r2 = radius * radius
      const x0 = Math.max(0, Math.floor(px - radius))
      const x1 = Math.min(width - 1, Math.ceil(px + radius))
      const y0 = Math.max(0, Math.floor(py - radius))
      const y1 = Math.min(height - 1, Math.ceil(py + radius))
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - px
          const dy = y + 0.5 - py
          const d2 = dx * dx + dy * dy
          if (d2 > r2) continue
          // Feather the last pixel of the radius so the dot edge is not a
          // jagged staircase at small sizes.
          const edge = clamp((radius - Math.sqrt(d2)) * 1.6, 0, 1)
          const i = (y * width + x) * 4
          const a = edge * color.a * alphaScale
          // Composite ink over whatever is already there.
          const dstA = data[i + 3] / 255
          const outA = a + dstA * (1 - a)
          if (outA > 0) {
            data[i] = clamp((color.r * a + data[i] * dstA * (1 - a)) / outA, 0, 255)
            data[i + 1] = clamp((color.g * a + data[i + 1] * dstA * (1 - a)) / outA, 0, 255)
            data[i + 2] = clamp((color.b * a + data[i + 2] * dstA * (1 - a)) / outA, 0, 255)
            data[i + 3] = outA * 255
          }
          inkPixels++
        }
      }
    }
  }
  return {
    dots,
    // Coverage is measured as ink laid *anywhere in the raster*, so a field of
    // partially transparent dots reports the area they touch. Combined with the
    // ink alpha this is what distinguishes "a wide field of almost invisible
    // marks" (high coverage, low alpha — the desired texture) from "a few solid
    // blobs" (low coverage, high alpha — the failure mode).
    coverage: inkPixels / (width * height),
    maxTone,
    toneSource,
  }
}

/**
 * Stochastic grain.
 *
 * Monochromatic by default, which is what a design wants: chroma noise reads
 * as a bad JPEG, while luminance noise reads as paper, film, or print. The
 * `mono` flag exists for the rare case where chromatic grain is the point.
 *
 * Deterministic when `seed` is set, so a render can be reproduced exactly —
 * essential when comparing two iterations of the same design.
 *
 * @param {{width:number, height:number, data:Uint8ClampedArray}} target
 * @param {object} spec
 * @returns {{applied:number, meanShift:number}}
 */
export function grain(target, spec) {
  const amount = clamp(spec.amount === undefined ? 0.03 : spec.amount, 0, 1)
  const mono = spec.mono !== false
  const seed = spec.seed === undefined ? null : spec.seed
  const rand = seed === null ? Math.random : mulberry32(seed)
  const { width, height, data } = target
  let applied = 0
  let sum = 0

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const n = (rand() - 0.5) * 2 * amount * 255
    sum += n
    if (mono) {
      data[i] = clamp(data[i] + n, 0, 255)
      data[i + 1] = clamp(data[i + 1] + n, 0, 255)
      data[i + 2] = clamp(data[i + 2] + n, 0, 255)
    } else {
      data[i] = clamp(data[i] + (rand() - 0.5) * 2 * amount * 255, 0, 255)
      data[i + 1] = clamp(data[i + 1] + (rand() - 0.5) * 2 * amount * 255, 0, 255)
      data[i + 2] = clamp(data[i + 2] + (rand() - 0.5) * 2 * amount * 255, 0, 255)
    }
    applied++
  }
  return { applied, meanShift: applied === 0 ? 0 : sum / applied }
}

/** Small deterministic PRNG so a seeded render is byte-reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Evaluate a piecewise-linear ramp defined as `[{at, value}]` with `at` on 0-1.
 *
 * Used to reshape tone before a dot radius is derived. Linear between control
 * points and clamped outside them, which is what makes "zero until this point,
 * full from that one" expressible without the ramp quietly overshooting.
 *
 * @param {{at:number, value:number}[]} points
 * @param {number} t
 * @returns {number}
 */
function applyRamp(points, t) {
  const x = clamp(t, 0, 1)
  if (x <= points[0].at) return clamp(points[0].value, 0, 1)
  const last = points[points.length - 1]
  if (x >= last.at) return clamp(last.value, 0, 1)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (x <= b.at) {
      const span = b.at - a.at
      if (span <= 0) return clamp(b.value, 0, 1)
      const u = (x - a.at) / span
      return clamp(a.value + (b.value - a.value) * u, 0, 1)
    }
  }
  return clamp(last.value, 0, 1)
}

/**
 * Map an image's luminance onto a two- or three-colour ramp.
 *
 * A duotone is the standard way to pull a full-colour illustration into a
 * designed palette without desaturating it into grey. Doing it in OKLab keeps
 * the shadow colour from turning to mud, and the optional midpoint lets a
 * three-stop ramp hold a hue at the midtone (a warm olive, say) rather than
 * passing straight through a desaturated average.
 *
 * @param {{width:number, height:number, data:Uint8ClampedArray}} target
 * @param {object} spec `{shadows, midtones?, highlights, strength?, preserveLuma?}`
 * @returns {{mapped:number}}
 */
export function duotone(target, spec) {
  const shadows = parseColor(spec.shadows === undefined ? '#1A1A1A' : spec.shadows)
  const highlights = parseColor(spec.highlights === undefined ? '#F5F5F0' : spec.highlights)
  const midtones = spec.midtones === undefined ? null : parseColor(spec.midtones)
  const strength = clamp(spec.strength === undefined ? 1 : spec.strength, 0, 1)
  const { data } = target
  let mapped = 0

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
    let r, g, b
    if (midtones !== null && lum < 0.5) {
      const t = lum * 2
      r = shadows.r + (midtones.r - shadows.r) * t
      g = shadows.g + (midtones.g - shadows.g) * t
      b = shadows.b + (midtones.b - shadows.b) * t
    } else if (midtones !== null) {
      const t = (lum - 0.5) * 2
      r = midtones.r + (highlights.r - midtones.r) * t
      g = midtones.g + (highlights.g - midtones.g) * t
      b = midtones.b + (highlights.b - midtones.b) * t
    } else {
      r = shadows.r + (highlights.r - shadows.r) * lum
      g = shadows.g + (highlights.g - shadows.g) * lum
      b = shadows.b + (highlights.b - shadows.b) * lum
    }
    data[i] = clamp(data[i] + (r - data[i]) * strength, 0, 255)
    data[i + 1] = clamp(data[i + 1] + (g - data[i + 1]) * strength, 0, 255)
    data[i + 2] = clamp(data[i + 2] + (b - data[i + 2]) * strength, 0, 255)
    mapped++
  }
  return { mapped }
}

/**
 * Apply a tone curve, as control points per channel.
 *
 * Curves are the single most useful tonal tool and the previous attempt could
 * not reach them, which is why its tone work was limited to opacity. A curve is
 * defined by control points and interpolated monotonically (Fritsch–Carlson),
 * NOT with a plain cubic spline: a natural spline overshoots between close
 * control points, and overshoot in a tone curve means values that go backwards
 * — visible as banding and a flipped highlight.
 *
 * Channels accept `rgb` plus per-channel `r`/`g`/`b`, each a list of
 * `[input, output]` pairs on a 0-255 scale. The identity curve is the default
 * for any channel not supplied.
 *
 * @param {{width:number, height:number, data:Uint8ClampedArray}} target
 * @param {object} spec `{rgb?, r?, g?, b?, a?}`
 * @returns {{applied:number, tables:object}}
 */
export function curves(target, spec) {
  const tables = {
    rgb: buildCurveTable(spec.rgb, 'rgb'),
    r: buildCurveTable(spec.r, 'r'),
    g: buildCurveTable(spec.g, 'g'),
    b: buildCurveTable(spec.b, 'b'),
    a: buildCurveTable(spec.a, 'a'),
  }
  const { data } = target
  let applied = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    // Composite order matches Photoshop: the per-channel curve first, then the
    // composite curve on the result. Getting this backwards is why hand-rolled
    // curve implementations disagree with what a designer sees in the app.
    data[i] = tables.rgb[tables.r[data[i]]]
    data[i + 1] = tables.rgb[tables.g[data[i + 1]]]
    data[i + 2] = tables.rgb[tables.b[data[i + 2]]]
    if (spec.a !== undefined) data[i + 3] = tables.a[data[i + 3]]
    applied++
  }
  return { applied, tables }
}

/**
 * Build a 256-entry lookup table from control points.
 *
 * @param {Array<[number, number]>|undefined} points
 * @param {string} channel
 * @returns {Uint8ClampedArray}
 */
export function buildCurveTable(points, channel) {
  const table = new Uint8ClampedArray(256)
  if (points === undefined || points === null || points.length === 0) {
    for (let i = 0; i < 256; i++) table[i] = i
    return table
  }
  if (points.length === 1) {
    const v = clamp(points[0][1], 0, 255)
    table.fill(v)
    return table
  }
  const xs = points.map((p) => clamp(p[0], 0, 255))
  const ys = points.map((p) => clamp(p[1], 0, 255))
  // Require strictly increasing input; a duplicate x would make the monotone
  // fit singular, and silently reordering would misrepresent the curve.
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] <= xs[i - 1]) {
      throw new Error(`curves(${channel}): control point inputs must strictly increase, got ${xs[i - 1]} then ${xs[i]}`)
    }
  }
  const tangents = monotoneTangents(xs, ys)
  let seg = 0
  for (let x = 0; x < 256; x++) {
    if (x <= xs[0]) { table[x] = ys[0]; continue }
    if (x >= xs[xs.length - 1]) { table[x] = ys[ys.length - 1]; continue }
    while (seg < xs.length - 2 && x > xs[seg + 1]) seg++
    const h = xs[seg + 1] - xs[seg]
    const t = (x - xs[seg]) / h
    const t2 = t * t
    const t3 = t2 * t
    // Hermite basis with monotone tangents.
    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2
    table[x] = h00 * ys[seg] + h10 * h * tangents[seg] + h01 * ys[seg + 1] + h11 * h * tangents[seg + 1]
  }
  return table
}

/** Fritsch–Carlson monotone tangents — the guard against curve overshoot. */
function monotoneTangents(xs, ys) {
  const n = xs.length
  const d = new Array(n - 1)
  const m = new Array(n)
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i])
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0
    else m[i] = (d[i - 1] + d[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const tau = 3 / Math.sqrt(s)
      m[i] = tau * a * d[i]
      m[i + 1] = tau * b * d[i]
    }
  }
  return m
}

/**
 * Hue / saturation / lightness adjustment.
 *
 * Performed in HSL rather than by channel arithmetic, because "desaturate by
 * 40%" has to mean the same thing for a saturated red and a near-grey — which
 * channel mixing cannot deliver. The optional `range` restricts the effect to a
 * band of hues, which is how a single accent colour is pulled back without
 * touching everything else in the frame.
 *
 * @param {{width:number, height:number, data:Uint8ClampedArray}} target
 * @param {object} spec `{hue?, saturation?, lightness?, range?}`
 * @returns {{applied:number, touched:number}}
 */
export function hueSaturation(target, spec) {
  const hueShift = spec.hue === undefined ? 0 : spec.hue
  const satScale = spec.saturation === undefined ? 0 : spec.saturation
  const lightScale = spec.lightness === undefined ? 0 : spec.lightness
  const range = spec.range === undefined ? null : spec.range
  const { data } = target
  let touched = 0

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const hsl = rgbToHsl(data[i], data[i + 1], data[i + 2])
    if (range !== null) {
      // Hue distance on a circle, so a band crossing 0/360 works.
      let dist = Math.abs(hsl.h - range.center)
      if (dist > 180) dist = 360 - dist
      if (dist > range.width) continue
    }
    const h = (hsl.h + hueShift + 360) % 360
    // Saturation moves toward 0 or toward 1 rather than scaling: scaling would
    // make an already-near-grey pixel stay grey, which is the opposite of what
    // "increase saturation" is expected to do.
    const s = satScale >= 0
      ? hsl.s + (1 - hsl.s) * satScale
      : hsl.s * (1 + satScale)
    const l = lightScale >= 0
      ? hsl.l + (1 - hsl.l) * lightScale
      : hsl.l * (1 + lightScale)
    const rgb = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1))
    data[i] = rgb[0]
    data[i + 1] = rgb[1]
    data[i + 2] = rgb[2]
    touched++
  }
  return { applied: data.length / 4, touched }
}

/** Desaturate toward the luminance grey. */
export function desaturate(target, amount) {
  const k = clamp(amount === undefined ? 1 : amount, 0, 1)
  const { data } = target
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    data[i] = data[i] + (lum - data[i]) * k
    data[i + 1] = data[i + 1] + (lum - data[i + 1]) * k
    data[i + 2] = data[i + 2] + (lum - data[i + 2]) * k
  }
  return { amount: k }
}

/**
 * Multiply a soft-light-style tone wipe across the buffer.
 *
 * This is the "local appearance" tool: the review's complaint was that a field
 * covered the whole canvas uniformly where the reference had it appear only in
 * part of the frame and fade out. A wipe is that gradient, applied to tone
 * rather than to alpha, so the underlying design stays visible while its weight
 * changes across the page.
 *
 * @param {{width:number, height:number, data:Uint8ClampedArray}} target
 * @param {object} spec `{angle, from, to, color, midpoint}`
 * @returns {{applied:number}}
 */
export function toneWipe(target, spec) {
  const angle = ((spec.angle === undefined ? 0 : spec.angle) * Math.PI) / 180
  const from = spec.from === undefined ? 0 : spec.from
  const to = spec.to === undefined ? 0.22 : spec.to
  const midpoint = spec.midpoint === undefined ? 0.5 : spec.midpoint
  const color = parseColor(spec.color === undefined ? '#000000' : spec.color)
  const { width, height, data } = target
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const half = (Math.abs(cos) * width + Math.abs(sin) * height) / 2
  const cx = width / 2
  const cy = height / 2

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] === 0) continue
      const proj = ((x - cx) * cos + (y - cy) * sin) / half / 2 + 0.5
      // Smoothstep around the midpoint keeps the wipe free of a visible seam,
      // which a linear ramp across a large area always shows on a gradient.
      const t = clamp((proj - midpoint) / Math.max(1e-6, 1 - Math.abs(2 * midpoint - 1)) + 0.5, 0, 1)
      const eased = t * t * (3 - 2 * t)
      const k = from + (to - from) * eased
      data[i] = clamp(data[i] + (color.r - data[i]) * k, 0, 255)
      data[i + 1] = clamp(data[i + 1] + (color.g - data[i + 1]) * k, 0, 255)
      data[i + 2] = clamp(data[i + 2] + (color.b - data[i + 2]) * k, 0, 255)
    }
  }
  return { applied: width * height }
}

/** RGB (0-255) -> HSL with h in degrees, s/l in 0-1. */
export function rgbToHsl(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  else if (max === gn) h = ((bn - rn) / d + 2) * 60
  else h = ((rn - gn) / d + 4) * 60
  return { h, s, l }
}

/** HSL -> `[r,g,b]` 0-255. */
export function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = l * 255
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hk = h / 360
  const conv = (t) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return [conv(hk + 1 / 3) * 255, conv(hk) * 255, conv(hk - 1 / 3) * 255]
}

/**
 * A quiet measure of how much visual "event" a buffer carries per unit area.
 *
 * The review's core insight was about frequency, so the engine needs to be able
 * to state it numerically: mean absolute luminance gradient over the buffer.
 * A flat fill scores near 0; a halftone dot field at low opacity scores far
 * higher while its contrast (standard deviation) stays low. Reporting both is
 * what makes "high frequency, low contrast" a target that can be hit rather
 * than a slogan.
 *
 * @param {{width:number, height:number, data:Uint8ClampedArray}} img
 * @returns {{frequency:number, contrast:number, meanLuma:number}}
 */
export function textureStats(img) {
  const { width, height, data } = img
  let gradSum = 0
  let gradCount = 0
  let lumaSum = 0
  let lumaSqSum = 0
  let n = 0
  const luma = (i) => (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255

  for (let y = 1; y < height; y++) {
    for (let x = 1; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 8) continue
      const l = luma(i)
      const left = (y * width + x - 1) * 4
      const up = ((y - 1) * width + x) * 4
      if (data[left + 3] >= 8) { gradSum += Math.abs(l - luma(left)); gradCount++ }
      if (data[up + 3] >= 8) { gradSum += Math.abs(l - luma(up)); gradCount++ }
      lumaSum += l
      lumaSqSum += l * l
      n++
    }
  }
  const mean = n === 0 ? 0 : lumaSum / n
  const variance = n === 0 ? 0 : Math.max(0, lumaSqSum / n - mean * mean)
  return {
    frequency: gradCount === 0 ? 0 : gradSum / gradCount,
    contrast: Math.sqrt(variance),
    meanLuma: mean,
  }
}

/** Mean relative luminance of a buffer, for tone reporting. */
export function meanLuminance(img) {
  const { data } = img
  let sum = 0
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    sum += relativeLuminance({ r: data[i], g: data[i + 1], b: data[i + 2] })
    n++
  }
  return n === 0 ? 0 : sum / n
}
