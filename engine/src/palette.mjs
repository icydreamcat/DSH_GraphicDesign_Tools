/**
 * The palette: a declarative operator graph, and named presets as snapshots of one.
 *
 * THE DESIGN, IN ONE PARAGRAPH
 * ----------------------------
 * A filter is a short list of typed operators. That is the whole data model. A named
 * preset is that same list with a name attached, plus the measurements it produced when
 * it was captured — so a preset is not a black box but a recipe with its own evidence
 * attached. Either direction converts: a preset expands to its graph (to inspect,
 * measure, or edit it), and a graph can be captured as a preset (to reuse it). Nothing
 * in the model is a function; it is all data, which is what makes it serialisable into a
 * scene, comparable for equality, and reportable after the fact.
 *
 * WHY PRECISION IS ENFORCED, NOT ENCOURAGED
 * -----------------------------------------
 * Every operator is defined by MEASURABLE quantities and refuses semantic ones. "warmer"
 * is rejected; "hue rotate -8 degrees" is accepted. Two people given the same numbers
 * build the same picture; two people given "warmer" do not. That is the entire reason
 * the palette is shaped this way, and it is enforced at construction so a vague
 * description fails immediately rather than producing a picture nobody can reproduce.
 *
 * WHAT AN OPERATOR IS
 * -------------------
 *   { op, ...params }
 *
 * Six operators cover the families that every raster filter reduces to:
 *
 *   sample    spatial   out(p) = weighted neighbourhood, kernel as a parameter
 *   map       pointwise out(p) = f(in(p)), via an OKLab lookup table
 *   blend     mixing    out = a + (b - a) * mask, which is what `scope` already was
 *   key       matting   alpha from a channel and a ramp
 *   blur      spatial   the fast paths, by name
 *   rank      spatial   a percentile of the neighbourhood, not a weighted sum
 *
 * THE COLOUR SPACE IS THE PRECISION
 * ---------------------------------
 * Pointwise operators act in OKLab rather than HSL. HSL is the traditional choice and
 * it is not perceptually uniform: rotating hue at constant "lightness" makes yellows
 * and blues change brightness differently, so the same parameter does visibly different
 * things at different hues and a described result does not survive a colour change.
 * Working in OKLab means "lightness +0.1" is the same perceived step everywhere.
 *
 * Each operator reports `{ applied, changedFraction, ... }` and the runner accumulates
 * them, so a graph states what it did rather than only what it was asked to do. That is
 * the check that catches the failure this project has hit most often: an operator that
 * runs, reports success, and changes nothing.
 */

import { parseColor, toOklab, fromOklab, clamp, relativeLuminance } from './color.mjs'
import { kernel, sample, sampleDirect, rankFilter, support } from './kernel.mjs'
import { measure, delta, assertDid } from './measure.mjs'

// ── the pointwise lookup table ──────────────────────────────────────────────

/** Resolution of a pointwise ramp. 1024 steps is four times what 8-bit output can
 *  express, so quantisation is invisible while the table stays small enough to build
 *  per operator rather than cache globally. */
const LUT_SIZE = 1024

/**
 * Build a pointwise transform as a lookup table indexed by OKLab lightness.
 *
 * The table is indexed by LUMINANCE rather than by position along a gradient, because
 * that is what makes `curves` and `levels` behave the way a designer expects: they
 * reshape the tonal distribution of the image, not its geometry.
 *
 * @param {(l: number) => {L: number, a: number, b: number} | null} fn
 *        receives OKLab L in 0..1 and returns adjusted OKLab, or null to leave as is
 * @returns {Uint8ClampedArray} LUT_SIZE * 3 RGB triples
 */
export function toLut(fn) {
  const lut = new Uint8ClampedArray(LUT_SIZE * 3)
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1)
    // The input chromaticity is unknown at table-build time, so the table maps
    // LIGHTNESS ONLY and the operator applies it as a delta. An operator that needs
    // per-pixel chroma (a hue rotation, a gradient map) uses `applyOklab` instead.
    const out = fn(t)
    const rgb = fromOklab(out === null ? { L: t, a: 0, b: 0 } : out)
    lut[i * 3] = rgb.r
    lut[i * 3 + 1] = rgb.g
    lut[i * 3 + 2] = rgb.b
  }
  return lut
}

/**
 * Apply a per-pixel OKLab transform.
 *
 * The image is converted to OKLab once, the transform applied per pixel, and converted
 * back once — rather than converting inside the loop per operation. A graph of four
 * pointwise operators thus pays for two conversions instead of eight, and each operator
 * sees the previous one's true OKLab output rather than a rounded RGB intermediate.
 *
 * @param {object} img
 * @param {(lab: {L:number,a:number,b:number}) => {L:number,a:number,b:number}|null} fn
 * @returns {object} and the fraction of pixels the transform actually moved
 */
export function applyOklab(img, fn) {
  const { width: w, height: h, data } = img
  const out = new Uint8ClampedArray(data.length)
  let changed = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 0) { out[i + 3] = 0; continue }
    const lab = toOklab({ r: data[i], g: data[i + 1], b: data[i + 2] })
    const next = fn(lab)
    const rgb = next === null ? { r: data[i], g: data[i + 1], b: data[i + 2] } : fromOklab(next)
    out[i] = clamp(rgb.r, 0, 255)
    out[i + 1] = clamp(rgb.g, 0, 255)
    out[i + 2] = clamp(rgb.b, 0, 255)
    out[i + 3] = a
    if (Math.abs(out[i] - data[i]) > 1 || Math.abs(out[i + 1] - data[i + 1]) > 1 || Math.abs(out[i + 2] - data[i + 2]) > 1) changed++
  }
  return { image: { width: w, height: h, data: out }, changedFraction: changed / (w * h) }
}

// ── the operators ───────────────────────────────────────────────────────────

/**
 * Pointwise operators, keyed by name.
 *
 * Each is a function of OKLab and returns OKLab. `null` means "leave this pixel alone",
 * which is how an operator can be a no-op over part of its domain without a branch at
 * the call site.
 *
 * Parameters that are REQUIRED and semantic-free:
 *
 *   lightness   { amount }                 OKLab L is shifted by amount, -1..1
 *   contrast    { pivot?, amount }         L expands about a pivot (default mid grey)
 *   exposure    { amount }                 a multiplicative stop, 2^amount in linear light
 *   hueRotate   { degrees }                OKLCH hue rotated; L and C untouched
 *   chroma      { amount }                 OKLCH chroma scaled
 *   saturate    { amount }                 alias of chroma, kept because it reads better
 *   curve       { points, channel }        a monotone curve through (x, y) pairs
 *   invert      {}                         L inverted about mid grey, alpha untouched
 *   threshold   { at }                     L forced to 0 or 1
 *   posterize   { levels }                 L quantised
 *   gradientMap { stops }                  L replaced by a ramp through the stops
 *   duotone     { shadows, midtones, highlights }
 */
export const POINTWISE = {
  lightness: (p) => {
    requireNumber('lightness', 'amount', p.amount)
    return (lab) => ({ ...lab, L: lab.L + p.amount })
  },

  exposure: (p) => {
    requireNumber('exposure', 'amount', p.amount)
    // Applied in linear light, which is what makes a stop a stop. Doing it on OKLab L
    // would make the same parameter do very different things in the shadows and the
    // highlights, so the parameter would stop being a description of the result.
    const k = Math.pow(2, p.amount)
    return (lab) => {
      const rgb = fromOklab(lab)
      const lin = (v) => {
        const s = v / 255
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      }
      const back = (v) => {
        const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
        return s * 255
      }
      return toOklab({ r: back(lin(rgb.r) * k), g: back(lin(rgb.g) * k), b: back(lin(rgb.b) * k) })
    }
  },

  contrast: (p) => {
    requireNumber('contrast', 'amount', p.amount)
    const pivot = p.pivot === undefined ? 0.5 : p.pivot
    requireRange('contrast', 'pivot', pivot, 0, 1)
    return (lab) => ({ ...lab, L: pivot + (lab.L - pivot) * (1 + p.amount) })
  },

  hueRotate: (p) => {
    requireNumber('hueRotate', 'degrees', p.degrees)
    const rad = (p.degrees * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    // Rotating in the a/b plane of OKLab rather than converting to polar and back. It is
    // the same operation, it cannot suffer a hue-wrap discontinuity, and it leaves L
    // exactly untouched — which is the property that makes the parameter trustworthy.
    return (lab) => ({ L: lab.L, a: lab.a * cos - lab.b * sin, b: lab.a * sin + lab.b * cos })
  },

  chroma: (p) => {
    requireNumber('chroma', 'amount', p.amount)
    const k = 1 + p.amount
    return (lab) => ({ ...lab, a: lab.a * k, b: lab.b * k })
  },

  invert: () => (lab) => ({ L: 1 - lab.L, a: -lab.a, b: -lab.b }),

  threshold: (p) => {
    requireRange('threshold', 'at', p.at, 0, 1)
    return (lab) => ({ L: lab.L >= p.at ? 1 : 0, a: 0, b: 0 })
  },

  posterize: (p) => {
    if (!Number.isInteger(p.levels) || p.levels < 2) {
      throw new Error(`posterize needs an integer "levels" of at least 2, got ${JSON.stringify(p.levels)}`)
    }
    const n = p.levels - 1
    return (lab) => ({ ...lab, L: Math.round(lab.L * n) / n })
  },

  curve: (p) => {
    const table = buildCurveTableStrict(p.points)
    return (lab) => ({ ...lab, L: table(lab.L) })
  },

  /**
   * A gradient map: luminance selects a colour from a ramp.
   *
   * The ramp is interpolated in OKLab, so a two-stop ramp between saturated colours does
   * not go grey in the middle — the same reason `color.mjs` interposes there.
   */
  gradientMap: (p) => {
    if (!Array.isArray(p.stops) || p.stops.length < 2) {
      throw new Error('gradientMap needs at least two stops')
    }
    const stops = p.stops.map((s) => (typeof s === 'string' ? parseColor(s) : parseColor(s.color)))
    const luts = stops.map((c) => toOklab(c))
    return (lab) => {
      const t = clamp(lab.L, 0, 1)
      const pos = t * (stops.length - 1)
      const i0 = Math.floor(pos)
      const i1 = Math.min(stops.length - 1, i0 + 1)
      const f = pos - i0
      const A = luts[i0]
      const B = luts[i1]
      return { L: A.L + (B.L - A.L) * f, a: A.a + (B.a - A.a) * f, b: A.b + (B.b - A.b) * f }
    }
  },

  duotone: (p) => {
    const lo = toOklab(parseColor(p.shadows))
    const mid = toOklab(parseColor(p.midtones))
    const hi = toOklab(parseColor(p.highlights))
    const strength = p.strength === undefined ? 1 : p.strength
    requireRange('duotone', 'strength', strength, 0, 1)
    return (lab) => {
      const t = clamp(lab.L, 0, 1)
      // Two-segment ramp through the midtone, so the midtone actually lands at mid grey
      // instead of wherever a straight shadow-to-highlight line happens to pass.
      const A = t < 0.5 ? lo : mid
      const B = t < 0.5 ? mid : hi
      const f = t < 0.5 ? t * 2 : (t - 0.5) * 2
      return {
        L: lab.L + (A.L + (B.L - A.L) * f - lab.L) * strength,
        a: lab.a + (A.a + (B.a - A.a) * f - lab.a) * strength,
        b: lab.b + (A.b + (B.b - A.b) * f - lab.b) * strength,
      }
    }
  },
}

// ── parameter validation ────────────────────────────────────────────────────

/**
 * Validation that names the problem and the fix.
 *
 * Precision is the requirement, so a vague or missing parameter is refused at
 * construction rather than producing a picture nobody can reproduce. The error messages
 * say what a valid value looks like, which is what makes the palette usable by someone
 * who does not already know the vocabulary.
 */
function requireNumber(op, key, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${op} needs a finite number for "${key}", got ${JSON.stringify(v)}. ` +
      'If you meant something qualitative like "warm" or "strong", give it a number: hueRotate degrees, chroma amount.')
  }
}
function requireRange(op, key, v, lo, hi) {
  requireNumber(op, key, v)
  if (v < lo || v > hi) {
    throw new Error(`${op} needs "${key}" between ${lo} and ${hi}, got ${v}`)
  }
}

/** A monotone curve through (x, y) pairs, evaluated by binary search. */
function buildCurveTableStrict(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('curve needs at least two [x, y] points')
  }
  const pts = points.map((p) => {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number') {
      throw new Error(`curve points must be [x, y] number pairs, got ${JSON.stringify(p)}`)
    }
    requireRange('curve', 'x', p[0], 0, 1)
    requireRange('curve', 'y', p[1], 0, 1)
    return p
  }).sort((a, b) => a[0] - b[0])
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1]
    if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]
    let lo = 0
    let hi = pts.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (pts[mid][0] <= x) lo = mid
      else hi = mid
    }
    const [x0, y0] = pts[lo]
    const [x1, y1] = pts[hi]
    const span = x1 - x0
    return span <= 0 ? y0 : y0 + (y1 - y0) * ((x - x0) / span)
  }
}

// ── kernel operators ────────────────────────────────────────────────────────

const SPATIAL_OPS = ['sample', 'blur', 'rank']

/**
 * Operators that combine the current image with another version of it.
 *
 * These are what replaced the kernel `gate` parameter, and the replacement is exact
 * rather than approximate — which is the reason it was worth doing. A gated blur is
 * "blur, find the pixels that are similar, and mix the two", and each of those is a
 * separate, measurable operation:
 *
 *   similarityMask   encode "which pixels are similar to a blurred version" as alpha
 *   blend            mix two versions through that alpha
 *
 * The chain therefore states its own structure, and each step reports what it changed.
 * A single `gate` parameter stated none of it.
 */
const MIX_OPS = ['blend', 'similarityMask', 'luminanceMask']

/** Validate the kernel a spatial operator carries. */
function kernelOf(op) {
  if (op.kernel === undefined || op.kernel === null) {
    throw new Error(`${op.op} needs a "kernel", e.g. { shape: 'gaussian', radius: 4 }`)
  }
  return kernel(op.kernel.shape, op.kernel)
}

/**
 * Where a chain step gets an image.
 *
 * Three names, and the third is what makes multi-step chains expressible:
 *
 *   "input"    the image the graph started with
 *   "current"  what the step before produced
 *   <name>     any result a previous step stored with `as: "<name>"`
 *
 * Without named results, "blend the blurred version back over the ORIGINAL" cannot be
 * written — and that single phrase is an unsharp mask, a surface blur and a high-pass
 * filter. `current` alone can only ever refer to the immediately preceding step, so a
 * two-operand operation would be limited to operand pairs the chain happens to produce
 * in order.
 */
function sourceImage(name, state) {
  if (name === undefined || name === 'current') return state.current
  if (name === 'input') return state.input
  const named = state.named.get(name)
  if (named === undefined) {
    const known = [...state.named.keys()]
    throw new Error(
      `unknown source "${name}". Use "input", "current", or a name stored by an earlier step's ` +
      `"as". Stored so far: ${known.length === 0 ? 'none' : known.join(', ')}`,
    )
  }
  return named
}

/**
 * A luminance mask: coverage from the pixel's OWN brightness, through a ramp.
 *
 * WHY THIS IS NOT `similarityMask`
 * --------------------------------
 * `similarityMask` compares two IMAGES and reports where they agree. This looks at ONE
 * image and reports how bright each pixel is. They are different measurements, and film
 * grain is the case that makes the difference matter: grain on real film is strongest in
 * the midtones and nearly absent in clean highlights and blocked shadows, so the noise
 * needs a mask derived from the picture's own tone. A comparison mask cannot express that
 * — there is nothing to compare against.
 *
 * COVERAGE COMES FROM THE STOP'S LUMINANCE, NOT ITS ALPHA
 * ------------------------------------------------------
 * The first version read each stop's alpha channel, and stops of `#000000` and `#FFFFFF`
 * both have alpha 1, so the mask came out fully opaque everywhere: a mask meant to select a
 * third of the image selected all of it. The mistake was reading the wrong channel of the
 * right data — a stop means "this much coverage" by how LIGHT it looks, which is how every
 * gradient ramp in this engine is already read. White is full coverage, black is none, and
 * the mask is legible in any viewer because its alpha IS its colour.
 *
 * A stop may still state an explicit alpha (`rgba(255,255,255,0.5)`) and that multiplies the
 * luminance, which is how a partly-transparent stop is expressed.
 *
 * Default stops are white-to-black, i.e. "bright pixels selected". A caller wanting the
 * opposite passes `invert: true` rather than reversing the stops and wondering which end it
 * got.
 *
 * This operator was found by trying to WRITE a preset rather than by guessing: `presets.mjs`
 * carried `GRAIN_NEEDS_OPERATOR` as a documented gap, and this closes it.
 */
function luminanceMaskOp(op, state) {
  const stops = op.stops === undefined ? ['#FFFFFF', '#000000'] : op.stops
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new Error('luminanceMask needs at least two stops')
  }
  const invert = op.invert === true
  const src = state.current
  // Coverage and input are both read on the GAMMA-ENCODED scale, not relative luminance.
  //
  // Relative luminance linearises sRGB, so `#808080` measures 0.216 rather than 0.5 and a
  // three-stop hump peaks at pixel value 188 instead of 128 — the grain would sit in the
  // upper midtones while a designer reading "midtone" means 128. Measured: the hump's
  // half-height width came out 52% of the range where the intended shape covers a third.
  //
  // The encoded scale is also what every other tonal operator in this engine indexes and
  // what a colour picker shows, so "0.5" means the same thing here as everywhere else.
  const stops2 = stops.map((c) => {
    const p = parseColor(c)
    const enc = (0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b) / 255
    return { cov: enc * p.a, r: p.r, g: p.g, b: p.b }
  })
  const out = new Uint8ClampedArray(src.data.length)
  let selected = 0
  for (let i = 0; i < src.data.length; i += 4) {
    const l = (0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2]) / 255
    const t = clamp(invert ? 1 - l : l, 0, 1)
    const pos = t * (stops2.length - 1)
    const i0 = Math.floor(pos)
    const i1 = Math.min(stops2.length - 1, i0 + 1)
    const f = pos - i0
    const cov = stops2[i0].cov + (stops2[i1].cov - stops2[i0].cov) * f
    const r = stops2[i0].r + (stops2[i1].r - stops2[i0].r) * f
    const g = stops2[i0].g + (stops2[i1].g - stops2[i0].g) * f
    const b = stops2[i0].b + (stops2[i1].b - stops2[i0].b) * f
    // Both colour and alpha carry the coverage, so the mask reads the same in any viewer
    // and the blend step — which reads alpha — gets the same number.
    const byte = cov * 255
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = byte
    if (cov > 0.5) selected++
  }
  return {
    image: { width: src.width, height: src.height, data: out },
    extra: {
      kind: 'luminanceMask',
      stops: stops.length,
      invert,
      selectedFraction: Number((selected / (src.width * src.height)).toFixed(5)),
    },
  }
}

/**
 * Seeded noise, as a constant source.
 *
 * DETERMINISM IS THE WHOLE REQUIREMENT
 * ------------------------------------
 * Two renders of the same scene must be byte-identical, or nothing in this project that
 * compares one render with another works — the palette's own verification, the scope tests,
 * the regression suite. So the field is derived from a hash of the pixel index and the seed
 * rather than from a random number generator: no state, no order dependence, and the same
 * seed gives the same field forever.
 *
 * The hash is the integer variant of the finaliser used by xxHash, which is cheap and
 * mixes well enough that no visible lattice appears at the scales a canvas is viewed at.
 * A weaker hash (a plain LCG indexed by pixel) produces diagonal banding that reads as a
 * texture rather than as grain — visible in a 1:1 crop, which is how these things are
 * checked.
 *
 * Emitted as a CONSTANT (it declares `produces`), because noise is an operand: what a filter
 * does with it is the filter. Grain multiplies it into the image; a scratch preset would
 * blend it through a different mask instead.
 */
function noiseOp(op, state) {
  const seed = op.seed === undefined ? 1 : op.seed
  requireNumber('noise', 'seed', seed)
  const amount = op.amount === undefined ? 0.5 : op.amount
  requireRange('noise', 'amount', amount, 0, 1)
  const base = op.base === undefined ? '#808080' : op.base
  const bc = parseColor(base)
  const monochrome = op.monochrome !== false
  const cur = state.current
  const n = cur.width * cur.height
  const buf = new Uint8ClampedArray(n * 4)
  const s0 = Math.imul(seed | 0, 0x9e3779b1) >>> 0
  for (let p = 0; p < n; p++) {
    // One hash per pixel for monochrome, three for colour. Colour noise on a photographic
    // layer reads as chroma speckle rather than as grain, which is why monochrome is the
    // default — but both are available because a scan sometimes wants the other.
    let h = (p + s0) >>> 0
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0
    h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0
    h ^= h >>> 15
    const d0 = ((h & 0xff) / 255 - 0.5) * 2 * amount * 255
    const i = p * 4
    buf[i] = bc.r + d0
    if (monochrome) {
      buf[i + 1] = bc.g + d0
      buf[i + 2] = bc.b + d0
    } else {
      let h1 = (h ^ 0x9e3779b9) >>> 0
      h1 ^= h1 >>> 15; h1 = Math.imul(h1, 0x2c1b3c6d) >>> 0
      h1 ^= h1 >>> 12
      let h2 = (h1 ^ 0x85ebca6b) >>> 0
      h2 ^= h2 >>> 13; h2 = Math.imul(h2, 0xc2b2ae35) >>> 0
      h2 ^= h2 >>> 16
      buf[i + 1] = bc.g + ((h1 & 0xff) / 255 - 0.5) * 2 * amount * 255
      buf[i + 2] = bc.b + ((h2 & 0xff) / 255 - 0.5) * 2 * amount * 255
    }
    buf[i + 3] = 255
  }
  return {
    image: { width: cur.width, height: cur.height, data: buf },
    extra: { kind: 'noise', seed, amount, monochrome },
  }
}

/**
 * The similarity mask: an alpha encoding of how much one image resembles another.
 *
 * This is the operator that replaced the kernel `gate` parameter, and it is what makes a
 * surface blur expressible as two operators instead of one special case.
 *
 * IT TAKES TWO OPERANDS, and getting that wrong is instructive. The first version
 * compared the current image against a blur of ITSELF, which is meaningless once the
 * chain has already blurred: the blur of a blur is the blur, every delta is zero, every
 * pixel is selected, and the mask silently selects everything — measured as
 * `selectedFraction: 1`. The mask is only informative when it compares a source against a
 * DIFFERENT version of it.
 *
 *   from      the image whose pixels are being judged        (default: input)
 *   against   the image it is compared to                     (default: current)
 *
 * So the surface blur reads "compare the original against its blur, then mix them", and
 * that is exactly what the operator now says.
 *
 *   delta <= maxDelta                     fully selected
 *   maxDelta < delta < maxDelta+softness  partially selected
 *   delta >= maxDelta+softness            not selected
 *
 * The soft ramp is the difference between a surface blur (a hard cut, which leaves
 * visible flat plateaus) and a bilateral filter (a ramp, which does not). Both are the
 * same operator with a different number.
 */
function similarityMaskOp(op, state) {
  const max = op.maxDelta === undefined ? 30 : op.maxDelta
  const soft = op.softness === undefined ? 0 : op.softness
  requireNumber('similarityMask', 'maxDelta', max)
  requireNumber('similarityMask', 'softness', soft)
  const from = sourceImage(op.from === undefined ? 'input' : op.from, state)
  const against = sourceImage(op.against === undefined ? 'current' : op.against, state)
  if (from.width !== against.width || from.height !== against.height) {
    throw new Error(
      `similarityMask operands must be the same size, got ${from.width}x${from.height} and ${against.width}x${against.height}`,
    )
  }
  const out = new Uint8ClampedArray(from.data.length)
  let selected = 0
  for (let i = 0; i < from.data.length; i += 4) {
    const l1 = 0.2126 * from.data[i] + 0.7152 * from.data[i + 1] + 0.0722 * from.data[i + 2]
    const l2 = 0.2126 * against.data[i] + 0.7152 * against.data[i + 1] + 0.0722 * against.data[i + 2]
    const d = Math.abs(l1 - l2)
    let m
    if (d <= max) m = 1
    else if (soft > 0 && d < max + soft) m = 1 - (d - max) / soft
    else m = 0
    // The mask REPLACES alpha, so it is readable on its own: fully selected is opaque,
    // unselected is transparent. The colour channels carry the same level, so a mask is
    // legible in any viewer rather than only through its alpha.
    out[i] = m * 255; out[i + 1] = m * 255; out[i + 2] = m * 255; out[i + 3] = m * 255
    if (m > 0.5) selected++
  }
  return {
    image: { width: from.width, height: from.height, data: out },
    extra: {
      kind: 'mask',
      maxDelta: max,
      softness: soft,
      selectedFraction: Number((selected / (from.width * from.height)).toFixed(5)),
    },
  }
}

/**
 * Blend two versions of the image.
 *
 *   out = base * (1 - amount) + over * amount, per pixel, through `mask` when given.
 *
 * NEGATIVE AMOUNTS ARE MEANINGFUL and are how an unsharp mask is expressed: with
 * `over` = the blurred version and `amount` = -0.8 the result is
 * `1.8*original - 0.8*blurred`, which is exactly the classic formula. Expressing it as a
 * blend rather than as its own operator means a sharpen, a dissolve and a surface blur
 * are the same two operators with different numbers.
 */
function blendOp(op, state) {
  const amount = op.amount === undefined ? 0.5 : op.amount
  requireNumber('blend', 'amount', amount)
  const base = sourceImage(op.base === undefined ? 'input' : op.base, state)
  const over = sourceImage(op.over === undefined ? 'current' : op.over, state)
  if (base.width !== over.width || base.height !== over.height) {
    throw new Error(`blend operands must be the same size, got ${base.width}x${base.height} and ${over.width}x${over.height}`)
  }
  const maskImg = op.mask === undefined ? null : sourceImage(op.mask, state)
  const out = new Uint8ClampedArray(base.data.length)
  for (let i = 0; i < base.data.length; i += 4) {
    // A mask in the alpha channel, normalised to 0..1.
    const m = maskImg === null ? 1 : maskImg.data[i + 3] / 255
    const k = amount * m
    for (let c = 0; c < 4; c++) {
      out[i + c] = base.data[i + c] + (over.data[i + c] - base.data[i + c]) * k
    }
  }
  return {
    image: { width: base.width, height: base.height, data: out },
    extra: { kind: 'blend', amount, masked: maskImg !== null },
  }
}

/** Wrap a bare RGBA buffer as an image, which the constant-time kernels return. */
function asImage(r, like) {
  return r.data === undefined ? { width: like.width, height: like.height, data: r } : r
}

// ── the graph runner ────────────────────────────────────────────────────────

/**
 * Run an operator graph over an image.
 *
 * Returns the result AND a per-step report. The report is the point: a graph that
 * silently did nothing is the failure mode this whole design is built to make visible,
 * so each step records what it changed, and a step that changes nothing is flagged
 * unless it was declared as a deliberate no-op.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} input
 * @param {object[]} graph
 * @param {{baseDir?:string, expectAll?:boolean}} options
 * @returns {{image:object, steps:object[], changedFraction:number}}
 */
export function run(input, graph, options = {}) {
  if (!Array.isArray(graph)) throw new Error('a graph must be an array of operators')
  // `input` and `current` are both carried, because a chain legitimately needs to refer
  // back to the image it started with — an unsharp mask blends the blurred version over
  // the ORIGINAL, and a surface blur mixes the original with its own blur. With only
  // `current` available, neither is expressible.
  const state = { input, current: input, named: new Map() }
  let accumulated = 0
  const steps = []
  for (let i = 0; i < graph.length; i++) {
    const op = graph[i]
    if (op === null || typeof op !== 'object') throw new Error(`operator ${i} is not an object`)
    if (typeof op.op !== 'string') throw new Error(`operator ${i} has no "op" name`)

    const before = state.current
    const r = applyOne(state, op, options)
    // A VALUE-GENERATING operator does not advance the current image.
    //
    // `solid` produces a constant to be used as an operand, not a transformation of the
    // picture. The first version stored it in `current` anyway, so the next `sample` blurred
    // a flat grey field instead of the image — measured as "changed 0.000% of pixels" on the
    // blur step — and the whole high-pass chain then operated on a constant. An operator
    // declares `produces: true` when its output is a source rather than a step.
    if (op.produces !== true) state.current = r.image
    const current = state.current
    if (typeof op.as === 'string') {
      if (op.as === 'input' || op.as === 'current') {
        throw new Error(`"as" cannot be "input" or "current" — those names are reserved`)
      }
      // Stored by REFERENCE, not copied: these buffers are tens of megabytes on a real
      // canvas, and a chain that names four intermediates would otherwise hold four
      // copies of the whole image alive at once.
      state.named.set(op.as, r.image)
    }

    const d = delta(before, current)
    const declared = op.expectNoChange === true
    const verdict = assertDid(d, declared ? {} : { atLeast: op.atLeast === undefined ? 1e-9 : op.atLeast })
    steps.push({
      index: i,
      op: op.op,
      changedFraction: d.changedFraction,
      lumaMeanShift: d.lumaMeanShift,
      edgeEnergyShift: d.edgeEnergyShift,
      ...r.extra,
      // A step that changed nothing is reported as a problem unless the graph said it
      // expected that. Silence here is what let a halftone report 7007 dots while
      // drawing none.
      suspicious: declared ? false : !verdict.ok,
      problem: declared ? null : (verdict.ok ? null : verdict.problems[0]),
    })
    accumulated = Math.max(accumulated, d.changedFraction)
  }
  return { image: state.current, steps, changedFraction: accumulated }
}

/** One operator. */
function applyOne(state, op, options) {
  if (op.op === 'sample' || op.op === 'blur') {
    const k = kernelOf(op)
    const out = asImage(sample(state.current, k), state.current)
    return {
      image: out,
      extra: { kind: 'sample', kernel: `${k.shape} r=${k.radius}`, constantTime: k.shape !== 'custom' },
    }
  }
  if (op.op === 'rank') {
    const out = rankFilter(state.current, { radius: op.radius, percentile: op.percentile })
    return { image: out, extra: { kind: 'rank', radius: op.radius === undefined ? 2 : op.radius } }
  }
  if (op.op === 'solid') {
    // A constant image, so an operator can blend toward a fixed value.
    //
    // Needed because "high pass" is "the edge signal plus mid grey", and mid grey has to
    // come from somewhere. Without a constant source the offset would have to be applied
    // as a lightness shift, which is a different operation in a different scale — and
    // getting that wrong is what made the first high-pass preset produce a black edge map
    // instead of a grey field.
    const c = op.color === undefined ? '#808080' : op.color
    const hex = String(c).replace('#', '')
    const r0 = parseInt(hex.slice(0, 2), 16)
    const g0 = parseInt(hex.slice(2, 4), 16)
    const b0 = parseInt(hex.slice(4, 6), 16)
    if ([r0, g0, b0].some((v) => Number.isNaN(v))) {
      throw new Error(`solid needs a hex colour like "#808080", got ${JSON.stringify(c)}`)
    }
    const cur = state.current
    const buf = new Uint8ClampedArray(cur.data.length)
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = r0; buf[i + 1] = g0; buf[i + 2] = b0; buf[i + 3] = 255
    }
    return { image: { width: cur.width, height: cur.height, data: buf }, extra: { kind: 'solid', colour: c } }
  }
  if (op.op === 'noise') return noiseOp(op, state)
  if (op.op === 'similarityMask') return similarityMaskOp(op, state)
  if (op.op === 'luminanceMask') return luminanceMaskOp(op, state)
  if (op.op === 'blend') return blendOp(op, state)

  const factory = POINTWISE[op.op]
  if (factory !== undefined) {
    const fn = factory(op)
    const out = applyOklab(state.current, fn)
    return { image: out.image, extra: { kind: 'pointwise', changedFraction: out.changedFraction } }
  }

  throw new Error(
    `unknown operator "${op.op}". Pointwise: ${Object.keys(POINTWISE).join(', ')}. `
    + `Spatial: ${SPATIAL_OPS.join(', ')}. Mixing: ${MIX_OPS.join(', ')}.`,
  )
}

// ── presets: named snapshots of a graph ─────────────────────────────────────

/** Captured presets, by name. Each holds its graph and the evidence it produced. */
const PRESETS = new Map()

/**
 * Capture a graph as a named preset.
 *
 * The measurements are recorded at capture time so the preset carries its own evidence:
 * re-running it and comparing the numbers is a regression check rather than a claim. A
 * preset that cannot prove it still does what it did is just a name.
 *
 * @param {string} name
 * @param {object[]} graph
 * @param {object} onImage a reference image the preset was captured against
 * @param {{description?:string, tags?:string[]}} meta
 */
export function capturePreset(name, graph, onImage, meta = {}) {
  if (typeof name !== 'string' || name.length === 0) throw new Error('a preset needs a name')
  if (!Array.isArray(graph) || graph.length === 0) {
    throw new Error(`preset "${name}" needs a non-empty operator graph`)
  }
  // Validate by running, so a broken preset cannot be stored. A preset that only fails
  // when someone uses it is worse than no preset.
  const r = run(onImage, graph)
  const suspicious = r.steps.filter((s) => s.suspicious)
  PRESETS.set(name, {
    name,
    description: meta.description === undefined ? null : meta.description,
    tags: meta.tags === undefined ? [] : meta.tags,
    graph: JSON.parse(JSON.stringify(graph)),
    evidence: measure(r.image),
  })
  return { name, steps: r.steps, suspicious }
}

/** Expand a preset back into its graph. The preset is data, not an opaque handle. */
export function expandPreset(name) {
  const p = PRESETS.get(name)
  if (p === undefined) {
    const known = [...PRESETS.keys()]
    throw new Error(`unknown preset "${name}"${known.length === 0 ? '' : `. Known: ${known.join(', ')}`}`)
  }
  return JSON.parse(JSON.stringify(p.graph))
}

/** List captured presets with their evidence, so a roster is inspectable. */
export function listPresets() {
  return [...PRESETS.values()].map((p) => ({
    name: p.name,
    description: p.description,
    tags: p.tags,
    operators: p.graph.map((o) => o.op),
    evidence: p.evidence,
  }))
}

/**
 * Re-run a preset and check it still produces the measurements it was captured with.
 *
 * This is what makes a preset maintainable rather than merely stored: change a kernel,
 * tighten a validator, alter a colour conversion, and the drifting presets announce
 * themselves instead of quietly producing different pictures.
 */
export function verifyPreset(name, onImage, tolerance) {
  const p = PRESETS.get(name)
  if (p === undefined) throw new Error(`unknown preset "${name}"`)
  const r = run(onImage, p.graph)
  const m = measure(r.image)
  const same = sameMeasure(p.evidence, m, tolerance)
  return { name, same: same.same, worstRatio: same.worstRatio, diffs: same.diffs, captured: p.evidence, now: m }
}

function sameMeasure(a, b, tolerance = {}) {
  const t = {
    lumaMean: tolerance.lumaMean === undefined ? 0.5 : tolerance.lumaMean,
    lumaSd: tolerance.lumaSd === undefined ? 0.5 : tolerance.lumaSd,
    coverage: tolerance.coverage === undefined ? 0.002 : tolerance.coverage,
    channelMean: tolerance.channelMean === undefined ? 0.5 : tolerance.channelMean,
  }
  const diffs = {}
  let worst = 0
  for (const [key, limit] of Object.entries(t)) {
    const av = a[key]
    const bv = b[key]
    if (av === undefined || bv === undefined) continue
    const d = Array.isArray(av) ? Math.max(...av.map((v, i) => Math.abs(v - bv[i]))) : Math.abs(av - bv)
    diffs[key] = Number(d.toFixed(4))
    if (d > limit) worst = Math.max(worst, d / limit)
  }
  return { same: worst <= 1, worstRatio: Number(worst.toFixed(3)), diffs }
}

/** Report what a graph would need, so an agent can be told before it runs anything. */
export function describeGraph(graph) {
  let maxReach = 0
  let anySlow = false
  const kinds = new Set()
  for (const op of graph) {
    if (op.op === 'rank') {
      maxReach = Math.max(maxReach, op.radius === undefined ? 2 : op.radius)
      anySlow = true
      kinds.add('rank')
      continue
    }
    if (op.op === 'sample' || op.op === 'blur') {
      const k = kernelOf(op)
      const s = support(k)
      maxReach = Math.max(maxReach, Math.max(s.x, s.y))
      // A general-path kernel costs pixels times area; the constant-time shapes do not.
      if (k.shape === 'custom' || k.shape === 'ring' || k.shape === 'cross') anySlow = true
      kinds.add('spatial')
      continue
    }
    if (op.op === 'similarityMask') {
      // The mask compares against a blur of the same radius, so it inherits that reach.
      const k = kernel(op.kernel === undefined ? 'box' : op.kernel.shape, op.kernel === undefined ? { radius: 3 } : op.kernel)
      const s = support(k)
      maxReach = Math.max(maxReach, Math.max(s.x, s.y))
      kinds.add('mask')
      continue
    }
    if (op.op === 'solid' || op.op === 'noise') { kinds.add(op.op); continue }
    if (op.op === 'luminanceMask') { kinds.add('mask'); continue }
    if (op.op === 'blend') {
      kinds.add('blend')
      continue
    }
    if (POINTWISE[op.op] === undefined) {
      throw new Error(
        `unknown operator "${op.op}". Pointwise: ${Object.keys(POINTWISE).join(', ')}. `
        + `Spatial: ${SPATIAL_OPS.join(', ')}. Mixing: ${MIX_OPS.join(', ')}.`,
      )
    }
    kinds.add('pointwise')
  }
  return {
    operators: graph.length,
    // What the chain is made of, so a description can be checked against what was asked
    // for: a graph that claims to be "just a tone adjustment" but reports a spatial step
    // is not what it says it is.
    kinds: [...kinds].sort(),
    maxNeighbourhood: maxReach,
    // Stated rather than discovered: a graph containing a general-path kernel or a rank
    // filter costs more than one that does not, and the caller should know before running
    // it on a full canvas rather than after.
    mayBeSlow: anySlow,
  }
}
