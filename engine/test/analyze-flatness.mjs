/**
 * regionFlatness() — the statistic that separates "an organised surface" from "a filled block".
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * The most expensive mistake recorded in this project's own notes was not a colour or a
 * size: a reference gave a region 42% of its canvas, so a 42%-sized BLOCK was placed there.
 * The area matched and the design was zero, because the reference's 42% was an organised
 * surface with internal hierarchy, not a colour. Every flat metric available at the time
 * (area share, element count, stroke width, contrast) reported that block as correct.
 *
 * These two numbers are what can see the difference — dominantFlatShare and distinctColours —
 * so they get a test that fails if the measurement stops discriminating. A test that only
 * asserted "the function returns numbers" would pass against a broken implementation.
 *
 * The thresholds asserted here are the measured anchors from the source study, not invented:
 * a designed surface reads dominant-flat 3.0%-20.8%; the recorded failures read 42.8% and
 * 87.6%. The rule's threshold is < 25%.
 *
 * Run: node test/analyze-flatness.mjs
 */
import { createCanvas } from '@napi-rs/canvas'
import { regionFlatness } from '../src/analyze.mjs'

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

const W = 400
const H = 400
const WHOLE = { x: 0, y: 0, w: 1, h: 1 }

/** Wrap a canvas as the analyser's image shape. */
function image(canvas) {
  const g = canvas.getContext('2d')
  return { width: canvas.width, height: canvas.height, data: g.getImageData(0, 0, canvas.width, canvas.height).data }
}

// ── 1. a filled block reads as a block ──────────────────────────────────────
console.log('=== 1. one flat fill is a block ===')
{
  const c = createCanvas(W, H)
  const g = c.getContext('2d')
  g.fillStyle = '#2B2929'
  g.fillRect(0, 0, W, H)
  const r = regionFlatness(image(c), WHOLE)
  check('dominant flat share is about 100%', r.dominantFlatShare > 0.99, String(r.dominantFlatShare))
  // Quantised to 5 bits per channel, one solid colour is exactly ONE colour.
  check('distinct colours is 1', r.distinctColours === 1, String(r.distinctColours))
  check('and the rule would reject it', r.dominantFlatShare >= 0.25, `dominantFlat ${r.dominantFlatShare} ≥ 0.25`)
}

// ── 2. the two recorded failures reproduce ──────────────────────────────────
console.log('\n=== 2. the failure cases from the notes reproduce ===')
{
  // A 87.6% dominant flat with ~191 colours: mostly one colour, a little noise on top.
  const c = createCanvas(W, H)
  const g = c.getContext('2d')
  g.fillStyle = '#E8E8E4'
  g.fillRect(0, 0, W, H)
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < 140; i++) {
    g.fillStyle = `rgb(${Math.floor(rnd() * 40) + 200},${Math.floor(rnd() * 40) + 200},${Math.floor(rnd() * 40) + 196})`
    g.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), 3, 3)
  }
  const r = regionFlatness(image(c), WHOLE)
  check('a mostly-one-colour panel reads dominant flat > 0.25', r.dominantFlatShare > 0.25, String(r.dominantFlatShare))
  check('and few distinct colours', r.distinctColours < 200, String(r.distinctColours))
}

// ── 3. an organised surface reads as organised ──────────────────────────────
console.log('\n=== 3. an organised surface passes ===')
{
  // The distinguishing property is INTERNAL DIVISION: no single colour survives as a
  // large flat run. Note the trap this fixture had to avoid — a region that is 90%
  // ground with a few marks on it is legitimately 90% ground, and reporting that as a
  // high dominant-flat share is CORRECT behaviour, not a defect. §4's threshold applies
  // to a surface that is supposed to be carrying internal structure, so the fixture has
  // to actually carry it: dense tonal variation plus ruling, the way a working panel does.
  const c = createCanvas(W, H)
  const g = c.getContext('2d')
  g.fillStyle = '#F1F1EC'
  g.fillRect(0, 0, W, H)
  let seed = 999
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  // Tonal field: every 8x8 tile gets its own near-ground value.
  for (let y = 0; y < H; y += 8) {
    for (let x = 0; x < W; x += 8) {
      const v = 225 + Math.floor(rnd() * 24)
      g.fillStyle = `rgb(${v},${v},${v - 3})`
      g.fillRect(x, y, 8, 8)
    }
  }
  // Internal division: ruling, ticks, marks, labels — the things §4.6 lists as hierarchy.
  g.strokeStyle = '#8A8F7C'
  g.lineWidth = 1
  for (let y = 6; y < H; y += 13) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke()
  }
  for (let i = 0; i < 1400; i++) {
    const v = Math.floor(rnd() * 150) + 40
    g.fillStyle = `rgba(${v},${Math.floor(v * 0.95)},${Math.floor(v * 0.75)},0.85)`
    g.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), 2 + Math.floor(rnd() * 4), 2)
  }
  const r = regionFlatness(image(c), WHOLE)
  check('dominant flat share is under the 25% threshold', r.dominantFlatShare < 0.25, String(r.dominantFlatShare))
  // Deliberately NOT asserting a colour-count threshold here. The source notes are explicit
  // that a high distinct-colour count mostly reflects the MEDIUM (3D rendering, photography
  // behind translucent panels, antialiased text at many sizes) rather than design skill, and
  // that chasing the number is how you end up forging a medium you are not in. This synthetic
  // fixture has a small palette by construction, so it legitimately scores below a real
  // render's 234-417. The property that matters is that it is no longer ONE colour.
  check('and it is no longer a single colour', r.distinctColours > 40, `${r.distinctColours} colours`)
}

// ── 3b. the honest limit: a sparse mark on a large ground IS mostly ground ──
console.log('\n=== 3b. a mark on a ground is not "organised" by this measure ===')
{
  const c = createCanvas(W, H)
  const g = c.getContext('2d')
  g.fillStyle = '#F1F1EC'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#2B2929'
  g.fillRect(40, 40, 60, 60)
  const r = regionFlatness(image(c), WHOLE)
  check('a small mark leaves the ground dominant', r.dominantFlatShare > 0.8, String(r.dominantFlatShare))
  check('so the metric is genuinely measuring dominance, not "is there anything here"',
    r.distinctColours > 1, `${r.distinctColours} colours`)
}

// ── 4. the statistic is genuinely per-region, not a whole-frame constant ─────
console.log('\n=== 4. it measures the REGION it is given ===')
{
  // Left half one solid colour, right half carrying its own internal structure. The whole
  // frame is "half flat"; each half must report its own character. Without this a per-region
  // report could be a whole-frame number copied around — the same class of mistake as
  // re-deriving a convention instead of reading it.
  const c = createCanvas(W, H)
  const g = c.getContext('2d')
  g.fillStyle = '#20242A'
  g.fillRect(0, 0, W / 2, H)
  // Right half: tonal tiles so that no one value survives as a large flat run.
  let seed = 77
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let y = 0; y < H; y += 8) {
    for (let x = W / 2; x < W; x += 8) {
      const v = 200 + Math.floor(rnd() * 50)
      g.fillStyle = `rgb(${v},${v},${v - 4})`
      g.fillRect(x, y, 8, 8)
    }
  }
  g.strokeStyle = '#6F7468'
  for (let y = 5; y < H; y += 11) {
    g.beginPath(); g.moveTo(W / 2, y); g.lineTo(W, y); g.stroke()
  }
  const left = regionFlatness(image(c), { x: 0, y: 0, w: 0.5, h: 1 })
  const right = regionFlatness(image(c), { x: 0.5, y: 0, w: 0.5, h: 1 })
  check('the solid half reads as a block', left.dominantFlatShare > 0.99, `left ${left.dominantFlatShare}`)
  check('the organised half does not', right.dominantFlatShare < 0.25, `right ${right.dominantFlatShare}`)
  check('the two halves disagree, so it is not a frame constant',
    Math.abs(left.dominantFlatShare - right.dominantFlatShare) > 0.5,
    `${left.dominantFlatShare} vs ${right.dominantFlatShare}`)
  check('the organised half distinguishes more colours',
    right.distinctColours > left.distinctColours * 5,
    `${right.distinctColours} vs ${left.distinctColours}`)
}

// ── 5. transparent pixels are not a surface ─────────────────────────────────
console.log('\n=== 5. transparency is excluded ===')
{
  const c = createCanvas(W, H)
  const g = c.getContext('2d')
  // Nothing drawn at all: fully transparent.
  const empty = regionFlatness(image(c), WHOLE)
  check('an empty region reports zero opaque pixels', empty.opaquePixels === 0, String(empty.opaquePixels))
  check('and does not divide by zero', Number.isFinite(empty.dominantFlatShare), String(empty.dominantFlatShare))
}

console.log(`\n=== ${checks - failed}/${checks} checks passed ===`)
process.exit(failed === 0 ? 0 : 1)
