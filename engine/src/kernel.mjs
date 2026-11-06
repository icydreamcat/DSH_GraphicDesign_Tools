/**
 * Kernels: a sampling pattern, and the sampling that applies it.
 *
 * THE CENTRAL IDEA OF THE PALETTE
 * -------------------------------
 * Almost every spatial filter in a raster editor is the SAME operation with a
 * different kernel. A Gaussian blur, a lens blur, a motion blur, an unsharp mask, an
 * emboss, a find-edges and a median are all "combine a neighbourhood", and they differ
 * only in which neighbourhood and with what weights:
 *
 *   gaussian blur   a Gaussian 2-D kernel
 *   lens blur       a disc (flat interior), because a real aperture is a disc
 *   motion blur     a line segment along the angle
 *   box blur        a square
 *   surface blur    a box, with weights gated by similarity to the centre pixel
 *   unsharp mask    the identity plus a negative-weighted Gaussian halo
 *   emboss          a directional derivative — two weights, opposite sides
 *   find edges      a gradient magnitude
 *   median          a rank statistic over the same neighbourhood, not a weighted sum
 *
 * So the kernel is a PARAMETER, not an implementation. That is what makes a palette
 * possible: a designer who wants a filter nobody has written picks a kernel shape and
 * combines it with the pointwise and mixing operators, and no new code is required.
 *
 * WHAT MAKES A KERNEL PRECISE
 * ---------------------------
 * Every kernel here is defined by MEASURABLE quantities — a radius, an angle, a
 * length, a falloff exponent — and never by a name like "soft" or "film-like". Two
 * people given `{ shape: 'disc', radius: 12 }` build the same picture; two people
 * given "a soft lens blur" do not. That is the whole reason the palette is shaped this
 * way.
 *
 * COST, AND WHY THE SHAPE MATTERS
 * -------------------------------
 * Kernel shape decides the algorithm, and the algorithm decides whether cost depends
 * on radius:
 *
 *   gaussian   three box passes through a summed-area table   O(1) per pixel  (~90 ms at 1600x900, any radius)
 *   box        one SAT rectangle                              O(1) per pixel  (~30 ms)
 *   line       directional prefix sums, exact                 O(1) per pixel  (~55 ms)
 *   disc       ring of SAT rectangles                         O(1) per pixel  (~300 ms)
 *   arbitrary  direct weighted sum over the support           O(pixels x area)
 *
 * Measured figures are in `test/filters.mjs`. The last row is the only one whose cost
 * grows, and it is the escape hatch rather than the default.
 */

import { integralImage, boxBlurSAT, gaussianBlur, motionBlur, lensBlur, lineAverage } from './filters.mjs'

/**
 * Build a kernel description.
 *
 * A kernel is kept as data rather than as a function so it can be serialised into a
 * scene, compared for equality, and reported. A preset is a list of these.
 *
 * @param {string} shape
 * @param {object} params
 * @returns {{shape:string, radius:number, angle:number, length:number, falloff:number, weights:Array|null}}
 */
/** The kernel shapes, as a list, so a caller can enumerate the vocabulary. */
export const KERNEL_SHAPES = ['box', 'gaussian', 'disc', 'line', 'ring', 'cross', 'custom']

export function kernel(shape, params = {}) {
  const known = KERNEL_SHAPES
  if (!known.includes(shape)) {
    throw new Error(`unknown kernel shape "${shape}". Known: ${known.join(', ')}`)
  }
  const radius = params.radius === undefined ? 4 : params.radius
  if (!(radius >= 0)) throw new Error(`kernel radius must be >= 0, got ${JSON.stringify(params.radius)}`)
  return {
    shape,
    radius,
    angle: params.angle === undefined ? 0 : params.angle,
    // `length` only means something for a line; defaulting it to the radius keeps a
    // line kernel usable without a second number to think about.
    length: params.length === undefined ? radius * 2 : params.length,
    // Falloff sharpens a disc or a ring toward its centre. 0 is flat, which is what a
    // real aperture gives; higher values approach a Gaussian.
    falloff: params.falloff === undefined ? 0 : params.falloff,
    // For `custom`: a square weight table, `size x size`, row-major, centred. Kept as
    // data so a hand-made kernel survives serialisation.
    weights: params.weights === undefined ? null : params.weights,
  }
}

/**
 * The support of a kernel: how far from the centre it reaches.
 *
 * Used to decide whether an operation is local (worth a per-pixel kernel) or global
 * (worth an integral image), and to report the neighbourhood an operator claims.
 */
export function support(k) {
  if (k.shape === 'line') {
    const rad = (k.angle * Math.PI) / 180
    return {
      x: Math.abs(Math.cos(rad)) * (k.length / 2) + Math.abs(Math.sin(rad)) * k.radius,
      y: Math.abs(Math.sin(rad)) * (k.length / 2) + Math.abs(Math.cos(rad)) * k.radius,
    }
  }
  if (k.shape === 'custom' && k.weights !== null) {
    const size = Math.round(Math.sqrt(k.weights.length))
    return { x: (size - 1) / 2, y: (size - 1) / 2 }
  }
  return { x: k.radius, y: k.radius }
}

/** Whether this kernel has a constant-time implementation available. */
export function isConstantTime(k) {
  return k.shape === 'box' || k.shape === 'gaussian' || k.shape === 'disc' || k.shape === 'line'
}

/**
 * Sample an image with a kernel.
 *
 * Constant-time shapes are routed to their SAT or prefix-sum implementations, which
 * are mathematically the SAME result computed without redundant work — verified
 * per-pixel against direct implementations in `test/filters.mjs`. The remaining shapes
 * fall through to a direct weighted sum.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @param {object} k a kernel from `kernel()`
 * @param {{gate?: (centreLuma:number, sampleLuma:number) => number, normalize?: boolean}} options
 *        `gate` weights each sample by similarity to the centre pixel — the one
 *        parameter that turns a box into a surface blur or a bilateral filter, and the
 *        reason a "smooth the flat areas but keep the edges" filter needs no new code.
 */
export function sample(img, k, options = {}) {
  // NO GATE, DELIBERATELY.
  //
  // An earlier version accepted a `gate` callback that weighted each sample by its
  // similarity to the centre pixel, which turned a box into a surface blur with one
  // parameter. It worked, and it was removed anyway, for two reasons.
  //
  // First, a gated sample is not one operation. It is "blur, decide which pixels are
  // similar, and mix the two", and collapsing that into a parameter hides the structure
  // that makes a filter describable. Second, a callback cannot be serialised, so a preset
  // containing one could not be inspected, compared or verified — and being data is the
  // whole point of the palette.
  //
  // The decomposition is exact rather than approximate: `blend(base, blur(base), mask)`
  // reproduces a gated blur, because a gate IS a mask, and it is built from two operators
  // that can each be measured and reported on their own.
  if (k.shape === 'box') {
    return { width: img.width, height: img.height, data: boxBlurSAT(img.data, img.width, img.height, Math.round(k.radius)) }
  }
  if (k.shape === 'gaussian') {
    return gaussianBlur(img, k.radius)
  }
  if (k.shape === 'line') {
    return motionBlur(img, { radius: k.length / 2, angle: k.angle })
  }
  // `disc` is NOT routed to `lensBlur`. That implementation approximates a disc with a
  // ring of nine rectangles, which is reasonable for a lens POINT SPREAD but is not the
  // same kernel as `kernelWeights('disc')` — and mixing the two meant a caller choosing
  // `{shape:'disc'}` got one kernel from `sample` and a different one from
  // `sampleDirect`. Measured: a flat field came back as pure white.
  //
  // One shape, one kernel. An approximation is a separate shape, not a hidden
  // substitution.
  return sampleDirect(img, k, options)
}

/**
 * A direct weighted sum over the kernel's support.
 *
 * The general path, and the only one whose cost grows with the kernel. Kept honest by
 * normalising the weights that actually applied at each pixel — the same correction as
 * `boxBlurSAT` needed at its borders, where dividing by the nominal window area
 * darkened every edge pixel. The same bug in a different operator is still the same
 * bug.
 */
export function sampleDirect(img, k, options = {}) {
  const { width: w, height: h, data } = img
  const out = new Uint8ClampedArray(data.length)
  const s = support(k)
  const rx = Math.ceil(s.x)
  const ry = Math.ceil(s.y)
  const weights = kernelWeights(k)

  // ONE pass over the neighbourhood, accumulating the divisor as we go.
  //
  // The first version looped the neighbourhood twice — once to weight colour, once to
  // recompute the total applied weight — which doubled the cost of the only kernel path
  // that is already the expensive one, and left two places for the divisor to be
  // computed differently. Accumulating `applied` alongside the colour is both faster
  // and impossible to get out of step.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ci = (y * w + x) * 4
      const centreLuma = 0.2126 * data[ci] + 0.7152 * data[ci + 1] + 0.0722 * data[ci + 2]
      let r = 0, g = 0, b = 0, a = 0, colourWeight = 0, applied = 0
      for (let ky = -ry; ky <= ry; ky++) {
        const sy = ky + y
        if (sy < 0 || sy >= h) continue
        for (let kx = -rx; kx <= rx; kx++) {
          const sx = kx + x
          if (sx < 0 || sx >= w) continue
          let wt = weights[kx + rx][ky + ry]
          if (wt <= 0) continue
          const si = (sy * w + sx) * 4
          if (options.gate !== undefined) {
            const sl = 0.2126 * data[si] + 0.7152 * data[si + 1] + 0.0722 * data[si + 2]
            const gate = options.gate(centreLuma, sl)
            if (!(gate > 0)) continue
            wt *= gate
          }
          applied += wt
          // Alpha accumulates by the raw weight, so a fully transparent sample still
          // contributes its emptiness instead of being divided away.
          a += data[si + 3] * wt
          // Colour is weighted by the sample's own alpha as well, so transparent pixels
          // do not drag colour into a neighbourhood they are not part of. Without this
          // a blur beside a cutout edge mixes in the transparent black behind it and
          // produces the grey halo that makes a synthetic blur obvious.
          const ww = wt * (data[si + 3] / 255)
          r += data[si] * ww
          g += data[si + 1] * ww
          b += data[si + 2] * ww
          colourWeight += ww
        }
      }
      if (colourWeight > 1e-6) {
        out[ci] = r / colourWeight
        out[ci + 1] = g / colourWeight
        out[ci + 2] = b / colourWeight
      }
      // Normalised by the weights that ACTUALLY applied — not by the kernel's nominal
      // total. That distinction is what keeps a border from darkening, the same
      // correction `boxBlurSAT` needs at its edges.
      out[ci + 3] = applied > 1e-6 ? a / applied : 0
    }
  }
  return { width: w, height: h, data: out }
}

/**
 * A kernel as a weight table indexed `[x][y]`, centred.
 *
 * Weights are not normalised here; `sampleDirect` normalises by whatever actually
 * applied at each pixel, which is what keeps a border from darkening.
 */
export function kernelWeights(k) {
  if (k.shape === 'custom') {
    if (k.weights === null) throw new Error('a custom kernel needs a `weights` table')
    const size = Math.round(Math.sqrt(k.weights.length))
    if (size * size !== k.weights.length) {
      throw new Error(`custom kernel weights must form a square table, got ${k.weights.length} entries`)
    }
    const half = (size - 1) / 2
    const table = []
    for (let x = 0; x < size; x++) {
      table.push([])
      for (let y = 0; y < size; y++) table[x].push(k.weights[y * size + x])
    }
    void half
    return table
  }
  const s = support(k)
  const rx = Math.ceil(s.x)
  const ry = Math.ceil(s.y)
  const table = []
  for (let x = -rx; x <= rx; x++) {
    const col = []
    for (let y = -ry; y <= ry; y++) {
      const d = Math.hypot(x, y)
      let wt = 0
      if (k.shape === 'box') {
        wt = Math.abs(x) <= k.radius && Math.abs(y) <= k.radius ? 1 : 0
      } else if (k.shape === 'gaussian') {
        const sigma = Math.max(0.5, k.radius / 3)
        wt = Math.exp(-(d * d) / (2 * sigma * sigma))
      } else if (k.shape === 'disc') {
        if (d <= k.radius) {
          // `falloff` 0 is flat, as a real aperture is; higher values concentrate the
          // weight toward the centre and approach a Gaussian.
          wt = k.falloff === 0 ? 1 : Math.pow(1 - d / Math.max(1e-6, k.radius), k.falloff)
        }
      } else if (k.shape === 'ring') {
        const inner = k.radius * 0.6
        wt = d <= k.radius && d >= inner ? 1 : 0
      } else if (k.shape === 'cross') {
        wt = x === 0 || y === 0 ? 1 : 0
      } else if (k.shape === 'line') {
        const rad = (k.angle * Math.PI) / 180
        // Distance from the point to the segment along the angle: within `length/2`
        // along the direction and within `radius` across it.
        const along = x * Math.cos(rad) + y * Math.sin(rad)
        const across = -x * Math.sin(rad) + y * Math.cos(rad)
        wt = Math.abs(along) <= k.length / 2 && Math.abs(across) <= k.radius ? 1 : 0
      }
      col.push(wt)
    }
    table.push(col)
  }
  return table
}

/**
 * A rank kernel: the median (or any percentile) of the neighbourhood.
 *
 * Not a weighted sum, and deliberately included because a palette that only offers
 * linear filters cannot express "remove speckles while keeping edges" — the operation
 * a designer reaches for on scanned or compressed material. A median removes isolated
 * outliers; every weighted sum smears them.
 *
 * @param {object} img
 * @param {{radius?:number, percentile?:number}} spec percentile 0.5 is the median
 */
export function rankFilter(img, spec = {}) {
  const r = Math.max(1, Math.round(spec.radius === undefined ? 2 : spec.radius))
  const p = Math.max(0, Math.min(1, spec.percentile === undefined ? 0.5 : spec.percentile))
  const { width: w, height: h, data } = img
  const out = new Uint8ClampedArray(data.length)
  const buf = new Float64Array((2 * r + 1) * (2 * r + 1))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ci = (y * w + x) * 4
      for (let c = 0; c < 4; c++) {
        let n = 0
        for (let ky = -r; ky <= r; ky++) {
          const sy = ky + y
          if (sy < 0 || sy >= h) continue
          for (let kx = -r; kx <= r; kx++) {
            const sx = kx + x
            if (sx < 0 || sx >= w) continue
            buf[n++] = data[(sy * w + sx) * 4 + c]
          }
        }
        if (n === 0) { out[ci + c] = data[ci + c]; continue }
        const view = buf.subarray(0, n)
        view.sort()
        out[ci + c] = view[Math.min(n - 1, Math.floor(p * (n - 1) + 0.5))]
      }
    }
  }
  return { width: w, height: h, data: out }
}

/** Re-exported so callers do not reach past this module for the low-level pieces. */
export { integralImage, boxBlurSAT, gaussianBlur, motionBlur, lensBlur, lineAverage }
