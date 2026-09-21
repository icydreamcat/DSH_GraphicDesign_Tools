/**
 * gate-delivery — the delivery gate. Exits NON-ZERO when a render must not ship.
 *
 * Usage:
 *   node tools/gate-delivery.mjs <scene.json> [--png render.png] [--report r.json] [--json]
 *
 * Exit codes
 *   0  every hard check passed
 *   1  at least one hard check FAILED
 *   2  the gate could not run (missing file, unparseable input) — never a pass
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT check-render OR design_verify
 * ---------------------------------------------------------------
 * Three tools already look at a render and none of them can stop a delivery:
 *
 *   design_verify   reads the SCENE, so it sees declared colour against declared ground and
 *                   never what is actually under the letters. It also flags a texture layer
 *                   stretched over the canvas as "subject too large", which is what a ground
 *                   texture IS.
 *   check-render    measures the DELIVERED pixels and is the better tool for legibility — but
 *                   its own header says it "must never become a rule that forces a layout to
 *                   change". It reports and defers. That is right for it, and it means it never
 *                   fails.
 *   design_critique answers the four design questions. Two of them come back as questions
 *                   with numbers, deliberately: they need a judgement.
 *
 * So every one of them reports, and a session can therefore pass all of them and still ship a
 * render whose report lists failed layers nobody read. That is not hypothetical: in one session
 * a blend-mode name outside the enum silently dropped six texture layers, and a malformed path
 * string silently dropped four connector lines. Both renders were "clean" by every report that
 * was actually read, because the WARNINGS ARRAY was never read.
 *
 * This tool reads it, and the other things that are mechanically decidable, and then refuses.
 *
 * WHAT IT CHECKS, AND WHAT IT REFUSES TO CHECK
 * --------------------------------------------
 * Hard checks — each is a fact about the files, decidable without taste:
 *
 *   H1  the render report's `warnings` array is EMPTY
 *   H2  every layer the report logged actually DREW (a `failed` step is a missing layer)
 *   H3  the scene's `gates` declaration is present and complete
 *   H4  declared draw order equals actual draw order
 *   H4b no element declared as foreground falls inside a declared `forbiddenZone`
 *   H5  no layer DECLARED as a sheet is semi-transparent
 *   H6  no text is near-white on a near-white ground
 *   H7  the accent budget is declared and inside its stated band
 *
 * WHAT H4b AND H5 EXEMPT, AND WHY IT IS NOW DECLARED RATHER THAN GUESSED
 * ---------------------------------------------------------------------
 * Both of these originally decided what to ignore from the layer's NAME — a prefix list for
 * sheets, a suffix list for overlays, a keyword list for grounds. Every one of those lists was a
 * vocabulary learned from one project's naming, and the consequence is worse than a false
 * positive: on a differently-named project the check exempts everything and reports a pass it
 * never earned. Silence reads as success.
 *
 * They are declaration-driven now. `gates.groundEntities` names the layers that are what the
 * figure stands on; `gates.sheetRoles` names the layers that ARE a physical sheet (and may name
 * the overlays that are not, with a reason). A scene that declares neither gets a SKIP that says
 * so, not a pass.
 *
 * The same principle already governed `forbiddenZones`, and this file's own header said it first:
 * the gate cannot discover where a face is, so the zone must be declared. The gate also cannot
 * know which of two full-bleed layers is the ground. Declare it.
 *
 * GATES ARE VALIDATED BY THE RENDERER TOO, THROUGH THE SAME MODULE
 * ---------------------------------------------------------------
 * `src/gates.mjs` owns what a valid declaration is, and the renderer refuses to render a scene
 * without one. Two checks with two rule sets would let a scene pass the render and be
 * unmeasurable at delivery, which is exactly the hole this whole mechanism exists to close.
 *
 * DELIBERATELY NOT CHECKED, and named here so the omission is visible rather than accidental:
 *
 *   - whether an element covers the figure's face or chest. The gate cannot know where a face
 *     is in a placed illustration. The scope must declare `forbiddenZones` and the gate CAN
 *     check declared element boxes against them (H4b below) — but it cannot discover the zone.
 *   - whether the craft is unified, whether the metaphor is apt, whether the piece pleases.
 *     Those belong to the person who owns the work. A gate that guessed at them would be worse
 *     than no gate, because it would launder a taste decision as a measurement.
 */
import { readFileSync, existsSync } from 'node:fs'
import { isAbsolute, resolve, dirname } from 'node:path'
import { validateGates, REQUIRED_GATE_KEYS } from '../src/gates.mjs'
import { parseColor, relativeLuminance } from '../src/color.mjs'

const argv = process.argv.slice(2)
const argOf = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}
const asJson = argv.includes('--json')
const scenePath = argv.find((a) => !a.startsWith('--') && a.endsWith('.json') && !a.includes('report'))

if (!scenePath) {
  console.error('usage: node tools/gate-delivery.mjs <scene.json> [--png render.png] [--report r.json] [--json]')
  process.exit(2)
}

const abs = (p) => (isAbsolute(p) ? p : resolve(process.cwd(), p))
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

let scene
try {
  scene = readJson(abs(scenePath))
} catch (e) {
  console.error(`gate-delivery: cannot read scene ${scenePath}: ${e.message}`)
  process.exit(2)
}

// Locate the render report beside the PNG, or take it from --report.
const pngArg = argOf('--png')
const reportArg = argOf('--report')
let reportPath = reportArg ? abs(reportArg) : null
if (reportPath === null && pngArg !== null) {
  const guess = abs(pngArg).replace(/\.png$/i, '.report.json')
  if (existsSync(guess)) reportPath = guess
}

const fail = []
const pass = []
const skip = []

/* ── H1  the warnings array is empty ──────────────────────────────────────── */
let report = null
if (reportPath === null || !existsSync(reportPath)) {
  skip.push({
    id: 'H1',
    what: 'render report warnings array',
    why: 'no report found — pass --report, or render beside the PNG so <name>.report.json exists',
  })
} else {
  try {
    report = readJson(reportPath)
  } catch (e) {
    fail.push({ id: 'H1', what: 'render report warnings array', detail: `report unreadable: ${e.message}` })
  }
}

if (report !== null) {
  const warnings = (report.report && report.report.warnings) || []
  if (warnings.length === 0) {
    pass.push({ id: 'H1', what: 'warnings array is empty' })
  } else {
    fail.push({
      id: 'H1',
      what: 'warnings array is empty',
      detail: `${warnings.length} failed: they are ABSENT from the image and no picture will show it`,
      items: warnings,
    })
  }

  /* ── H2  every logged layer actually drew ──────────────────────────────── */
  const log = (report.report && report.report.log) || []
  const noDraw = log.filter((e) => e.step === 'layer' && (e.drawn === undefined || e.drawn === null))
  if (noDraw.length === 0) {
    pass.push({ id: 'H2', what: `all ${log.filter((e) => e.step === 'layer').length} logged layers drew` })
  } else {
    fail.push({
      id: 'H2',
      what: 'every logged layer drew',
      detail: `${noDraw.length} layer steps produced no draw record`,
      items: noDraw.map((e) => e.id || '(unnamed)'),
    })
  }
}

/* ── H3  the scene declares its gates ────────────────────────────────────── */
// Validated by the SHARED module, not by a copy of the rules here. The renderer refuses a scene
// on the same function, so a scene can never pass the render and be unmeasurable at delivery.
const gateCheck = validateGates(scene.gates)
const gates = scene.gates
if (gateCheck.ok) {
  pass.push({ id: 'H3', what: `scene declares gates (${REQUIRED_GATE_KEYS.join(' / ')})` })
} else {
  fail.push({
    id: 'H3',
    what: 'scene declares usable `gates`',
    detail: `${gateCheck.problems.length} problem(s) in the declaration`,
    items: gateCheck.problems,
  })
}

/* ── H4  declared draw order equals actual draw order ────────────────────── */
const wanted = gates && Array.isArray(gates.layers) ? gates.layers : null
const layerIds = (scene.layers || []).map((l) => String(l.id || ''))
if (wanted === null) {
  skip.push({ id: 'H4', what: 'declared order vs actual order', why: 'gates.layers not declared' })
} else {
  // each declared layer name is a PREFIX that must appear; the order of first occurrence must match
  const positions = wanted.map((name) => layerIds.findIndex((id) => id.startsWith(name)))
  const absent = wanted.filter((_, i) => positions[i] < 0)
  if (absent.length > 0) {
    fail.push({ id: 'H4', what: 'declared order vs actual order', detail: `declared but absent from the scene: ${absent.join(', ')}` })
  } else {
    let ok = true
    for (let i = 1; i < positions.length; i++) if (positions[i] < positions[i - 1]) ok = false
    if (ok) pass.push({ id: 'H4', what: 'declared order equals actual order' })
    else
      fail.push({
        id: 'H4',
        what: 'declared order equals actual order',
        detail: `declared ${wanted.join(' → ')} but actual first-occurrence is ${positions.join(' , ')}`,
      })
  }
}

/* ── H4b declared elements must not fall inside forbidden zones ──────────── */
const zones = gates && Array.isArray(gates.forbiddenZones) ? gates.forbiddenZones : null
if (zones === null || zones.length === 0) {
  skip.push({
    id: 'H4b',
    what: 'elements inside forbiddenZones',
    why: 'no forbiddenZones declared — the gate cannot know where a face is in a placed illustration, so the zone must be declared',
  })
} else {
  const hits = []
  const CW = scene.canvas && scene.canvas.width ? scene.canvas.width : 0
  const CH = scene.canvas && scene.canvas.height ? scene.canvas.height : 0
  /**
   * A ground and a ground-texture cover the whole canvas by definition, so they always intersect
   * every zone. They are not "an element sitting over the face" — they are what the figure stands
   * on. Verified: an unfiltered version failed its own self-test because the background rectangle
   * "overlapped face by 200×200px".
   *
   * HOW THIS IS DECIDED, AND WHY IT CHANGED
   * ---------------------------------------
   * This used to be a regular expression over layer ids — /(^|[-_])(bg|ground|paper|texture|…)/
   * — which is a vocabulary learned from ONE project's naming. A threshold gate that only
   * recognises the names one project happens to use is a gate that silently exempts every other
   * project, and silence reads as a pass. (The size fallback below stays, because "covers the
   * whole canvas" is a geometric fact rather than a naming convention.)
   *
   * So the exemption is DECLARED now: `gates.groundEntities` lists the layer ids that are what
   * the figure stands on. The same principle the zone itself already follows — the gate cannot
   * discover where a face is, so the zone must be declared, and it cannot know which of two
   * full-bleed layers is the ground, so that must be declared too.
   */
  const groundEntities = new Set(Array.isArray(gates.groundEntities) ? gates.groundEntities : [])
  const isGroundLike = (l) => {
    const w = l.w || 0
    const h = l.h || 0
    if (CW && CH && w >= CW * 0.98 && h >= CH * 0.98) return true
    return groundEntities.has(String(l.id || ''))
  }
  for (const l of scene.layers || []) {
    if (!['rect', 'image', 'ellipse', 'text', 'path', 'polygon'].includes(l.shape)) continue
    if (gates.allowZones && gates.allowZones.includes(l.id)) continue
    if (isGroundLike(l)) continue
    const x = l.x ?? (l.shape === 'line' ? Math.min(l.x1, l.x2) : undefined)
    const y = l.y ?? (l.shape === 'line' ? Math.min(l.y1, l.y2) : undefined)
    const w = l.w ?? (l.shape === 'line' ? Math.abs(l.x2 - l.x1) : undefined)
    const h = l.h ?? (l.shape === 'line' ? Math.abs(l.y2 - l.y1) : undefined)
    if (x === undefined || y === undefined) continue
    for (const z of zones) {
      const zx2 = z.x + z.w
      const zy2 = z.y + z.h
      const lx2 = x + (w || 0)
      const ly2 = y + (h || 0)
      const overlapW = Math.max(0, Math.min(lx2, zx2) - Math.max(x, z.x))
      const overlapH = Math.max(0, Math.min(ly2, zy2) - Math.max(y, z.y))
      if (overlapW > 0 && overlapH > 0) {
        hits.push(`${l.id} overlaps ${z.name || 'zone'} by ${Math.round(overlapW)}×${Math.round(overlapH)}px`)
      }
    }
  }
  if (hits.length === 0) pass.push({ id: 'H4b', what: 'nothing sits inside a forbidden zone' })
  else fail.push({ id: 'H4b', what: 'nothing sits inside a forbidden zone', detail: `${hits.length} overlap(s)`, items: hits.slice(0, 14) })
}

/* ── H5  no declared sheet is semi-transparent ───────────────────────────── */
const ALLOW = new Set(gates && Array.isArray(gates.allowTranslucent) ? gates.allowTranslucent : [])
/**
 * The check is about the SHEET, not about what is printed on it.
 *
 * A sheet legitimately carries overlay layers — a fibre texture, a cockle relief, a pigment
 * bleed, a lit edge — and every one of those is SUPPOSED to be semi-transparent, because it is
 * a treatment laid over opaque paper. Flagging them is a false positive, and a gate that cries
 * wolf gets switched off, which is worse than no gate. Verified against a real scene: an
 * unfiltered version reported 18 "translucent sheets", of which 15 were overlay layers.
 *
 * HOW THE SHEET IS IDENTIFIED, AND WHY IT CHANGED
 * ----------------------------------------------
 * The first version carried two regular expressions — one listing sheet-ish id prefixes
 * (env|rc|card|tag|…) and one listing overlay-ish suffixes (-fib|-cok|-pig|…). Both were a
 * vocabulary learned from ONE project's naming, and they only existed because that project's
 * overlays kept tripping the check. The consequence is the one that matters here: on a project
 * that names things differently, the check silently exempts everything. Silence reads as a pass,
 * so the gate would report "no translucent sheet" on a scene it never examined.
 *
 * The declaration replaces both lists. `gates.sheetRoles` names the layers that ARE a physical
 * sheet, and only those are judged. Two accepted shapes, because a role is sometimes the point:
 *
 *   sheetRoles: ["rc-body", "card-1"]                                  every entry is a sheet
 *   sheetRoles: [{ id: "rc-body", role: "sheet" }, { id: "rc-fib", role: "overlay" }]
 *
 * The overlay entries in the second form document *why* a layer is exempt, which is what the
 * regular expression could never say.
 */
const sheetIds = new Set()
let sheetDeclarationMalformed = 0
for (const entry of Array.isArray(gates && gates.sheetRoles) ? gates.sheetRoles : []) {
  if (typeof entry === 'string') { sheetIds.add(entry); continue }
  if (entry !== null && typeof entry === 'object' && typeof entry.id === 'string') {
    // `role: 'overlay'` (or anything other than 'sheet') is an explicit exemption, not an omission.
    if (entry.role === undefined || entry.role === 'sheet') sheetIds.add(entry.id)
    continue
  }
  sheetDeclarationMalformed++
}
if (sheetDeclarationMalformed > 0) {
  fail.push({
    id: 'H5',
    what: 'no declared sheet is semi-transparent',
    detail: `gates.sheetRoles has ${sheetDeclarationMalformed} entry that is neither a layer id nor an { id, role } record`,
  })
}
const semi = []
for (const l of scene.layers || []) {
  const id = String(l.id || '')
  if (!sheetIds.has(id)) continue               // undeclared layers are simply not this check's business
  if (ALLOW.has(id)) continue
  if (l.shape !== 'rect' && l.shape !== 'path') continue
  if (typeof l.opacity === 'number' && l.opacity < 0.95 && (l.w || 0) > 60 && (l.h || 0) > 40) {
    semi.push(`${id} opacity ${l.opacity} at ${l.w}×${l.h}`)
  }
}
if (semi.length > 0) {
  fail.push({
    id: 'H5',
    what: 'no declared sheet is semi-transparent',
    detail: `${semi.length} translucent sheet(s) — real paper is opaque; lower its VALUE, not its opacity`,
    items: semi.slice(0, 14),
  })
} else if (sheetIds.size === 0 && sheetDeclarationMalformed === 0) {
  skip.push({
    id: 'H5',
    what: 'no declared sheet is semi-transparent',
    why: 'gates.sheetRoles declares no sheet layers, so there is nothing for this check to judge. ' +
      'Declare the layers that ARE a physical sheet (and, if useful, the overlays that are not) — ' +
      'otherwise this check exempts the whole scene and reports a pass it did not earn.',
  })
} else {
  pass.push({ id: 'H5', what: `no declared sheet is semi-transparent (${sheetIds.size} declared)` })
}

/* ── H6  no near-white text on a near-white ground ───────────────────────── */
/**
 * Relative luminance through the engine's own colour parser, not a hand-rolled hex regex.
 *
 * The regex version accepted `#RRGGBB` and silently returned null for everything else — `#RGB`,
 * `#RRGGBBAA`, `rgb()` — and null meant SKIPPED. The engine's own `paint`/`color` fields accept
 * all of those forms, so a scene written in 8-digit hex was never checked while the gate reported
 * a pass. Accepting what the rest of the engine accepts is the only consistent answer.
 */
const lum = (colour) => {
  try {
    return relativeLuminance(parseColor(colour))
  } catch {
    return null
  }
}
const groundHex = typeof scene.ground === 'string' ? scene.ground : null
const gl = lum(groundHex)
const pale = []
if (gl === null) {
  skip.push({
    id: 'H6',
    what: 'near-white text on near-white ground',
    why: `scene.ground is not a colour the engine can parse, so no ratio can be computed: ${JSON.stringify(scene.ground)}`,
  })
} else {
  for (const l of scene.layers || []) {
    if (l.shape !== 'text') continue
    // A text layer may carry its paint under either key — the renderer accepts both.
    const tl = lum(l.color === undefined ? l.paint : l.color)
    if (tl === null) continue
    const hi = Math.max(gl, tl) + 0.05
    const lo = Math.min(gl, tl) + 0.05
    const ratio = hi / lo
    if (ratio < 1.6 && gl > 0.6) pale.push(`${l.id} "${String(l.text || '').slice(0, 18)}" ratio ${ratio.toFixed(2)}:1 on ${groundHex}`)
  }
  if (pale.length === 0) pass.push({ id: 'H6', what: 'no near-white text on a near-white ground' })
  else
    fail.push({
      id: 'H6',
      what: 'no near-white text on a near-white ground',
      detail: `${pale.length} text layer(s) below 1.6:1 against the ground`,
      items: pale.slice(0, 12),
      caveat:
        'NOTE: this compares the declared ink against the declared GROUND only. Text sitting on its own ' +
        'panel is measured wrongly and may be perfectly legible. Crop at 1:1 before acting on this.',
    })
}

/* ── H7  accent budget declared and honoured ─────────────────────────────── */
if (report !== null && report.verification && report.verification.metrics) {
  const acc = report.verification.metrics.accentFlatShare
  const band = gates && Array.isArray(gates.accentBand) ? gates.accentBand : null
  if (band === null) {
    skip.push({ id: 'H7', what: 'accent budget', why: 'gates.accentBand not declared (expected [lo, hi])' })
  } else if (typeof acc !== 'number') {
    skip.push({ id: 'H7', what: 'accent budget', why: 'report carries no accentFlatShare' })
  } else if (acc >= band[0] && acc <= band[1]) {
    pass.push({ id: 'H7', what: `accent flat share ${(acc * 100).toFixed(1)}% inside declared ${band[0] * 100}–${band[1] * 100}%` })
  } else {
    fail.push({
      id: 'H7',
      what: 'accent budget',
      detail: `accentFlatShare ${(acc * 100).toFixed(1)}% outside declared ${band[0] * 100}–${band[1] * 100}%`,
    })
  }
} else {
  skip.push({ id: 'H7', what: 'accent budget', why: 'no report, or report has no verification.metrics' })
}

/* ── report ──────────────────────────────────────────────────────────────── */
const out = {
  tool: 'gate-delivery',
  scene: abs(scenePath),
  report: reportPath,
  passed: fail.length === 0,
  fail,
  pass,
  skipped: skip,
}
if (asJson) {
  console.log(JSON.stringify(out, null, 2))
} else {
  console.log(`gate-delivery — ${abs(scenePath)}`)
  console.log('')
  for (const p of pass) console.log(`  PASS  ${p.id.padEnd(4)} ${p.what}`)
  for (const s of skip) console.log(`  SKIP  ${s.id.padEnd(4)} ${s.what} — ${s.why}`)
  for (const f of fail) {
    console.log(`  FAIL  ${f.id.padEnd(4)} ${f.what}`)
    console.log(`        ${f.detail}`)
    for (const it of f.items || []) console.log(`          · ${String(it).slice(0, 150)}`)
    if (f.caveat) console.log(`        ${f.caveat}`)
  }
  console.log('')
  console.log(fail.length === 0
    ? `gate-delivery: PASS (${pass.length} passed, ${skip.length} skipped)`
    : `gate-delivery: FAIL — ${fail.length} hard check(s) failed. Do not ship this render.`)
  console.log('The gate cannot judge craft, a metaphor, or whether the piece pleases. Those stay with the person who owns the work.')
}
process.exit(fail.length === 0 ? 0 : 1)
