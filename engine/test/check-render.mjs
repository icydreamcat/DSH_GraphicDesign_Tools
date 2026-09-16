/**
 * The delivered-pixel check: does it read type the way a person does?
 *
 * WHAT THIS SUITE IS PROTECTING
 * -----------------------------
 * This tool exists because of two failures that both looked fine in a green report:
 *
 *   1. A poster was measured on its hero composite, one stage before the effects, so every
 *      ratio described an image nobody delivered. Measured on the delivered file, the same zones
 *      were 3.7:1 and 3.9:1. The measurement was not wrong; its object was.
 *   2. Two versions of text came back "80 layers, all ≥ 4.5:1" while the letters on screen were
 *      grey, because a dark glow had been painted OVER the strokes. The declared colour was
 *      untouched and the ground was untouched; only the glyph changed, and no check that compared
 *      those two could see it.
 *
 * So there are two claims under test, and both are asserted against pixels whose correct verdict
 * is known BEFORE the tool runs:
 *
 *   - a design that reads, reads: light type on a dark field is `ok`, not a false alarm. The
 *     first two algorithms written here failed exactly there — one by comparing a text box's
 *     darkest pixels against its lightest, the other by splitting the luminance histogram, which
 *     on a region containing a map found two hill colours and called them ink and ground.
 *   - a design that does not read, does not: mid-grey on a dark field is `LOW`.
 *
 * The third case is the one the tool was written for: the same light ink as the passing zone,
 * with a dark glow painted over its strokes. It must still read `ok` (a reader can see it) AND
 * carry a divergence, because the ink on screen is no longer the ink that was declared.
 *
 * Run: node test/check-render.mjs
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'

import { measureZone, readImageData } from '../tools/check-render.mjs'
import { renderScene } from '../src/render.mjs'
import { registerFonts, fontFamilyReport } from '../src/fonts.mjs'
import { WORKSPACE } from '../src/paths.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE = resolve(HERE, '..')
const TOOL = resolve(ENGINE, 'tools', 'check-render.mjs')

// Scratch goes outside the repository, per the layout: `.cache/` is safe to delete, and a test
// that writes into the working tree leaves artefacts behind for the next person to wonder about.
const SCRATCH = join(WORKSPACE, '.cache', 'test')
mkdirSync(SCRATCH, { recursive: true })

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()

/** A synthetic delivered image: a ground with rectangular "glyphs" of a stated ink drawn in it. */
function paint(groundHex, inkHex, blocks, w = 300, h = 120) {
  const g0 = [1, 3, 5].map((i) => parseInt(groundHex.slice(i, i + 2), 16))
  const i0 = [1, 3, 5].map((i) => parseInt(inkHex.slice(i, i + 2), 16))
  const D = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = (y * w + x) * 4
      const inside = blocks.some((b) => x >= b[0] && x < b[0] + b[2] && y >= b[1] && y < b[1] + b[3])
      const c = inside ? i0 : g0
      D[at] = c[0]; D[at + 1] = c[1]; D[at + 2] = c[2]; D[at + 3] = 255
    }
  }
  return { D, W: w, H: h }
}

/** Bars that fill 8% of the box, so the ink is a clear minority of its own zone. */
const bars = (x, y, w, h, n = 6) => {
  const out = []
  const bw = Math.floor(w / (n * 2))
  for (let i = 0; i < n; i++) out.push([x + 4 + i * bw * 2, y + 4, bw, h - 8])
  return out
}

// ── 1. the two readings, on pixels whose verdict is known ───────────────────

console.log('\nlight type on a dark field — must read as readable')
{
  const image = paint('#101821', '#EAF2FA', bars(10, 10, 280, 100))
  const m = measureZone({ label: 'light-on-dark', box: [0, 0, 300, 120], ink: '#EAF2FA', fontSize: 44 }, image)
  check('verdict is ok', m.verdict === 'ok', `got ${m.verdict} at ${m.onscreen.toFixed(2)}:1`)
  check('on-screen ink is the ink, not the ground', m.inkHex.toUpperCase() === '#EAF2FA', `got ${m.inkHex}`)
  check('on-screen ground is the ground', m.groundHex.toUpperCase() === '#101821', `got ${m.groundHex}`)
  check('contrast is the real ratio (≈15.8:1)', Math.abs(m.onscreen - 15.8) < 0.6, `${m.onscreen.toFixed(2)}:1`)
  check('a legible surface is not blamed: weak ground share 0', m.weakGroundShare === 0, `${m.weakGroundShare}`)
  check('the declaration matches the screen', m.divergence !== null && m.divergence.factor < 1.1,
    m.divergence === null ? 'no divergence reported' : `${m.divergence.factor}×`)
}

console.log('\nmid-grey type on a dark field — must read as failing')
{
  const image = paint('#101821', '#3E4750', bars(10, 10, 280, 100))
  const m = measureZone({ label: 'grey-on-dark', box: [0, 0, 300, 120], ink: '#3E4750', fontSize: 44 }, image)
  check('verdict is LOW', m.verdict === 'LOW', `got ${m.verdict} at ${m.onscreen.toFixed(2)}:1`)
  check('contrast is under 2:1', m.onscreen < 2, `${m.onscreen.toFixed(2)}:1`)
  check('the surface is reported as unable to hold the type', m.weakGroundShare > 0.9, `${m.weakGroundShare}`)
}

console.log('\na ground this ink cannot sit on at all — the inverted case')
{
  // Dark type on a dark field: the ink is present, the contrast is simply not there. Reported as
  // failing on the pixels, without needing any declaration to say so.
  const image = paint('#33393F', '#101821', bars(10, 10, 280, 100))
  const m = measureZone({ label: 'dark-on-dark', box: [0, 0, 300, 120], ink: null, fontSize: 44 }, image)
  check('verdict is LOW', m.verdict === 'LOW', `got ${m.verdict} at ${m.onscreen.toFixed(2)}:1`)
  check('no declaration needed for the on-screen reading', m.divergence === null)
}

console.log('\nan ink declared but absent from the picture')
{
  // The scene says one thing and no such pixel exists. Saying so is the point: averaging this
  // into a plausible-looking ratio is how a missing layer survives a check.
  const image = paint('#101821', '#EAF2FA', bars(10, 10, 280, 100))
  const m = measureZone({ label: 'missing-ink', box: [0, 0, 300, 120], ink: '#FF0000', fontSize: 44 }, image)
  check('reported, not averaged', m.verdict === 'unresolved' || m.divergence !== null,
    `verdict ${m.verdict}`)
  check('the report names the ground it did find', typeof m.groundHex === 'string' && m.groundHex.startsWith('#'))
}

console.log('\na zone with no glyph in it')
{
  const image = paint('#101821', '#EAF2FA', [])
  const m = measureZone({ label: 'blank', box: [0, 0, 300, 120], ink: '#EAF2FA', fontSize: 44 }, image)
  check('not reported as passing', m.verdict !== 'ok', `verdict ${m.verdict}`)
}

// ── 2. the render, and the report that has to describe it ───────────────────

console.log('\nthe render report records the ink its own text layers asked for')
const fonts = registerFonts()
const fontFaces = fontFamilyReport().faces
const fontCount = fontFaces.length
let rendered = null
if (fontCount === 0) {
  console.log('  skip  no curated fonts resolved on this machine — the render fixture cannot run')
} else {
  const GROUND = '#101821'
  const text = (id, y, colour, extra = {}) => ({
    id, shape: 'text',
    x: 80, y, w: 900,
    text: 'READABILITY 0123',
    size: 44,
    font: fontFaces[0].alias,
    color: colour,
    align: 'left',
    wrap: false,
    ...extra,
  })
  const scene = {
    canvas: { width: 1100, height: 560 },
    ground: GROUND,
    layers: [
      { id: 'bg', shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: GROUND },
      text('pass', 80, '#EAF2FA'),
      text('low', 230, '#3E4750'),
      // The historical failure, reproduced mechanically. `outerGlow` defaults to `blend: 'screen'`,
      // which can only lighten; with `blend: 'normal'` it paints its dark colour OVER the strokes,
      // and at a radius large enough to reach the letterform's interior the letters stop being the
      // colour anyone declared. That is the case a declared-versus-ground check cannot see.
      text('outlined', 380, '#EAF2FA', {
        effects: [{ type: 'outerGlow', size: 14, opacity: 1, color: '#050A10', blend: 'normal' }],
      }),
    ],
  }
  const { canvas, report } = await renderScene(scene)
  const png = join(SCRATCH, 'check-render-fixture.png')
  const reportPath = join(SCRATCH, 'check-render-fixture.report.json')
  writeFileSync(png, canvas.encodeSync('png'))
  writeFileSync(reportPath, JSON.stringify({ report }, null, 2))

  const textRows = report.log.filter((r) => r.shape === 'text')
  check('every text layer is in the report', textRows.length === 3, `${textRows.length} found`)
  check('the report carries the declared ink', textRows.every((r) => typeof r.drawn.paint === 'string'),
    textRows.map((r) => r.drawn.paint).join(' '))
  check('the declared ink is the one the scene asked for',
    textRows.every((r, i) => r.drawn.paint.toUpperCase().startsWith(['#EAF2FA', '#3E4750', '#EAF2FA'][i])),
    textRows.map((r) => r.drawn.paint).join(' '))
  check('no font fell back silently', textRows.every((r) => r.drawn.fontFallback === false))

  rendered = { png, reportPath }
}

// ── 3. the command line, on the rendered fixture ────────────────────────────

if (rendered !== null) {
  console.log('\nthe command line, reading the delivered PNG')
  const proc = spawnSync(process.execPath, [TOOL, rendered.png, '--report', rendered.reportPath, '--json', '--quiet'], {
    cwd: ENGINE,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  })
  let parsed = null
  try { parsed = JSON.parse(proc.stdout) } catch { /* reported below */ }
  check('writes one JSON object to stdout', parsed !== null, parsed === null ? (proc.stdout ?? '').slice(0, 120) : 'parsed')
  if (parsed !== null) {
    const by = Object.fromEntries(parsed.zones.map((z) => [z.label, z]))
    check('three zones measured', parsed.measured === 3, `${parsed.measured}`)
    check('the readable zone is ok', by.pass !== undefined && by.pass.verdict === 'ok',
      by.pass === undefined ? 'missing' : by.pass.verdict)
    check('the grey zone fails', by.low !== undefined && by.low.verdict === 'LOW',
      by.low === undefined ? 'missing' : by.low.verdict)
    check('the readable zones measure as readable',
      by.pass.onscreenRatio > 10 && by.outlined !== undefined && by.outlined.onscreenRatio > 10,
      `pass ${by.pass.onscreenRatio}:1, outlined ${by.outlined === undefined ? '—' : by.outlined.onscreenRatio + ':1'}`)
    // The case this tool was written for: legible on screen, but the ink that reached the screen
    // is not the ink the scene declared. Both halves have to be in the same payload.
    check('the outlined zone is reported as a divergence, though it reads fine',
      by.outlined !== undefined && by.outlined.divergence !== null && by.outlined.divergence.factor >= 1.3,
      by.outlined === undefined || by.outlined.divergence === null ? 'no divergence' : `${by.outlined.divergence.factor}× (${by.outlined.divergence.screenInk})`)
    check('the divergence names what the screen actually shows',
      by.outlined !== undefined && by.outlined.divergence !== null &&
      by.outlined.divergence.screenInk.toUpperCase() === by.outlined.ink.toUpperCase(),
      by.outlined === undefined || by.outlined.divergence === null ? '—' : `${by.outlined.divergence.screenInk} vs ink ${by.outlined.ink}`)
    check('the payload states its own limits', Array.isArray(parsed.limits) && parsed.limits.length >= 2)
    check('exit status is non-zero when a zone fails', proc.status === 1, `exit ${proc.status}`)
  }

  // A delivery gate needs a clean run to be a clean run: hide the failing zone and the same
  // command must exit 0.
  const zoneFile = join(SCRATCH, 'check-render-zones.json')
  writeFileSync(zoneFile, JSON.stringify({
    zones: [{ label: 'only-the-readable-one', box: [80, 80, 900, 62], ink: '#EAF2FA' }],
  }, null, 2))
  const clean = spawnSync(process.execPath, [TOOL, rendered.png, '--zones', zoneFile, '--json', '--quiet'], {
    cwd: ENGINE,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  })
  let cleanJson = null
  try { cleanJson = JSON.parse(clean.stdout) } catch { /* reported below */ }
  check('a zone file states its own boxes and ink', cleanJson !== null && cleanJson.measured === 1,
    cleanJson === null ? (clean.stdout ?? '').slice(0, 120) : `${cleanJson.measured} zone`)
  check('a clean run exits 0', clean.status === 0, `exit ${clean.status}`)
  check('exit 0 means no LOW zone', cleanJson !== null && cleanJson.counts.low === 0,
    cleanJson === null ? '—' : JSON.stringify(cleanJson.counts))

  // Geometry has to come from the report, because a hard-coded zone list belongs to one poster at
  // one size. This is the assertion that the tool is not that.
  const sized = spawnSync(process.execPath, [TOOL, rendered.png, '--report', rendered.reportPath, '--json', '--quiet'], {
    cwd: ENGINE, encoding: 'utf8', maxBuffer: 1 << 26,
  })
  const sizedJson = JSON.parse(sized.stdout)
  check('every zone box came from the report, at the report\'s coordinates',
    sizedJson.zones.every((z) => Array.isArray(z.box) && z.box.length === 4 && z.source === 'render report'))
  check('the report\'s canvas size is what was measured',
    sizedJson.canvas.width === 1100 && sizedJson.canvas.height === 560,
    `${sizedJson.canvas.width}x${sizedJson.canvas.height}`)
} else {
  console.log('\n  skip  the command-line checks need the render fixture')
}

console.log(`\n${checks - failed}/${checks} checks passed`)
process.exit(failed === 0 ? 0 : 1)
