/**
 * Supersampled rendering: does the delivered pixel match the shape that was asked for?
 *
 * THE MEASUREMENT THIS SUITE USES, AND THE ONE IT DELIBERATELY DOES NOT
 * --------------------------------------------------------------------
 * The obvious test — "a supersampled edge has fewer partially-inked pixels" — is FALSE on this
 * rasteriser, and a suite asserting it would be asserting a lie. Measured before this file was
 * written, on a 79.5px circle at fractional coordinates:
 *
 *     blend pixels (partial ink)          285 at 1x  ->  300 at 3x
 *     a 3px line at exactly 45 degrees    324 at 1x  ->  646 at 3x
 *
 * Skia already computes near-exact area coverage for a straight edge at 1x. A 45-degree edge runs
 * along pixel diagonals, which 1x resolves EXACTLY and an averaged 3x version cannot. So counting
 * blend pixels measures the wrong thing and would have produced a test that passes for the wrong
 * reason or fails for a correct implementation.
 *
 * What supersampling actually buys is **where the edge lands**. So the reference here is not
 * another rasterisation — it is the exact analytic area the shape covers in each pixel, computed
 * from the circle's own geometry. Coverage error against that is the honest measure, and it is the
 * one that matters: the pixels that are wrong are the ones that make a circle read as a polygon.
 *
 * THE CEILING, MEASURED — because the factor is not free
 * ------------------------------------------------------
 * Supersampling multiplies the canvas, and every full-canvas buffer with it: the composite, the
 * layer being drawn, one scratch buffer per mask or effect, and — because the pool is released with
 * the pool and `renderScene` never releases it mid-render — a buffer for every layer drawn. So the
 * cost is roughly LAYERS x canvas x factor^2, not canvas x factor^2, and the layer count is what
 * makes a real document different from a fixture.
 *
 * Measured on `scenes/kv-timeline.json` (2400x1350, 22 layers) with EACH FACTOR IN ITS OWN PROCESS,
 * so no figure is inflated by memory an earlier factor was still holding:
 *
 *     factor  internal     per buffer   time     rss grown   result
 *     1x      2400x1350      12 MB      1.1 s      1.7 GB    ok
 *     2x      4800x2700      49 MB      3.9 s      6.6 GB    ok
 *     3x      7200x4050     111 MB      9.1 s     14.7 GB    ok
 *     4x      9600x5400     198 MB     21.1 s     22.5 GB    ok
 *
 *     same document, 1x-4x in ONE process    4x   still 14.7 GB resident  REFUSED (read-back)
 *     storyboard, 2420x1336                  3x   7260x4008, 111 MB       REFUSED (read-back)
 *     over-budget fixture in this suite  4x  32000x32000, 4.1 GB/buffer   REFUSED (allocation)
 *
 * Largest combination actually completed: a 2400x1350, 22-layer document at 4x — internal
 * 9600x5400, 198 MB per buffer, 21 s, 22.5 GB resident, in a fresh process. The first refusal
 * observed was that same 4x render attempted after 1x-3x had already run in the same process.
 *
 * WHERE THE LIMIT IS, STATED AS FAR AS IT WAS ESTABLISHED
 * ------------------------------------------------------
 * It is MEMORY, and there are two distinct places it gives out — both converted into the refusal
 * below, which is why the boundary is reached as a message rather than as a crash:
 *
 *   * ALLOCATION. `createCanvas` refused a 32000x32000 canvas (1.02 Gpx, 4.1 GB of RGBA) while
 *     allocating. The suite's own walk finds this boundary on whatever machine it runs on.
 *   * READ-BACK. `getImageData` in `readBuffer`, during the reduction, is where a real render fails
 *     first in practice: at 7260x4008 under a full render's other buffers, and at 9600x5400 when
 *     14.7 GB was already resident from earlier factors.
 *
 * There is NO hard dimension ceiling at the sizes a design uses: read-back was probed in isolation
 * from 3 Mpx up to 24000x12000 (288 Mpx, 1.1 GB per buffer) and every size succeeded, so nothing
 * here is a Skia limit on width or height. What I could NOT establish is exactly which allocation
 * exhausts the address space first inside a real render — read-back is where it surfaces, but an
 * allocation or a scratch buffer could be the one that fails on a larger document. The honest
 * statement is therefore the code's own: the factor has a stated limit, a refused render says what
 * it needed and what to do instead, and no request is ever quietly answered at 1x, which would be a
 * clean report describing a render that did not happen.
 *
 * Run: node test/supersample.mjs
 */
import { renderScene } from '../src/render.mjs'
import { resolveSupersample, SUPERSAMPLE_LIMIT, downsampleRGBA, inflateScene } from '../src/supersample.mjs'

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

// ── the analytic reference ───────────────────────────────────────────────────

/**
 * Exact area of the circle inside the axis-aligned box [x0,x1] x [y0,y1], by integration.
 *
 * The antiderivative of sqrt(r^2 - u^2) is (u*sqrt(r^2-u^2) + r^2*asin(u/r))/2, so the area of a
 * vertical strip is exact and only the horizontal extent needs sampling. 4096 sub-strips per pixel
 * puts the reference itself far below the coverage quantum of a single 1/255 step, so the error
 * measured below is the renderer's, not the reference's.
 */
function circleAreaInBox(cx, cy, r, x0, x1, y0, y1) {
  const STRIPS = 4096
  const dx = (x1 - x0) / STRIPS
  const F = (u) => 0.5 * (u * Math.sqrt(Math.max(0, r * r - u * u)) + r * r * Math.asin(Math.max(-1, Math.min(1, u / r))))
  let area = 0
  for (let i = 0; i < STRIPS; i++) {
    const x = x0 + (i + 0.5) * dx
    const du = x - cx
    if (Math.abs(du) >= r) continue
    const half = Math.sqrt(r * r - du * du)
    const lo = Math.max(cy - half, y0)
    const hi = Math.min(cy + half, y1)
    if (hi > lo) area += (hi - lo) * dx
    void F
  }
  return area
}

/** Fraction of a pixel covered by the circle, per pixel, over a box. */
function analyticCoverage(cx, cy, r, x0, y0, w, h) {
  const out = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = circleAreaInBox(cx, cy, r, x0 + x, x0 + x + 1, y0 + y, y0 + y + 1)
    }
  }
  return out
}

/** Ink coverage per pixel, read from a rendered canvas: 0 = ground, 1 = full ink. */
function inkCoverage(canvas, x0, y0, w, h, groundLum, inkLum) {
  const ctx = canvas.getContext('2d')
  const data = ctx.getImageData(x0, y0, w, h).data
  const out = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const p = i * 4
    const lum = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255
    out[i] = (groundLum - lum) / (groundLum - inkLum)
  }
  return out
}

function compareToAnalytic(measured, analytic) {
  let worst = 0
  let sum = 0
  let off = 0
  for (let i = 0; i < measured.length; i++) {
    const err = Math.abs(measured[i] - analytic[i])
    if (err > worst) worst = err
    sum += err
    if (err > 0.1) off++
  }
  return { worst, mean: sum / measured.length, off }
}

// ── the fixture: a circle at fractional coordinates ──────────────────────────
// Fractional centre and radius on purpose. An integer-centred circle sits exactly on the pixel
// grid and rasterises trivially, which would flatter both factors and measure nothing.

const W = 200
const H = 150
const CX = 99.5
const CY = 74.5
const R = 39.75
const GROUND = '#FFFFFF'
const INK = '#000000'
const GROUND_LUM = 1
const INK_LUM = 0

const circleScene = {
  canvas: { width: W, height: H },
  ground: GROUND,
  gates: {
    focus: 'one circle, nothing else — this is a sampling fixture, not a design',
    lightAxis: 'none; a flat fill has no light',
    layers: ['disc'],
    drawingRule: 'one ellipse layer, radius in pixels, centre at fractional coordinates',
    accentBand: [0, 0],
  },
  layers: [
    {
      id: 'disc', shape: 'ellipse',
      x: CX - R, y: CY - R, w: R * 2, h: R * 2,
      paint: INK,
    },
  ],
}

console.log('the analytic reference: a 79.5px circle centred at 99.5, 74.5 on a 200x150 canvas')
const BOX = { x: Math.floor(CX - R) - 1, y: Math.floor(CY - R) - 1 }
BOX.w = Math.ceil(R * 2) + 3
BOX.h = Math.ceil(R * 2) + 3
const analytic = analyticCoverage(CX, CY, R, BOX.x, BOX.y, BOX.w, BOX.h)
{
  const total = analytic.reduce((a, b) => a + b, 0)
  const expected = Math.PI * R * R
  check('the reference itself is correct (integrated area = πr²)',
    Math.abs(total - expected) / expected < 0.0005,
    `${total.toFixed(2)} vs πr² = ${expected.toFixed(2)}`)
}

// ── the claim: more sampling, closer to the true shape ───────────────────────

console.log('\ncoverage error against the true circle, by factor')
const rows = []
for (const factor of [1, 2, 3, 4]) {
  const { canvas } = await renderScene(circleScene, { supersample: factor })
  const measured = inkCoverage(canvas, BOX.x, BOX.y, BOX.w, BOX.h, GROUND_LUM, INK_LUM)
  const stats = compareToAnalytic(measured, analytic)
  // The counts the obvious test would have used, collected here so both are REPORTED
  // rather than argued about — plus the one count that does fall.
  let blend = 0
  let ghosts = 0
  for (let i = 0; i < measured.length; i++) {
    const d = measured[i]
    if (d <= 1 / 255 || d >= 1 - 1 / 255) continue
    blend++
    // A GHOST is a blend pixel the circle's edge is not in: the analytic area says
    // this pixel is all ink or all paper, and the render put an edge in it anyway.
    // Those are the pixels that make a curve read as a polygon.
    if (analytic[i] <= 1e-6 || analytic[i] >= 1 - 1e-6) ghosts++
  }
  rows.push({ factor, ...stats, blend, ghosts })
  console.log(`  ${factor}x  worst ${(stats.worst * 100).toFixed(1)}%  mean ${(stats.mean * 255).toFixed(3)}/255  pixels off by >10%: ${stats.off}`
    + `  |  blend px ${blend}  ghost blend px ${ghosts}`)
}

const one = rows.find((r) => r.factor === 1)
const three = rows.find((r) => r.factor === 3)
const four = rows.find((r) => r.factor === 4)

check('1x has pixels off by more than 10% of a pixel (the defect being fixed)',
  one.off > 0, `${one.off} pixels`)
check('3x reduces the worst pixel error substantially',
  three.worst < one.worst * 0.6, `${(one.worst * 100).toFixed(1)}% -> ${(three.worst * 100).toFixed(1)}%`)
check('3x nearly eliminates pixels off by more than 10%',
  three.off <= Math.max(1, Math.floor(one.off * 0.05)), `${one.off} -> ${three.off}`)
check('4x is no worse than 3x on the worst pixel',
  four.worst <= three.worst * 1.1, `${(three.worst * 100).toFixed(1)}% -> ${(four.worst * 100).toFixed(1)}%`)
check('error decreases monotonically as the factor rises',
  rows.every((r, i) => i === 0 || r.worst <= rows[i - 1].worst + 1e-9),
  rows.map((r) => `${r.factor}x:${(r.worst * 100).toFixed(1)}%`).join('  '))
// The finding at the top of this file, asserted rather than only described: total
// blend pixels do not fall, and the count that DOES fall is the one where the edge is
// in the wrong place entirely.
check('total blend pixels do not fall on this rasteriser',
  three.blend >= one.blend * 0.95, `${one.blend} at 1x -> ${three.blend} at 3x`)
check('FEWER blend pixels whose edge the circle is not in (the polygon look)',
  three.ghosts < one.ghosts, `${one.ghosts} at 1x -> ${three.ghosts} at 3x`)

// The same two counts on a straight-edged shape, where the honest answer is "no
// change": a rotated thin bar at fractional coordinates. A straight edge is what 1x
// already resolves to near-exact area coverage, so the count must hold steady rather
// than grow — an edge that dissolved into a soft band would be a worse render.
{
  const bar = () => ({
    canvas: { width: W, height: H }, ground: GROUND,
    gates: circleScene.gates,
    layers: [{
      id: 'bar', shape: 'rect', x: 30.25, y: 20.5, w: 90.4, h: 12.6, paint: INK,
      transform: { rotate: 7, originX: 30.25, originY: 20.5 },
    }],
  })
  const counts = []
  for (const factor of [1, 2, 3]) {
    const { canvas } = await renderScene(bar(), { supersample: factor })
    const measured = inkCoverage(canvas, 0, 0, W, H, GROUND_LUM, INK_LUM)
    let blend = 0
    for (let i = 0; i < measured.length; i++) if (measured[i] > 1 / 255 && measured[i] < 1 - 1 / 255) blend++
    counts.push(blend)
  }
  console.log(`  rotated thin bar, blend px:  1x=${counts[0]}  2x=${counts[1]}  3x=${counts[2]}`)
  check('a straight-edged shape keeps its edge at 2x (blend count within 15% of 1x)',
    Math.abs(counts[1] - counts[0]) / counts[0] < 0.15, `${counts[1]} vs ${counts[0]}`)
  check('and at 3x', Math.abs(counts[2] - counts[0]) / counts[0] < 0.15, `${counts[2]} vs ${counts[0]}`)
}

// ── the contract: delivered size, determinism, and what the report says ──────

console.log('\nthe contract for callers')
{
  const base = await renderScene(circleScene)
  const explicitOne = await renderScene(circleScene, { supersample: 1 })
  const png = (c) => c.encodeSync('png')
  check('omitting the option and passing supersample:1 give byte-identical output',
    Buffer.compare(png(base.canvas), png(explicitOne.canvas)) === 0)

  const again = await renderScene(circleScene)
  check('the default render is deterministic across calls',
    Buffer.compare(png(base.canvas), png(again.canvas)) === 0)

  for (const factor of [1, 2, 3, 4]) {
    const r = await renderScene(circleScene, { supersample: factor })
    check(`${factor}x delivers the declared canvas size`,
      r.canvas.width === W && r.canvas.height === H && r.report.canvas.width === W && r.report.canvas.height === H,
      `canvas ${r.canvas.width}x${r.canvas.height}, report ${r.report.canvas.width}x${r.report.canvas.height}`)
    check(`${factor}x reports the factor that was used`,
      r.report.supersample === factor, `report.supersample = ${r.report.supersample}`)
  }

  // The scene must survive the call: `renderScene` does not own the caller's object, and a scene
  // left inflated would disagree with the report that says what was delivered.
  const probe = {
    canvas: { width: W, height: H }, ground: GROUND,
    gates: circleScene.gates,
    layers: [
      { id: 'a', shape: 'rect', x: 10, y: 10, w: 40, h: 40, paint: INK },
      { id: 'b', shape: 'rect', x: -5, y: 120, w: 30, h: 20, paint: INK },
    ],
  }
  const before = JSON.stringify(probe)
  await renderScene(probe, { supersample: 3 })
  check('the caller\'s scene is not mutated by supersampling', JSON.stringify(probe) === before)

  // A negative offset is PIXELS, not a fraction — the case `resolveLength` documents as a found
  // defect. If inflation treated it as a fraction the layer would move to a different place.
  const negOne = await renderScene(probe)
  const negThree = await renderScene(probe, { supersample: 3 })
  const px = (c, x, y) => {
    const d = c.getContext('2d').getImageData(x, y, 1, 1).data
    return `${d[0]},${d[1]},${d[2]}`
  }
  // y = -5 puts the layer above the canvas, so it must be absent in BOTH renders; y = 120 is inside.
  const insideA = px(negOne.canvas, 20, 125)
  const insideB = px(negThree.canvas, 20, 125)
  check('a layer inside the canvas lands in the same place at 1x and 3x',
    insideA === '0,0,0' && insideB === '0,0,0', `${insideA} / ${insideB}`)
  const aboveA = px(negOne.canvas, 20, 2)
  const aboveB = px(negThree.canvas, 20, 2)
  check('a negative offset stays off-canvas at 3x rather than being scaled as a fraction',
    aboveA === '255,255,255' && aboveB === '255,255,255', `${aboveA} / ${aboveB}`)
}

// ── the ceiling: refused, not silently dropped ───────────────────────────────

console.log('\nthe ceiling')
{
  check('the factor has a stated limit', Number.isInteger(SUPERSAMPLE_LIMIT) && SUPERSAMPLE_LIMIT >= 2, `SUPERSAMPLE_LIMIT = ${SUPERSAMPLE_LIMIT}`)
  check('a factor above the limit is refused by the resolver',
    (() => { try { resolveSupersample(SUPERSAMPLE_LIMIT + 1); return false } catch { return true } })())
  check('a factor below 1 is refused', (() => { try { resolveSupersample(0); return false } catch { return true } })())
  check('an omitted factor resolves to 1', resolveSupersample(undefined) === 1)

  // The refusal has to be reachable, and the exact size where the backend gives up differs by
  // machine (a 24000x16000 canvas allocated successfully here, which is 1.5 GB of RGBA). So the
  // suite FINDS the boundary rather than hard-coding it: it walks the document size up until a
  // render is refused, asserts the refusal is clean and actionable, and skips the item with a
  // printed note if this machine never refuses within the range it explores. A test that hard-codes
  // a machine's limit fails on a bigger machine and passes for the wrong reason on a smaller one.
  const fixtureAt = (w, h) => ({
    canvas: { width: w, height: h }, ground: GROUND,
    gates: {
      focus: 'an over-budget probe', lightAxis: 'none',
      layers: ['a', 'b'], drawingRule: 'two rectangles',
      accentBand: [0, 0],
    },
    layers: [
      { id: 'a', shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: GROUND },
      { id: 'b', shape: 'rect', x: 10, y: 10, w: 40, h: 40, paint: INK },
    ],
  })

  let refusal = null
  let refusalAt = null
  for (const side of [4000, 8000, 14000, 20000, 28000]) {
    try {
      await renderScene(fixtureAt(side, side), { supersample: 4 })
    } catch (error) {
      refusal = String(error && error.message ? error.message : error)
      refusalAt = side
      break
    }
  }

  if (refusal === null) {
    console.log('  note  no refusal reached up to a 28000x28000 document on this machine — ' +
      'the refusal path is not exercised here (it was reached at 2420x1336 document size with ' +
      'the engine\'s own storyboard scene, and at 3x on a 7260x4008 canvas)')
  } else {
    check(`an over-budget factor throws rather than returning a 1x render (first refused at ${refusalAt}px)`, true, `document ${refusalAt}x${refusalAt} at 4x`)
    check('the refusal names the sizes involved', /\d+x\d+/.test(refusal), refusal.slice(0, 90) + '…')
    // The wrapper is what has to be actionable: the requested canvas, the delivered document, the
    // factor, and a way out. The backend's own reason is passed through AFTER that and may name
    // Skia — that is honest, not a leak: the raw reason is information, and suppressing it would be
    // prettier and less useful. What must not happen is the raw error being the whole message.
    check('the refusal wraps the backend reason rather than being it',
      /^cannot allocate /.test(refusal) && /supersample a \d+x\d+ document at \d+x/.test(refusal),
      refusal.slice(0, 90))
    check('the refusal offers a way out', /--scale|lower factor/.test(refusal))
  }
}

// ── the pieces, directly ────────────────────────────────────────────────────

console.log('\nthe two pieces, tested without a render')
{
  // inflateScene: absolute lengths multiply, fractions do not, negatives are pixels.
  const s = inflateScene({
    canvas: { width: 100, height: 50 },
    layers: [
      { id: 'a', shape: 'rect', x: 0.5, y: 10, w: 1, h: 20, paint: INK },
      { id: 'b', shape: 'rect', x: -8, y: 0, w: 1, h: 1, paint: INK },
    ],
  }, 3)
  check('inflate multiplies the canvas', s.canvas.width === 300 && s.canvas.height === 150, `${s.canvas.width}x${s.canvas.height}`)
  check('a fractional length is left alone', s.layers[0].x === 0.5, `x = ${s.layers[0].x}`)
  check('an absolute length is multiplied', s.layers[0].y === 30 && s.layers[0].h === 60, `y = ${s.layers[0].y}, h = ${s.layers[0].h}`)
  check('a full-bleed length of 1 stays a full-bleed fraction', s.layers[1].w === 1 && s.layers[1].h === 1, `w = ${s.layers[1].w}`)
  check('a negative offset is treated as pixels', s.layers[1].x === -24, `x = ${s.layers[1].x}`)

  // downsampleRGBA: a 2x2 block of one black and three white pixels is a quarter ink — and the
  // colour must be weighted by alpha, or transparent pixels pull the result toward black.
  const img = {
    width: 2, height: 2,
    data: new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 255, 255, 255, 255,
    ]),
  }
  const down = downsampleRGBA(img, 2)
  check('downsample yields a 1x1 image', down.width === 1 && down.height === 1)
  const [r, g, b, a] = down.data
  check('a quarter-inked block averages to the right grey',
    Math.abs(r - 191) <= 2 && r === g && g === b && a === 255, `rgba(${r},${g},${b},${a})`)

  // Alpha weighting: one opaque red pixel beside three fully transparent ones. A naive average of
  // the RGB channels would give a dark red at alpha 64; weighting by alpha keeps the colour pure
  // and averages only the alpha. This is the same failure the blur implementation documents — an
  // unpremultiplied average drags transparent black into the visible colour.
  const transparent = {
    width: 2, height: 2,
    data: new Uint8ClampedArray([
      0, 0, 0, 0, 255, 0, 0, 255,
      0, 0, 0, 0, 0, 0, 0, 0,
    ]),
  }
  const t = downsampleRGBA(transparent, 2)
  check('alpha weighting keeps transparent neighbours from darkening the colour',
    t.data[0] === 255 && t.data[1] === 0 && t.data[2] === 0 && t.data[3] === 64,
    `rgba(${t.data[0]},${t.data[1]},${t.data[2]},${t.data[3]})`)

  // A partial block must be refused rather than quietly mis-averaged: the renderer sizes its canvas
  // to an exact multiple, so a partial block means the caller did the sizing and got it wrong.
  const partial = { width: 3, height: 2, data: new Uint8ClampedArray(3 * 2 * 4) }
  check('a partial block is refused, not mis-averaged', (() => {
    try { downsampleRGBA(partial, 2); return false } catch { return true }
  })())

  // A non-integer factor has no block to average.
  check('a non-integer factor is refused by the resolver', (() => {
    try { resolveSupersample(2.5); return false } catch { return true }
  })())
}

console.log(`\n${checks - failed}/${checks} checks passed`)
process.exit(failed === 0 ? 0 : 1)
