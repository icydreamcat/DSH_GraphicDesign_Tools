/**
 * Check leaf attachment and crowding against the scene's own anchor convention.
 *
 * WHICH OF THE TWO PLANT AUDITS THIS IS
 * -------------------------------------
 * `audit-plant.mjs` and this file carried the SAME header for a while, so the roster could
 * not tell them apart and neither could a reader. They are not the same program:
 *
 *   audit-leaf-attachment.mjs (this file, 186 lines)  attachment and crowding only, and it
 *                                                     reads the anchor from the layer's own
 *                                                     `anchorY`
 *   audit-plant.mjs           (213 lines)             the broader pass: connectivity,
 *                                                     overlap AND distribution, on top of
 *                                                     the attachment checks
 *
 * Use this one when the question is specifically "is every blade attached where the scene
 * says it is". Use `audit-plant` when the question is whether the foliage reads as one plant.
 *
 * READ THIS BEFORE TRUSTING IT
 * ----------------------------
 * The first version of this file reported zero problems for several review rounds while
 * every blade was in fact misplaced, because it RE-DERIVED the attachment convention
 * instead of reading it — the same sign error lived in the scene and in the audit, so the
 * two agreed. Two lessons are built into what follows:
 *
 *   * the anchor comes from the layer's own `anchorY`
 *   * the checks are separate from each other, so one wrong assumption cannot excuse
 *     everything downstream of it
 *
 * Usage: node tools/audit-leaf-attachment.mjs <scene.json> [--limit 12]
 */

import { readFileSync } from 'node:fs'
import { resolve, isAbsolute } from 'node:path'

const args = process.argv.slice(2)
const file = isAbsolute(args[0]) ? args[0] : resolve(process.cwd(), args[0])
const limit = Number((args.includes('--limit') ? args[args.indexOf('--limit') + 1] : 12))

const scene = JSON.parse(readFileSync(file, 'utf8'))
const flat = []
const walk = (ls) => ls.forEach((l) => { flat.push(l); if (Array.isArray(l.children)) walk(l.children) })
walk(scene.layers)

/** A stem is a `path` whose id says so; its quadratic is sampled for distance. */
function stemSamples(layer, n = 24) {
  const m = /^M(-?[\d.]+) (-?[\d.]+) Q(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/.exec(layer.d)
  if (m === null) {
    const mm = /^M(-?[\d.]+) (-?[\d.]+) L(-?[\d.]+) (-?[\d.]+)/.exec(layer.d)
    if (mm === null) return null
    const [, x1, y1, x2, y2] = mm.map(Number)
    const out = []
    for (let i = 0; i <= n; i++) out.push([x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n])
    return out
  }
  const [, x1, y1, qx, qy, x2, y2] = m.map(Number)
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push([u * u * x1 + 2 * u * t * qx + t * t * x2, u * u * y1 + 2 * u * t * qy + t * t * y2])
  }
  return out
}

const distToPolyline = (px, py, pts) => Math.min(...pts.map(([x, y]) => Math.hypot(x - px, y - py)))

const stems = flat.filter((l) => /-stem\d+$/.test(String(l.id))).map((l) => ({ id: l.id, pts: stemSamples(l) })).filter((s) => s.pts !== null)
const spurs = flat.filter((l) => /-spur\d+$/.test(String(l.id)))
const petioles = flat.filter((l) => /-petiole\d+-\d+$/.test(String(l.id)))
const blades = flat.filter((l) => /-leaf\d+-\d+$/.test(String(l.id)))

/**
 * Where a layer's joint actually is, read FROM THE LAYER.
 *
 * The first version of this audit computed it as `y + h * 0.97`, hard-coding the
 * convention the scene was using — and the scene's convention was WRONG (the anchor
 * offset had its sign inverted). So the checker and the bug agreed, and the audit
 * reported zero problems while every blade sat 207px from the petiole it was supposed to
 * meet. That is the failure mode this project's handover already records: 自检通过 ≠ 正确.
 *
 * The layer now carries its own `anchorY`, and this reads it. An audit that re-derives
 * the thing it is checking is not an audit.
 */
const attachPoint = (l) => {
  const a = typeof l.anchorY === 'number' ? l.anchorY : 0.5
  const k = String(l.id).match(/-(\d+)-(\d+)$/)
  return {
    x: l.x + l.w * 0.5,
    y: l.y + l.h * a,
    key: k === null ? '' : `${k[1]}-${k[2]}`,
  }
}

const petioleEnds = new Map()
for (const p of petioles) {
  const m = /^M(-?[\d.]+) (-?[\d.]+) Q[^ ]+ [^ ]+ (-?[\d.]+) (-?[\d.]+)/.exec(p.d)
  const keyMatch = String(p.id).match(/-(\d+)-(\d+)$/)
  if (m === null || keyMatch === null) continue
  petioleEnds.set(`${keyMatch[1]}-${keyMatch[2]}`, {
    start: [Number(m[1]), Number(m[2])],
    end: [Number(m[3]), Number(m[4])],
  })
}

// Every stem's tip, so a spur can be checked against it.
const stemTips = stems.map((s) => ({ id: s.id, tip: s.pts[s.pts.length - 1], all: s.pts }))

const THRESH = 14   // px; a joint that is further away than this is visibly floating
const problems = { spurOffStem: [], petioleOffSpur: [], bladeOffPetiole: [], petioleNoPair: [] }

for (const p of petioles) {
  const keyMatch = String(p.id).match(/-(\d+)-(\d+)$/)
  if (keyMatch === null) continue
  const key = `${keyMatch[1]}-${keyMatch[2]}`
  const geom = petioleEnds.get(key)
  if (geom === undefined) { problems.petioleNoPair.push(p.id); continue }
  // 1. does this petiole START on a stem (allowing for the spur's length)?
  const d0 = Math.min(...stemTips.map((s) => distToPolyline(geom.start[0], geom.start[1], s.all)))
  if (d0 > 60) problems.spurOffStem.push({ id: p.id, distance: Math.round(d0) })
  // 2. does the matching blade sit at this petiole's END?
  const blade = blades.find((b) => {
    const km = String(b.id).match(/-(\d+)-(\d+)$/)
    return km !== null && `${km[1]}-${km[2]}` === key
  })
  if (blade === undefined) { problems.bladeOffPetiole.push({ id: p.id, note: 'no blade for this petiole' }); continue }
  const ap = attachPoint(blade)
  const d1 = Math.hypot(ap.x - geom.end[0], ap.y - geom.end[1])
  if (d1 > THRESH) problems.bladeOffPetiole.push({ id: blade.id, petiole: p.id, distance: Math.round(d1) })
}

const report = {
  ok: problems.spurOffStem.length === 0 && problems.bladeOffPetiole.length === 0 && problems.petioleNoPair.length === 0,
  scene: file,
  counts: { stems: stems.length, spurs: spurs.length, petioles: petioles.length, blades: blades.length },
  threshold: THRESH,
  problems: {
    spurOffStem: problems.spurOffStem.length,
    petioleOffSpur: problems.petioleOffSpur.length,
    bladeOffPetiole: problems.bladeOffPetiole.length,
    petioleNoPair: problems.petioleNoPair.length,
  },
  worst: {
    spurOffStem: problems.spurOffStem.sort((a, b) => b.distance - a.distance).slice(0, limit),
    bladeOffPetiole: problems.bladeOffPetiole.sort((a, b) => (b.distance || 0) - (a.distance || 0)).slice(0, limit),
    petioleNoPair: problems.petioleNoPair.slice(0, limit),
  },
}

// ── SPACING AND DISTRIBUTION ───────────────────────────────────────────────────
// "Check each blade's plausibility" is not only about whether it is attached. A canopy
// can be perfectly jointed and still be wrong: too crowded to read, or all on one side of
// the plant. Two more measures, independent of the joint checks above.
if (blades.length > 0) {
  const centres = blades.map((b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2, r: b.w / 2, id: b.id }))

  // 1. CROWDING. For each blade, the distance to its nearest neighbour expressed as a
  //    multiple of the two radii. Below ~1.0 the blades overlap; the floor is the
  //    `minGap` the scene enforces, so anything under it means a check failed.
  const nearest = centres.map((a) => {
    let best = Infinity
    for (const b of centres) {
      if (a === b) continue
      best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, a.r + b.r))
    }
    return { id: a.id, ratio: Number.isFinite(best) ? Math.round(best * 100) / 100 : null, x: Math.round(a.x), y: Math.round(a.y) }
  }).sort((p, q) => (p.ratio || 99) - (q.ratio || 99))

  // 2. DISTRIBUTION. Split the page into a 4x3 grid and count blades per cell. A canopy
  //    that lives in two cells is a clump, not a plant.
  const GW = 4
  const GH = 3
  const grid = Array.from({ length: GH }, () => new Array(GW).fill(0))
  for (const c of centres) {
    const gx = Math.min(GW - 1, Math.max(0, Math.floor((c.x / scene.canvas.width) * GW)))
    const gy = Math.min(GH - 1, Math.max(0, Math.floor((c.y / scene.canvas.height) * GH)))
    grid[gy][gx]++
  }
  const cells = grid.flat()
  const occupied = cells.filter((n) => n > 0).length
  const mean = cells.reduce((a, b) => a + b, 0) / cells.length
  const variance = cells.reduce((a, b) => a + (b - mean) ** 2, 0) / cells.length
  // Coefficient of variation: 0 is perfectly even, higher is clumpier. Reported rather
  // than asserted, because a real canopy is genuinely uneven — a tree has a light side.
  const cv = mean === 0 ? 0 : Math.round((Math.sqrt(variance) / mean) * 100) / 100

  report.spacing = {
    minGapRatio: nearest[0] === undefined ? null : nearest[0].ratio,
    crowdedUnder1: nearest.filter((n) => n.ratio !== null && n.ratio < 1).length,
    tightest: nearest.slice(0, limit),
  }
  report.distribution = {
    grid,
    occupiedCells: occupied,
    ofCells: cells.length,
    clumpingCV: cv,
  }
}

console.log(JSON.stringify(report, null, 2))
