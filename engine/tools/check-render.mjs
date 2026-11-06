/**
 * check-render — read the text zones of a DELIVERED image and report whether they still read.
 *
 * Usage: node tools/check-render.mjs <png> [--report FILE] [--zones FILE] [--draw OUT.png] [--json]
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT verifyScene
 * ---------------------------------------------
 * Two facts, both measured, put this file here.
 *
 * 1. The scene cannot answer this question. `verifyScene` sees a text layer's declared colour
 *    and the page's declared `ground`; it never sees what is actually underneath the letters.
 *    Its own comment says so, and works around it with an allowance list. That is the right
 *    thing for a static check to do, and it means the static check is structurally unable to
 *    report the thing a reader experiences.
 *
 * 2. Measuring an earlier stage measures the wrong image. A poster was measured on its hero
 *    composite — the state BEFORE the region duotones, the screen and the dark field were
 *    added. Every "8.4:1" reported there described a picture that was never delivered. On the
 *    delivered PNG the same zones were 3.7:1 and 3.9:1. The measurement was not wrong; the
 *    object of measurement was.
 *
 * So: zones come from the delivered image, and the numbers come from its pixels.
 *
 * THE BLIND SPOT THIS IS BUILT AROUND
 * -----------------------------------
 * The worst failure in that project's history was text that measured 80 layers "all ≥ 4.5:1"
 * — the guard was green — while the letters on screen were grey.
 *
 * The cause is a category error, and it is easy to repeat: an `outerGlow` with `blend: normal`
 * draws a dark ring OVER the strokes. It does not change the declared ink colour. It does not
 * change the ground. It changes the GLYPH. A check that compares declared ink against measured
 * ground cannot see it, because both of its inputs are untouched.
 *
 * Therefore every zone here is measured twice:
 *
 *   declared  the ink string the scene asked for, against the measured ground
 *   onscreen   the two extremes actually present in the zone's pixels, against each other
 *
 * and when the two disagree, that disagreement is the report. The tool does not need to know
 * that a glow was the cause: it reports `declared vs screen`, and a divergence is visible even
 * when the declared-ink path says everything is fine.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not judge the design. A zone can be low-contrast on purpose — a watermark, a ghosted
 * figure, type that is meant to sit just under the threshold of legibility. The tool reports
 * the ratio and the share of ground that falls below it. The decision stays with a person, and
 * the one thing this tool must never become is a rule that forces a layout to change.
 *
 * It also cannot judge what it cannot measure. Ghosted type, letterforms broken by an effect,
 * or a fold in the composition are not ratio questions. That limit is stated in the output
 * rather than hidden, because a green report from this tool means less than it looks like.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { parseColor, relativeLuminance, cssColor, toHex8 } from '../src/color.mjs'

// WCAG 2.x thresholds. Deliberately the standard ones: every value a reader can check against
// a contrast checker is one fewer number to argue about.
const OK_RATIO = 4.5
const WARN_RATIO = 4.0
const FLOOR_RATIO = 3.0          // a ground pixel below this cannot hold small type
const DIVERGENCE_FACTOR = 1.3    // screen ink this far from the declared ink is reported
const SAMPLE_STEP = 2            // every 2nd pixel, as desktop contrast checkers do

/** Space-separated integers from a comma/space separated list. */
function numbers(text, label) {
  const out = String(text).split(/[,\s]+/).filter((s) => s !== '').map(Number)
  if (out.length !== 4 || out.some((v) => !Number.isFinite(v))) {
    throw new Error(`${label} needs four numbers "x,y,w,h", got "${text}"`)
  }
  return out
}

function readJson(path) {
  const p = isAbsolute(path) ? path : resolve(process.cwd(), path)
  return JSON.parse(readFileSync(p, 'utf8'))
}

/** Minimal flag parsing; the argument surface here is four options. */
function parseArgs(argv) {
  const opts = { report: null, zones: null, draw: null, json: false, debug: false, quiet: false, image: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--report') opts.report = argv[++i]
    else if (a === '--zones') opts.zones = argv[++i]
    else if (a === '--draw') opts.draw = argv[++i]
    else if (a === '--json') opts.json = true
    else if (a === '--debug') opts.debug = true
    else if (a === '--quiet') opts.quiet = true
    else if (a === '-h' || a === '--help') opts.help = true
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else opts.image = a
  }
  return opts
}

/**
 * Zones from an explicit file, which is also where a declared ink can be stated.
 *
 * Anchored to the zone file's own directory, like every other path in this engine, so a
 * command works from any working directory.
 *
 *   [{ "label": "引文", "box": [240, 1092, 800, 104], "ink": "#E4F3FA" }]
 */
function zonesFromFile(path) {
  const { zones } = readJson(path)
  if (!Array.isArray(zones)) throw new Error(`${path} must contain { "zones": [...] }`)
  return zones.map((z, i) => ({
    label: z.label ?? `zone ${i}`,
    box: Array.isArray(z.box) ? z.box.map(Number) : numbers(z.box, `zone ${i} box`),
    ink: z.ink ?? null,
    source: 'zone file',
  }))
}

/**
 * Zones derived from the render report — the delivered image's own record of what it drew.
 *
 * This is what makes the tool universal. The zone list used to be nine hard-coded rectangles
 * belonging to one poster at one size; geometry now comes from the report, so the same command
 * works on any scene the engine rendered, at any canvas size.
 *
 * Only text layers produce zones. A declared ink is carried along when the scene asked for one,
 * because that is what makes the `declared vs screen` comparison possible.
 */
function zonesFromReport(path) {
  const raw = readJson(path)
  const report = raw.report ?? raw
  const log = Array.isArray(report.log) ? report.log : []
  const W = report.canvas?.width
  const H = report.canvas?.height
  const zones = []
  const notes = []

  for (const entry of log) {
    if (entry?.step !== 'layer' || entry.shape !== 'text') continue
    const b = entry.drawn?.block
    if (b === undefined || b === null) {
      notes.push(`${entry.id}: text layer with no drawn block — not measured`)
      continue
    }
    let ink = null
    try {
      // The report records the ink on the drawn record, so a consumer of the report can compare
      // the scene's intent against the pixels without re-reading the scene.
      const paint = entry.drawn.paint
      ink = paint === undefined || paint === null ? null : toHex8(paint)
    } catch {
      notes.push(`${entry.id}: unreadable declared ink ${JSON.stringify(entry.drawn.paint)}`)
    }
    if (entry.drawn.overflow === true) {
      notes.push(`${entry.id}: text overflowed its box — the measured region is smaller than the type`)
    }
    zones.push({
      label: entry.id,
      box: [b.x, b.y, b.w, b.h],
      ink,
      fontSize: entry.drawn.fontSize ?? null,
      families: entry.drawn.families ?? [],
      fontFallback: entry.drawn.fontFallback === true,
      source: 'render report',
    })
  }

  // Text that sits outside the canvas is clipped silently by the renderer, so a zone off the
  // edge would otherwise report "no pixels" as if the zone were empty by design.
  const inside = zones.filter((z) => {
    const [x, y, w, h] = z.box
    if (W !== undefined && (x + w <= 0 || x >= W)) return false
    if (H !== undefined && (y + h <= 0 || y >= H)) return false
    return true
  })
  const clipped = zones.length - inside.length
  if (clipped > 0) notes.push(`${clipped} text zone(s) entirely outside the canvas — not measured`)

  return { zones: inside, notes, canvas: W !== undefined && H !== undefined ? { width: W, height: H } : null }
}

/**
 * Measure one zone from the delivered pixels.
 *
 * THE METHOD, AND THE TWO IT REPLACED
 * -----------------------------------
 * Both earlier attempts failed on the first real poster, in instructive ways:
 *
 *   1. "darkest pixels vs lightest pixels" reported ordinary anti-aliased numerals at 2.5:1,
 *      because in a small text box both ends are glyph. It cried wolf on type that reads fine.
 *   2. "Otsu's split of the luminance histogram" reported the same zones at 1.5:1, because on a
 *      region containing a map it found two hill colours and called them ink and ground. A
 *      histogram split cannot tell a glyph from a landscape.
 *
 * What works is competitive assignment: two centres, every pixel votes for the nearer one, and
 * the answer is the pair of centroids. The centres are seeded, not guessed — the ground from the
 * zone's own border pixels (a text box is mostly not glyph at its edges, and the surface there is
 * the surface under the type), and the ink from the declared paint when the scene stated one,
 * otherwise the pixel furthest from that ground.
 *
 * Seeding the ink from the declaration is what makes the `declared vs screen` comparison exact:
 * the two clusters either agree with the declaration or they do not, and the size of the
 * disagreement is the finding.
 *
 * Only the two core tones are compared. Every pixel between them is an anti-aliased edge or a
 * soft effect, and judging a ratio on a blend is how a legible design gets reported as broken.
 */
export function measureZone(zone, image, debug = false) {
  const sample = sampleZone(zone, image)
  const base = { ...zone, samples: sample.samples }
  if (sample.empty) return { ...base, verdict: 'empty', note: 'no opaque pixels in this region' }
  if (sample.samples < 32) {
    return { ...base, verdict: 'unresolved', note: `only ${sample.samples} sampled pixels — too few to resolve glyph from ground` }
  }

  // ── seed the ground from the border, and the ink from the declaration if there is one ──
  const border = sample.borderPixels
  const groundSeed = border.length > 0 ? medianColor(border, image.D) : medianColor(sample.px, image.D)

  let declaredInk = null
  let declaredLuma = null
  if (zone.ink !== null && zone.ink !== undefined) {
    try {
      declaredInk = toHex8(zone.ink)
      declaredLuma = relativeLuminance(declaredInk)
    } catch { /* an unreadable ink is reported as absent rather than guessed */ }
  }

  const groundLumaSeed = relativeLuminance(groundSeed)
  let inkSeed
  if (declaredLuma !== null) {
    inkSeed = parseColor(declaredInk)
  } else {
    let best = null
    let bestD = -1
    for (const i of sample.px) {
      const d = Math.abs(lumaAt(image.D, i) - groundLumaSeed)
      if (d > bestD) { bestD = d; best = i }
    }
    inkSeed = { r: image.D[best], g: image.D[best + 1], b: image.D[best + 2] }
  }

  const clusters = twoMeans(sample.px, image.D, inkSeed, groundSeed)
  const inkCluster = clusters.a
  const groundCluster = clusters.b
  const inkShare = inkCluster.count / sample.samples

  // A glyph that is not in the picture is the failure this tool exists to catch, so it is
  // reported as such rather than being averaged into a plausible-looking number.
  if (inkShare < 0.002) {
    return {
      ...base,
      verdict: 'unresolved',
      groundHex: rgbHex(groundCluster.mean),
      note: 'the declared ink is absent from this region — no pixel comes near it',
    }
  }

  // ── the two tones, and which is the ink ─────────────────────────────────────────────────
  //
  // A stroke's tone is its CORE, not the average of the stroke and its own soft edges. Using the
  // cluster mean measured #EAF2FA type as #DBE3EB: at 44px most of a glyph's pixels are edge, so
  // the mean lands well inside the blend. For the same reason the mean cannot be used to decide
  // which class is the ink — the contaminated means put the light ink's average BELOW the dark
  // ground's, which inverted every ratio and made legible type report as failing.
  //
  // So: take each class's light tail and dark tail, and decide by the one that reaches furthest
  // from the other class. That needs no assumption about whether the design is light-on-dark or
  // dark-on-light, and it is decided on the tones that actually exist rather than on averages.
  const inkTailLight = tailColor(inkCluster.pixels, image.D, false)
  const inkTailDark = tailColor(inkCluster.pixels, image.D, true)
  const groundTailLight = tailColor(groundCluster.pixels, image.D, false)
  const groundTailDark = tailColor(groundCluster.pixels, image.D, true)

  // Whichever class reaches brighter is the light-inked one, and it gets the ground's opposite
  // end. One comparison decides the whole orientation, and it holds for light-on-dark,
  // dark-on-light, and a knocked-out tile alike.
  //
  // The comparison is on relative luminance. It was first written on channel sums, which are not
  // a luminance: #EAF2FA sums to 726 and #101821 to 73, so a light-ink design was read as
  // dark-on-light and every ratio in the report was inverted.
  const inkIsLight = relativeLuminance(inkTailLight) > relativeLuminance(groundTailLight)
  const inkCore = inkIsLight ? inkTailLight : inkTailDark
  const groundCore = inkIsLight ? groundTailDark : groundTailLight
  const inkIsDark = !inkIsLight

  const inkHex = rgbHex(inkCore)
  const groundHex = rgbHex(groundCore)
  const inkLuma = relativeLuminance(inkCore)
  const groundLuma = relativeLuminance(groundCore)
  const onscreen = ratioOf(inkLuma, groundLuma)

  // How much of the surface UNDER the type cannot hold it.
  //
  // Stated directly: of the pixels that belong to the GROUND, how many fall below the floor
  // contrast against the ink? No orientation flag, because `ratioOf` is symmetric — a symmetric
  // question cannot be inverted by a sign, which is exactly how the earlier versions of this
  // share went wrong twice.
  //
  // Two things are deliberately NOT counted:
  //   - the ink class, so a glyph is never blamed for its own tone;
  //   - the glyph's outer blend, which the ground class collects on its way out of the box. A
  //     blend pixel's contrast is low by definition and says nothing about the surface.
  const floorRatio = FLOOR_RATIO
  const nearInk = inkLuma + (groundLuma - inkLuma) * 0.2
  const pureGround = groundCluster.pixels.filter((i) => {
    const l = lumaAt(image.D, i)
    return Math.abs(l - inkLuma) >= Math.abs(nearInk - inkLuma)
  })
  const weakGroundShare = pureGround.length === 0
    ? 0
    : pureGround.filter((i) => ratioOf(inkLuma, lumaAt(image.D, i)) < floorRatio).length / pureGround.length

  // The ground a reader actually sees is the SURFACE, which is the modal tone of the ground
  // class, not its extreme. A dark halo painted around light letters — an outerGlow in a dark
  // colour, which is the failure this tool was written for — sits between the letters and the
  // field, so it is a minority tone inside the ground class while remaining exactly the thing
  // that has to be reported. Its own share of the class is reported alongside, because "12% of
  // this zone is darker than the declared field" is a finding.
  const modalGround = modalColor(groundCluster.pixels, image.D)
  const modalGroundLuma = relativeLuminance(modalGround)
  const modalGroundShare = groundCluster.pixels.length === 0
    ? 0
    : groundCluster.pixels.filter((i) => Math.abs(lumaAt(image.D, i) - modalGroundLuma) < 0.02).length / groundCluster.pixels.length

  const verdict = classify(onscreen, weakGroundShare)

  let divergence = null
  if (declaredInk !== null) {
    const factor = ratioOf(declaredLuma, inkLuma)
    // The second half of the divergence: the ink can be exactly right while the surface under it
    // is not. Compared on the modal ground, so a halo of a different tone is what shows up.
    const groundFactor = ratioOf(modalGroundLuma, groundLuma)
    divergence = {
      declaredInk,
      declaredRatio: round(ratioOf(declaredLuma, modalGroundLuma)),
      screenInk: inkHex,
      screenInkLuma: round(inkLuma),
      declaredLuma: round(declaredLuma),
      factor: round(factor),
      direction: inkLuma < declaredLuma ? 'darker on screen' : inkLuma > declaredLuma ? 'lighter on screen' : 'as declared',
      modalGround: rgbHex(modalGround),
      modalGroundShare: round(modalGroundShare),
      groundFactor: round(groundFactor),
      groundAnomaly: groundFactor >= DIVERGENCE_FACTOR,
      reads: factor < DIVERGENCE_FACTOR
        ? 'the screen shows the declared ink'
        : `the screen shows ${inkHex}, which is ${round(factor)}× off the declared ${declaredInk} (${inkLuma < declaredLuma ? 'darker' : 'lighter'} on screen)`,
    }
  }

  return {
    ...base,
    inkHex,
    groundHex,
    inkLuma,
    groundLuma,
    onscreen,
    weakGroundShare,
    inkShare,
    separation: Math.abs(inkLuma - groundLuma),
    verdict,
    divergence,
    declaredRatio: divergence === null ? null : divergence.declaredRatio,
    // The internals are behind --debug: they exist for the day a number looks wrong, and a
    // report a person reads should not carry them.
    clusterDebug: debug === true
      ? {
        ...clusters.debug,
        inkIsDark,
        inkIsLight,
        inkLuma: round(inkLuma),
        groundLuma: round(groundLuma),
        pureGround: pureGround.length,
        groundTotal: groundCluster.pixels.length,
        weak: pureGround.filter((i) => ratioOf(inkLuma, lumaAt(image.D, i)) < floorRatio).length,
      }
      : null,
    note: null,
  }
}

/** Coarse luminance histogram, for diagnosing a share that looks wrong. */
function histogram(values) {
  const bins = new Array(10).fill(0)
  for (const v of values) bins[Math.min(9, Math.max(0, Math.floor(v * 10)))]++
  return bins
}

/** Sample a zone's pixels: interior, plus the border ring used to seed the ground. */
function sampleZone(zone, image) {
  const { D, W, H } = image
  const [bx, by, bw, bh] = zone.box
  const x0 = Math.max(0, Math.floor(bx))
  const y0 = Math.max(0, Math.floor(by))
  const x1 = Math.min(W, Math.ceil(bx + bw))
  const y1 = Math.min(H, Math.ceil(by + bh))
  const px = []
  const borderPixels = []
  // The ring is proportional to the type size, so it scales with the design rather than with
  // the canvas: on small type it sits just outside the glyphs, on a large headline it is a band
  // of surrounding surface.
  const ring = Math.max(3, Math.min(12, Math.round((zone.fontSize === null || zone.fontSize === undefined ? 12 : zone.fontSize) * 0.5)))

  for (let y = y0; y < y1; y += SAMPLE_STEP) {
    for (let x = x0; x < x1; x += SAMPLE_STEP) {
      const i = (y * W + x) * 4
      if (D[i + 3] < 8) continue // fully transparent: not part of the delivered surface
      px.push(i)
      if (x - x0 < ring || x1 - 1 - x < ring || y - y0 < ring || y1 - 1 - y < ring) borderPixels.push(i)
    }
  }
  return { px, borderPixels, samples: px.length, empty: px.length === 0 }
}

/**
 * Two centres by competitive assignment, deterministic and independent of input order.
 *
 * k-means in sRGB channel space without the randomness: the seeds are supplied, so repeated runs
 * on the same file give the same numbers — which is the whole point of a measurement.
 *
 * `inkIsFirst` tracks which centre is which THROUGHOUT the iteration. Deciding it at the end by
 * comparing the final centroids back against the seeds is wrong, and was a real defect here: by
 * then each seed has been replaced by its own centroid, and the ink centroid is as far from the
 * ink seed as the design is light — so the two came back swapped, and light type on a dark field
 * was reported as 91% dark ink. The identity of a cluster is where it started, not how far it
 * moved.
 */
function twoMeans(px, D, inkSeed, groundSeed) {
  let ink = { r: inkSeed.r, g: inkSeed.g, b: inkSeed.b }
  let ground = { r: groundSeed.r, g: groundSeed.g, b: groundSeed.b }
  let inkSet = []
  let groundSet = []

  for (let iter = 0; iter < 12; iter++) {
    inkSet = []
    groundSet = []
    for (const i of px) {
      const dInk = (D[i] - ink.r) ** 2 + (D[i + 1] - ink.g) ** 2 + (D[i + 2] - ink.b) ** 2
      const dGround = (D[i] - ground.r) ** 2 + (D[i + 1] - ground.g) ** 2 + (D[i + 2] - ground.b) ** 2
      if (dInk <= dGround) inkSet.push(i)
      else groundSet.push(i)
    }
    if (inkSet.length === 0 || groundSet.length === 0) break
    const nextInk = centroid(inkSet, D)
    const nextGround = centroid(groundSet, D)
    const moved = Math.abs(nextInk.r - ink.r) + Math.abs(nextInk.g - ink.g) + Math.abs(nextInk.b - ink.b) +
      Math.abs(nextGround.r - ground.r) + Math.abs(nextGround.g - ground.g) + Math.abs(nextGround.b - ground.b)
    ink = nextInk
    ground = nextGround
    if (moved < 0.5) break
  }

  // The cluster fed by the ink seed IS the ink cluster. No size heuristic, no re-derivation: a
  // tight text box can hold more glyph than ground, so "the smaller class is the ink" would
  // invert the reading on exactly the type where it matters.
  return {
    a: { mean: ink, count: inkSet.length, pixels: inkSet },
    b: { mean: ground, count: groundSet.length, pixels: groundSet },
    debug: {
      inkSeed: rgbHex(inkSeed), groundSeed: rgbHex(groundSeed),
      inkCount: inkSet.length, groundCount: groundSet.length,
      inkMean: rgbHex(ink), groundMean: rgbHex(ground),
    },
  }
}

/**
 * The modal tone of a pixel set: the colour most of the class is actually made of.
 *
 * Binned coarse on purpose. Two adjacent codes one step apart are the same surface, and a strict
 * mode over exact 24-bit values would find a thousand colours with one pixel each in a noisy
 * photo and report noise as the mode.
 */
function modalColor(pixels, D) {
  if (pixels.length === 0) return { r: 0, g: 0, b: 0 }
  const bins = new Map()
  for (const i of pixels) {
    const key = `${D[i] >> 3},${D[i + 1] >> 3},${D[i + 2] >> 3}`
    const bin = bins.get(key)
    if (bin === undefined) bins.set(key, { n: 1, r: D[i], g: D[i + 1], b: D[i + 2] })
    else { bin.n++; bin.r += D[i]; bin.g += D[i + 1]; bin.b += D[i + 2] }
  }
  let best = null
  for (const bin of bins.values()) if (best === null || bin.n > best.n) best = bin
  return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n }
}

function centroid(offsets, D) {
  let r = 0, g = 0, b = 0
  for (const i of offsets) { r += D[i]; g += D[i + 1]; b += D[i + 2] }
  const n = Math.max(1, offsets.length)
  return { r: r / n, g: g / n, b: b / n }
}

function dist2(a, b) {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2
}

/** The median colour of a pixel set, per channel — robust to a glyph clipping the sample. */
function medianColor(offsets, D) {
  const pick = (shift) => {
    const v = offsets.map((i) => D[i + shift]).sort((a, b) => a - b)
    return v[Math.floor(v.length / 2)]
  }
  return { r: pick(0), g: pick(1), b: pick(2) }
}

function rgbHex(c) {
  const h = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0').toUpperCase()
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

/** `ok` / `warn` / `LOW` — the bands the original tool used, on the two inputs that matter. */
function classify(ratio, weakGroundShare) {
  if (ratio >= OK_RATIO && weakGroundShare < 0.10) return 'ok'
  if (ratio >= WARN_RATIO && weakGroundShare < 0.20) return 'warn'
  return 'LOW'
}

/** sRGB channel -> linear. The same curve `relativeLuminance` uses, applied to a byte. */
function lin(v) {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** Relative luminance of the pixel at offset `i`. */
function lumaAt(D, i) {
  return 0.2126 * lin(D[i]) + 0.7152 * lin(D[i + 1]) + 0.0722 * lin(D[i + 2])
}

/**
 * The representative tone of a class, taken from one end of it.
 *
 * `dark` asks for the darkest decile, which is the core of a dark stroke; otherwise the lightest
 * decile, which is the core of a light one. Callers ask both classes for both ends and then
 * decide which end is the ink — see `measureZone`.
 */
function tailColor(pixels, D, dark) {
  if (pixels.length === 0) return { r: 0, g: 0, b: 0 }
  const sorted = [...pixels].sort((a, b) => (dark ? lumaAt(D, a) - lumaAt(D, b) : lumaAt(D, b) - lumaAt(D, a)))
  const take = Math.max(1, Math.round(sorted.length * 0.1))
  return centroid(sorted.slice(0, take), D)
}

function ratioOf(a, b) {
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

function round(v) {
  return Math.round(v * 1000) / 1000
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

/** The human table. stderr, so stdout stays a single JSON object for a caller. */
function writeTable(zones, meta, quiet = false) {
  if (quiet) return
  const out = []
  out.push(`在成品上量（${meta.image}  ${meta.canvas.width}x${meta.canvas.height}）`)
  for (const z of zones) {
    const label = String(z.label).padEnd(22)
    if (z.verdict === 'empty') { out.push(`  ---- ${label} 区内没有不透明像素`); continue }
    if (z.verdict === 'unresolved') {
      out.push(`  ???? ${label} ${z.note ?? 'could not resolve glyph from ground'}${z.groundHex === undefined ? '' : `（底 ${z.groundHex}）`}`)
      continue
    }
    const flag = z.verdict === 'ok' ? 'ok  ' : z.verdict === 'warn' ? 'warn' : 'LOW '
    const div = z.divergence === null || z.divergence.factor < DIVERGENCE_FACTOR
      ? ''
      : `  ⚠ 屏幕上的墨是 ${z.divergence.screenInk}，不是声明的 ${z.divergence.declaredInk}（${z.divergence.factor}×）`
    const groundAnomaly = z.divergence === null || z.divergence.groundAnomaly !== true
      ? ''
      : `  ⚠ ${Math.round(z.divergence.modalGroundShare * 100)}% 的底是 ${z.divergence.modalGround}，比实测底子深 ${z.divergence.groundFactor}×`
    out.push(
      `  ${flag} ${label}` +
      ` 字 ${z.inkHex} 底 ${z.groundHex}` +
      `  屏幕上 ${z.onscreen.toFixed(1)}:1` +
      `  底子里撑不住的 ${Math.round(z.weakGroundShare * 100)}%` +
      `  字占 ${Math.round(z.inkShare * 100)}%` +
      (z.declaredRatio === null ? '  （无声明墨）' : `  声明 ${z.declaredRatio.toFixed(1)}:1`) +
      div + groundAnomaly,
    )
  }
  out.push('')
  out.push('屏幕上 x:1 = 区内像素暗亮两类的实测均值之比，不需要事先知道墨色，也是读者实际看到的那个数。')
  out.push('声明 x:1 = 场景里写的墨色对实测底子。两个数差得多，就是「声明的墨和屏幕上的字不是一回事」——')
  out.push('外发光、描边、混合模式都会这样：它们改的是字形，不是声明的颜色，所以按声明去比是看不见的。')
  out.push('本工具只报数，不改版面：故意压低的字是设计决定，不是缺陷。')
  process.stderr.write(out.join('\n') + '\n')
}

/** A sheet of the zones, for the one judgement the numbers cannot make. */
function drawSheet(image, zones, outPath) {
  const { D, W, H } = image
  const cv = createCanvas(W, H)
  const g = cv.getContext('2d')
  const id = g.createImageData(W, H)
  id.data.set(D)
  g.putImageData(id, 0, 0)
  g.lineWidth = 3
  g.strokeStyle = '#FF2D55'
  g.fillStyle = '#FF2D55'
  g.font = '20px sans-serif'
  for (const z of zones) {
    const [x, y, w, h] = z.box
    g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3)
    g.fillText(String(z.label).slice(0, 28), x + 4, Math.max(18, y - 5))
  }
  writeFileSync(outPath, cv.encodeSync('png'))
  process.stderr.write(`zones drawn to ${outPath}\n`)
}

/** Load a PNG into the shape `measureZone` works on. Shared with the test suite. */
export async function readImageData(path) {
  const img = await loadImage(readFileSync(path))
  const cv = createCanvas(img.width, img.height)
  const g = cv.getContext('2d')
  g.drawImage(img, 0, 0)
  return { D: g.getImageData(0, 0, img.width, img.height).data, W: img.width, H: img.height }
}

// ── entry ───────────────────────────────────────────────────────────────────
//
// Guarded, so the test suite can import `measureZone` and `readImageData` without the tool
// running its own command line — and without calling `process.exit`, which would kill the suite.
const invokedAsCommand = process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (invokedAsCommand) {
const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  process.stderr.write(
    'design check-render <png> [--report FILE.report.json] [--zones FILE.json] [--draw OUT.png] [--json] [--quiet]\n\n' +
    '  Measures the text zones of a DELIVERED image: what is under the type, what the type\n' +
    '  measures against it, and whether the ink on screen is still the ink that was declared.\n\n' +
    '  --report  zones and declared inks taken from the render report (any scene, any size)\n' +
    '  --zones   {"zones":[{"label":"...","box":[x,y,w,h],"ink":"#RRGGBB"}]}\n' +
    '  --draw    write a copy with the zones marked, to look at\n' +
    '  --json    write the machine-readable result to stdout\n' +
    '  --debug   include the clustering internals, for when a number looks wrong\n\n' +
    '  Exit status is non-zero when a zone is unreadable (LOW). `warn` is not a failure: it is\n' +
    '  the band where a person should look, and failing on it would start forcing layouts.\n',
  )
  process.exit(opts.image === null ? 1 : 0)
}
if (opts.image === null) {
  process.stderr.write('design check-render: needs a PNG path. Try --help.\n')
  process.exit(1)
}

const pngPath = isAbsolute(opts.image) ? opts.image : resolve(process.cwd(), opts.image)
const img = await loadImage(readFileSync(pngPath))
const W = img.width
const H = img.height
const cv = createCanvas(W, H)
const g2d = cv.getContext('2d')
g2d.drawImage(img, 0, 0)
const image = { D: g2d.getImageData(0, 0, W, H).data, W, H }

let zones = []
const notes = []
if (opts.zones !== null) {
  const fromZones = zonesFromFile(opts.zones)
  // A declared ink in a zone file belongs to the image it describes, so the zone file is
  // authoritative when both are given.
  zones.push(...fromZones)
  if (opts.report !== null) {
    const derived = zonesFromReport(opts.report)
    zones.push(...derived.zones.map((z) => ({ ...z, ink: null })))
    notes.push(...derived.notes)
  }
} else if (opts.report !== null) {
  const derived = zonesFromReport(opts.report)
  zones.push(...derived.zones)
  notes.push(...derived.notes)
} else {
  process.stderr.write(
    'design check-render: needs zones. Pass --report <scene>.report.json to take them from the\n' +
    'render, or --zones <file.json> to state them. There is no default zone list on purpose:\n' +
    'a hard-coded list belongs to one poster at one size, which is what this tool replaces.\n',
  )
  process.exit(1)
}

const measured = zones.map((z) => measureZone(z, image, opts.debug))

// A report written by an older engine has no declared ink on its text layers, so half the
// measurement is unavailable. That is said out loud rather than passed over: silently reporting
// only the on-screen ratio would look identical to a design that matched its own declaration.
if (measured.length > 0 && measured.every((z) => z.divergence === null)) {
  notes.push(
    'this report records no declared ink, so the declared-vs-screen half was not measured. ' +
    'Re-render to get a report that carries it: the engine now writes `paint` on each text layer.',
  )
}

const summary = {
  ok: measured.every((z) => z.verdict !== 'LOW'),
  image: pngPath,
  canvas: { width: W, height: H },
  measured: measured.length,
  counts: {
    ok: measured.filter((z) => z.verdict === 'ok').length,
    warn: measured.filter((z) => z.verdict === 'warn').length,
    low: measured.filter((z) => z.verdict === 'LOW').length,
    unresolved: measured.filter((z) => z.verdict === 'unresolved').length,
    empty: measured.filter((z) => z.verdict === 'empty').length,
  },
  divergences: measured.filter((z) => z.divergence !== null && z.divergence.factor >= DIVERGENCE_FACTOR).length,
  notes,
  // Stated in the payload, not only in the comments: a caller that reads only the JSON should
  // still learn what this measurement cannot see.
  limits: [
    'Reports ratios and shares. It does not decide whether a low ratio was intended.',
    'A glyph the tool cannot separate from its ground comes back unresolved, never as passing.',
    'Effects that break letterforms, and anything about composition, are outside what a ratio can answer.',
  ],
  zones: measured.map((z) => ({
    label: z.label,
    box: z.box,
    source: z.source,
    verdict: z.verdict,
    fontSize: z.fontSize ?? null,
    families: z.families ?? [],
    fontFallback: z.fontFallback === true,
    samples: z.samples ?? 0,
    onscreenRatio: z.onscreen === undefined ? null : round(z.onscreen),
    ink: z.inkHex ?? null,
    ground: z.groundHex ?? null,
    groundLuma: z.groundLuma === undefined ? null : round(z.groundLuma),
    weakGroundShare: z.weakGroundShare === undefined ? null : round(z.weakGroundShare),
    inkShare: z.inkShare === undefined ? null : round(z.inkShare),
    declaredInk: z.ink ?? null,
    declaredRatio: z.declaredRatio ?? null,
    divergence: z.divergence,
    clusterDebug: z.clusterDebug ?? null,
    note: z.note ?? null,
  })),
}

writeTable(measured, { image: pngPath, canvas: summary.canvas }, opts.quiet)
if (opts.draw !== null) {
  const out = isAbsolute(opts.draw) ? opts.draw : resolve(process.cwd(), opts.draw)
  drawSheet(image, measured, out)
}

if (opts.json) process.stdout.write(JSON.stringify(summary, null, 2) + '\n')

// Exit status follows the verdict, so a caller can gate on it without parsing: a `LOW` zone is
// unreadable ground, which is a defect. `warn` is deliberately not a failure — it is the band
// where a person should look, and a tool that fails on it would start forcing layouts.
process.exit(summary.ok ? 0 : 1)
}
