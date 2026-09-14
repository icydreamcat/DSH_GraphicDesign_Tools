/**
 * Draw a ginkgo leaf as THREE SEPARABLE PARTS.
 *
 * WHY THE PARTS ARE SEPARATE — this is the whole point of the file
 * ---------------------------------------------------------------
 * The review was structural, not about parameters: a leaf baked into ONE file "has
 * only one dimension that can change". Scaled and spun about its centre, and nothing
 * else — the stalk cannot bend, the blade cannot twist independently of its stalk, and
 * nothing can meet a branch at a plausible angle. That is a limit of the ASSET, and no
 * amount of tuning the scene can get around it.
 *
 * So each variant is emitted as three plates:
 *
 *   spur-<v>.png          the short woody shoot a ginkgo carries its leaves on. THIS
 *                         is the part that meets the branch, and it is what makes a
 *                         cluster read as a spur shoot rather than as a bunch tied on
 *   blade-<v>.png         the lamina alone, drawn with its BASE AT THE BOTTOM CENTRE
 *                         of the box, so the renderer can rotate it about the point
 *                         where it actually joins its stalk
 *   blade-<v>-veins.png   the same blade's venation, alone
 *
 * The PETIOLE is not in any of them. The scene draws it, as a bezier from the spur to
 * the blade's base, which gives the stalk its own length, curvature and angle — and
 * lets it droop under the blade's weight independently of everything else.
 *
 * WHAT A GINKGO LEAF IS, in the terms the geometry below encodes:
 *   * a FAN, not an oval: the radius flares fast just off the axis, then flattens
 *   * a CENTRAL NOTCH — the defining feature, and the one generic leaf shapes miss
 *   * DICHOTOMOUS VEINS from base to rim, forking in a Y
 *   * a WAVY margin, because a real edge is not a spline
 *
 * The blade is emitted at its own natural size, so the scene never stretches it: no
 * anisotropic resampling, no stiffened outline.
 *
 * Usage:
 *   node tools/make-leaf-parts.mjs --out assets/leaves [--size 900] [--count 6] [--seed 1]
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
const SIZE = Number(opt('size', 900))
const COUNT = Number(opt('count', 6))
const SEED = Number(opt('seed', 1))
mkdirSync(outDir, { recursive: true })

/** Deterministic 0..1: a leaf is reproducible, so a change means a change. */
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
 * The blade's outline and venation, in polar terms around its own base.
 *
 * The rim is addressed by ANGLE FROM VERTICAL, which is the frame the shape is
 * described in: a=0 is the leaf's axis, a=±half are the basal shoulders. So the cleft
 * is simply "near a=0" and the lobes are "either side of it". An earlier version
 * parameterised the rim by "fraction of the spread" and the notch consequently ended
 * up on the SIDE of the blade.
 */
function bladeGeometry(r) {
  // A ginkgo is WIDER than tall: a narrow opening with a long radius.
  const half = (52 + r() * 8) * (Math.PI / 180)
  const cleftHalf = (4.5 + r() * 3) * (Math.PI / 180)
  const cleftCut = 0.1 + r() * 0.1
  const bias = (r() - 0.5) * 0.1
  const notchDroop = (r() - 0.5) * 0.08

  const rimAt = (a) => {
    const t = Math.min(1, Math.abs(a) / half)
    let rad = 1.18 * Math.pow(Math.sin((0.05 + 0.95 * t) * Math.PI * 0.5), 0.5)
    const dc = Math.abs(a - notchDroop)
    if (dc < cleftHalf) {
      const k = 1 - dc / cleftHalf
      rad *= 1 - cleftCut * k * k
    }
    rad *= a < 0 ? 1 + bias : 1 - bias
    rad *= 1 + 0.014 * Math.sin(a * 24 + bias * 40)
    if (t > 0.93) rad *= 1 - ((t - 0.93) / 0.07) * 0.22
    return rad
  }

  const RAYS = 44
  const blade = []
  for (let i = 0; i <= RAYS; i++) {
    const a = -half + (2 * half * i) / RAYS
    const rad = rimAt(a)
    blade.push([Math.sin(a) * rad, Math.cos(a) * rad])
  }

  const veins = []
  const VEIN_COUNT = 11
  for (let v = 0; v < VEIN_COUNT; v++) {
    const a = -half * 0.86 + (2 * half * 0.86 * v) / (VEIN_COUNT - 1)
    const rad = rimAt(a) * 0.94
    const pts = [[0, 0]]
    for (let s = 1; s <= 6; s++) {
      const f = s / 6
      const aa = a * (0.42 + 0.58 * f) + (r() - 0.5) * 0.012
      pts.push([Math.sin(aa) * rad * f, Math.cos(aa) * rad * f])
    }
    veins.push(pts)
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
  return { blade, veins }
}

const ink = parseColor('#9CA25C')
const COL = `rgb(${ink.r},${ink.g},${ink.b})`

/**
 * THE BLADE'S THIRD DIMENSION, BAKED AS A SET OF VIEWS.
 *
 * The review asked for the one thing a flat renderer cannot do directly: "if this tree
 * were three-dimensional, how would the blade deform in the other directions?" An image
 * layer's transform here is a single planar rotation, so a blade cannot be turned about
 * its own long axis at draw time.
 *
 * It can, however, be turned at BUILD time. A blade tilted away from the viewer is
 * FORESHORTENED — its projected width compresses by cos(tilt) — and the face that turns
 * toward the light brightens while the face turning away darkens. Both are properties of
 * the pose, not of the scene, so each variant is emitted as a SET OF VIEWS:
 *
 *   foreshortening  the silhouette is squeezed along the blade's own cross-axis by
 *                   cos(tilt), which is what a tilted plane actually projects to
 *   self-shadowing  the lamina is drawn in its own ink scaled by a face brightness, so
 *                   a blade tilted away from the key light is genuinely darker rather
 *                   than being made darker by a scene-level tint
 *
 * The leaves therefore have a real pose: a 3D tilt that selects a view, on top of the 2D
 * direction that selects a rotation. That is two independent axes of deformation, where
 * the previous version had one.
 */
const VIEWS = [0, 30, -30, 55, -55, 72, -72]

/** How bright the lamina's face is at a given tilt, from a key light above-left. */
const faceBrightness = (tilt) => {
  const t = (Math.abs(tilt) * Math.PI) / 180
  // Facing the viewer (tilt 0) is the brightest reading; turning away falls off, and a
  // blade turned AWAY (negative tilts are drawn mirrored) loses a little more, because
  // its lit face is the one we can no longer see.
  return (tilt >= 0 ? 1 : 0.9) * (0.68 + 0.32 * Math.cos(t))
}

/** Plate geometry for one blade variant in one view. */
function drawBlade(variant, seed) {
  const r = rng(seed)
  const g = bladeGeometry(r)
  const S = SIZE
  const baseY = S * 0.97
  const maxY = Math.max(...g.blade.map(([, y]) => y))
  const maxX = Math.max(...g.blade.map(([, x]) => Math.abs(x)))
  const scale = Math.min((baseY - S * 0.03) / maxY, (S * 0.49) / Math.max(1e-6, maxX))

  const written = []
  for (const tilt of VIEWS) {
    const squeeze = Math.cos((Math.abs(tilt) * Math.PI) / 180)
    const bright = faceBrightness(tilt)
    const ink = parseColor('#9CA25C')
    const shaded = `rgb(${Math.round(ink.r * bright)},${Math.round(ink.g * bright)},${Math.round(ink.b * bright)})`
    const cx = S / 2
    // The cross-axis is x, so foreshortening squeezes x and leaves y alone: exactly what
    // a plane rotating about its own vertical axis projects to.
    const toPx = ([x, y]) => [cx + x * scale * squeeze, baseY - y * scale]

    const bladeCv = createCanvas(S, S)
    const bc = bladeCv.getContext('2d')
    const pts = g.blade.map(toPx)
    bc.beginPath()
    bc.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) bc.lineTo(pts[i][0], pts[i][1])
    bc.closePath()
    bc.fillStyle = shaded
    bc.fill()

    const veinCv = createCanvas(S, S)
    const vc = veinCv.getContext('2d')
    vc.strokeStyle = shaded
    vc.lineCap = 'round'
    vc.lineJoin = 'round'
    vc.lineWidth = Math.max(1.4, S * 0.0045)
    for (const poly of g.veins) {
      const p = poly.map(toPx)
      vc.beginPath()
      vc.moveTo(p[0][0], p[0][1])
      for (let i = 1; i < p.length; i++) vc.lineTo(p[i][0], p[i][1])
      vc.stroke()
    }

    // `tilt0` is the canonical, un-squeezed view; the rest carry their angle in the name.
    const tag = tilt === 0 ? 't0' : `t${tilt > 0 ? 'p' : 'm'}${Math.abs(tilt)}`
    writeFileSync(join(outDir, `blade-${variant}-${tag}.png`), bladeCv.encodeSync('png'))
    writeFileSync(join(outDir, `blade-${variant}-${tag}-veins.png`), veinCv.encodeSync('png'))
    written.push(tag)
  }
  return { bladePixels: g.blade.length, veins: g.veins.length, views: written, attachY: 0.97, attachX: 0.5 }
}

/**
 * One spur shoot: the short woody peg a ginkgo carries its leaves on.
 *
 * Drawn as a tapering peg with two or three ring scars — the marks left by previous
 * seasons' leaves. That is what it looks like, and it is the part that meets the
 * branch, so a cluster of leaves hangs off something instead of floating.
 */
function drawSpur(variant, seed) {
  const r = rng(seed * 7 + 11)
  const S = SIZE
  const cv = createCanvas(S, S)
  const c = cv.getContext('2d')
  const cx = S * 0.5
  const topY = S * 0.1
  const botY = S * 0.92
  const wTop = S * 0.10
  const wBot = S * 0.17

  c.fillStyle = COL
  c.beginPath()
  c.moveTo(cx - wTop / 2, topY)
  c.quadraticCurveTo(cx - wBot * 0.62, S * 0.5, cx - wBot / 2, botY)
  c.quadraticCurveTo(cx, botY + S * 0.02, cx + wBot / 2, botY)
  c.quadraticCurveTo(cx + wBot * 0.62, S * 0.5, cx + wTop / 2, topY)
  c.closePath()
  c.fill()

  // Ring scars: knocked out, not drawn on, so they read as structure.
  c.globalCompositeOperation = 'destination-out'
  const scars = 2 + Math.floor(r() * 2)
  for (let i = 0; i < scars; i++) {
    const t = 0.3 + (i / Math.max(1, scars)) * 0.5
    const y = topY + (botY - topY) * t
    const w = wTop + (wBot - wTop) * t
    c.beginPath()
    c.ellipse(cx, y, w * 0.5 * 0.95, S * 0.012, 0, 0, Math.PI * 2)
    c.fill()
  }
  c.globalCompositeOperation = 'source-over'

  writeFileSync(join(outDir, `spur-${variant}.png`), cv.encodeSync('png'))
  return { scars, attachY: 0.1, baseY: 0.92 }
}

const variants = []
for (let v = 1; v <= COUNT; v++) {
  const b = drawBlade(v, SEED * 1000 + v * 37)
  const s = drawSpur(v, SEED * 1000 + v * 37)
  variants.push({ variant: v, ...b, spur: s })
}

console.log(JSON.stringify({
  ok: true,
  outDir,
  size: SIZE,
  files: variants.length * 3,
  variants,
}, null, 2))
