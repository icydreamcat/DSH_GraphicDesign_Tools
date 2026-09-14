#!/usr/bin/env node
/**
 * The design engine command line.
 *
 * This exists so the engine can be driven by any agent, in any harness, over a
 * process boundary — not only by the DSH tools that happen to wrap it. That
 * matters because the engine is the durable asset here: a plugin row can be
 * rewritten, but a CLI with a stable JSON contract stays usable.
 *
 * Every subcommand writes machine-readable JSON to stdout (one object), and
 * human commentary to stderr. That split is deliberate: a caller can parse the
 * result without the report text getting in the way, and a failure still leaves
 * a readable reason on stderr.
 *
 * Commands
 *   render   <scene.json> --out <dir>       render a scene, write PNG + report
 *   analyze  <image>                        extract a design specification
 *   verify   <scene.json|png>               check a render against its intent
 *   fonts                                   list usable families and axes
 *   ladder   [--base 16 --ratio 1.25]       print a typographic scale
 *   ramp     <color> [--steps 9]            print an OKLab colour ramp
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve, isAbsolute, basename, extname } from 'node:path'
import { parseArgs } from 'node:util'

import { registerFonts, fontFamilyReport } from '../src/fonts.mjs'
import { renderScene, readBuffer, writeBuffer } from '../src/render.mjs'
import { writePsd } from '../src/psd.mjs'
import { analyseReference } from '../src/analyze.mjs'
import { verifyScene, verifyRender, selfCritique } from '../src/verify.mjs'
import { scaleLadder } from '../src/text.mjs'
import { scaleRamp, toHex8, toOklch, contrastRatio } from '../src/color.mjs'
import { textureStats } from '../src/tone.mjs'
import { scaleScene } from '../src/scale.mjs'

// Fonts must be registered before any canvas context exists; every subcommand
// that measures or draws depends on it.
const fontState = registerFonts()

/** Emit the single JSON result object. */
function emit(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n')
}

/** Fail with a clear reason on stderr and a non-zero exit. */
function fail(message, extra) {
  process.stderr.write('design: ' + message + '\n')
  if (extra !== undefined) process.stderr.write(JSON.stringify(extra, null, 2) + '\n')
  process.exit(1)
}

/** Read a JSON file, resolving relative to cwd. */
function readJson(path) {
  const p = isAbsolute(path) ? path : resolve(process.cwd(), path)
  if (!existsSync(p)) fail(`file not found: ${p}`)
  try {
    return { data: JSON.parse(readFileSync(p, 'utf8')), path: p }
  } catch (error) {
    fail(`could not parse JSON from ${p}: ${error.message}`)
  }
}

const argv = process.argv.slice(2)
const command = argv[0]

if (command === undefined || command === '-h' || command === '--help') {
  process.stderr.write(
    'design <command> [options]\n\n' +
    '  render  <scene.json> [--out DIR] [--name FILE] [--psd]\n' +
    '  analyze <image> [--max-side N] [--cols N --rows N]\n' +
    '  verify  <scene.json> [--png FILE] [--intent FILE]\n' +
    '  critique <png> [--json]\n' +
    '  palette ops    [--kind KIND]                 # the operator vocabulary\n' +
    '  palette presets                              # the named filter library\n' +
    '  palette show   <preset> [--params JSON]      # the operator graph a preset builds\n' +
    '  palette apply  <image> <preset> [--params JSON] [--out FILE] [--graph FILE]\n' +
    '  palette run    <image> --graph FILE [--out FILE]\n' +
    '  tool    [--list | --describe NAME | <name> [args...]]   # the session tool roster\n' +
    '  fonts\n' +
    '  ladder  [--base N] [--ratio N] [--steps N]\n' +
    '  ramp    <#RRGGBB> [--steps N]\n',
  )
  process.exit(command === undefined ? 1 : 0)
}

// ── palette ─────────────────────────────────────────────────────────────────
//
// The filter vocabulary, as something a caller can inspect and use without writing
// JavaScript. Everything here is data: a preset is a named operator graph, and an
// operator is a record. `palette show` prints the graph a preset builds, so a preset is
// never a black box — and `palette apply` runs it on a PNG and reports what each step did,
// which is how a filter is checked rather than assumed.
if (command === 'palette') {
  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    options: {
      kind: { type: 'string' },
      params: { type: 'string' },
      out: { type: 'string' },
      graph: { type: 'string' },
      set: { type: 'string', multiple: true },
    },
    allowPositionals: true,
  })
  const sub = positionals[0]
  // Two ways to state parameters, because `--params '{"a":1}'` is painful and fragile in
  // every Windows shell: the quotes needed to protect JSON are the quotes the shell eats
  // first. `--set key=value` needs no quoting and covers what a caller actually does —
  // override one or two numbers — while `--params` remains for a full specification and for
  // callers that build JSON programmatically.
  const paramsOf = () => {
    const sets = {}
    for (const raw of values.set ?? []) {
      const eq = String(raw).indexOf('=')
      if (eq <= 0) fail(`--set needs key=value, got "${raw}"`)
      const key = String(raw).slice(0, eq)
      const text = String(raw).slice(eq + 1)
      // Numbers, booleans and strings are told apart here, because every preset parameter is
      // one of the three and passing "0.7" as a string would be rejected by the validator
      // with a message about finite numbers rather than about quoting.
      const num = Number(text)
      sets[key] = text === '' ? ''
        : Number.isFinite(num) ? num
          : text === 'true' ? true
            : text === 'false' ? false
              : text
    }
    if (values.params === undefined) return sets
    let parsed
    try { parsed = JSON.parse(values.params) } catch (e) {
      fail(`--params is not valid JSON: ${e.message}. On Windows the quoting is awkward — prefer --set key=value.`)
    }
    return { ...parsed, ...sets }
  }

  if (sub === 'ops' || sub === undefined) {
    // The vocabulary, grouped by family, with each operator's own parameters. Listed from
    // the implementation rather than hand-written, so it cannot go stale.
    const { POINTWISE } = await import('../src/palette.mjs')
    const { KERNEL_SHAPES } = await import('../src/kernel.mjs')
    const kinds = {
      spatial: ['sample', 'rank'],
      pointwise: Object.keys(POINTWISE),
      mixing: ['blend', 'similarityMask', 'luminanceMask'],
      source: ['solid', 'noise'],
    }
    const want = values.kind === undefined ? null : values.kind
    const out = {}
    for (const [kind, names] of Object.entries(kinds)) {
      if (want !== null && want !== kind) continue
      out[kind] = names
    }
    emit({
      ok: true,
      kinds: out,
      kernels: KERNEL_SHAPES,
      constantsOfATime: ['box', 'gaussian', 'line'],
      note:
        'A filter is a list of operators. Spatial ops take a kernel. A value-producing op ' +
        '(solid, noise) declares produces:true and does not advance the current image. ' +
        'Use `palette presets` for the named library and `palette show <preset>` for its graph.',
    })
    process.exit(0)
  }

  if (sub === 'presets') {
    const { LIBRARY, DEFAULTS } = await import('../src/presets.mjs')
    emit({
      ok: true,
      presets: Object.keys(LIBRARY).map((name) => ({
        name,
        defaults: Object.fromEntries(
          Object.entries(DEFAULTS[name] ?? {}).filter(([k]) => k !== 'range'),
        ),
        range: (DEFAULTS[name] ?? {}).range ?? null,
      })),
      note: 'Parameters keep the names and ranges their documentation uses, so a description transfers.',
    })
    process.exit(0)
  }

  if (sub === 'show') {
    const name = positionals[1]
    if (name === undefined) fail('palette show needs a preset name')
    const { build } = await import('../src/presets.mjs')
    const { describeGraph } = await import('../src/palette.mjs')
    const graph = build(name, paramsOf())
    emit({ ok: true, preset: name, graph, summary: describeGraph(graph) })
    process.exit(0)
  }

  // apply / run both need an image on disk.
  const target = positionals[1]
  if (target === undefined) fail(`palette ${sub} needs an image path`)
  const { loadImage, createCanvas } = await import('@napi-rs/canvas')
  const { run: runGraph, describeGraph } = await import('../src/palette.mjs')
  const { build } = await import('../src/presets.mjs')
  const { measure } = await import('../src/measure.mjs')

  let graph
  if (sub === 'run') {
    if (values.graph === undefined) fail('palette run needs --graph FILE')
    graph = readJson(values.graph)
    if (!Array.isArray(graph)) fail('--graph must contain a JSON array of operators')
  } else if (sub === 'apply') {
    const name = positionals[2]
    if (name === undefined) fail('palette apply needs a preset name')
    graph = build(name, paramsOf())
  } else {
    fail(`unknown palette subcommand "${sub}". Use ops, presets, show, apply or run.`)
  }

  const img = await loadImage(resolve(target))
  const canvas = createCanvas(img.width, img.height)
  canvas.getContext('2d').drawImage(img, 0, 0)
  const before = readBuffer(canvas)

  let r
  try {
    r = runGraph(before, graph)
  } catch (e) {
    fail(`palette ${sub} failed: ${e.message}`, { graph })
  }

  const outPath = values.out === undefined
    ? resolve('out', `${basename(target, extname(target))}-${sub === 'apply' ? positionals[2] : 'graph'}.png`)
    : resolve(values.out)
  mkdirSync(dirname(outPath), { recursive: true })
  const outCanvas = createCanvas(img.width, img.height)
  writeBuffer(outCanvas, r.image)
  writeFileSync(outPath, outCanvas.toBuffer('image/png'))

  emit({
    ok: true,
    image: target,
    out: outPath,
    canvas: { width: img.width, height: img.height },
    summary: describeGraph(graph),
    before: measure(before),
    after: measure(r.image),
    // Per-step, so a step that ran and changed nothing is visible rather than buried.
    steps: r.steps,
    inertSteps: r.steps.filter((s) => s.suspicious).length,
  })
  process.exit(0)
}

// ── tool ────────────────────────────────────────────────────────────────────
//
// The roster of session tools: measurement and asset scripts written across earlier sessions,
// each of which answered a real question and was then left as a loose file. The measured
// consequence was that the next session re-wrote several of them, because there was no way to
// know they existed. A tool nobody can find is a tool that gets written again, so they are
// enumerated from their own headers and run through this one entry point.
if (command === 'tool') {
  const { listTools, runTool } = await import('../src/tools-roster.mjs')
  const rest = argv.slice(1)
  if (rest.length === 0 || rest[0] === '--list' || rest[0] === '-l') {
    const roster = listTools()
    emit({
      ok: true,
      count: roster.length,
      run: 'design tool <name> [args...]   — arguments go straight to the tool',
      tools: roster.map((t) => ({ name: t.name, purpose: t.purpose, usage: t.usage })),
    })
    process.exit(0)
  }
  if (rest[0] === '--describe') {
    const want = rest[1]
    const one = want === undefined ? null : listTools().find((t) => t.name === want || t.name === `${want}.mjs`)
    if (one === undefined || one === null) fail(`no such tool "${want ?? ''}". Run \`design tool --list\`.`)
    emit({ ok: true, ...one })
    process.exit(0)
  }
  // Stdio is inherited, so each tool's own tables and progress print exactly as written.
  process.exit(await runTool(rest[0], rest.slice(1)))
}

// ── fonts ───────────────────────────────────────────────────────────────────
if (command === 'fonts') {
  const report = fontFamilyReport()
  emit({
    ok: true,
    registered: report.faces.length,
    faces: report.faces.map((f) => ({
      alias: f.alias,
      label: f.label,
      class: f.class,
      scripts: f.scripts,
      variable: f.variable,
      axes: f.axes,
      path: f.path,
    })),
    // Kept separate: these resolved from the OS and are usable, but they are
    // not guaranteed to exist on another machine, so a design that must travel
    // should stick to the curated set above.
    uncuratedSystemFamilies: report.uncuratedSystemFamilies,
  })
  process.exit(0)
}

// ── ladder ──────────────────────────────────────────────────────────────────
if (command === 'ladder') {
  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      base: { type: 'string' },
      ratio: { type: 'string' },
      steps: { type: 'string' },
    },
    allowPositionals: false,
  })
  const ladder = scaleLadder({
    base: values.base === undefined ? 16 : Number(values.base),
    ratio: values.ratio === undefined ? 1.25 : Number(values.ratio),
    steps: values.steps === undefined ? 7 : Number(values.steps),
  })
  emit({ ok: true, ladder })
  process.exit(0)
}

// ── ramp ────────────────────────────────────────────────────────────────────
if (command === 'ramp') {
  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    options: { steps: { type: 'string' } },
    allowPositionals: true,
  })
  const base = positionals[0]
  if (base === undefined) fail('ramp needs a base colour, e.g. `design ramp "#8CA33C"`')
  const steps = values.steps === undefined ? 9 : Number(values.steps)
  const ramp = scaleRamp(base, { steps })
  emit({
    ok: true,
    base,
    baseOklch: toOklch(base),
    steps: ramp.map((hex, i) => ({
      step: i,
      hex,
      oklch: toOklch(hex),
      contrastOnWhite: Number(contrastRatio(hex, '#FFFFFF').toFixed(2)),
      contrastOnBlack: Number(contrastRatio(hex, '#000000').toFixed(2)),
    })),
  })
  process.exit(0)
}

// ── analyze ─────────────────────────────────────────────────────────────────
if (command === 'analyze') {
  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    options: {
      'max-side': { type: 'string' },
      cols: { type: 'string' },
      rows: { type: 'string' },
      bins: { type: 'string' },
    },
    allowPositionals: true,
  })
  const target = positionals[0]
  if (target === undefined) fail('analyze needs an image path')
  const result = await analyseReference(target, {
    maxSide: values['max-side'] === undefined ? undefined : Number(values['max-side']),
    cols: values.cols === undefined ? undefined : Number(values.cols),
    rows: values.rows === undefined ? undefined : Number(values.rows),
    bins: values.bins === undefined ? undefined : Number(values.bins),
  })
  emit({ ok: true, ...result })
  process.exit(0)
}

// ── render ──────────────────────────────────────────────────────────────────
if (command === 'render') {
  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    options: {
      out: { type: 'string' },
      name: { type: 'string' },
      scale: { type: 'string' },
      psd: { type: 'boolean' },
    },
    allowPositionals: true,
  })
  const scenePath = positionals[0]
  if (scenePath === undefined) fail('render needs a scene JSON path')

  const { data: scene, path: resolvedScene } = readJson(scenePath)
  const outDir = isAbsolute(values.out === undefined ? 'out' : values.out)
    ? values.out
    : resolve(process.cwd(), values.out === undefined ? 'out' : values.out)
  mkdirSync(outDir, { recursive: true })

  const name = values.name === undefined ? basename(resolvedScene).replace(/\.json$/i, '') : values.name

  // Scale the whole scene by rewriting the canvas and any absolute lengths. The
  // rewrite lives in src/scale.mjs so it can be unit-tested directly — see that
  // module for the double-scaling defect this used to carry.
  if (values.scale !== undefined) {
    const s = Number(values.scale)
    if (!(s > 0)) fail(`--scale must be positive, got ${values.scale}`)
    scaleScene(scene, s)
  }

  const t0 = Date.now()
  const wantsPsd = values.psd === true
  const { canvas, report, layers: captured } = await renderScene(scene, {
    baseDir: dirname(resolvedScene),
    // Captured in the same pass that composites them, so the delivered layers
    // cannot disagree with the delivered PNG.
    captureLayers: wantsPsd,
  })
  const elapsed = Date.now() - t0

  const pngPath = join(outDir, `${name}.png`)
  writeFileSync(pngPath, canvas.encodeSync('png'))

  const verification = verifyScene(scene)

  let psdPath = null
  let psdInfo = null
  if (wantsPsd) {
    // Written by the engine, not by Photoshop. Layered delivery used to be the
    // one thing that required the application; writing the container directly
    // removes that dependency, and with it the risk that delivery depends on a
    // process that may not start.
    psdPath = join(outDir, `${name}.psd`)
    const composite = readBuffer(canvas)
    const bytes = writePsd({
      width: report.canvas.width,
      height: report.canvas.height,
      layers: captured === null ? [] : captured,
      composite,
    })
    writeFileSync(psdPath, bytes)
    psdInfo = {
      path: psdPath,
      bytes: bytes.length,
      layerCount: captured === null ? 0 : captured.length,
      layerNames: captured === null ? [] : captured.map((l) => l.name),
    }
  }

  // Also write the report beside the image so a later step can diff two
  // iterations without re-rendering.
  const reportPath = join(outDir, `${name}.report.json`)
  writeFileSync(reportPath, JSON.stringify({ report, verification }, null, 2))

  process.stderr.write(
    `rendered ${report.canvas.width}x${report.canvas.height} in ${elapsed}ms · ` +
    `${report.layerCount} layers · texture frequency ${report.stats.frequency.toFixed(4)} / ` +
    `contrast ${report.stats.contrast.toFixed(4)}\n` +
    (report.warnings.length > 0 ? `warnings:\n  ${report.warnings.join('\n  ')}\n` : '') +
    (verification.issues.length > 0 ? `design issues:\n  ${verification.issues.map((i) => i.message).join('\n  ')}\n` : ''),
  )

  emit({
    ok: true,
    png: pngPath,
    report: reportPath,
    psd: psdPath,
    psdInfo,
    elapsedMs: elapsed,
    canvas: report.canvas,
    layerCount: report.layerCount,
    warnings: report.warnings,
    stats: report.stats,
    verification,
  })
  process.exit(0)
}

// ── verify ──────────────────────────────────────────────────────────────────
if (command === 'verify') {
  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    options: { png: { type: 'string' }, intent: { type: 'string' } },
    allowPositionals: true,
  })
  const target = positionals[0]
  if (target === undefined) fail('verify needs a scene JSON path')

  const { data: scene } = readJson(target)
  const sceneCheck = verifyScene(scene)

  let renderCheck = null
  if (values.png !== undefined) {
    const analysis = await analyseReference(values.png, { maxSide: 1400 })
    renderCheck = verifyRender(analysis, sceneCheck.spec)
  }

  let intentCheck = null
  if (values.intent !== undefined) {
    const { data: intent } = readJson(values.intent)
    intentCheck = { intent, notes: 'Intent is compared by the agent, not automatically.' }
  }

  emit({ ok: sceneCheck.issues.filter((i) => i.severity === 'error').length === 0, scene: sceneCheck, render: renderCheck, intent: intentCheck })
  process.exit(0)
}

// ── critique ────────────────────────────────────────────────────────────────
if (command === 'critique') {
  const { positionals } = parseArgs({ args: argv.slice(1), options: {}, allowPositionals: true })
  const target = positionals[0]
  if (target === undefined) fail('critique needs a PNG path')
  const analysis = await analyseReference(target, { maxSide: 1400 })
  const critique = selfCritique(analysis)
  process.stderr.write(critique.summary + '\n')
  emit({ ok: true, critique, analysis })
  process.exit(0)
}

fail(`unknown command "${command}". Run with --help for the list.`)
