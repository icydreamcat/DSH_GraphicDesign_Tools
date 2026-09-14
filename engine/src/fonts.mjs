/**
 * Font registry for the design engine.
 *
 * Deliberately placed at the entry point: `@napi-rs/canvas` ships its own Skia
 * build, so the fonts it can see are NOT the fonts the OS reports — they are
 * whatever Skia's font manager resolved at process start, plus anything
 * registered here. A font that exists on disk but was never registered is
 * silently substituted, which is exactly the class of failure that produces a
 * design that measures wrong and lays out wrong.
 *
 * Two consequences drive this module:
 *
 *   1. Registration must happen BEFORE any canvas context or `measureText`
 *      call is trusted. `registerFonts()` is called from the entry point, and
 *      nothing else in the engine may be imported and used without it.
 *
 *   2. Variable fonts need `fontVariationSettings` to be useful. Skia ignores
 *      the numeric weight token in the `font` shorthand for a variable face
 *      (`font = '900 48px NotoSC'` and `font = '400 48px NotoSC'` measure
 *      identically — verified), so weight must be pushed through the `wght`
 *      axis explicitly. `styleFor()` returns both halves together so a caller
 *      cannot set one and forget the other.
 *
 * A family may be the same face at several weights. Those are tracked as one
 * entry with an `axes` description, not as several entries, because the point
 * of the registry is to answer "what can I actually set", not "what files are
 * on disk".
 */

import { GlobalFonts } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Windows font directories, in precedence order. */
function fontDirs() {
  const dirs = []
  const win = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows'
  dirs.push(join(win, 'Fonts'))
  if (process.env.LOCALAPPDATA) {
    dirs.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'))
  }
  return dirs
}

/**
 * The curated face set.
 *
 * `file` is resolved against the font directories. `alias` is the family name
 * the renderer will use — deliberately short and collision-free, because the
 * OS name is often repeated ("Source Han Sans SC" ships seven files that all
 * report the same family and are distinguishable only by file).
 *
 * `axes` describes what `fontVariationSettings` can drive. A static face
 * declares `null` and is selected by file, not by axis: picking the right
 * static file IS the weight choice, and pretending an axis exists would
 * silently render the default weight.
 */
const FACES = [
  // ── CJK: the workhorses ────────────────────────────────────────────────
  {
    alias: 'SansSC',
    file: 'NotoSansSC-VF.ttf',
    label: 'Noto Sans SC (variable)',
    class: 'sans',
    scripts: ['hans', 'latn'],
    axes: { wght: [100, 900], default: 100 },
  },
  {
    alias: 'SerifSC',
    file: 'NotoSerifSC-VF.ttf',
    label: 'Noto Serif SC (variable)',
    class: 'serif',
    scripts: ['hans', 'latn'],
    axes: { wght: [200, 900], default: 200 },
  },
  {
    alias: 'MiSans',
    file: 'MiSans-Regular.otf',
    label: 'MiSans Regular',
    class: 'sans',
    scripts: ['hans', 'latn'],
    axes: null,
  },
  {
    alias: 'HanSansMedium',
    file: 'SourceHanSansSC-Medium-2.otf',
    label: 'Source Han Sans SC Medium',
    class: 'sans',
    scripts: ['hans', 'latn'],
    axes: null,
  },
  {
    alias: 'HanSansBold',
    file: 'SourceHanSansSC-Bold-2.otf',
    label: 'Source Han Sans SC Bold',
    class: 'sans',
    scripts: ['hans', 'latn'],
    axes: null,
  },
  {
    alias: 'PuHuiTiLight',
    file: 'AlibabaPuHuiTi-3-45-Light.ttf',
    label: 'Alibaba PuHuiTi 3.45 Light',
    class: 'sans',
    scripts: ['hans', 'latn'],
    axes: null,
  },
  {
    alias: 'SimHei',
    file: 'simhei.ttf',
    label: 'SimHei (黑体)',
    class: 'sans',
    scripts: ['hans'],
    axes: null,
  },
  {
    alias: 'DengXian',
    file: 'Deng.ttf',
    label: 'DengXian Regular (等线)',
    class: 'sans',
    scripts: ['hans'],
    axes: null,
  },
  {
    alias: 'DengXianLight',
    file: 'Dengl.ttf',
    label: 'DengXian Light (等线 Light)',
    class: 'sans',
    scripts: ['hans'],
    axes: null,
  },
  {
    alias: 'SongTi',
    file: 'simsun.ttc',
    label: 'SimSun (宋体) — display serif',
    class: 'serif',
    scripts: ['hans'],
    axes: null,
  },
  {
    alias: 'SongTiBold',
    file: 'simsunb.ttf',
    label: 'SimSun Bold — display serif heavy',
    class: 'serif',
    scripts: ['hans'],
    axes: null,
  },

  // ── Latin: display and editorial ──────────────────────────────────────
  //
  // Bahnschrift declares ONLY `wdth` here even though the face advertises a
  // `wght` axis too. That axis was tested and does NOT respond through
  // `fontVariationSettings` in this Skia build — 300 and 700 measured
  // byte-identical — so claiming it would promise a weight the renderer cannot
  // deliver. The width axis does work, and a condensed/regular pair is the
  // more useful display tool anyway. Weight variety for Latin comes from the
  // static families below instead, where it is certain.
  {
    alias: 'Grotesk',
    file: 'bahnschrift.ttf',
    label: 'Bahnschrift (variable wdth only) — DIN-lineage grotesque',
    class: 'grotesque',
    scripts: ['latn'],
    axes: { wdth: [75, 100], default: 100 },
  },
  {
    alias: 'Neue',
    file: 'segoeui.ttf',
    label: 'Segoe UI Regular',
    class: 'humanist',
    scripts: ['latn', 'hans'],
    axes: null,
  },
  {
    alias: 'NeueLight',
    file: 'segoeuil.ttf',
    label: 'Segoe UI Light',
    class: 'humanist',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'NeueSemilight',
    file: 'segoeuisl.ttf',
    label: 'Segoe UI Semilight',
    class: 'humanist',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'NeueBold',
    file: 'segoeuib.ttf',
    label: 'Segoe UI Bold',
    class: 'humanist',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'NeueBlack',
    file: 'segoeuiz.ttf',
    label: 'Segoe UI Black',
    class: 'humanist',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'Journal',
    file: 'georgia.ttf',
    label: 'Georgia — editorial serif',
    class: 'serif',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'JournalItalic',
    file: 'georgiai.ttf',
    label: 'Georgia Italic',
    class: 'serif',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'JournalBold',
    file: 'georgiab.ttf',
    label: 'Georgia Bold',
    class: 'serif',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'Bookface',
    file: 'BOOKOS.ttf',
    label: 'Bookman Old Style — bookish serif',
    class: 'serif',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'Antiqua',
    file: 'times.ttf',
    label: 'Times New Roman',
    class: 'serif',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'Calibri',
    file: 'calibri.ttf',
    label: 'Calibri Regular — humanist sans',
    class: 'humanist',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'CalibriLight',
    file: 'calibril.ttf',
    label: 'Calibri Light',
    class: 'humanist',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'GroteskStatic',
    file: 'arial.ttf',
    label: 'Arial Regular — neutral grotesque',
    class: 'grotesque',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'GroteskStaticBold',
    file: 'arialbd.ttf',
    label: 'Arial Bold',
    class: 'grotesque',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'Verdana',
    file: 'verdana.ttf',
    label: 'Verdana — wide, high-legibility sans',
    class: 'humanist',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'Mono',
    file: 'consola.ttf',
    label: 'Consolas — monospaced',
    class: 'mono',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'MonoTech',
    file: 'CascadiaMono.ttf',
    label: 'Cascadia Mono — technical monospaced',
    class: 'mono',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'Code',
    file: 'CascadiaCode.ttf',
    label: 'Cascadia Code — monospaced with ligatures',
    class: 'mono',
    scripts: ['latn'],
    axes: null,
  },
  {
    alias: 'AntiqueDisplay',
    file: 'dingliesongtypeface20241217-2.ttf',
    label: 'Dinglie Song — display CJK serif (poster weight)',
    class: 'display',
    scripts: ['hans'],
    axes: null,
  },
]

/** alias -> resolved entry, populated by registerFonts(). */
const registry = new Map()

/** Family names Skia knew about before we registered anything. */
let systemFamilies = []

/**
 * Register every face that exists on this machine.
 *
 * A missing file is not an error: the face set is curated for a typical Adobe
 * workstation and a given machine legitimately lacks some of it. What would be
 * an error is reporting a face as available when it failed to register — so
 * the returned `missing` list is what callers must consult before using a
 * family, and `fontFamilyReport()` is the tool surface for it.
 *
 * @returns {{registered: string[], missing: string[], systemFamilies: string[]}}
 */
export function registerFonts() {
  const dirs = fontDirs()
  const registered = []
  const missing = []

  for (const face of FACES) {
    let hit = null
    for (const dir of dirs) {
      const candidate = join(dir, face.file)
      if (existsSync(candidate)) {
        hit = candidate
        break
      }
    }
    if (hit === null) {
      missing.push(`${face.alias} (${face.file})`)
      continue
    }
    try {
      const key = GlobalFonts.registerFromPath(hit, face.alias)
      if (key === null) {
        missing.push(`${face.alias} (${face.file}: register returned null)`)
        continue
      }
      // Fill in the real family/styles Skia resolved, so a report can show
      // whether the alias landed as intended rather than assuming it did.
      const resolved = GlobalFonts.families.find((f) => f.family === face.alias)
      registry.set(face.alias, {
        ...face,
        path: hit,
        typefaceId: key.typefaceId,
        resolvedStyles: resolved === undefined ? [] : resolved.styles,
      })
      registered.push(face.alias)
    } catch (error) {
      missing.push(`${face.alias} (${face.file}: ${error.message})`)
    }
  }

  systemFamilies = GlobalFonts.families.map((f) => f.family)
  return { registered, missing, systemFamilies }
}

/**
 * Ensure fonts are registered before a lookup can fail.
 *
 * WHY THIS EXISTS
 * ---------------
 * Registration used to be the ENTRY POINT's job: `bin/design.mjs` called
 * `registerFonts()` and the library did not. Anything reaching `renderScene`
 * directly — a test harness, another module, a future embedding — therefore had an
 * empty registry, and EVERY text layer failed with "none of the requested families
 * exist". That is a total silent failure of all typography on one code path and
 * perfect behaviour on another, which is the worst shape a defect can take: the CLI
 * looked right, so the difference was invisible from outside.
 *
 * Registering lazily at the first lookup removes the requirement rather than
 * documenting it. Idempotent, and free after the first call.
 */
let registrationAttempted = false
function ensureRegistered() {
  if (registrationAttempted) return
  registrationAttempted = true
  registerFonts()
}

/**
 * Whether a family can actually be set.
 *
 * @param {string} alias
 * @returns {boolean}
 */
export function hasFace(alias) {
  ensureRegistered()
  return registry.has(alias)
}

/**
 * Look up a registered face. Throws on an unknown alias rather than falling
 * back, because a silent fallback is how a design ends up in the wrong
 * typeface with every measurement still looking plausible.
 *
 * @param {string} alias
 * @returns {object}
 */
export function face(alias) {
  ensureRegistered()
  const hit = registry.get(alias)
  if (hit === undefined) {
    const known = [...registry.keys()].join(', ')
    throw new Error(
      `unknown font family "${alias}". Registered: ${known}. ` +
        `Call the font report tool for the full list with availability.`,
    )
  }
  return hit
}

/**
 * Build a CSS font shorthand plus the matching variation settings.
 *
 * Returned as a pair because they are not independently correct: for a
 * variable face the shorthand's weight token does nothing and the axis does
 * everything, while for a static face the axis does nothing and the file is
 * the weight. Returning `{font, variationSettings}` means a caller cannot
 * apply half of it.
 *
 * `wght` is clamped to the face's real axis range — asking a 100–900 face for
 * 1200 should render at 900 and be visible in the returned `clamped` field,
 * not silently produce Skia's own idea of "too heavy".
 *
 * @param {string} alias
 * @param {{size: number, weight?: number, width?: number, italic?: boolean}} spec
 * @returns {{font: string, variationSettings: string, clamped: string[]}}
 */
export function styleFor(alias, spec) {
  const f = face(alias)
  const size = spec.size
  if (typeof size !== 'number' || !(size > 0)) {
    throw new Error(`styleFor(${alias}): size must be a positive number, got ${size}`)
  }
  const clamped = []
  const axes = []
  let shorthandWeight = ''

  if (f.axes !== null && f.axes.wght !== undefined) {
    const requested = spec.weight === undefined ? f.axes.default : spec.weight
    const [lo, hi] = f.axes.wght
    const used = Math.min(hi, Math.max(lo, requested))
    if (used !== requested) clamped.push(`wght ${requested}->${used}`)
    axes.push(`"wght" ${used}`)
  } else if (spec.weight !== undefined) {
    // Static face: the weight token selects among the aliases the caller
    // should have registered separately. It is passed through so that a
    // static family registered under one alias still resolves its bold.
    shorthandWeight = `${spec.weight} `
  }

  if (f.axes !== null && f.axes.wdth !== undefined && spec.width !== undefined) {
    const [lo, hi] = f.axes.wdth
    const used = Math.min(hi, Math.max(lo, spec.width))
    if (used !== spec.width) clamped.push(`wdth ${spec.width}->${used}`)
    axes.push(`"wdth" ${used}`)
  }

  const style = spec.italic === true ? 'italic ' : ''
  return {
    font: `${style}${shorthandWeight}${size}px "${alias}"`,
    variationSettings: axes.length === 0 ? 'normal' : axes.join(', '),
    clamped,
  }
}

/**
 * A full report of what the renderer can set, for the font tool.
 *
 * @returns {object}
 */
export function fontFamilyReport() {
  const faces = [...registry.values()].map((f) => ({
    alias: f.alias,
    label: f.label,
    class: f.class,
    scripts: f.scripts,
    path: f.path,
    variable: f.axes !== null,
    axes: f.axes,
  }))
  // Families Skia resolved on its own are usable too, but they are not
  // guaranteed to exist on another machine — reported separately so a design
  // that must travel can stick to the curated set.
  const curated = new Set(faces.map((f) => f.alias))
  return {
    faces,
    uncuratedSystemFamilies: systemFamilies.filter((n) => !curated.has(n)).sort(),
  }
}
