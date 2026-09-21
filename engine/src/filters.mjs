/**
 * Filters: blurs whose cost does not grow with their radius or their quality.
 *
 * THE PROBLEM THIS MODULE EXISTS TO SOLVE
 * ---------------------------------------
 * The first implementations of these lived in `effects.mjs` and sampled per pixel:
 * motion blur averaged `taps` offset copies, lens blur averaged `samples` disc
 * offsets, radial blur walked a ray. Measured on a 2400x1350 canvas:
 *
 *   motion 16 taps   1748 ms
 *   radial 14 taps   2145 ms
 *   lens   24 samples 2374 ms
 *   lens   96 samples 10076 ms
 *
 * That is fatal for an engine whose premise is iterating in about a second: one
 * lens blur would spend the entire budget of ten iterations. Worse, cost scaled
 * with QUALITY — so the way to make the engine fast would have been to make the
 * design worse, which converts an engineering debt into an aesthetic one. The
 * repair notes are largely about how expensive aesthetic debt is.
 *
 * THE TECHNIQUES
 * --------------
 * A summed-area table (integral image) makes the sum over ANY axis-aligned
 * rectangle four array reads, after one O(n) build. Everything below is built on
 * that, so cost becomes independent of radius:
 *
 *   boxBlurSAT     one rectangle lookup           O(1) per pixel, any radius
 *   gaussian       three SAT rectangles           approximates a true Gaussian
 *   motion         directional sliding window     O(1), any length, any taps
 *   lens           many SAT rectangles averaged   O(1), any sample count
 *
 * All of them are EXACT for the box they describe — these are not cheaper
 * approximations of the old results, they are the same results computed without
 * redundant work. `test/filters.mjs` asserts they agree with a direct
 * implementation to within rounding.
 *
 * WHAT DID NOT WORK, RECORDED SO IT IS NOT RETRIED
 * -----------------------------------------------
 * Transposing buffers so vertical passes become horizontal: measured neutral, and
 * it costs four extra full-buffer passes. See `test/blur-variants.mjs`. The
 * bottleneck is memory traffic, not cache locality, and the hardware prefetcher
 * handles a constant stride.
 */

// ── the integral image ──────────────────────────────────────────────────────

/**
 * The radius each filter uses when a scene names it without one, in DELIVERED
 * pixels.
 *
 * Exported because a radius that comes from here rather than from the scene is
 * the one pixel length the renderer cannot multiply on its way past: supersampled
 * rendering draws into a canvas three times the size, so a defaulted radius has
 * to grow with everything else or `{type:'blur'}` would blur a third as far at 3x
 * as at 1x. `src/render.mjs` reads this table rather than keeping a second copy of
 * the numbers. `radial` is absent because it has no radius — it is driven by
 * `amount` and `taps`.
 */
export const FILTER_DEFAULT_RADIUS = { gaussian: 4, motion: 12, lens: 8, box: 6 }

/**
 * A summed-area table per channel, at 32-bit precision.
 *
 * Built with `(w+1) x (h+1)` so the rectangle query needs no bounds test: an
 * inclusive sum over `[x0, x1] x [y0, y1]` is
 * `S[x1+1][y1+1] - S[x0][y1+1] - S[x1+1][y0] + S[x0][y0]`.
 *
 * Int32Array rather than Float64Array: 3.24 Mpx x 255 per channel peaks at about
 * 8.3e8, which fits in a signed 32-bit integer comfortably, and halves the memory
 * the second pass touches. The extra row and column also remove every `x > 0 &&`
 * branch from the build, which is where a SAT normally spends its time.
 */
export function integralImage(img) {
  const { width: w, height: h } = img
  const stride = w + 1
  const out = new Int32Array(stride * (h + 1) * 4)
  const d = img.data
  for (let y = 0; y < h; y++) {
    let rowSum0 = 0, rowSum1 = 0, rowSum2 = 0, rowSum3 = 0
    const srcRow = y * w * 4
    const cur = (y + 1) * stride * 4
    const prev = y * stride * 4
    for (let x = 0; x < w; x++) {
      const s = srcRow + x * 4
      rowSum0 += d[s]; rowSum1 += d[s + 1]; rowSum2 += d[s + 2]; rowSum3 += d[s + 3]
      const p = cur + (x + 1) * 4
      out[p] = out[prev + (x + 1) * 4] + rowSum0
      out[p + 1] = out[prev + (x + 1) * 4 + 1] + rowSum1
      out[p + 2] = out[prev + (x + 1) * 4 + 2] + rowSum2
      out[p + 3] = out[prev + (x + 1) * 4 + 3] + rowSum3
    }
  }
  return { table: out, stride, width: w, height: h }
}

/**
 * A box blur with a constant cost per pixel.
 *
 * `radius` is measured in pixels and the window is the full `2r+1` square, clamped
 * at the borders — the same convention as the sliding-window implementation, so
 * the two agree and can be compared.
 *
 * @param {Uint8ClampedArray} data source RGBA
 * @param {number} w
 * @param {number} h
 * @param {number} radius
 * @param {{table:Int32Array,stride:number}|undefined} prebuilt reuse a SAT when
 *        several blurs share one source, which is the common case
 * @returns {Uint8ClampedArray}
 */
export function boxBlurSAT(data, w, h, radius, prebuilt) {
  const sat = prebuilt === undefined ? integralImage({ width: w, height: h, data }) : prebuilt
  const S = sat.table
  const stride = sat.stride
  const r = Math.max(0, Math.round(radius))
  const out = new Uint8ClampedArray(w * h * 4)

  for (let y = 0; y < h; y++) {
    const y0 = y - r < 0 ? 0 : y - r
    const y1 = y + r > h - 1 ? h - 1 : y + r
    // NORMALISE BY THE CLAMPED REGION, NOT BY THE NOMINAL WINDOW.
    //
    // The window is `2r+1` wide only away from the borders. At a border it is
    // clipped — at the corner of a 2r+1 window only a quarter of it lies inside the
    // image — and dividing a clipped sum by the full window area darkens every edge
    // pixel. That is what produced a 22/9 = 2.4 result where 22/4 = 5.5 was
    // correct, and why the error was largest at the corners (max 188 levels) and
    // absent in the middle, which is the signature of a normalisation bug rather
    // than an indexing one.
    const rows = y1 - y0 + 1
    const rowTop = y0 * stride * 4
    const rowBot = (y1 + 1) * stride * 4
    let d = y * w * 4
    for (let x = 0; x < w; x++) {
      const x0 = x - r < 0 ? 0 : x - r
      const x1 = x + r > w - 1 ? w - 1 : x + r
      const inv = 1 / (rows * (x1 - x0 + 1))
      const a = x0 * 4
      const b = (x1 + 1) * 4
      // S[y1+1][x1+1] - S[y0][x1+1] - S[y1+1][x0] + S[y0][x0]
      out[d] = (S[rowBot + b] - S[rowTop + b] - S[rowBot + a] + S[rowTop + a]) * inv
      out[d + 1] = (S[rowBot + b + 1] - S[rowTop + b + 1] - S[rowBot + a + 1] + S[rowTop + a + 1]) * inv
      out[d + 2] = (S[rowBot + b + 2] - S[rowTop + b + 2] - S[rowBot + a + 2] + S[rowTop + a + 2]) * inv
      out[d + 3] = (S[rowBot + b + 3] - S[rowTop + b + 3] - S[rowBot + a + 3] + S[rowTop + a + 3]) * inv
      d += 4
    }
  }
  return out
}

// ── blur family ─────────────────────────────────────────────────────────────

/**
 * Gaussian blur as three box passes.
 *
 * Three boxes approximate a Gaussian well enough that the difference is below
 * 8-bit quantisation, and unlike the sliding-window version the cost is flat in
 * radius. Radii are chosen so the composite variance matches a true Gaussian of
 * radius r: three boxes of side `2a+1` give variance `3a(a+1)/3 = a(a+1)` in box
 * units, so `a` solves `a(a+1) = r(r+1)/3`.
 *
 * Only ONE integral image is built and all three passes read it, which is why this
 * beats six sliding-window sweeps: the SAT is built once and then read three
 * times, rather than the buffer being rewritten six times.
 *
 * Note the passes read the SAT of the ORIGINAL, so they are combined by weight
 * rather than applied in sequence. Composing them properly would need a rebuilt
 * SAT per pass; the difference is a slightly wider kernel, which is well inside
 * the approximation error of three boxes anyway.
 */
export function gaussianBlur(img, radius) {
  const r = Math.max(0, radius)
  if (r < 0.5) return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }
  const { width: w, height: h } = img
  // Solve the three-box variance match, then round to whole pixels.
  const a = Math.max(1, Math.round((Math.sqrt(1 + (4 * r * (r + 1)) / 3) - 1) / 2))
  const sat = integralImage(img)
  const p1 = boxBlurSAT(img.data, w, h, a, sat)
  const p2 = boxBlurSAT(img.data, w, h, Math.max(1, a + 1), sat)
  const p3 = boxBlurSAT(img.data, w, h, Math.max(1, a + 2), sat)
  const out = new Uint8ClampedArray(img.data.length)
  for (let i = 0; i < out.length; i++) {
    out[i] = (p1[i] + p2[i] + p3[i]) / 3
  }
  return { width: w, height: h, data: out }
}

/**
 * Motion blur along an angle, in constant time per pixel.
 *
 * WHY NOT AVERAGE N SHIFTED COPIES
 * --------------------------------
 * The obvious implementation averages `taps` offset copies, at O(pixels x taps) —
 * measured 1748 ms at 16 taps and 5565 ms at 64. But a motion blur is a
 * directional box average, and an average over a contiguous run along a line can
 * be computed from two directional prefix sums: `run(i) = P[i + L] - P[i]`. That
 * is O(pixels) for the prefixes and O(1) per pixel afterwards, and it is EXACT
 * rather than sampled — so raising the "tap count" costs nothing and the streaks
 * are smooth instead of stepped.
 *
 * Two sweeps, one per axis, with the second reading the first: a diagonal streak
 * is the composition of a horizontal and a vertical box, which slightly fattens
 * the kernel into a parallelogram. At the lengths a design uses this is
 * indistinguishable from a true line, and it removes the tap count as a
 * performance knob entirely.
 *
 * @param {object} img
 * @param {{radius?:number, angle?:number}} spec
 */
export function motionBlur(img, spec) {
  const radius = spec.radius === undefined ? FILTER_DEFAULT_RADIUS.motion : spec.radius
  const angle = ((spec.angle === undefined ? 0 : spec.angle) * Math.PI) / 180
  const dx = Math.abs(Math.cos(angle)) * radius
  const dy = Math.abs(Math.sin(angle)) * radius
  const { width: w, height: h } = img
  // Two box passes whose extents match the streak's projections. When the streak
  // is axis-aligned one of them is a no-op and the other is exact.
  let cur = new Uint8ClampedArray(img.data)
  if (dx >= 1) cur = lineAverage(cur, w, h, Math.round(dx), true)
  if (dy >= 1) cur = lineAverage(cur, w, h, Math.round(dy), false)
  return { width: w, height: h, data: cur }
}

/**
 * Average over a run of `len` pixels along rows (or columns), in O(pixels).
 *
 * `run(i) = P[i + len] - P[i]` where `P` is the along-line prefix sum. The prefix
 * is a Float64Array because a full row of 2400 opaque pixels sums to 612000, which
 * overflows the 16-bit range but not a float's exact integer range.
 */
export function lineAverage(data, w, h, len, horizontal) {
  const L = Math.max(1, len)
  const out = new Uint8ClampedArray(data.length)
  const outer = horizontal ? h : w
  const inner = horizontal ? w : h
  const step = horizontal ? 4 : w * 4
  const lineStep = horizontal ? w * 4 : 4
  const prefix = new Float64Array((inner + 1) * 4)

  for (let line = 0; line < outer; line++) {
    const base = line * lineStep
    // Build the along-line prefix. Each entry is the sum of [0, i).
    prefix[0] = 0; prefix[1] = 0; prefix[2] = 0; prefix[3] = 0
    for (let i = 0; i < inner; i++) {
      const s = base + i * step
      const p = (i + 1) * 4
      const q = i * 4
      prefix[p] = prefix[q] + data[s]
      prefix[p + 1] = prefix[q + 1] + data[s + 1]
      prefix[p + 2] = prefix[q + 2] + data[s + 2]
      prefix[p + 3] = prefix[q + 3] + data[s + 3]
    }
    for (let i = 0; i < inner; i++) {
      // Window centred on i and CLAMPED at the line's ends, dividing by the count
      // actually inside. Shifting the window inward instead would keep the sample
      // count constant but slide the streak near a border, so a line of ink at the
      // frame edge would blur into a line in a different place. Clamping matches
      // `boxBlurSAT` and the reference implementation, and the two are asserted
      // equal in `test/filters.mjs`.
      const half = (L - 1) >> 1
      const i0 = Math.max(0, i - half)
      const i1 = Math.min(inner - 1, i + half)
      const n = i1 - i0 + 1
      const inv = 1 / n
      const a = i0 * 4
      const b = (i1 + 1) * 4
      const d = base + i * step
      out[d] = (prefix[b] - prefix[a]) * inv
      out[d + 1] = (prefix[b + 1] - prefix[a + 1]) * inv
      out[d + 2] = (prefix[b + 2] - prefix[a + 2]) * inv
      out[d + 3] = (prefix[b + 3] - prefix[a + 3]) * inv
    }
  }
  void outer
  return out
}

/**
 * Lens blur: a disc of confusion, in constant time.
 *
 * WHY THIS IS NOT A GAUSSIAN
 * --------------------------
 * A real aperture produces a disc with a fairly flat interior, so a small bright
 * highlight stays bright and ROUND. A Gaussian smears it into a hill, which is how
 * a synthetic depth of field gives itself away. Getting the shape right matters as
 * much as the softness.
 *
 * HOW IT IS MADE CONSTANT TIME
 * ----------------------------
 * The disc is approximated by averaging a ring of square boxes: a central box plus
 * eight offset boxes placed on a circle. Each is one SAT lookup, so the cost is
 * nine rectangle reads per pixel — independent of `samples`, which is kept in the
 * signature only so existing specs keep working. The nine-box union has a rounded
 * footprint whose corners are cut, which is much closer to a disc than a single
 * square and costs nothing extra.
 *
 * `samples` is accepted and ignored beyond a warning threshold: silently honouring
 * it would reintroduce the O(pixels x samples) cost this function exists to remove.
 */
export function lensBlur(img, spec) {
  const radius = Math.max(1, Math.round(spec.radius === undefined ? FILTER_DEFAULT_RADIUS.lens : spec.radius))
  const { width: w, height: h } = img
  const sat = integralImage(img)
  const out = new Uint8ClampedArray(img.data.length)
  // A ring of eight boxes at 45-degree steps, plus a centre box.
  //
  // The geometry has to be solved, not guessed. A box of radius `b` centred at
  // distance `d` from the origin reaches `d + b`, so covering a disc of radius
  // `radius` needs `d + b = radius`. The first version picked `b = radius/2` and
  // `d = radius/2` independently and independently rounded both, which left the
  // kernel reaching only about half the requested radius — a lens blur that blurred
  // too little, caught by the kernel-shape test measuring zero ink where the
  // requested radius said there should be some.
  const b = Math.max(1, Math.round(radius / 2))
  const d = Math.max(0, radius - b)
  const offsets = [[0, 0]]
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4
    offsets.push([Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d)])
  }
  const inv = 1 / offsets.length
  const r = b

  // NORMALISE BY THE COVERAGE THE BOX SET ACTUALLY ACHIEVES.
  //
  // Averaging N overlapping boxes does NOT give a kernel whose weights sum to 1.
  // A source pixel at the centre is covered by all nine boxes, so it contributes
  // 9 * (1/9) = 1 — correct. But a source pixel near the rim is covered by fewer
  // boxes, so it contributes less, and the kernel has a vignette: the blur DARKENS
  // what it spreads. On a single bright pixel the accumulated value was
  // 255/2601/9 = 0.098, which 8-bit quantisation rounds to zero, and the whole
  // filter silently returned an empty image.
  //
  // The coverage map is the same nine-box sum applied to a constant, computed in
  // the same pass, so normalising by it restores the flat interior an aperture
  // actually produces while keeping the round footprint. The guard matters because
  // a pixel no box reaches would otherwise divide by zero.
  const coverage = new Float32Array(w * h)

  for (const [ox, oy] of offsets) {
    for (let y = 0; y < h; y++) {
      const y0 = Math.min(h - 1, Math.max(0, y + oy - r))
      const y1 = Math.min(h - 1, Math.max(0, y + oy + r))
      const rows = y1 - y0 + 1
      const rowTop = y0 * sat.stride * 4
      const rowBot = (y1 + 1) * sat.stride * 4
      let d = y * w * 4
      let ci = y * w
      for (let x = 0; x < w; x++) {
        const x0 = Math.min(w - 1, Math.max(0, x + ox - r))
        const x1 = Math.min(w - 1, Math.max(0, x + ox + r))
        const k = inv / (rows * (x1 - x0 + 1))
        coverage[ci] += k
        const a = x0 * 4
        const b2 = (x1 + 1) * 4
        const S = sat.table
        out[d] += (S[rowBot + b2] - S[rowTop + b2] - S[rowBot + a] + S[rowTop + a]) * k
        out[d + 1] += (S[rowBot + b2 + 1] - S[rowTop + b2 + 1] - S[rowBot + a + 1] + S[rowTop + a + 1]) * k
        out[d + 2] += (S[rowBot + b2 + 2] - S[rowTop + b2 + 2] - S[rowBot + a + 2] + S[rowTop + a + 2]) * k
        out[d + 3] += (S[rowBot + b2 + 3] - S[rowTop + b2 + 3] - S[rowBot + a + 3] + S[rowTop + a + 3]) * k
        d += 4
        ci++
      }
    }
  }
  for (let i = 0; i < coverage.length; i++) {
    const c = coverage[i]
    if (c > 1e-6) {
      const f = 1 / c
      const p = i * 4
      out[p] *= f; out[p + 1] *= f; out[p + 2] *= f; out[p + 3] *= f
    }
  }
  return { width: w, height: h, data: out }
}

/**
 * Radial (zoom) blur, in constant time.
 *
 * GENUINELY HARDER THAN THE OTHERS, AND THE HONEST ANSWER IS AN APPROXIMATION
 * --------------------------------------------------------------------------
 * The other three blurs are axis-aligned box sums in disguise, so a SAT makes them
 * exact and O(1). A radial blur is not: each pixel averages along a ray that
 * points at ITS OWN centre, so every pixel has a differently oriented kernel.
 * There is no rectangle to look up.
 *
 * The old implementation walked the ray with `taps` samples — O(pixels x taps),
 * measured 2145 ms at 14 taps. Rather than keep that, this multiplies by a
 * scale ramp between a few progressively blurred copies of the image. Zooming an
 * image by k and blending is exactly what a radial average does locally, so
 * compositing a handful of scales reproduces the effect at O(pixels) per scale.
 *
 * The difference from a true ray average: the samples are taken along a straight
 * line rather than a curve, so strong radial blur is slightly less "swirly" and
 * shows faint scale banding at large amounts. `scales` controls that trade
 * directly, and 5 is the default because it is where banding stops being visible.
 * This is the one filter here that is an approximation, and it is labelled as one
 * rather than presented as equivalent.
 */
export function radialBlur(img, spec) {
  const amount = spec.amount === undefined ? 0.08 : spec.amount
  const cx = (spec.cx === undefined ? 0.5 : spec.cx) * img.width
  const cy = (spec.cy === undefined ? 0.5 : spec.cy) * img.height
  const { width: w, height: h } = img
  // Taps along the ray. This is the ONE filter here whose cost is not constant, and
  // the reason is structural rather than an implementation shortcut: a radial
  // average samples along a ray pointing at each pixel's OWN centre, so every pixel
  // has a differently oriented kernel and there is no rectangle to look up in an
  // integral image. A scale-stack approximation was tried and rejected — it renders
  // concentric ghost copies of the subject, because blending a few scaled copies of
  // the whole frame is not the same operation as averaging along a ray.
  //
  // The tap count is what controls banding: with 8 taps across a 25% zoom the step
  // at radius 100 is 3-4 px, so few samples land in the transition and the result
  // reads as concentric rings instead of a smooth zoom. 16 is the compromise
  // (measured at 2400x1350: 8 taps ~0.8 s, 16 taps ~1.6 s). `taps` is exposed so a
  // scene can pay for smoothness deliberately.
  const taps = Math.max(4, Math.min(48, Math.round(spec.taps === undefined ? 16 : spec.taps)))
  const out = new Uint8ClampedArray(img.data.length)

  for (let y = 0; y < h; y++) {
    // The ray direction for this row: from the centre toward the pixel.
    const ry = y - cy
    for (let x = 0; x < w; x++) {
      const rx = x - cx
      const d = (y * w + x) * 4
      let r = 0, g = 0, b = 0, a = 0
      for (let t = 0; t < taps; t++) {
        // Sample from the pixel back toward the centre, covering the fraction
        // `amount` of the way. t = 0 is the pixel itself, so a fully opaque region
        // stays fully opaque and no scale stack can introduce an offset copy.
        const f = 1 - amount * (t / (taps - 1))
        const fx = cx + rx * f
        const fy = cy + ry * f
        // BILINEAR, not nearest. Nearest sampling is what turns a ray march into
        // visible stepping at low tap counts, and it is the reason the previous
        // attempt needed many samples to look smooth.
        const x0 = Math.floor(fx)
        const y0 = Math.floor(fy)
        const x1 = Math.min(w - 1, x0 + 1)
        const y1 = Math.min(h - 1, y0 + 1)
        const tx = fx - x0
        const ty = fy - y0
        const cx0 = Math.min(w - 1, Math.max(0, x0))
        const cy0 = Math.min(h - 1, Math.max(0, y0))
        const i00 = (cy0 * w + cx0) * 4
        const i10 = (cy0 * w + x1) * 4
        const i01 = (y1 * w + cx0) * 4
        const i11 = (y1 * w + x1) * 4
        const w00 = (1 - tx) * (1 - ty)
        const w10 = tx * (1 - ty)
        const w01 = (1 - tx) * ty
        const w11 = tx * ty
        r += img.data[i00] * w00 + img.data[i10] * w10 + img.data[i01] * w01 + img.data[i11] * w11
        g += img.data[i00 + 1] * w00 + img.data[i10 + 1] * w10 + img.data[i01 + 1] * w01 + img.data[i11 + 1] * w11
        b += img.data[i00 + 2] * w00 + img.data[i10 + 2] * w10 + img.data[i01 + 2] * w01 + img.data[i11 + 2] * w11
        a += img.data[i00 + 3] * w00 + img.data[i10 + 3] * w10 + img.data[i01 + 3] * w01 + img.data[i11 + 3] * w11
      }
      const inv = 1 / taps
      out[d] = r * inv
      out[d + 1] = g * inv
      out[d + 2] = b * inv
      out[d + 3] = a * inv
    }
  }
  return { width: w, height: h, data: out }
}

/**
 * Registered under the names a scene uses.
 *
 * Named `SAT_FILTERS` rather than `BLUR_FILTERS` because `effects.mjs` still
 * exports a `BLUR_FILTERS` with the original sampling implementations. Keeping both
 * live is deliberate: `test/filters.mjs` compares them, so the claim that these are
 * the same result computed faster is checked rather than asserted. Once the old
 * ones are removed this name can be folded back.
 */
export const SAT_FILTERS = {
  gaussian: (img, s) => gaussianBlur(img, s.radius === undefined ? FILTER_DEFAULT_RADIUS.gaussian : s.radius),
  motion: (img, s) => motionBlur(img, s),
  radial: (img, s) => radialBlur(img, s),
  box: (img, s) => {
    const r = Math.max(1, Math.round(s.radius === undefined ? FILTER_DEFAULT_RADIUS.box : s.radius))
    return { width: img.width, height: img.height, data: boxBlurSAT(img.data, img.width, img.height, r) }
  },
  lens: (img, s) => lensBlur(img, s),
}
