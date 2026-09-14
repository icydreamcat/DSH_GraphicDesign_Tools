/**
 * The palette: pointwise operators, the graph runner, and presets.
 *
 * THE ASSERTION THAT MATTERS MOST
 * ------------------------------
 * `hueRotate` promises that lightness does not move. In HSL that promise is false —
 * rotating hue at constant "lightness" changes perceived brightness, most severely in
 * yellows and blues — which is exactly why the same parameter would do visibly
 * different things at different hues, and why a described result would not survive a
 * colour change. Working in OKLab is what makes the promise keepable, so it is asserted
 * across the hue circle rather than at one convenient angle.
 *
 * A test that checked a single hue would pass an HSL implementation. Checking twelve
 * hues and requiring the lightness spread to stay small is what distinguishes them.
 *
 * Run: node test/palette-ops.mjs
 */
import { run, describeGraph, POINTWISE, capturePreset, expandPreset, listPresets, verifyPreset, applyOklab } from '../src/palette.mjs'
import { measure, delta } from '../src/measure.mjs'
import { toOklab, fromOklab } from '../src/color.mjs'

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

// ── fixtures ────────────────────────────────────────────────────────────────

/** A tonal ramp plus colour patches, so both lightness and chroma have something to do. */
function ramp(w = 64, h = 48) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      data[i] = (x / (w - 1)) * 255
      data[i + 1] = (y / (h - 1)) * 255
      data[i + 2] = 128
      data[i + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

/** A field of the same colour, for isolating one operator's effect. */
function flat(colour, w = 32, h = 32) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = colour.r; data[i + 1] = colour.g; data[i + 2] = colour.b; data[i + 3] = 255
  }
  return { width: w, height: h, data }
}

const img = ramp()

// ── 1. the colour space is the precision ────────────────────────────────────
console.log('=== 1. hueRotate moves hue without moving perceived lightness ===')
{
  // Twelve hues around the circle, each rotated by the same amount. Perceived lightness
  // is OKLab L, which is the quantity the promise is about.
  const hues = []
  for (let k = 0; k < 12; k++) {
    const rgb = fromOklab({ L: 0.62, a: 0.12 * Math.cos((k * Math.PI) / 6), b: 0.12 * Math.sin((k * Math.PI) / 6) })
    const field = flat({ r: rgb.r, g: rgb.g, b: rgb.b })
    const before = toOklab({ r: rgb.r, g: rgb.g, b: rgb.b })
    const out = run(field, [{ op: 'hueRotate', degrees: 47 }])
    const px = out.image.data
    const after = toOklab({ r: px[0], g: px[1], b: px[2] })
    hues.push({ before: before.L, after: after.L, shift: after.L - before.L })
  }
  const shifts = hues.map((h) => Math.abs(h.shift))
  const worst = Math.max(...shifts)
  const mean = shifts.reduce((a, b) => a + b, 0) / shifts.length
  check('lightness is preserved at every hue', worst < 0.02,
    `worst shift ${worst.toFixed(4)}, mean ${mean.toFixed(4)} across 12 hues`)
  // And the hue ACTUALLY moved, so the check above cannot be satisfied by an operator
  // that does nothing.
  const moved = run(img, [{ op: 'hueRotate', degrees: 47 }])
  check('hue did move', delta(img, moved.image).changedFraction > 0.5,
    `${(delta(img, moved.image).changedFraction * 100).toFixed(0)}% of pixels changed`)
  // 180 degrees must be distinguishable from 47: a rotation that ignored its parameter
  // would pass everything above.
  const half = run(img, [{ op: 'hueRotate', degrees: 180 }])
  check('the rotation amount matters', delta(moved.image, half.image).changedFraction > 0.5,
    `47 vs 180 differ on ${(delta(moved.image, half.image).changedFraction * 100).toFixed(0)}% of pixels`)
}

// ── 2. every pointwise operator does something, in the right direction ──────
console.log('\n=== 2. pointwise operators ===')
{
  const cases = [
    ['lightness +0.15 raises mean luminance', { op: 'lightness', amount: 0.15 }, (d) => d.lumaMeanShift > 8],
    ['lightness -0.15 lowers mean luminance', { op: 'lightness', amount: -0.15 }, (d) => d.lumaMeanShift < -8],
    ['contrast +0.5 widens the luminance spread', { op: 'contrast', amount: 0.5 }, (d) => d.lumaSdShift > 3],
    ['contrast -0.5 narrows it', { op: 'contrast', amount: -0.5 }, (d) => d.lumaSdShift < -3],
    ['exposure +0.5 brightens', { op: 'exposure', amount: 0.5 }, (d) => d.lumaMeanShift > 10],
    ['exposure -1 darkens by half', { op: 'exposure', amount: -1 }, (d) => d.lumaMeanShift < -10],
    ['invert reverses the ramp', { op: 'invert' }, (d) => d.changedFraction > 0.9],
    ['threshold binarises', { op: 'threshold', at: 0.5 }, (d) => d.lumaSdShift > 10],
    ['posterize quantises without moving the mean much', { op: 'posterize', levels: 4 },
      (d) => d.changedFraction > 0.5 && Math.abs(d.lumaMeanShift) < 8],
    ['chroma +0.5 intensifies', { op: 'chroma', amount: 0.5 }, (d) => d.changedFraction > 0.5],
    ['gradientMap replaces tone with a ramp', { op: 'gradientMap', stops: ['#2E3324', '#EFEFE2'] },
      (d) => d.lumaMeanShift > 5],
    ['duotone maps to two inks', { op: 'duotone', shadows: '#2E3324', midtones: '#6E7742', highlights: '#EFEFE2' },
      (d) => d.lumaMeanShift > 5],
    ['curve lifts the midtones', { op: 'curve', points: [[0, 0], [0.5, 0.68], [1, 1]] },
      (d) => d.lumaMeanShift > 15],
  ]
  for (const [label, op, predicate] of cases) {
    const before = measure(img)
    const out = run(img, [op])
    const d = delta(img, out.image)
    check(label, predicate(d) && d.changedFraction > 0.2,
      `changed ${(d.changedFraction * 100).toFixed(0)}%, luma ${d.lumaMeanShift}, sd ${d.lumaSdShift}`)
    void before
  }
}

// ── 3. precision is enforced, not encouraged ────────────────────────────────
console.log('\n=== 3. semantic parameters are refused with a usable message ===')
{
  const bad = [
    [{ op: 'lightness', amount: 'warmer' }, /finite number/],
    [{ op: 'hueRotate' }, /finite number/],
    [{ op: 'hueRotate', degrees: 'slightly' }, /finite number/],
    [{ op: 'contrast', amount: 0.2, pivot: 2 }, /between 0 and 1/],
    [{ op: 'posterize', levels: 1 }, /integer "levels"/],
    [{ op: 'posterize', levels: 3.5 }, /integer "levels"/],
    [{ op: 'curve', points: [[0, 0]] }, /at least two/],
    [{ op: 'curve', points: [[0, 0], ['half', 1]] }, /number pairs/],
    [{ op: 'gradientMap', stops: ['#000000'] }, /at least two stops/],
    [{ op: 'duotone', shadows: '#000', midtones: '#888' }, /finite number|undefined/],
    [{ op: 'sample' }, /needs a "kernel"/],
    [{ op: 'nonsense' }, /unknown operator/],
    [{ op: 'sample', kernel: { shape: 'nonsense', radius: 3 } }, /unknown kernel shape/],
  ]
  for (const [op, pattern] of bad) {
    let msg = null
    try { run(img, [op]) } catch (e) { msg = e.message }
    check(`refuses ${JSON.stringify(op).slice(0, 46)}`, msg !== null && pattern.test(msg),
      msg === null ? 'it was accepted' : msg.slice(0, 72))
  }
  // The error for a qualitative value must say how to make it quantitative — that is
  // what makes the palette usable by someone who does not know the vocabulary yet.
  let hint = ''
  try { run(img, [{ op: 'chroma', amount: 'vivid' }]) } catch (e) { hint = e.message }
  check('the refusal tells the caller what a valid value looks like',
    /hueRotate|chroma amount/.test(hint), hint.slice(0, 80))
}

// ── 4. the graph runner reports what each step did ─────────────────────────
console.log('\n=== 4. the runner reports every step ===')
{
  const graph = [
    { op: 'sample', kernel: { shape: 'gaussian', radius: 3 } },
    { op: 'contrast', amount: 0.3 },
    { op: 'duotone', shadows: '#2E3324', midtones: '#6E7742', highlights: '#EFEFE2' },
  ]
  const out = run(img, graph)
  check('every step is recorded', out.steps.length === 3, `${out.steps.length} steps`)
  check('each step reports its own change', out.steps.every((s) => typeof s.changedFraction === 'number'),
    out.steps.map((s) => `${s.op}:${(s.changedFraction * 100).toFixed(0)}%`).join(' '))
  check('no step is flagged as doing nothing', out.steps.every((s) => !s.suspicious),
    out.steps.filter((s) => s.suspicious).map((s) => s.problem).join('; ') || 'none')
  check('step order is preserved', out.steps.every((s, i) => s.index === i))

  // THE detector: a step that changes nothing must be flagged. This is the automated
  // form of the defect class that has cost the most time in this project — an operator
  // that runs, reports success, and has no effect.
  const dead = run(img, [{ op: 'lightness', amount: 0 }])
  check('a no-op step is flagged', dead.steps[0].suspicious === true, dead.steps[0].problem ?? 'not flagged')
  check('and it names what it observed', /changed 0/.test(dead.steps[0].problem ?? ''),
    dead.steps[0].problem ?? 'no problem text')

  // A declared no-op is not a surprise, so it must not be flagged — otherwise the
  // detector cries wolf on graphs that legitimately contain a disabled step.
  const declared = run(img, [{ op: 'lightness', amount: 0, expectNoChange: true }])
  check('a declared no-op is not flagged', declared.steps[0].suspicious === false,
    declared.steps[0].problem ?? 'clean')

  // A threshold at 0 passes everything through, so L becomes 1 for every pixel — which
  // IS a change. A threshold at 1 does the same in the other direction. Something that
  // genuinely does nothing is a zero-amount operator, tested above.
  const empty = run(img, [])
  check('an empty graph returns the input unchanged', delta(img, empty.image).changedFraction === 0,
    `${empty.steps.length} steps`)
}

// ── 5. presets are graphs with evidence, in both directions ────────────────
console.log('\n=== 5. presets expand, and prove they still hold ===')
{
  const graph = [
    { op: 'sample', kernel: { shape: 'gaussian', radius: 2 } },
    { op: 'contrast', amount: 0.25 },
    { op: 'duotone', shadows: '#2E3324', midtones: '#6E7742', highlights: '#EFEFE2', strength: 0.9 },
  ]
  const cap = capturePreset('olive-press', graph, img, { description: 'olive duotone with a soft plate', tags: ['press'] })
  check('capturing validates by running', cap.steps.length === 3 && cap.suspicious.length === 0,
    `${cap.steps.length} steps, ${cap.suspicious.length} suspicious`)

  const back = expandPreset('olive-press')
  check('a preset expands back to its graph',
    JSON.stringify(back) === JSON.stringify(graph), `${back.length} operators`)
  // The expanded graph must be a COPY: mutating it must not corrupt the stored preset,
  // or a caller inspecting a preset could silently change it.
  back[0].kernel.radius = 99
  check('the expansion is a copy, not a handle', expandPreset('olive-press')[0].kernel.radius === 2,
    `radius is ${expandPreset('olive-press')[0].kernel.radius}`)

  const v = verifyPreset('olive-press', img)
  check('a preset verifies against its own evidence', v.same === true,
    `worstRatio ${v.worstRatio}, diffs ${JSON.stringify(v.diffs)}`)

  // And verification must FAIL when the picture changes. Without this the check proves
  // nothing — it would pass a preset whose graph had been swapped underneath it.
  const altered = run(img, [{ op: 'invert' }]).image
  const vBad = verifyPreset('olive-press', altered)
  check('verification fails on a different image', vBad.same === false,
    `worstRatio ${vBad.worstRatio}`)

  const roster = listPresets()
  check('the roster names the preset and its operators',
    roster.length === 1 && roster[0].name === 'olive-press' && roster[0].operators.length === 3,
    JSON.stringify(roster[0].operators))
  check('the roster carries the evidence', typeof roster[0].evidence.lumaMean === 'number',
    `lumaMean ${roster[0].evidence.lumaMean}`)

  // A broken preset must not be storable: one that only fails when someone uses it is
  // worse than no preset at all.
  let refused = null
  try { capturePreset('broken', [{ op: 'posterize', levels: 0 }], img) } catch (e) { refused = e.message }
  check('a preset with an invalid graph is refused at capture', refused !== null, refused?.slice(0, 60) ?? 'accepted')
  let emptyRefused = null
  try { capturePreset('empty', [], img) } catch (e) { emptyRefused = e.message }
  check('an empty preset is refused', emptyRefused !== null, emptyRefused?.slice(0, 50) ?? 'accepted')
  let missing = null
  try { expandPreset('does-not-exist') } catch (e) { missing = e.message }
  check('expanding an unknown preset says so', missing !== null, missing?.slice(0, 60) ?? 'no error')
}

// ── 6. cost is declared before running ─────────────────────────────────────
console.log('\n=== 6. describeGraph states the cost class up front ===')
{
  const cheap = describeGraph([
    { op: 'sample', kernel: { shape: 'gaussian', radius: 8 } },
    { op: 'contrast', amount: 0.2 },
  ])
  check('a constant-time graph reports no slow path', cheap.mayBeSlow === false && cheap.maxNeighbourhood === 8,
    JSON.stringify(cheap))

  const slow = describeGraph([{ op: 'sample', kernel: { shape: 'custom', weights: [0, 1, 0, 1, 1, 1, 0, 1, 0] } }])
  check('a custom kernel is flagged as possibly slow', slow.mayBeSlow === true, JSON.stringify(slow))

  // A surface blur is a COMPOSITION now, not a gated sample. The `gate` parameter was
  // removed — a gated sample is three operations in one, and a callback cannot be
  // serialised into a preset — so what is asserted here is that the composition reports
  // its parts, which is what lets a description be checked against the chain.
  const composed = describeGraph([
    { op: 'sample', kernel: { shape: 'box', radius: 3 } },
    { op: 'similarityMask', maxDelta: 20 },
    { op: 'blend', base: 'input', over: 'current', amount: 1 },
  ])
  check('a composed surface blur reports its kinds',
    composed.kinds.includes('spatial') && composed.kinds.includes('mask') && composed.kinds.includes('blend'),
    JSON.stringify(composed))

  const ranked = describeGraph([{ op: 'rank', radius: 3 }])
  check('a rank filter is flagged as possibly slow', ranked.mayBeSlow === true, JSON.stringify(ranked))
}

// ── 7. transparency is never invented or lost ──────────────────────────────
console.log('\n=== 7. pointwise operators leave transparency alone ===')
{
  // A luminance transform has no business changing alpha, and a transparent pixel has no
  // colour to transform — converting transparent black through OKLab and back can shift
  // it, which would show up as a fringe along every cutout edge.
  const cut = (() => {
    const w = 32, h = 32
    const d = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const inside = x > 10 && x < 22 && y > 10 && y < 22
        d[i] = 200; d[i + 1] = 60; d[i + 2] = 60
        d[i + 3] = inside ? 255 : 0
      }
    }
    return { width: w, height: h, data: d }
  })()
  for (const op of [
    { op: 'lightness', amount: 0.2 },
    { op: 'invert' },
    { op: 'duotone', shadows: '#2E3324', midtones: '#6E7742', highlights: '#EFEFE2' },
    { op: 'threshold', at: 0.5 },
  ]) {
    const out = run(cut, [op]).image
    let alphaWrong = 0
    for (let i = 3; i < out.data.length; i += 4) {
      if (out.data[i] !== cut.data[i]) alphaWrong++
    }
    check(`${op.op} leaves alpha untouched`, alphaWrong === 0, `${alphaWrong} pixels changed alpha`)
  }
}

console.log(`\n=== ${checks - failed}/${checks} checks passed ===`)
process.exit(failed === 0 ? 0 : 1)
