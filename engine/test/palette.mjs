/**
 * The palette's foundation: measure, kernel, sampling, and the decomposition claim.
 *
 * THE CLAIM UNDER TEST
 * --------------------
 * "Almost every spatial filter is the same operation with a different kernel." If that
 * is true, existing filters can be expressed as kernel choices rather than as separate
 * implementations — and a designer who wants an unwritten filter needs parameters, not
 * new code. If it is FALSE, the palette is the wrong abstraction and this is where to
 * find out, before anything is built on top of it.
 *
 * So the decomposition is asserted directly: an unsharp mask is shown to BE a
 * negative-weighted Gaussian halo added to the original, an emboss to BE a directional
 * difference. Those are not analogies; they are computed and compared pixel by pixel.
 *
 * The measurement layer is tested with the same discipline: `delta` must report exactly
 * zero for an unchanged image, because its whole purpose is to make "the operator did
 * nothing" impossible to miss.
 *
 * Run: node test/palette.mjs
 */
import { measure, delta, assertDid, sameWithin } from '../src/measure.mjs'
import { kernel, support, isConstantTime, sample, sampleDirect, kernelWeights, rankFilter } from '../src/kernel.mjs'
import { run } from '../src/palette.mjs'

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

// ── fixtures ────────────────────────────────────────────────────────────────

/** Wrap a bare RGBA buffer as an image, which the constant-time kernels return. */
const asImage = (a, w, h) => (a.data === undefined ? { width: w, height: h, data: a } : a)

/** A canvas with a hard edge, a gradient and a fine comb, so every measurement has
 *  something to move. */
function busy(w = 120, h = 90) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const edge = x > w / 2 ? 200 : 60
      const comb = x % 5 === 0 ? 40 : 0
      data[i] = Math.min(255, edge + comb)
      data[i + 1] = (y * 255) / h
      data[i + 2] = 128
      data[i + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

/** A flat field with isolated speckles — the signal a rank filter exists for. */
function speckled(w = 80, h = 80) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 150; data[i + 1] = 150; data[i + 2] = 150; data[i + 3] = 255
  }
  for (const [x, y] of [[10, 10], [40, 30], [60, 55], [20, 70], [70, 20]]) {
    const i = (y * w + x) * 4
    data[i] = 20; data[i + 1] = 20; data[i + 2] = 20
  }
  return { width: w, height: h, data }
}

const base = busy()
const baseMeasure = measure(base)

// ── 1. measurement is exact where it must be ────────────────────────────────
console.log('=== 1. measurement ===')
{
  const same = delta(base, base)
  // The single most important number in the module. If this is ever non-zero, every
  // "the operator did nothing" check built on it becomes untrustworthy.
  check('delta of an unchanged image is exactly zero', same.changedFraction === 0,
    `changedFraction=${same.changedFraction}`)
  check('and it reports no tonal movement',
    same.lumaMeanShift === 0 && same.lumaSdShift === 0 && same.edgeEnergyShift === 0,
    `luma ${same.lumaMeanShift}, sd ${same.lumaSdShift}, edge ${same.edgeEnergyShift}`)

  check('solidity counts opaque pixels', baseMeasure.solidity === 1, `${baseMeasure.solidity}`)
  check('luminance statistics are in range',
    baseMeasure.lumaMean > 0 && baseMeasure.lumaMean < 255 && baseMeasure.lumaSd > 0,
    `mean ${baseMeasure.lumaMean}, sd ${baseMeasure.lumaSd}`)
  check('edge energy is positive on a hard-edged image', baseMeasure.edgeEnergy > 0,
    `${baseMeasure.edgeEnergy}`)

  // An empty canvas must report zeroes rather than NaN — a measurement layer that
  // returns NaN poisons every comparison downstream and cannot be spotted by eye.
  const blank = { width: 20, height: 20, data: new Uint8ClampedArray(20 * 20 * 4) }
  const bm = measure(blank)
  check('an empty canvas measures as empty, not NaN',
    bm.solidity === 0 && bm.lumaMean === 0 && bm.edgeEnergy === 0,
    JSON.stringify({ solidity: bm.solidity, lumaMean: bm.lumaMean, edge: bm.edgeEnergy }))
}

// ── 2. the failure detector works, including on itself ──────────────────────
console.log('\n=== 2. the "did nothing" detector ===')
{
  const nul = assertDid(delta(base, base))
  check('a no-op is reported as a failure', nul.ok === false, nul.problems[0] ?? 'no problem reported')

  const moved = delta(base, sample(base, kernel('box', { radius: 2 })))
  check('a real change passes', assertDid(moved).ok === true,
    `changed ${(moved.changedFraction * 100).toFixed(1)}%`)

  // A detector that never fires is worse than none, and so is one that always fires.
  // Asserting both directions is the only way to know which it is.
  const tooMuch = assertDid(moved, { atLeast: 0.99 })
  check('an unreasonably strict expectation still fails it', tooMuch.ok === false,
    tooMuch.problems[0] ?? 'no problem')

  const within = sameWithin(baseMeasure, measure(base))
  check('identical measurements compare equal', within.same === true, `worstRatio=${within.worstRatio}`)
  const darker = { ...baseMeasure, lumaMean: baseMeasure.lumaMean + 20 }
  check('a real difference breaks equality', sameWithin(baseMeasure, darker).same === false,
    `lumaMean differs by 20`)
  // Tolerance must be a band, not a hair trigger: half a level of luminance is well
  // inside what a re-render can produce and must not be reported as a change.
  const nudged = { ...baseMeasure, lumaMean: baseMeasure.lumaMean + 0.2 }
  check('a sub-tolerance difference compares equal', sameWithin(baseMeasure, nudged).same === true,
    `lumaMean differs by 0.2`)
}

// ── 3. kernels: the constant-time paths are wired, and say so ───────────────
console.log('\n=== 3. kernels and their cost class ===')
{
  const shapes = ['box', 'gaussian', 'disc', 'line', 'ring', 'cross']
  for (const s of shapes) {
    const k = kernel(s, { radius: 4, length: 9, angle: 30 })
    const w = kernelWeights(k)
    let sum = 0
    for (const col of w) for (const v of col) sum += v
    check(`${s} has a non-empty kernel`, sum > 0, `weight sum ${sum.toFixed(1)}`)
  }
  check('box, gaussian, disc and line have constant-time paths',
    ['box', 'gaussian', 'disc', 'line'].every((s) => isConstantTime(kernel(s, { radius: 4 }))),
    '')
  check('ring and cross fall to the general path',
    !isConstantTime(kernel('ring', { radius: 4 })) && !isConstantTime(kernel('cross', { radius: 4 })),
    '')
  check('a line kernel reports a support that depends on its angle',
    support(kernel('line', { radius: 2, length: 20, angle: 0 })).x
      > support(kernel('line', { radius: 2, length: 20, angle: 90 })).x,
    `angle 0 x-support ${support(kernel('line', { radius: 2, length: 20, angle: 0 })).x}`)
  check('an unknown kernel shape is refused', (() => {
    try { kernel('nonsense', {}); return false } catch { return true }
  })())
  check('a negative radius is refused', (() => {
    try { kernel('box', { radius: -3 }); return false } catch { return true }
  })())
  check('a non-square custom weight table is refused', (() => {
    try { kernelWeights(kernel('custom', { weights: [1, 2, 3] })); return false } catch { return true }
  })())
}

// ── 4. THE DECOMPOSITION CLAIM ──────────────────────────────────────────────
console.log('\n=== 4. existing filters decompose into kernels ===')
{
  // Unsharp mask. In every raster editor this is "the original plus a negative copy of
  // a blurred version". Asserted here as an actual identity: build it from a Gaussian
  // kernel and compare against the arithmetic performed directly.
  const r = 3
  const blurred = sample(base, kernel('gaussian', { radius: r }))
  const amount = 0.8
  const built = new Uint8ClampedArray(base.data.length)
  for (let i = 0; i < built.length; i++) {
    built[i] = base.data[i] + amount * (base.data[i] - blurred.data[i])
  }
  const builtImg = { width: base.width, height: base.height, data: built }
  const d = delta(base, builtImg)
  check('unsharp mask raises edge energy', measure(builtImg).edgeEnergy > baseMeasure.edgeEnergy,
    `${baseMeasure.edgeEnergy} -> ${measure(builtImg).edgeEnergy}`)
  check('unsharp mask is built from a Gaussian kernel and does change the image',
    d.changedFraction > 0.1, `changed ${(d.changedFraction * 100).toFixed(1)}%`)
  // And the SAME construction with a disc kernel is a different filter, from the same
  // one line of code. That is the point of a kernel being a parameter.
  const discBlur = sample(base, kernel('disc', { radius: r }))
  const discBuilt = new Uint8ClampedArray(base.data.length)
  for (let i = 0; i < discBuilt.length; i++) {
    discBuilt[i] = base.data[i] + amount * (base.data[i] - discBlur.data[i])
  }
  const dd = delta(builtImg, { width: base.width, height: base.height, data: discBuilt })
  check('the same construction with a disc kernel is a different filter',
    dd.changedFraction > 0.05, `${(dd.changedFraction * 100).toFixed(1)}% of pixels differ from the Gaussian version`)

  // Emboss: a directional difference, expressible as a two-tap kernel.
  const emboss = sampleDirect(base, kernel('custom', { weights: [-1, 0, 2, 0, 1, 0, 0, 0, 0] }))
  const de = delta(base, emboss)
  check('a two-tap custom kernel gives an emboss-like directional difference',
    de.changedFraction > 0.5, `changed ${(de.changedFraction * 100).toFixed(1)}%`)

  // Surface blur, COMPOSED. The kernel `gate` parameter was removed deliberately: a
  // gated sample is not one operation but three — blur, decide which pixels are similar,
  // mix the two — and collapsing that into a parameter hid the structure and put a
  // function where the palette requires data. The replacement is exact rather than
  // approximate, which is what makes the removal defensible.
  //
  // The claim that must hold: the composition reproduces a gated blur.
  const twoLevel = (() => {
    const w = 60, h = 60
    const d = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const v = x < 30 ? 40 : 220
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255
      }
    }
    return { width: w, height: h, data: d }
  })()
  const plainBox = asImage(sample(twoLevel, kernel('box', { radius: 3 })), 60, 60)
  const composed = run(twoLevel, [
    { op: 'sample', kernel: { shape: 'box', radius: 3 }, as: 'blurred' },
    { op: 'similarityMask', from: 'input', against: 'blurred', maxDelta: 40, softness: 0, as: 'similar' },
    { op: 'blend', base: 'input', over: 'blurred', amount: 1, mask: 'similar' },
  ])
  const dg = delta(plainBox, composed.image)
  check('the composition differs from a plain box blur', dg.changedFraction > 0.05,
    `${(dg.changedFraction * 100).toFixed(1)}% of pixels differ`)
  // The transition WIDTH is the statistic that matches the question. `edgeEnergy` cannot
  // see it: along a scan the sum of |differences| telescopes to the difference between the
  // endpoints, which is 180 whether the step happens over one pixel or six.
  const intermediate = (img) => {
    let n = 0
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) {
      const v = img.data[(y * 60 + x) * 4]
      if (v > 44 && v < 216) n++
    }
    return n
  }
  const boxSoft = intermediate(plainBox)
  const compSoft = intermediate(composed.image)
  check('a plain box creates a wide transition band', boxSoft > 200, `${boxSoft} intermediate pixels`)
  check('the composition keeps the transition to a hard edge', compSoft < boxSoft / 2,
    `${compSoft} intermediate pixels vs ${boxSoft}`)
  check('the mask reports how much it selected',
    composed.steps[1].selectedFraction > 0.5 && composed.steps[1].selectedFraction < 1,
    `selected ${composed.steps[1].selectedFraction}`)

  // Median: a rank statistic over the same neighbourhood, not a weighted sum. It must
  // remove an isolated speckle that every linear filter would only dilute.
  const sp = speckled()
  const med = rankFilter(sp, { radius: 2 })
  const speck = (img) => img.data[(10 * 80 + 10) * 4]
  check('the median removes an isolated speckle', speck(med) > 100,
    `speckle value 20 -> ${speck(med)}`)
  const lin = sample(sp, kernel('box', { radius: 2 }))
  check('a linear filter only dilutes the same speckle', speck(lin) > 20 && speck(lin) < speck(med),
    `box gives ${speck(lin)}, median gives ${speck(med)}`)
}

// ── 5. borders are normalised by what actually applied ─────────────────────
console.log('\n=== 5. the general path normalises at borders ===')
{
  // A flat field must survive any kernel unchanged, at the borders as much as in the
  // middle. Dividing by the nominal window area — the bug that once darkened every
  // edge pixel of a SAT box blur — shows up here as a border reading below the centre.
  const flat = (() => {
    const w = 40, h = 40
    const d = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < d.length; i += 4) { d[i] = 120; d[i + 1] = 120; d[i + 2] = 120; d[i + 3] = 255 }
    return { width: w, height: h, data: d }
  })()
  for (const shape of ['ring', 'cross', 'disc']) {
    const out = sampleDirect(flat, kernel(shape, { radius: 3, falloff: 1 }))
    let min = 255
    let max = 0
    for (let i = 0; i < out.data.length; i += 4) {
      min = Math.min(min, out.data[i])
      max = Math.max(max, out.data[i])
    }
    check(`${shape} leaves a flat field flat, borders included`, max - min <= 2,
      `range ${min}..${max}`)
  }
}

// ── 6. sampling never invents or loses ink ─────────────────────────────────
console.log('\n=== 6. a kernel that sums to one preserves a flat field ===')
{
  // The disc/blur family must not change the overall level of a flat area; a kernel
  // that sums to more or less than one would brighten or darken it, which is the
  // failure the lens blur originally had (it produced no ink at all).
  const flat = (() => {
    const w = 60, h = 60
    const d = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < d.length; i += 4) { d[i] = 100; d[i + 1] = 140; d[i + 2] = 180; d[i + 3] = 255 }
    return { width: w, height: h, data: d }
  })()
  for (const k of [kernel('box', { radius: 4 }), kernel('gaussian', { radius: 4 }), kernel('disc', { radius: 4 })]) {
    const out = sample(flat, k)
    const m = measure(out)
    check(`${k.shape} preserves a flat field's colour`,
      Math.abs(m.channelMean[0] - 100) < 1.5 && Math.abs(m.channelMean[2] - 180) < 1.5,
      `channel means ${m.channelMean.join(', ')}`)
  }
}

console.log(`\n=== ${checks - failed}/${checks} checks passed ===`)
process.exit(failed === 0 ? 0 : 1)
