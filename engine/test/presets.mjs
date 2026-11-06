/**
 * The preset library: real filters as operator graphs, verified by what they do.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * Two separate claims, and the second is the important one.
 *
 *   1. Each preset does what its name says. A sharpener must raise edge energy, a surface
 *      blur must lower it while keeping the edge, a posterize must widen the tonal
 *      histogram in steps. Checking the direction of a documented effect is the only way
 *      to know a parameter mapping is right rather than merely plausible.
 *
 *   2. The vocabulary is SUFFICIENT. Every preset here is a filter with published
 *      parameters from another tool — GIMP's unsharp mask and its documented radius /
 *      amount / threshold ranges — and if any of them cannot be expressed as a graph, the
 *      abstraction is missing something. This file is where that would be discovered.
 *
 * A NOTE ON WHAT EARLIER MEASUREMENTS GOT WRONG
 * ---------------------------------------------
 * An intermediate check reported "the threshold changes nothing" because the fixture was
 * two flat levels: the selection fraction barely moved, and `changedFraction` saturated at
 * 87% in both cases so it could not distinguish them. The measurement was fine; the
 * fixture could not show the difference. The check below looks at the MASK directly, which
 * is what the threshold actually controls.
 *
 * Run: node test/presets.mjs
 */
import { build, apply, DEFAULTS, LIBRARY, captureLibrary } from '../src/presets.mjs'
import { run, describeGraph, listPresets } from '../src/palette.mjs'
import { measure, delta } from '../src/measure.mjs'

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

/** A reference image with a hard edge, a tonal ramp, and fine texture — so sharpening,
 *  smoothing, quantising and tone mapping each have something to act on. */
function reference(w = 160, h = 120) {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const edge = x < w * 0.45 ? 70 : 190
      const grad = (y / (h - 1)) * 40
      const fine = Math.sin(x * 0.9) * 6
      d[i] = Math.max(0, Math.min(255, edge + grad + fine))
      d[i + 1] = Math.max(0, Math.min(255, 120 + grad + fine))
      d[i + 2] = Math.max(0, Math.min(255, 160 - grad))
      d[i + 3] = 255
    }
  }
  return { width: w, height: h, data: d }
}

const img = reference()
const base = measure(img)

// ── 1. every preset does what its name says ────────────────────────────────
console.log('=== 1. documented effects produce their documented result ===')
{
  const uns = apply('unsharp', { radius: 5, amount: 1.0, threshold: 0 }, img)
  check('unsharp raises edge energy', uns.measurements.edgeEnergy > base.edgeEnergy * 1.5,
    `${base.edgeEnergy} -> ${uns.measurements.edgeEnergy}`)
  check('unsharp holds the overall level', Math.abs(uns.measurements.lumaMean - base.lumaMean) < 2,
    `lumaMean ${base.lumaMean} -> ${uns.measurements.lumaMean}`)

  // A larger amount must sharpen more. Without this, a preset that ignored its own
  // parameter would pass the check above.
  const strong = apply('unsharp', { radius: 5, amount: 2.5, threshold: 0 }, img)
  check('a larger amount sharpens more', strong.measurements.edgeEnergy > uns.measurements.edgeEnergy,
    `amount 1.0 -> ${uns.measurements.edgeEnergy}, amount 2.5 -> ${strong.measurements.edgeEnergy}`)

  const sb = apply('surfaceBlur', { radius: 5, maxDelta: 15, softness: 0 }, img)
  check('surface blur lowers edge energy', sb.measurements.edgeEnergy < base.edgeEnergy,
    `${base.edgeEnergy} -> ${sb.measurements.edgeEnergy}`)
  // The whole point of a SURFACE blur rather than a plain one: the hard edge survives.
  // A plain box blur of the same radius would smear it.
  const plain = apply('posterize', { levels: 256 }, img) // identity, for contrast below
  void plain
  const blurred = run(img, [{ op: 'sample', kernel: { shape: 'box', radius: 5 } }])
  const edgeContrast = (im) => {
    // Difference across the hard edge at mid height, sampled either side.
    const y = 60
    const a = im.data[(y * 160 + 66) * 4]
    const b = im.data[(y * 160 + 74) * 4]
    return Math.abs(a - b)
  }
  check('surface blur keeps the hard edge', edgeContrast(sb.image) >= edgeContrast(blurred.image) * 0.9,
    `edge contrast: surface ${edgeContrast(sb.image)}, plain box ${edgeContrast(blurred.image)}`)
  check('surface blur flattens the texture', sb.measurements.lumaSd < base.lumaSd,
``    + `lumaSd ${base.lumaSd} -> ${sb.measurements.lumaSd}`)

  // The signature of a high pass: where the image is flat the low frequencies are absent,
  // so only the offset survives and the result is EXACTLY mid grey. Asserted tightly, on a
  // genuinely flat fixture, because the two earlier versions of this preset both returned
  // something plausible-looking on a textured image and both failed here. Measured on a
  // flat field of 100: 128. A tolerance of 40 was passing a value of 86, which is the kind
  // of loose assertion that hides a wrong formula.
  const flatPlate = (() => {
    const w = 60, h = 60
    const d = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < d.length; i += 4) { d[i] = 100; d[i + 1] = 100; d[i + 2] = 100; d[i + 3] = 255 }
    return { width: w, height: h, data: d }
  })()
  const hpFlat = apply('highPass', { radius: 8 }, flatPlate)
  check('high pass returns exactly mid grey on a flat field',
    Math.abs(hpFlat.image.data[0] - 128) <= 2, `flat field of 100 reads ${hpFlat.image.data[0]}`)
  // And it must actually deviate around that grey on a real image, or the preset would be
  // a constant fill — the check above cannot tell those apart on its own.
  const hp = apply('highPass', { radius: 10 }, img)
  let lo = 255
  let hi = 0
  for (let i = 0; i < hp.image.data.length; i += 4) {
    lo = Math.min(lo, hp.image.data[i])
    hi = Math.max(hi, hp.image.data[i])
  }
  // The spread is asserted against the measured result rather than a hoped-for one: this
  // implementation carries HALF the high-pass amplitude, because the offset comes free from
  // the mid-grey base (see the note in the preset). Full amplitude needs a base of black and
  // a separately added offset, which is a different trade rather than a better one. Measured
  // range on this fixture: 102..160, centred on grey as it should be.
  check('high pass deviates around mid grey on a textured image', lo < 115 && hi > 150 && (lo + hi) / 2 > 110 && (lo + hi) / 2 < 145,
    `range ${lo}..${hi}, centred at ${((lo + hi) / 2).toFixed(0)}`)
  // Amplitude must scale with the edge, not with the image's overall level: a flat area of
  // the textured fixture sits near 128 as well.
  const flatArea = (im) => im.data[(30 * 160 + 10) * 4]
  check('a flat area of a textured image also sits near mid grey',
    Math.abs(flatArea(hp.image) - 128) < 45, `reads ${flatArea(hp.image)}`)

  const post = apply('posterize', { levels: 6 }, img)
  check('posterize widens the tonal histogram in steps', post.measurements.lumaSd > base.lumaSd,
    `lumaSd ${base.lumaSd} -> ${post.measurements.lumaSd}`)
  check('posterize holds the overall level', Math.abs(post.measurements.lumaMean - base.lumaMean) < 6,
    `lumaMean ${base.lumaMean} -> ${post.measurements.lumaMean}`)

  const lv = apply('levels', { blackPoint: 0.15, whitePoint: 0.85, midtone: 1.2 }, img)
  check('levels raises contrast', lv.measurements.lumaSd > base.lumaSd,
    `lumaSd ${base.lumaSd} -> ${lv.measurements.lumaSd}`)

  const dt = apply('duotonePress', { shadows: '#2E3324', midtones: '#6E7742', highlights: '#EFEFE2' }, img)
  // The two inks are olive and near-white; the red channel of the result must sit close to
  // the green one, which is what "a two-colour separation" means numerically.
  const rMean = dt.measurements.channelMean[0]
  const gMean = dt.measurements.channelMean[1]
  check('duotone press collapses the image onto two inks', Math.abs(rMean - gMean) < 25,
    `channel means ${dt.measurements.channelMean.join(', ')}`)
}

// ── 2. the threshold, measured on the mask it controls ─────────────────────
console.log('\n=== 2. the unsharp threshold protects smooth areas ===')
{
  // The threshold decides which pixels count as edges. Looking at the MASK is the direct
  // measurement; looking at the output conflates it with how much the sharpening moves
  // each pixel.
  const maskOf = (threshold) => {
    const g = [
      { op: 'sample', kernel: { shape: 'gaussian', radius: 5 }, as: 'blurred' },
      { op: 'similarityMask', from: 'input', against: 'blurred', maxDelta: threshold * 255, softness: 0, as: 'edges' },
    ]
    const r = run(img, g)
    return r.steps[1].selectedFraction
  }
  // GIMP's threshold SKIPS differences below it, so a SMALL threshold is the STRICT one:
  // only pixels that barely differ from their neighbourhood count as edges. The first
  // version of this test assumed the opposite and reported a correct implementation as
  // broken. The measured distribution on this fixture is 99% of pixels within 0-7 levels
  // and a maximum of 17.8, so the two ends are far apart and the direction is unambiguous.
  const strict = maskOf(0)
  const loose = maskOf(0.12)
  check('a near-zero threshold selects only the nearly-flat pixels', strict < 0.1,
    `selected ${strict}`)
  check('raising the threshold selects more', loose > strict,
    `threshold 0 -> ${strict}, threshold 0.12 -> ${loose}`)
  check('a high threshold selects effectively everything', loose > 0.9, `selected ${loose}`)
}

// ── 3. the vocabulary is sufficient ────────────────────────────────────────
console.log('\n=== 3. every published filter is expressible as a graph ===')
{
  for (const name of Object.keys(LIBRARY)) {
    let graph = null
    let err = null
    try { graph = build(name, {}) } catch (e) { err = e.message }
    check(`${name} builds from its documented defaults`, graph !== null, err ?? `${graph?.length} operators`)
    if (graph === null) continue
    const d = describeGraph(graph)
    check(`${name} describes itself`, Array.isArray(d.kinds) && d.kinds.length > 0,
      `${d.operators} ops, kinds ${d.kinds.join('+')}, reach ${d.maxNeighbourhood}, slow ${d.mayBeSlow}`)
    // Every operator in the graph must be one the palette knows — describeGraph throws
    // otherwise, so reaching here already proves it, but the count is worth reporting.
    check(`${name} uses only known operators`, d.operators === graph.length, `${d.operators}`)
  }
  // The gap this catalogue existed to expose, now closed. Film grain needs a mask derived
  // from the image's OWN tone, and no operator could express that: `similarityMask` compares
  // two images and there is nothing here to compare against.
  check('film grain is now expressible', typeof LIBRARY.filmGrain === 'function',
    'luminanceMask supplies the missing operator')

  const grain = build('filmGrain', { intensity: 0.2, amount: 0.8, seed: 3 })
  check('film grain composes from existing operators',
    grain.map((o) => o.op).join('+') === 'noise+luminanceMask+blend',
    grain.map((o) => o.op).join('+'))

  // THE MASK CURVE, measured directly rather than inferred from a noisy output.
  //
  // An earlier check measured roughness in three narrow bands of a noisy field and concluded
  // the mask was not working. It was: the sampling variance of a random field inside a narrow
  // band swamps the signal, so the bands read alike whatever the mask did. The mask is
  // deterministic, so it is measured on its own — a ramp across every luminance, read as a
  // curve.
  const ramp = (() => {
    const w = 256, h = 1
    const dd = new Uint8ClampedArray(w * h * 4)
    for (let x = 0; x < w; x++) {
      dd[x * 4] = x; dd[x * 4 + 1] = x; dd[x * 4 + 2] = x; dd[x * 4 + 3] = 255
    }
    return { width: w, height: h, data: dd }
  })()
  const mask = run(ramp, [{ op: 'luminanceMask', stops: ['#000000', '#FFFFFF', '#000000'] }])
  const mA = (v) => mask.image.data[v * 4 + 3]
  check('the mask peaks at mid grey', mA(128) > 250, `alpha at 128 is ${mA(128)}`)
  check('the mask is zero at black and at white', mA(0) === 0 && mA(255) === 0,
    `alpha at 0 is ${mA(0)}, at 255 is ${mA(255)}`)
  check('the mask rises toward the middle', mA(32) < mA(80) && mA(80) < mA(128),
    `${mA(32)} -> ${mA(80)} -> ${mA(128)}`)
  check('the mask falls away after the middle', mA(128) > mA(180) && mA(180) > mA(224),
    `${mA(128)} -> ${mA(180)} -> ${mA(224)}`)
  // THE SHAPE, not a width.
  //
  // A width threshold was the first attempt and it was wrong twice over. Geometrically, a
  // straight-line hump rising from 0 to 128 and back down would clear half height over 85 of
  // 256 levels, so "about a third" looked right; the interpolation runs through OKLab, which
  // curves the segments outward, and the measured half-height width is 128 — half the range.
  // Rather than tune a number to fit, the DEFINING properties are asserted: near zero at both
  // ends, monotone up to the peak, monotone down after it. Those are what film grain needs;
  // the exact width is a curve shape, not a specification.
  let covered = 0
  for (let v = 0; v < 256; v++) if (mA(v) > 26) covered++
  check('the mask is near zero over the outer extremes',
    mA(4) < 26 && mA(251) < 26, `alpha at 4 is ${mA(4)}, at 251 is ${mA(251)}`)
  check('the mask covers a clear majority of the middle', covered > 200 && covered < 256,
    `${covered} of 256 levels above a tenth of full coverage`)
  // Monotone on both sides. Note this alone would NOT catch the linear-light bug that put the
  // peak at 188: that curve is still monotone. The peak position asserted above is what
  // catches it, and the two checks only mean something together.
  let monotone = true
  for (let v = 0; v < 128; v++) if (mA(v + 1) < mA(v)) { monotone = false; break }
  for (let v = 128; v < 255; v++) if (mA(v + 1) > mA(v)) { monotone = false; break }
  check('the mask is monotone up to the peak and down after it', monotone, '')

  // And the ENDS: grain must vanish where the mask has no coverage. This is the property that
  // separates grain from sensor noise, and unlike a narrow-band measurement it is not a
  // statistic — it is zero.
  const flatAt = (v) => {
    const w = 40, h = 40
    const dd = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < dd.length; i += 4) { dd[i] = v; dd[i + 1] = v; dd[i + 2] = v; dd[i + 3] = 255 }
    return { width: w, height: h, data: dd }
  }
  const deviationFrom = (v, target) => {
    const im = apply('filmGrain', { intensity: 0.2, amount: 0.8, seed: 3 }, flatAt(v)).image
    let worst = 0
    for (let i = 0; i < im.data.length; i += 4) worst = Math.max(worst, Math.abs(im.data[i] - target))
    return worst
  }
  check('grain vanishes in pure white', deviationFrom(255, 255) === 0,
    `max deviation ${deviationFrom(255, 255)}`)
  check('grain vanishes in pure black', deviationFrom(0, 0) === 0,
    `max deviation ${deviationFrom(0, 0)}`)
  // Grain in the midtones must be present, or the two checks above would pass a no-op.
  check('grain is present in the midtones', deviationFrom(128, 128) > 20,
    `max deviation ${deviationFrom(128, 128)}`)

  // Determinism, which everything that compares two renders depends on.
  const g128a = apply('filmGrain', { intensity: 0.2, amount: 0.8, seed: 3 }, flatAt(128)).image.data
  const g128b = apply('filmGrain', { intensity: 0.2, amount: 0.8, seed: 3 }, flatAt(128)).image.data
  let identical = true
  for (let i = 0; i < g128a.length; i++) if (g128a[i] !== g128b[i]) { identical = false; break }
  check('the same seed gives a byte-identical field', identical, '')
  const g128c = apply('filmGrain', { intensity: 0.2, amount: 0.8, seed: 4 }, flatAt(128)).image.data
  let differs = false
  for (let i = 0; i < g128a.length; i++) if (g128a[i] !== g128c[i]) { differs = true; break }
  check('a different seed gives a different field', differs, 'the seed is not ignored')
}

// ── 4. presets carry evidence and verify ───────────────────────────────────
console.log('\n=== 4. the library captures as presets with evidence ===')
{
  const caps = captureLibrary(img)
  check('every library preset captures', caps.length === Object.keys(LIBRARY).length,
    `${caps.length} captured`)
  check('no captured preset has an inert step', caps.every((c) => c.suspicious === 0),
    caps.filter((c) => c.suspicious > 0).map((c) => c.name).join(', ') || 'none')

  const roster = listPresets()
  check('the roster holds them all', roster.length === caps.length, `${roster.length} presets`)
  check('the roster records each graph', roster.every((p) => p.operators.length > 0),
    roster.map((p) => `${p.name}:${p.operators.length}`).join(' '))
  check('the roster carries measurements', roster.every((p) => typeof p.evidence.lumaMean === 'number'),
    `first lumaMean ${roster[0].evidence.lumaMean}`)
}

// ── 5. parameters are validated against their published ranges ─────────────
console.log('\n=== 5. parameter handling ===')
{
  // Defaults must be usable without arguments: a caller who names a filter and nothing
  // else should get that filter, not an error.
  for (const name of Object.keys(LIBRARY)) {
    let ok = true
    let err = null
    try { apply(name, {}, img) } catch (e) { ok = false; err = e.message }
    check(`${name} runs with no parameters`, ok, err ?? 'ok')
  }
  check('levels refuses an inverted range', (() => {
    try { build('levels', { blackPoint: 0.9, whitePoint: 0.1 }); return false } catch { return true }
  })())
  check('an unknown preset name lists what exists', (() => {
    try { build('nonsense', {}) } catch (e) { return /Known:/.test(e.message) }
    return false
  })())
  check('the documented ranges are declared for every preset',
    Object.keys(LIBRARY).every((n) => DEFAULTS[n] !== undefined && DEFAULTS[n].range !== undefined),
    Object.keys(LIBRARY).join(', '))
}

console.log(`\n=== ${checks - failed}/${checks} checks passed ===`)
process.exit(failed === 0 ? 0 : 1)
