/**
 * Draw ginkgo leaves 鈥?real ones, as geometry, not as a repeated clip.
 *
 * WHY THIS EXISTS
 * ---------------
 * The plant was being grown by stamping one library file at N rotations. The review
 * was right that this is not foliage: a repeated clip has no direction, no attachment
 * and no anatomy, and no amount of rotating fixes it 鈥?a ginkgo leaf is a specific
 * shape and it has to be drawn as that shape.
 *
 * WHAT A GINKGO LEAF ACTUALLY IS, in the terms this file encodes:
 *
 *   * a FAN, not an oval: the blade's width grows faster than its length, so the
 *     outline flares outward from a narrow base
 *   * a CENTRAL NOTCH. The defining feature, and the one every generic leaf shape
 *     misses: the apex is cleft, and the cleft is usually off-centre because the two
 *     lobes are not equal
 *   * RADIATING VEINS from the base to the rim, forking in a Y as they go. Ginkgo
 *     venation is dichotomous 鈥?that is the second half of why the leaf is
 *     recognisable at a glance
 *   * a PETIOLE, long and thin, joining the blade to the stem
 *   * a slightly WAVY rim, because a real margin is not a spline
 *
 * The leaf is emitted twice per variant: once as a filled silhouette and once as
 * veins only. The renderer composites them separately, so the veins can carry a
 * different ink, opacity or treatment from the blade 鈥?which is how one drawing
 * yields a leaf, a vein study, and a rim-only outline without three assets.
 *
 * Output: `<outDir>/leaf-<v>.png` (blade + veins) and `leaf-<v>-veins.png`.
 *
 * Usage:
 *   node tools/make-leaf.mjs --out assets/leaves [--size 1600] [--count 6] [--seed 1]
 */

import { createCanvas } from '@napi-rs/canvas'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseColor } from '../src/color.mjs'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const outDir = resolve(process.cwd(), opt('out', 'assets/leaves'))
const SIZE = Number(opt('size', 1600))
const COUNT = Number(opt('count', 6))
const SEED = Number(opt('seed', 1))
mkdirSync(outDir, { recursive: true })

/** Deterministic 0..1, so a leaf is reproducible and a change means a change. */
function rng(seed) {
  let a = (seed >>> 0) || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One leaf, as a set of paths in a unit box.
 *
 * THE GEOMETRY IS POLAR AROUND THE BASE, and the first version got that wrong in a
 * way worth recording: it parameterised the rim by "fraction of the spread", so the
 * cleft's position depended on that fraction and the notch ended up on the side of
 * the blade instead of at the top centre 鈥?the 1:1 sheet showed a blob with a bite
 * out of its right edge. The rim is now addressed by ANGLE FROM VERTICAL, which is
 * the frame the shape is actually described in:
 *
 *   a = 0            the leaf's axis, pointing up
 *   a = 卤halfSpread  the two basal shoulders

 * so the cleft is simply "near a = 0", and the lobes are "either side of it".
 */
function leafGeometry(r) {
  // THREE NUMBERS SET THE SILHOUETTE, and all three were wrong on the previous pass:
  //
  //   half   the fan's opening. At 58-70 degrees the blade came out nearly as tall as
  //          it was wide; a ginkgo is WIDER than tall, so the opening narrows to
  //          52-60 while the radius below grows.
  //   cleft  how far the notch bites. At 0.20-0.36 the blade split into two detached
  //          lobes and the sheet read as a pair of kidney shapes. A real cleft is a
  //          shallow V, so this drops to 0.10-0.20, and `cleftHalf` narrows with it
  //          because a deep notch also has to be a thin one.
  const half = (52 + r() * 8) * (Math.PI / 180)
  const cleftHalf = (4.5 + r() * 3) * (Math.PI / 180)
  const cleftCut = 0.1 + r() * 0.1
  const bias = (r() - 0.5) * 0.1
  const notchDroop = (r() - 0.5) * 0.08

  /**
   * Rim radius at a given angle from vertical.
   *
   * The FLARE is the whole difference between a ginkgo and a lily pad: the radius
   * rises quickly just off the axis and then flattens, so the blade widens faster
   * than it lengthens. `pow` under 1 on the sine does that; an earlier exponent of
   * 0.62 produced a blade that was round rather than flared.
   */
  const rimAt = (a) => {
    const t = Math.min(1, Math.abs(a) / half)
    let rad = 1.18 * Math.pow(Math.sin((0.05 + 0.95 * t) * Math.PI * 0.5), 0.5)
    // The cleft: a square-shouldered notch, so its walls are visible rather than
    // reading as a soft dip.
    const dc = Math.abs(a - notchDroop)
    if (dc < cleftHalf) {
      const k = 1 - dc / cleftHalf
      rad *= 1 - cleftCut * k * k
    }
    // Which lobe is fuller.
    rad *= a < 0 ? 1 + bias : 1 - bias
    // A margin is not a spline.
    rad *= 1 + 0.014 * Math.sin(a * 24 + bias * 40)
    // The outer corners round off rather than stopping dead.
    if (t > 0.93) rad *= 1 - (t - 0.93) / 0.07 * 0.22
    return rad
  }

  const RAYS = 44
  const blade = []
  for (let i = 0; i <= RAYS; i++) {
    const a = -half + (2 * half * i) / RAYS
    const rad = rimAt(a)
    blade.push([Math.sin(a) * rad, Math.cos(a) * rad])
  }

  // VEINS: dichotomous, radiating from the base, forking in a Y. Each stops just
  // inside the rim 鈥?the first version let them run past the blade, which is what
  // made the vein plate look like a dandelion clock rather than a leaf.
  const veins = []
  const VEIN_COUNT = 11
  for (let v = 0; v < VEIN_COUNT; v++) {
    const a = -half * 0.86 + (2 * half * 0.86 * v) / (VEIN_COUNT - 1)
    const rad = rimAt(a) * 0.94
    const pts = [[0, 0]]
    const steps = 6
    for (let s = 1; s <= steps; s++) {
      const f = s / steps
      const aa = a * (0.42 + 0.58 * f) + (r() - 0.5) * 0.012
      pts.push([Math.sin(aa) * rad * f, Math.cos(aa) * rad * f])
    }
    veins.push(pts)
    // One Y per vein, near the outer third, opening away from the axis.
    if (v % 2 === (v > VEIN_COUNT / 2 ? 1 : 0)) {
      const ab = a + (a >= 0 ? 1 : -1) * (0.1 + r() * 0.08)
      const rb = rimAt(ab) * 0.9
      veins.push([
        [Math.sin(a) * rad * 0.6, Math.cos(a) * rad * 0.6],
        [Math.sin(ab) * rb * 0.8, Math.cos(ab) * rb * 0.8],
        [Math.sin(ab) * rb, Math.cos(ab) * rb],
      ])
    }
  }

  return { blade, veins, petiole: 0.3 + r() * 0.2, spread: half * 2 }
}

/**
 * Draw one variant at `size`, as a blade plate and a vein plate.
 *
 * A single path per plate keeps the PNG small and the silhouette crisp at 1:1; the
 * veins are stroked with round caps because a dichotomous vein has no square ends.
 */
function drawLeaf(variant, seed) {
  const r = rng(seed)
  const g = leafGeometry(r)
  const S = SIZE
  const cx = S / 2
  // THE BOX IS FITTED TO THE DRAWING, not guessed. At `bladeScale` 0.72 with a rim
  // radius of 1.18 the apex computed to a NEGATIVE y — the leaves were being cut off
  // flat across the top, which is what the contact sheet showed. The scale is now
  // solved from the geometry's own extent, so the blade always fits with a margin and
  // the petiole always reaches the bottom edge.
  const bladeBaseY = S * 0.80
  const maxY = Math.max(...g.blade.map(([, y]) => y))
  const maxX = Math.max(...g.blade.map(([, x]) => Math.abs(x)))
  const bladeScale = Math.min((bladeBaseY - S * 0.05) / maxY, (S * 0.46) / Math.max(0.001, maxX))
  const toPx = ([x, y]) => [cx + x * bladeScale, bladeBaseY - y * bladeScale]

  const bladeCv = createCanvas(S, S)
  const bc = bladeCv.getContext('2d')
  const ink = parseColor('#9CA25C')
  const col = `rgb(${ink.r},${ink.g},${ink.b})`
  // The petiole always reaches the box's bottom edge, so a caller that attaches the
  // FILE at its base gets a stalk of a known length. At the earlier fixed 0.30-0.50
  // share it rendered as a detached speck floating under the blade, because the box
  // was fitted to the blade rather than the blade plus its stalk.
  const petioleEndY = S * 0.985

  bc.beginPath()
  const pts = g.blade.map(toPx)
  bc.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) bc.lineTo(pts[i][0], pts[i][1])
  bc.closePath()
  bc.fillStyle = col
  bc.fill()
  // The petiole, drawn with the blade so the silhouette includes the joint.
  bc.beginPath()
  bc.moveTo(cx, bladeBaseY - S * 0.01)
  bc.lineTo(cx + S * 0.012, petioleEndY)
  bc.lineWidth = Math.max(2, S * 0.011)
  bc.lineCap = 'round'
  bc.strokeStyle = col
  bc.stroke()

  const veinCv = createCanvas(S, S)
  const vc = veinCv.getContext('2d')
  vc.strokeStyle = col
  vc.lineCap = 'round'
  vc.lineJoin = 'round'
  vc.lineWidth = Math.max(1.5, S * 0.0055)
  for (const poly of g.veins) {
    const p = poly.map(toPx)
    vc.beginPath()
    vc.moveTo(p[0][0], p[0][1])
    for (let i = 1; i < p.length; i++) vc.lineTo(p[i][0], p[i][1])
    vc.stroke()
  }
  // The petiole's own midrib, so the vein plate alone still reads as a leaf.
  vc.beginPath()
  vc.moveTo(cx, bladeBaseY - S * 0.01)
  vc.lineTo(cx + S * 0.012, petioleEndY)
  vc.stroke()

  const name = `leaf-${variant}`
  writeFileSync(join(outDir, `${name}.png`), bladeCv.encodeSync('png'))
  writeFileSync(join(outDir, `${name}-veins.png`), veinCv.encodeSync('png'))
  return {
    variant: name,
    blade: g.blade.length,
    veins: g.veins.length,
    petioleShare: Math.round(g.petiole * 100) / 100,
    spreadDeg: Math.round((g.spread * 180) / Math.PI),
  }
}

const report = []
for (let v = 0; v < COUNT; v++) report.push(drawLeaf(v + 1, SEED * 1000 + v * 37))

console.log(JSON.stringify({
  ok: true,
  outDir,
  size: SIZE,
  files: report.length * 2,
  // `lift` is what the scene needs: the blade's base sits at 66% of the box, so a
  // caller places the file centre at `base + 0.16 x height` to land the joint on the
  // stem. Reporting it here keeps the number out of the scene file.
  attachAt: 0.5,
  variants: report,
}, null, 2))

