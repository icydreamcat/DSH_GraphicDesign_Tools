/**
 * The preset library: real filters, expressed as operator graphs.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Two things, and the second is the point.
 *
 * First, a catalogue: filters a designer already knows, written in the palette's
 * vocabulary so they can be used, inspected and modified rather than reimplemented.
 *
 * Second — and this is what the catalogue is really testing — it is the evidence that the
 * vocabulary is SUFFICIENT. Every preset here is a standard filter from GIMP, Photoshop,
 * ImageMagick or silver-halide practice, with its published parameters mapped onto
 * operators. If a well-established filter cannot be written as a graph, the abstraction is
 * missing something, and the gap shows up here rather than in production.
 *
 * PARAMETERS KEEP THEIR PUBLISHED NAMES AND RANGES
 * ------------------------------------------------
 * Where a filter has documented parameters, they are used unchanged and with the
 * documented ranges, so a description written for one tool transfers:
 *
 *   unsharp        radius 0-1500, amount 0-3 (GIMP's 0-300%), threshold 0-1
 *   surfaceBlur    radius, maxDelta, softness, all in 0-255 luminance levels
 *   highPass       radius; the result is grey where the image is flat
 *   posterize      2-255 levels
 *   levels         in 0..1, matching every colour picker
 *
 * The conversion from a published parameter to an operator parameter is stated in each
 * preset, because that conversion is where a description would otherwise silently drift.
 *
 * All of them are data. Nothing here is a function, so a preset can be serialised,
 * compared, expanded, and verified against its own measurements.
 */

import { run, capturePreset } from './palette.mjs'
import { measure } from './measure.mjs'

/**
 * Unsharp mask, as GIMP defines it.
 *
 * GIMP's documented construction is: blur the image, subtract the blur from the original,
 * add the difference back. Written as a blend, with `over` = the blurred version:
 *
 *   out = original + (blurred - original) * amount
 *
 * so `amount` = -1 is 100% and -3 is GIMP's 300% maximum. The negative sign is the whole
 * content of the filter: a positive amount smooths, a negative one sharpens, and both are
 * this same operator.
 *
 * The threshold is GIMP's, and maps exactly onto `similarityMask`: differences below it
 * are not treated as edges and so are left alone, which is what protects "areas of smooth
 * tonal transition … face, sky or water surface" from being sharpened into blemishes.
 */
export function unsharp(radius, amount, threshold) {
  const g = [
    { op: 'sample', kernel: { shape: 'gaussian', radius }, as: 'blurred' },
    {
      op: 'similarityMask',
      from: 'input',
      against: 'blurred',
      maxDelta: threshold * 255,
      softness: 0,
      as: 'edges',
    },
    {
      op: 'blend',
      base: 'input',
      over: 'blurred',
      amount: -amount,
      // With a threshold of zero every pixel is an edge, so the mask is omitted rather
      // than being a mask that selects everything — a chain should not carry a step that
      // provably does nothing.
      ...(threshold > 0 ? { mask: 'edges' } : {}),
    },
  ]
  return threshold > 0 ? g : g.filter((o) => o.op !== 'similarityMask')
}

/**
 * Surface blur: smooth within a region, stop at its edges.
 *
 * The composition that replaced the kernel `gate` parameter, and the reason that removal
 * was worth doing: "blur, find the pixels that resemble their neighbourhood, mix the two"
 * is three operators whose individual effects are all measurable, where a gate parameter
 * stated none of the structure.
 *
 * `maxDelta` and `softness` are in luminance levels. At softness 0 this is GIMP's surface
 * blur (a hard cut, which leaves visible plateaus); above 0 it becomes a bilateral filter
 * (a ramp, which does not).
 */
export function surfaceBlur(radius, maxDelta, softness) {
  return [
    { op: 'sample', kernel: { shape: 'box', radius }, as: 'blurred' },
    { op: 'similarityMask', from: 'input', against: 'blurred', maxDelta, softness, as: 'flat' },
    { op: 'blend', base: 'input', over: 'blurred', amount: 1, mask: 'flat' },
  ]
}

/**
 * High pass: what is left of an image after its low frequencies are removed.
 *
 *   out = original - blurred + 0.5
 *
 * Used at low opacity over the original it is the standard "large-radius sharpening" that
 * raises local contrast without haloing, which is why it is worth having as a preset
 * rather than as a slider. The +0.5 is what makes it grey where the image is flat, and the
 * mid-grey result is the giveaway that it worked: a high pass that is not grey in a flat
 * area has not removed the low frequencies.
 */
export function highPass(radius) {
  return [
    // out = mid grey + (original - blurred) / 2
    //
    // The arithmetic was determined EMPIRICALLY rather than derived, after two derived
    // versions each looked correct and were both wrong. `blend(base, over, amount)` is
    // `base + (over - base) * amount`, clamped — established by probing the operator with
    // known values — and that shape cannot produce the difference `original - blurred` from
    // a base of `original`:
    //
    //   blend(input, blurred, -1)  =  input + (blurred - input) * -1  =  2*input - blurred
    //
    // which is not a difference at all. The difference needs the base to be the MID-TONE, so
    // the subtraction arrives already offset and representable in 0..255:
    //
    //   blend(midgrey, blurred, -1)  =  128 + (blurred - 128) * -1  =  256 - blurred
    //   blend(that, input, 0.5)      =  (256 - blurred)*0.5 + input*0.5
    //                                =  128 + (original - blurred) / 2
    //
    // A flat area therefore lands exactly on 128, which is the property that identifies a
    // high pass: the low frequencies are gone, so where there are none only the offset
    // remains. The half factor is the price of getting the offset for free — full amplitude
    // would need a base of black and two more steps, and the offset would have to be added
    // separately, because `blend(black, blurred, -1)` is negative and cannot survive the
    // 0..255 clamp.
    //
    // Both earlier versions failed on a FLAT fixture while looking plausible on a textured
    // one, which is why the test carries a flat case.
    { op: 'solid', color: '#808080', as: 'midgrey', produces: true, expectNoChange: true },
    { op: 'sample', kernel: { shape: 'gaussian', radius }, as: 'blurred' },
    { op: 'blend', base: 'midgrey', over: 'blurred', amount: -1, as: 'inverted' },
    { op: 'blend', base: 'inverted', over: 'input', amount: 0.5 },
  ]
}

/** Posterize: quantise tone to a fixed number of levels. */
export function posterize(levels) {
  return [{ op: 'posterize', levels }]
}

/**
 * Levels: the black point, white point and midtone gamma every colour picker exposes.
 *
 * Written as a curve rather than as a dedicated operator, because levels IS a curve and
 * expressing it that way means one fewer operator to maintain. The midtone is the curve's
 * value at the midpoint, so gamma 1.0 is the identity.
 */
export function levels(blackPoint, whitePoint, midtone) {
  const span = whitePoint - blackPoint
  if (span <= 0) throw new Error(`levels needs whitePoint above blackPoint, got ${blackPoint} and ${whitePoint}`)
  const mid = Math.pow(0.5, 1 / Math.max(0.01, midtone))
  return [{
    op: 'curve',
    points: [[0, 0], [blackPoint, 0], [blackPoint + span * mid, 0.5], [whitePoint, 1], [1, 1]],
  }]
}

/**
 * A duotone press: two inks and the paper, which is what a screen-printed poster is.
 *
 * `strength` is how far toward the inks the image is pushed; 1 is a full two-colour
 * separation, which is what a press actually produces.
 */
export function duotonePress(shadows, midtones, highlights, strength = 1) {
  return [{ op: 'duotone', shadows, midtones, highlights, strength }]
}

/**
 * Silver-halide grain: noise that respects the tone of the image it sits on.
 *
 * WHY THIS IS NOT UNIFORM NOISE
 * -----------------------------
 * On real film, grain is most visible in the midtones and nearly absent in clean highlights
 * and blocked shadows. Add the same noise everywhere and the result reads as digital sensor
 * noise rather than as grain — the tell is a sky full of speckle where film would be smooth,
 * and dust-free black shadows where film would show its texture.
 *
 * So the mask comes from the image's OWN luminance, which is what `luminanceMask` exists
 * for. A comparison mask (`similarityMask`) could not express it: there is nothing to
 * compare against when the quantity wanted is "how bright is this pixel".
 *
 * THE COMPOSITION
 * ---------------
 *   noise       a seeded constant field, deterministic so two renders match
 *   lum         a mask that peaks in the midtones: white at the centre, black at both ends
 *   blend       the noise mixed into the image through that mask
 *
 * `amount` is how far toward the noise the image is pushed, and `intensity` is the noise
 * field's own amplitude. They are separate because a designer reaches for them for
 * different reasons: intensity is "how rough is the grain", amount is "how much of it is
 * there".
 *
 * The midtone weighting uses three stops — none, full, none — rather than a curve, so the
 * shape is legible in the graph: the hump IS the mask's stop list.
 */
export function filmGrain(intensity, amount, seed) {
  return [
    { op: 'noise', amount: intensity, seed, base: '#808080', monochrome: true, as: 'grain', produces: true, expectNoChange: true },
    // Black at the ends, white in the middle: grain lives in the midtones.
    { op: 'luminanceMask', stops: ['#000000', '#FFFFFF', '#000000'], as: 'midtone' },
    // The mask reads the image, so it must be built before `current` becomes the noise.
    // The noise is drawn from the named slot rather than from `current`, which is the whole
    // reason named results exist.
    { op: 'blend', base: 'input', over: 'grain', amount, mask: 'midtone' },
  ]
}

/**
 * Silver-halide grain: luminance-dependent noise, which is what film grain is.
 *
 * Not uniform noise. On film, grain is most visible in the midtones and nearly absent in
 * clean highlights and blocked shadows, so a preset that adds the same noise everywhere
 * reads as digital rather than photographic. This is expressed as a lightness shift
 * applied through a curve-shaped mask — the structure being visible is the point.
 */
export const GRAIN_NEEDS_OPERATOR = 'a seeded noise operator, gated by luminance'

/** Every preset in the library, as a function of its own published parameters. */
export const LIBRARY = {
  unsharp,
  surfaceBlur,
  highPass,
  posterize,
  levels,
  duotonePress,
  filmGrain,
}

/** The defaults a UI would offer, with each filter's documented range. */
export const DEFAULTS = {
  unsharp: { radius: 5, amount: 1.0, threshold: 0, range: { radius: [0, 1500], amount: [0, 3], threshold: [0, 1] } },
  surfaceBlur: { radius: 5, maxDelta: 15, softness: 0, range: { radius: [0, 100], maxDelta: [0, 255], softness: [0, 255] } },
  highPass: { radius: 10, range: { radius: [0, 250] } },
  posterize: { levels: 8, range: { levels: [2, 255] } },
  levels: { blackPoint: 0.1, whitePoint: 0.9, midtone: 1.0, range: { blackPoint: [0, 1], whitePoint: [0, 1], midtone: [0.1, 9.99] } },
  duotonePress: { shadows: '#2E3324', midtones: '#6E7742', highlights: '#EFEFE2', strength: 1, range: { strength: [0, 1] } },
  filmGrain: { intensity: 0.12, amount: 0.6, seed: 1, range: { intensity: [0, 1], amount: [0, 1], seed: [0, 65535] } },
}

/**
 * Build a preset from the library by name and parameters.
 *
 * One entry point, so a caller describes a filter the way its documentation does and the
 * preset layer does the conversion. `LIBRARY[name](...)` with positional arguments would
 * put that knowledge in the caller's head instead.
 *
 * @param {string} name
 * @param {object} params
 */
export function build(name, params = {}) {
  const fn = LIBRARY[name]
  if (fn === undefined) {
    const known = Object.keys(LIBRARY)
    throw new Error(`unknown preset "${name}". Known: ${known.join(', ')}`)
  }
  const spec = fn.constructor.name === 'AsyncFunction' ? fn : fn
  const merged = { ...(DEFAULTS[name] ?? {}), ...params }
  delete merged.range
  const ordered = Object.keys(DEFAULTS[name] ?? {})
    .filter((k) => k !== 'range')
    .map((k) => merged[k])
  // The library functions are written with positional, documented parameters, so the
  // argument order IS the documentation order. Passing them explicitly keeps a preset's
  // construction inspectable rather than hidden behind an object spread.
  return spec(...ordered)
}

/** Build, run, and report — the shape most callers want. */
export function apply(name, params, image) {
  const graph = build(name, params)
  const r = run(image, graph)
  return { graph, image: r.image, steps: r.steps, measurements: measure(r.image) }
}

/**
 * Capture every library preset against a reference image, so the whole catalogue carries
 * evidence and can be regression-checked as one.
 */
export function captureLibrary(image, overrides = {}) {
  const out = []
  for (const name of Object.keys(LIBRARY)) {
    const params = overrides[name] ?? {}
    const graph = build(name, params)
    const cap = capturePreset(`lib:${name}`, graph, image, { description: `library preset ${name}` })
    out.push({ name, operators: graph.map((o) => o.op), steps: cap.steps.length, suspicious: cap.suspicious.length })
  }
  return out
}
