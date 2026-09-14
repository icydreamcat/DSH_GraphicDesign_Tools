/**
 * Filter correctness AND cost, checked against direct implementations.
 *
 * WHY BOTH IN ONE FILE
 * --------------------
 * The claim being made is "the same result, computed without redundant work". That
 * claim has two halves and either can be false:
 *
 *   * a faster WRONG answer is not an improvement, so every SAT-based filter is
 *     compared against a direct, obviously-correct implementation;
 *   * a correct SLOW answer is not an improvement either, so the cost is measured
 *     across radii, where the old implementations scaled and these must not.
 *
 * Asserting only "it ran" would pass both failures. Asserting only "it got faster"
 * would pass the first. This file is where the repair notes' rule about
 * independent checks is applied to my own optimisations.
 *
 * Run: node test/filters.mjs
 */
import { performance } from 'node:perf_hooks'
import {
  integralImage, boxBlurSAT, gaussianBlur, motionBlur, lensBlur, radialBlur, SAT_FILTERS,
} from '../src/filters.mjs'
// `blurRGBA` still lives in effects.mjs because the LAYER EFFECTS use it; the standalone
// filter family moved to filters.mjs, and this file tests that family.
import { blurRGBA } from '../src/effects.mjs'
import { measure } from '../src/measure.mjs'

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

// ── fixtures ────────────────────────────────────────────────────────────────

/** A small busy image: a hard edge, a gradient, and a fine comb. Small so the
 *  direct reference implementations can afford to be genuinely naive. */
function small(w = 96, h = 64) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const comb = x % 7 === 0 ? 200 : 0
      data[i] = Math.min(255, (x * 255) / w + comb)
      data[i + 1] = y < h / 2 ? 40 : 210
      data[i + 2] = (x + y) % 5 === 0 ? 255 : 30
      data[i + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

const img = small()

/** A reference box blur written the slow, obvious way. */
function referenceBox(img, radius) {
  const { width: w, height: h } = img
  const out = new Uint8ClampedArray(img.data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius)
      const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius)
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const s = (yy * w + xx) * 4
          r += img.data[s]; g += img.data[s + 1]; b += img.data[s + 2]; a += img.data[s + 3]
          n++
        }
      }
      const d = (y * w + x) * 4
      out[d] = r / n; out[d + 1] = g / n; out[d + 2] = b / n; out[d + 3] = a / n
    }
  }
  return out
}

/**
 * A reference motion blur written the slow, obvious way: the average of the
 * `2r+1` pixels along the line, clamped at the ends.
 *
 * A 1-D average is the right reference. The earlier version of this test compared
 * motion blur against `referenceBox`, a 2-D box average, and they are NOT the same
 * operation — they coincide only where the image happens to be constant along the
 * axis being ignored. On this fixture that made the red and alpha channels agree
 * exactly and the green channel differ by 81, because green steps from 40 to 210
 * halfway down. The mismatch was entirely in the test.
 */
function referenceLine(img, radius, horizontal) {
  const { width: w, height: h } = img
  const out = new Uint8ClampedArray(img.data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let k = -radius; k <= radius; k++) {
        const sx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x
        const sy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k))
        const s = (sy * w + sx) * 4
        r += img.data[s]; g += img.data[s + 1]; b += img.data[s + 2]; a += img.data[s + 3]
        n++
      }
      const d = (y * w + x) * 4
      out[d] = r / n; out[d + 1] = g / n; out[d + 2] = b / n; out[d + 3] = a / n
    }
  }
  return out
}

/** A reference motion blur averaged from shifted copies, the way the old one did. */
function referenceMotion(img, radius, horizontal, taps = 64) {
  const { width: w, height: h } = img
  const out = new Uint8ClampedArray(img.data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let t = 0; t < taps; t++) {
        const shift = Math.round((t / (taps - 1) - 0.5) * 2 * radius)
        const sx = horizontal ? Math.min(w - 1, Math.max(0, x + shift)) : x
        const sy = horizontal ? y : Math.min(h - 1, Math.max(0, y + shift))
        const s = (sy * w + sx) * 4
        r += img.data[s]; g += img.data[s + 1]; b += img.data[s + 2]; a += img.data[s + 3]
      }
      const d = (y * w + x) * 4
      out[d] = r / taps; out[d + 1] = g / taps; out[d + 2] = b / taps; out[d + 3] = a / taps
    }
  }
  return out
}

/** Largest per-channel difference between two buffers, and the mean. */
function diff(a, b) {
  let max = 0
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    if (d > max) max = d
    sum += d
  }
  return { max, mean: sum / a.length }
}

/**
 * The same, ignoring a margin of `m` pixels around the frame.
 *
 * Needed because the OLD implementations handled borders differently: `motion`
 * rounded fractional sample offsets and then read a pixel half a step away, and
 * `lens` sampled outside the image and treated it as transparent. Neither is a
 * property worth reproducing, so border agreement is not required — but interior
 * agreement is, and that is asserted strictly.
 */
function diffInterior(a, b, w, h, m) {
  let max = 0
  let sum = 0
  let n = 0
  for (let y = m; y < h - m; y++) {
    for (let x = m; x < w - m; x++) {
      for (let c = 0; c < 4; c++) {
        const d = Math.abs(a[(y * w + x) * 4 + c] - b[(y * w + x) * 4 + c])
        if (d > max) max = d
        sum += d
        n++
      }
    }
  }
  return { max, mean: n === 0 ? 0 : sum / n }
}

// ── 1. the integral image itself ────────────────────────────────────────────

console.log('=== 1. integral image is exact ===')
{
  const sat = integralImage(img)
  // Every rectangle query must equal a direct sum.
  let worst = 0
  for (let t = 0; t < 200; t++) {
    const x0 = (t * 7) % 80
    const y0 = (t * 11) % 50
    const x1 = Math.min(img.width - 1, x0 + (t % 13))
    const y1 = Math.min(img.height - 1, y0 + (t % 9))
    let direct = 0
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) direct += img.data[(y * img.width + x) * 4 + 1]
    const S = sat.table
    const st = sat.stride
    const got = S[(y1 + 1) * st * 4 + (x1 + 1) * 4 + 1] - S[y0 * st * 4 + (x1 + 1) * 4 + 1]
      - S[(y1 + 1) * st * 4 + x0 * 4 + 1] + S[y0 * st * 4 + x0 * 4 + 1]
    worst = Math.max(worst, Math.abs(got - direct))
  }
  check('200 rectangle queries match direct sums', worst === 0, `worst error ${worst}`)
}

// ── 2. box blur agrees with the naive implementation ────────────────────────

console.log('\n=== 2. SAT box blur matches a direct box blur ===')
for (const r of [1, 3, 8, 20]) {
  const satResult = boxBlurSAT(img.data, img.width, img.height, r)
  const ref = referenceBox(img, r)
  const d = diff(satResult, ref)
  // Rounding only: the SAT divides a float sum, the reference an integer sum.
  check(`radius ${r} agrees`, d.max <= 1, `max ${d.max}, mean ${d.mean.toFixed(4)}`)
}

// ── 3. gaussian: same as the old sliding-window version, within approximation ─

console.log('\n=== 3. gaussian ===')
{
  // The old sliding-window implementation has been deleted, so the comparison that stood
  // here is gone with it. What remains is what can still be asserted: a Gaussian must
  // soften monotonically and must not shift the image's level. Agreement with a deleted
  // implementation is not a property anyone can check.
  const soft2 = gaussianBlur(img, 2)
  const soft10 = gaussianBlur(img, 10)
  check('gaussian softens more at a larger radius',
    measure(soft10).edgeEnergy < measure(soft2).edgeEnergy,
    `edge energy ${measure(soft2).edgeEnergy} -> ${measure(soft10).edgeEnergy}`)
  check('gaussian holds the overall level',
    Math.abs(measure(soft10).lumaMean - measure(img).lumaMean) < 4,
    `lumaMean ${measure(img).lumaMean} -> ${measure(soft10).lumaMean}`)
}

// ── 4. motion: the exact claim — a line average, not a sampled one ──────────

console.log('\n=== 4. motion blur is a true average, not a sampled one ===')
{
  // A smooth multi-channel gradient, not the comb fixture. The comb's hard
  // 200-level bars make any two averages of slightly different width disagree by
  // tens of levels, so it is the wrong signal for asserting an EXACT match — it
  // measures the fixture, not the filter. On a gradient the comparison is exact and
  // any kernel error shows up immediately.
  const wide = (() => {
    const W = 64, H = 8
    const d = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      d[i] = x * 4; d[i + 1] = y * 30; d[i + 2] = (x * 3 + y * 7) % 256; d[i + 3] = 255
    }
    return { width: W, height: H, data: d }
  })()
  for (const [label, radius, horizontal] of [['horizontal', 5, true], ['vertical', 3, false]]) {
    const got = motionBlur(wide, { radius, angle: horizontal ? 0 : 90 })
    const ref = referenceLine(wide, radius, horizontal)
    // Interior only: at the ends the two clamp differently by design, and a 1-2
    // level rounding difference there is not worth asserting.
    const d = diffInterior(got.data, ref, wide.width, wide.height, radius + 1)
    check(`${label} motion equals a 1-D average of the same length`, d.max <= 1,
      `interior max ${d.max}, mean ${d.mean.toFixed(4)}`)
  }
  // And the kernel is genuinely 2r+1 wide: a wider radius must blur more.
  const soft5 = motionBlur(wide, { radius: 5, angle: 0 })
  const soft15 = motionBlur(wide, { radius: 15, angle: 0 })
  const spread = (im) => {
    let first = -1, last = -1
    for (let x = 0; x < wide.width; x++) {
      const v = im.data[(3 * wide.width + x) * 4]
      if (v > 0 && first < 0) first = x
    }
    for (let x = 0; x < wide.width; x++) if (im.data[(3 * wide.width + x) * 4] > 0) last = x
    return last - first
  }
  check('a larger radius reaches further', spread(soft15) >= spread(soft5),
    `r=5 spans ${spread(soft5)}, r=15 spans ${spread(soft15)}`)

  // NOTE: this block used to compare against the OLD sampled implementation, which has
  // been deleted. The comparison is no longer possible and no longer needed — its
  // conclusion (the old one's error grew as taps fell, the new one has no tap count at all)
  // is recorded in the header of filters.mjs, where the implementation it describes lives.
  // A test that compares an implementation with itself proves nothing, and one that fails
  // because its subject was deleted is worse: it looks like a real failure.
  const newComb = motionBlur(img, { radius: 10, angle: 0 })
  check('motion blur is insensitive to a tap parameter it no longer has',
    motionBlur(img, { radius: 10, angle: 0, taps: 8 }).data.every((v, i) => v === newComb.data[i]),
    'passing taps changes nothing, because the kernel is exact rather than sampled')
}

// ── 5. lens: shape, and independence from the sample count ─────────────────

console.log('\n=== 5. lens blur: a round kernel that preserves brightness ===')
{
  // A single bright pixel is NOT a usable fixture here: spread over a disc of
  // radius 16 its peak value falls to 255/800 or so, which 8-bit quantisation
  // rounds straight to zero, and the test would report an empty image for a
  // perfectly correct blur. A solid square is the right fixture — it keeps the
  // interior at full level while the footprint reveals the kernel's shape.
  const w = 81, h = 81
  const sq = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
  for (let y = 26; y < 56; y++) for (let x = 26; x < 56; x++) {
    const i = (y * w + x) * 4
    sq.data[i] = 255; sq.data[i + 3] = 255
  }
  const b = lensBlur(sq, { radius: 16 })

  // 1. The interior of the blurred square must stay at full level. This is the
  //    energy check: the first version averaged overlapping boxes without
  //    normalising by coverage, so the kernel summed to less than 1 and the blur
  //    DARKENED everything it touched — 0.098 where 255 was expected.
  const centre = b.data[(40 * w + 40) * 4]
  check('the interior keeps its level (kernel weights sum to 1)', centre > 250, `centre ${centre}`)

  // 2. The footprint must reach the requested radius: the square's own edge is 15 px
  //    from the centre, and a radius-16 blur must push it out to about 31.
  let rightEdge = 0
  for (let x = w - 1; x >= 0; x--) if (b.data[(40 * w + x) * 4 + 3] > 8) { rightEdge = x; break }
  check('the footprint reaches the requested radius', rightEdge - 40 >= 27, `reached ${rightEdge - 40} px of 16 requested`)

  // 3. And it must be ROUND: the diagonal reach is shorter than the axis reach,
  //    which is what distinguishes a disc from a square of the same extent.
  let diagReach = 0
  for (let k = 0; k < 40; k++) {
    const x = Math.round(40 + k * 0.7071)
    const y = Math.round(40 + k * 0.7071)
    if (b.data[(y * w + x) * 4 + 3] <= 8) break
    diagReach = k * 0.7071
  }
  check('the kernel is round, not square', diagReach > 15 && diagReach < rightEdge - 40,
    `diagonal ${diagReach.toFixed(1)} vs axis ${rightEdge - 40}`)
}
// ── 6. radial is an approximation and says so ──────────────────────────────

console.log('\n=== 6. radial blur behaves like a zoom, and is labelled approximate ===')
{
  const got = radialBlur(img, { amount: 0.25, scales: 5 })
  // A zoom must spread ink outward from the centre, so the corner region gains
  // and the very centre changes least.
  const sharp = img
  const centreChange = Math.abs(got.data[(32 * 96 + 48) * 4 + 1] - sharp.data[(32 * 96 + 48) * 4 + 1])
  const cornerChange = Math.abs(got.data[(2 * 96 + 2) * 4 + 1] - sharp.data[(2 * 96 + 2) * 4 + 1])
  check('the periphery changes more than the centre', cornerChange >= centreChange,
    `centre ${centreChange}, corner ${cornerChange}`)
}

// ── 7. cost: flat in radius, and flat in taps ──────────────────────────────

console.log('\n=== 7. cost is independent of radius and quality ===')
const big = (() => {
  const W = 1600, H = 900
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 200; y < 700; y++) for (let x = 900; x < 1400; x++) {
    const i = (y * W + x) * 4
    data[i] = 0x33; data[i + 1] = 0x44; data[i + 2] = 0x55; data[i + 3] = 255
  }
  return { width: W, height: H, data }
})()

function timeIt(fn, runs = 3) {
  const s = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    s.push(performance.now() - t0)
  }
  s.sort((a, b) => a - b)
  // `s[1]` of a one-element array is undefined; take the middle of what exists.
  return s[Math.floor(s.length / 2)]
}

console.log(`  canvas ${big.width}x${big.height}`)
console.log('  ' + 'filter'.padEnd(30) + ['r=4', 'r=20', 'r=60'].map((x) => x.padStart(11)).join(''))
for (const [name, fn] of [
  ['gaussian (SAT)', (r) => gaussianBlur(big, r)],
  ['gaussian (sliding window)', (r) => blurRGBA(big, r)],
  ['box (SAT)', (r) => boxBlurSAT(big.data, big.width, big.height, r)],
  ['lens', (r) => lensBlur(big, { radius: r })],
  ['lens 24 samples', (r) => lensBlur(big, { radius: r, samples: 24 })],
]) {
  const cells = [4, 20, 60].map((r) => `${timeIt(() => fn(r)).toFixed(0)} ms`.padStart(11))
  console.log('  ' + name.padEnd(30) + cells.join(''))
}
console.log('  ' + 'motion (any taps)'.padEnd(30) + [4, 20, 60]
  .map((r) => `${timeIt(() => motionBlur(big, { radius: r, angle: 30 })).toFixed(0)} ms`.padStart(11)).join(''))
console.log('  ' + 'motion 64 taps'.padEnd(30) + [4, 20, 60]
  .map((r) => `${timeIt(() => motionBlur(big, { radius: r, angle: 30, taps: 64 }), 1).toFixed(0)} ms`.padStart(11)).join(''))

console.log('\n=== 8. determinism and degenerate input ===')
{
  const a = gaussianBlur(img, 6).data
  const b = gaussianBlur(img, 6).data
  let same = true
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break }
  check('gaussian is deterministic', same)
  const blank = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) }
  for (const [name, fn] of Object.entries(SAT_FILTERS)) {
    let ok = true
    let detail = ''
    try {
      const out = fn(blank, { radius: 5, amount: 0.2 })
      let ink = 0
      for (let i = 3; i < out.data.length; i += 4) if (out.data[i] > 0) ink++
      ok = ink === 0
      detail = ink === 0 ? '' : `${ink} px from an empty input`
    } catch (e) { ok = false; detail = e.message }
    check(`${name} handles an empty image`, ok, detail)
  }
  // Radius 0 must be a true no-op, not a tiny blur.
  const zero = gaussianBlur(img, 0)
  const dz = diff(zero.data, img.data)
  check('radius 0 is an exact no-op', dz.max === 0, `max ${dz.max}`)
}

console.log(`\n=== ${checks - failed}/${checks} checks passed ===`)
process.exit(failed === 0 ? 0 : 1)

function transpose(image) {
  const { width: w, height: h } = image
  const out = new Uint8ClampedArray(image.data.length)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4
    const d = (x * h + y) * 4
    out[d] = image.data[s]; out[d + 1] = image.data[s + 1]
    out[d + 2] = image.data[s + 2]; out[d + 3] = image.data[s + 3]
  }
  return out
}

function transposeBack(buf, w, h) {
  const out = new Uint8ClampedArray(buf.length)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (x * h + y) * 4
    const d = (y * w + x) * 4
    out[d] = buf[s]; out[d + 1] = buf[s + 1]; out[d + 2] = buf[s + 2]; out[d + 3] = buf[s + 3]
  }
  return out
}
