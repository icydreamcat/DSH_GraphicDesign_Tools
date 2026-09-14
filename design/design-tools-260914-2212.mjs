/**
 * The design engine, as model-facing tools.
 *
 * HOW THIS FILE IS SHAPED, AND WHY
 * --------------------------------
 * Every tool here is a thin wrapper over `bin/design.mjs`: it builds an argv, runs the
 * engine, and returns the engine's own JSON. No tool reimplements any part of the engine,
 * so the CLI and the tool surface cannot disagree about what a command does — which is the
 * failure mode a second implementation always eventually produces.
 *
 * THE ONE THING THAT MUST BE RIGHT: `tools.register()` DOES NOT COMPILE `parameters`
 * ---------------------------------------------------------------------------------
 * A tool must hand the registry an ALREADY-COMPILED JSON Schema. The built-in tool packages
 * look like they pass a bare literal, but they wrap it in `defineTool({...})`, and
 * `defineTool` is what performs the compilation. `register()` stores the definition verbatim
 * and the provider then validates it, so a raw parameter spec arrives at the API as
 * `{"image":{…}}` with no `type` — and the API rejects it with
 *
 *   schema must be a JSON Schema of 'type: "object"', got 'type: null'
 *
 * That message is misleading: the declaration is correct, and it is the missing compilation
 * step that produces the null. It cost several sessions to find, so `compileParameters`
 * below does the work `defineTool` would have done. It cannot be imported: Node resolves
 * bare specifiers by walking parent `node_modules` from the PRESET's location, and the
 * preset sits in a user root with no package tree above it.
 *
 * `name` and `inject` are exported because the composition row declares them.
 */
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { spawn } from 'node:child_process'

export const inject = ['tools']

export const name = 'design-tools'

/**
 * Where the engine lives, in order of precedence:
 *
 *   1. the composition row's `config.engineDir` — the normal path;
 *   2. `DSH_DESIGN_ENGINE` — for a clone that does not sit at the path baked in below,
 *      which is every clone except the machine this was written on;
 *   3. DEFAULT_ENGINE — the path on the machine of origin.
 *
 * WHY (2) EXISTS
 * --------------
 * `engineDir` is the composition's only absolute path and therefore the one thing that
 * breaks when the repository moves. That was fine while there was exactly one checkout;
 * it stops being fine the moment the repository is cloned anywhere else, because the
 * failure is a mount-time throw naming a directory the reader has never heard of.
 *
 * The engine cannot be located relative to `baseUrl` instead: the preset is deployed OUT
 * of the repository into `$DSH_HOME/.agent-presets/design/`, so its own directory says
 * nothing about where the repository was cloned. The override is what closes that gap,
 * and `deploy-preset.mjs --engine <path>` prints the exact line to set.
 *
 * A row that lost its config would otherwise throw from a directory check with no hint of
 * what to repair; with a plausible default here, the error names `engineDir` explicitly.
 */
const DEFAULT_ENGINE = 'D:\\DSH_GDT\\DSH_GraphicDesign_Tools\\engine'

/**
 * Run the engine CLI and parse its JSON.
 *
 * stderr is returned alongside the result rather than discarded: the engine writes its
 * human-readable diagnosis there and its JSON on stdout, and a caller debugging a render
 * needs both. A non-zero exit is reported as `engineExit` instead of thrown, because a
 * partially failed render still produces useful measurements for the layers that did draw.
 */
function runEngine(engineDir, argv, options = {}) {
  return new Promise((resolveCall, rejectCall) => {
    const child = spawn(process.execPath, [resolve(engineDir, 'bin', 'design.mjs'), ...argv], {
      cwd: engineDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const fail = (e) => { if (!settled) { settled = true; rejectCall(e) } }
    if (options.signal !== undefined) {
      if (options.signal.aborted) { child.kill(); return fail(new Error('design engine call was cancelled')) }
      options.signal.addEventListener('abort', () => {
        child.kill()
        fail(new Error('design engine call was cancelled'))
      }, { once: true })
    }
    child.stdout.on('data', (b) => { stdout += b.toString('utf8') })
    child.stderr.on('data', (b) => { stderr += b.toString('utf8') })
    child.on('error', (e) => fail(new Error(`could not start the design engine: ${e.message}`)))
    child.on('close', (code) => {
      if (settled) return
      settled = true
      let parsed = null
      try { parsed = JSON.parse(stdout) } catch {
        return rejectCall(new Error(
          `the design engine did not return JSON (exit ${code}).\n` +
          `stdout: ${stdout.slice(0, 600)}\nstderr: ${stderr.slice(0, 600)}`,
        ))
      }
      resolveCall({ result: { ...parsed, engineExit: code }, stderr: stderr.trim() })
    })
  })
}

/** Run PowerShell, for the Photoshop bridge. */
function runPowerShell(argv, timeoutMs, signal) {
  return new Promise((resolveCall, rejectCall) => {
    const child = spawn('pwsh', ['-NoProfile', '-File', ...argv], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value) } }
    const timer = setTimeout(() => {
      child.kill()
      finish(rejectCall, new Error(`Photoshop bridge timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)
    if (signal !== undefined) {
      if (signal.aborted) { child.kill(); finish(rejectCall, new Error('cancelled')) }
      else signal.addEventListener('abort', () => { child.kill(); finish(rejectCall, new Error('cancelled')) }, { once: true })
    }
    child.stdout.on('data', (b) => { stdout += b.toString('utf8') })
    child.stderr.on('data', (b) => { stderr += b.toString('utf8') })
    child.on('error', (e) => finish(rejectCall, new Error(`could not start PowerShell: ${e.message}`)))
    child.on('close', () => finish(resolveCall, { stdout, stderr }))
  })
}

/**
 * Compile a ParameterSchemaSpec into the JSON Schema the provider requires.
 *
 * The spec form is `{ argName: { type, required?, enum?, description? } }`; the output form
 * is `{ type: 'object', properties: {...}, required: [...] }`. See the header for why this
 * cannot be left to `defineTool` here.
 */
function compileParameters(spec) {
  const properties = {}
  const required = []
  for (const [key, def] of Object.entries(spec)) {
    const prop = { type: def.type }
    if (def.description !== undefined) prop.description = def.description
    if (def.enum !== undefined) prop.enum = [...def.enum]
    if (def.items !== undefined) prop.items = def.items
    properties[key] = prop
    if (def.required === true) required.push(key)
  }
  const schema = { type: 'object', properties }
  if (required.length > 0) schema.required = required
  return schema
}

/**
 * The output contract every tool states: a schema, and the text the model reads.
 *
 * The registry requires BOTH. Declaring only `schema` fails the mount with "must declare
 * output { schema, render, presentationMeta? }" rather than defaulting, so every tool states
 * both explicitly.
 */
function textOutput() {
  return {
    schema: { type: 'object', additionalProperties: true, properties: {} },
    render(_args, value) {
      return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
  }
}

/** Resolve a path the caller gave, against the session's working directory. */
const here = (p) => (isAbsolute(String(p)) ? String(p) : resolve(process.cwd(), String(p)))

export function apply(ctx, config) {
  const configured = config !== undefined && typeof config.engineDir === 'string'
    ? config.engineDir
    : undefined
  const fromEnv = typeof process.env.DSH_DESIGN_ENGINE === 'string' && process.env.DSH_DESIGN_ENGINE.trim() !== ''
    ? process.env.DSH_DESIGN_ENGINE.trim()
    : undefined
  const engineDir = configured ?? fromEnv ?? DEFAULT_ENGINE
  if (!existsSync(engineDir)) {
    throw new Error(
      `design-tools: engine directory does not exist: ${engineDir}. ` +
      `Fix this row's config.engineDir in agent.cordis.yml, or set DSH_DESIGN_ENGINE ` +
      `to the engine directory of your checkout ` +
      `(resolved from: ${configured !== undefined ? 'config.engineDir' : fromEnv !== undefined ? 'DSH_DESIGN_ENGINE' : 'the built-in default'}).`,
    )
  }

  // ── design_render ───────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'design_render',
    description:
      'Render a scene JSON to PNG at full resolution and return its measurements.\n\n' +
      'This is the primary way to make a design. A scene is declarative: a canvas, a ground, and a stack of layers ' +
      '(rect, ellipse, line, polygon, path, text, image, group, adjustment). Lengths at or below 1 are fractions of the ' +
      'canvas; above 1 they are pixels — a value just above 1 is therefore ONE POINT SOMETHING PIXELS, so a width meant ' +
      'to bleed past the edge must be written in pixels.\n\n' +
      'A line is drawn from (x1, y1) to (x2, y2) and does NOT use x/y. Writing a horizontal rule as {x, y, x2, y2} draws a ' +
      'diagonal from the canvas corner instead, and that mistake is now refused rather than tolerated.\n\n' +
      'A layer supports opacity, any of 16 blend modes, a mask, and effects. The vocabulary is: ten layer effects ' +
      '(dropShadow, outerGlow, innerShadow, innerGlow, stroke, colorOverlay, gradientOverlay, patternOverlay, bevel, ' +
      'satin) which read the layer\'s own alpha; five filters (gaussian, motion, radial, box, lens) whose cost is flat in ' +
      'radius; and the tone operators. Any effect may carry a `scope` — a region confining where it acts, which is how a ' +
      'treatment is kept off a face; and any effect may be replaced by `{ graph: [...] }`, a palette operator chain (see ' +
      'design_palette).\n\n' +
      'A shape also supports a shape-level `tone` array which runs over that shape\'s own box; that is how a dot screen is ' +
      'confined to the mark that generated it rather than spilling across the canvas.\n\n' +
      'The result carries the render report: per-layer geometry as actually drawn, whether any text overflowed, which font ' +
      'families were used and whether a silent fallback occurred, mask retention, halftone dot counts and coverage, and ' +
      'whole-image texture statistics. Design-level issues come back separately under `verification`, by severity.\n\n' +
      'READ THE WARNINGS. A layer that fails records why and is skipped; the render still returns measurements for the ' +
      'rest, which is useful but means a clean-looking report can be missing a layer entirely.\n\n' +
      'Iterate: render, read `verification`, fix the scene, render again. A full-resolution poster renders in about a ' +
      'second, so several rounds are cheap and expected. Always look at the output image before declaring a design ' +
      'finished — measurements catch what numbers can catch, not what only an eye can.',
    parameters: compileParameters({
      scene: { required: true, type: 'string', description: 'Path to the scene JSON, relative to the working directory or absolute.' },
      out: { type: 'string', description: 'Output directory. Defaults to `out` beside the scene.' },
      name: { type: 'string', description: 'Base filename for the PNG and report. Defaults to the scene filename.' },
      scale: { type: 'number', description: 'Multiply the whole canvas by this factor, e.g. 0.3 for a fast draft. Fractional lengths are scale-invariant, so only absolute ones are rewritten.' },
    }),
    output: textOutput(),
    async execute(args, exec) {
      const argv = ['render', here(args.scene)]
      if (args.out !== undefined) argv.push('--out', String(args.out))
      if (args.name !== undefined) argv.push('--name', String(args.name))
      if (args.scale !== undefined) argv.push('--scale', String(args.scale))
      const { result, stderr } = await runEngine(engineDir, argv, {
        signal: exec === undefined ? undefined : exec.signal,
      })
      return { ...result, engineNotes: stderr }
    },
  })

  // ── design_analyze ──────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'design_analyze',
    description:
      'Measure a reference image and return it as a SPECIFICATION rather than a description.\n\n' +
      'Use this before designing from a reference. It converts a picture into numbers that can be acted on: ground ' +
      'luminance and hex; the luminance band holding most of the image; accent share reported BOTH as every chromatic ' +
      'pixel and as the subset belonging to large flat fills — the second is the number an accent budget is actually ' +
      'about, because an illustrated reference is legitimately chromatic throughout its artwork while its designed ' +
      'accent is a few percent; a luminance histogram; the detected layout grid pitch in pixels with a confidence score; ' +
      'connected-region geometry; stroke weights; and a spatial detail map.\n\n' +
      'A grid pitch of null means no grid was detected, which is a finding rather than a failure: it says the reference ' +
      'does not use one at the measured scale. Compare `share` against `flatShare` before concluding anything about ' +
      'colour: a high share with a low flatShare is an illustration, not a loud palette.',
    parameters: compileParameters({
      image: { required: true, type: 'string', description: 'Path to the reference image (PNG, JPEG, WebP).' },
      maxSide: { type: 'number', description: 'Downscale the longest side to this before measuring. Default 1600, which still resolves a 24px grid.' },
      cols: { type: 'number', description: 'Spatial grid columns. Default 8.' },
      rows: { type: 'number', description: 'Spatial grid rows. Default 5.' },
    }),
    output: textOutput(),
    async execute(args, exec) {
      const argv = ['analyze', here(args.image)]
      if (args.maxSide !== undefined) argv.push('--max-side', String(args.maxSide))
      if (args.cols !== undefined) argv.push('--cols', String(args.cols))
      if (args.rows !== undefined) argv.push('--rows', String(args.rows))
      const { result, stderr } = await runEngine(engineDir, argv, {
        signal: exec === undefined ? undefined : exec.signal,
      })
      return { ...result, engineNotes: stderr }
    },
  })

  // ── design_critique ─────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'design_critique',
    description:
      'Answer the four design questions from a finished image, with measurements.\n\n' +
      'Run this on your OWN render before showing it to anyone. It reports: whether the focus is unique (more than one ' +
      'competing focus is the most common way a page reads as unfinished); whether the composition still carries its ' +
      'information if half the elements go; whether the detail level is spread or clumped; and whether the accent share ' +
      'is inside a sane budget.\n\n' +
      'Two of the four are answered outright and two come back as questions with the numbers attached, because they need ' +
      'a judgement the tool cannot make. Treat the numbers as the evidence and answer the questions yourself.',
    parameters: compileParameters({
      image: { required: true, type: 'string', description: 'Path to the rendered PNG to critique.' },
    }),
    output: textOutput(),
    async execute(args, exec) {
      const { result, stderr } = await runEngine(engineDir, ['critique', here(args.image)], {
        signal: exec === undefined ? undefined : exec.signal,
      })
      return { ...result, engineNotes: stderr }
    },
  })

  // ── design_verify ───────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'design_verify',
    description:
      'Check a scene against the composition rules, statically and against a render.\n\n' +
      'Static checks, no render needed: is the type hierarchy a readable step, is the focus unique, does the subject ' +
      'occupy a sane fraction of the canvas, is every text layer legible against what it sits on. With a PNG it also ' +
      'checks the measured result rather than the declaration, which is where a scene that reads correctly can still ' +
      'render wrong.\n\n' +
      'An `allow` block in the scene records a deliberate exception with its reason, so a real decision does not have to ' +
      'be either silently violated or permanently flagged.',
    parameters: compileParameters({
      scene: { required: true, type: 'string', description: 'Path to the scene JSON.' },
      png: { type: 'string', description: 'Optional rendered PNG to verify against as well.' },
    }),
    output: textOutput(),
    async execute(args, exec) {
      const argv = ['verify', here(args.scene)]
      if (args.png !== undefined) argv.push('--png', here(args.png))
      const { result, stderr } = await runEngine(engineDir, argv, {
        signal: exec === undefined ? undefined : exec.signal,
      })
      return { ...result, engineNotes: stderr }
    },
  })

  // ── design_system ───────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'design_system',
    description:
      'Read the design-system primitives: usable fonts and their real variable axes, typographic scale ladders, and ' +
      'perceptually even colour ramps.\n\n' +
      'Call this before writing type or colour into a scene, because both are easy to get quietly wrong. The font list ' +
      'is what is ACTUALLY registered on this machine, by alias — a family name that is not in the list fails the layer ' +
      'with a warning rather than falling back silently. Several faces do not cover Chinese, so a face that renders Latin ' +
      'perfectly can still produce tofu for a Chinese title.\n\n' +
      'Each ladder step reports its contrast ratio on white and on black, so a step can be chosen by legibility rather ' +
      'than by eye. Ramp steps are interpolated in OKLab, so a light and a dark end stay perceptually even instead of ' +
      'going grey in the middle.',
    parameters: compileParameters({
      what: { required: true, type: 'string', enum: ['fonts', 'ladder', 'ramp'], description: "Which primitive to read. One of: 'fonts', 'ladder', 'ramp'." },
      color: { type: 'string', description: 'Base colour for `ramp`, e.g. "#83923A".' },
      base: { type: 'number', description: 'Base size in px for `ladder`. Default 16.' },
      ratio: { type: 'number', description: 'Scale ratio for `ladder`. Default 1.25; 1.2 is denser, 1.333 more dramatic.' },
      steps: { type: 'number', description: 'Step count. Default 7 for a ladder, 9 for a ramp.' },
    }),
    output: textOutput(),
    async execute(args, exec) {
      const argv = [args.what]
      if (args.color !== undefined) argv.push(String(args.color))
      if (args.base !== undefined) argv.push('--base', String(args.base))
      if (args.ratio !== undefined) argv.push('--ratio', String(args.ratio))
      if (args.steps !== undefined) argv.push('--steps', String(args.steps))
      const { result, stderr } = await runEngine(engineDir, argv, {
        signal: exec === undefined ? undefined : exec.signal,
      })
      return { ...result, engineNotes: stderr }
    },
  })

  // ── design_photoshop ────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'design_photoshop',
    description:
      'Drive Photoshop when a human needs a layered file, and report whether it is reachable.\n\n' +
      'Optional. The engine writes layered PSDs itself (see `design_render --psd`), so nothing here is required to ' +
      'finish a design. Use it when a client specifically expects Photoshop to have touched the file.\n\n' +
      'REQUIRES AN UNCONFINED PROCESS. Photoshop writes its preferences, workspace and dialog state into ' +
      '%APPDATA%\\Adobe on every launch. When the DSH file sandbox denies that path, Photoshop does not fail fast — it ' +
      'BLOCKS, reaching about 900 MB and 136 threads with the UI never appearing, and each attempt leaks an ' +
      '`adobe_licensing_wf.exe` that does not exit on its own. So do not launch it under a sandboxed session. This is a ' +
      'sandbox interaction, NOT a broken install: launched outside the sandbox it reports ready in about 9 seconds.\n\n' +
      'ALWAYS CALL action:"status" FIRST. It answers in under a second, uses the process list rather than COM, and never ' +
      'blocks, so it tells you whether Photoshop is already running before anything expensive happens. `up` refuses to ' +
      'launch if ANY Photoshop process exists, `run` refuses if one is hung, and `down` closes what it started.\n\n' +
      'A KNOWN LIMIT: this Photoshop build cannot have adjustment layers CREATED through its scripting interface — eight ' +
      'different formulations were tried, including a control, and all failed, with `LayerKind` enumerating zero ' +
      'constants. That is a version boundary, not a syntax error, so do not spend attempts on it. Raster layers, text, ' +
      'groups, masks, effects and layered saves all work.',
    parameters: compileParameters({
      action: { required: true, type: 'string', enum: ['up', 'down', 'status', 'run'], description: "What to do. One of: 'status', 'up', 'run', 'down'. Use 'status' first: it answers instantly and never blocks." },
      script: { type: 'string', description: 'JSX file path; required when action is `run`.' },
      timeoutSec: { type: 'number', description: 'Hard timeout for `run`, in seconds. Default 120.' },
    }),
    output: textOutput(),
    async execute(args, exec) {
      const bridge = resolve(engineDir, 'jsx', 'psx.ps1')
      const argv = [bridge]
      if (args.action === 'up') argv.push('-Up')
      else if (args.action === 'down') argv.push('-Down')
      else if (args.action === 'status') argv.push('-Status')
      else {
        if (args.script === undefined) throw new Error('design_photoshop action:"run" needs a `script` path')
        argv.push('-Run', here(args.script))
        if (args.timeoutSec !== undefined) argv.push('-Timeout', String(args.timeoutSec))
      }
      // `up` legitimately takes a minute on a cold machine, so this outer bound is generous
      // on purpose; the bridge enforces its own tighter limit.
      const { stdout, stderr } = await runPowerShell(
        argv,
        args.action === 'up' ? 180000 : 240000,
        exec === undefined ? undefined : exec.signal,
      )
      return { action: args.action, output: stdout.trim(), notes: stderr.trim() }
    },
  })

  // ── design_palette ──────────────────────────────────────────────────────
  //
  // The filter vocabulary. Everything it exposes is DATA — a preset is a named operator
  // graph and an operator is a record — so a preset can be read, edited and re-run rather
  // than only used.
  //
  // Why this is its own tool rather than more named effects: a fixed list of effects can only
  // ever produce the effects on the list. Almost every spatial filter is the same operation
  // with a different kernel (a Gaussian, a lens disc, a motion streak and an unsharp mask are
  // four kernels over one primitive), so a filter nobody wrote is a list of operators rather
  // than new code. That is what this tool hands over.
  ctx.tools.register({
    name: 'design_palette',
    description:
      'Inspect and apply the filter vocabulary: read the operator list, read the named preset library, print the graph a ' +
      'preset builds, and apply a preset or a hand-written graph to a PNG.\n\n' +
      'WHY THIS EXISTS. A fixed set of named effects can only make the effects on its list. Almost every spatial filter ' +
      'is the SAME operation with a different kernel: a Gaussian blur, a lens blur, a motion streak and an unsharp mask ' +
      'are four kernels over one primitive. So a filter nobody has written is a LIST OF OPERATORS, not new code — and ' +
      'that is what this tool gives you. Use it when the effect you want is not in the render vocabulary.\n\n' +
      'THE FOUR KINDS. spatial: `sample` (kernel: box, gaussian, disc, line, ring, cross, custom) and `rank` (a ' +
      'percentile of the neighbourhood — the only non-linear one, and the only way to remove speckles without smearing ' +
      'edges). pointwise: 11 tone and colour operators that all work in OKLab, so "lightness" means the same perceptual ' +
      'step at every hue. mixing: `blend` plus two mask builders — `similarityMask` (compares TWO images, which is what ' +
      'a surface blur needs) and `luminanceMask` (reads ONE image\'s own brightness, which is what film grain needs). ' +
      'source: `solid` and `noise`, which declare `produces: true` and do NOT advance the current image.\n\n' +
      'HOW TO WRITE A GRAPH. A graph is an array of records, run in order. `input` is always the original image, ' +
      '`current` is the previous step\'s output, and any step may store its result under a name with `as: "name"` for a ' +
      'later step to reference — that is how "blend the blurred version back over the ORIGINAL" is written, which is an ' +
      'unsharp mask. Operators that combine two images take `base`/`over`, or `from`/`against` for the mask builders.\n\n' +
      'EVERY STEP IS REPORTED. The result carries per-step `changedFraction` and an `inertSteps` count, and a step that ' +
      'ran and changed nothing is flagged with a `problem` string. Read those: an operator that silently does nothing is ' +
      'the failure this reporting exists to catch, and it has happened repeatedly in this engine.\n\n' +
      'PRECISION IS ENFORCED. Parameters must be numbers. "warmer" is rejected; "hueRotate degrees: -8" is accepted. ' +
      'That is deliberate — two people given the same numbers build the same picture, and two people given "warmer" do ' +
      'not. If you want something qualitative, translate it into numbers first and say which numbers you chose.\n\n' +
      'THE PARAMETER NAMES ARE THE DOCUMENTED ONES. `unsharp` uses radius 0-1500, amount 0-300% (so 1.5), threshold ' +
      '0-1, exactly as GIMP documents them, so a description written for another tool transfers.',
    parameters: compileParameters({
      what: {
        required: true,
        type: 'string',
        enum: ['ops', 'presets', 'show', 'apply', 'run'],
        description:
          "Which query. 'ops' lists the operators and kernels; 'presets' lists the named library with each one's " +
          "parameters and ranges; 'show' prints the operator graph a preset builds from the given params; 'apply' runs " +
          "a preset on an image; 'run' runs a hand-written graph JSON on an image.",
      },
      preset: { type: 'string', description: "Preset name, for what:'show' or what:'apply'. Names come from what:'presets'." },
      image: { type: 'string', description: "Path to the PNG to filter, for what:'apply' or what:'run'." },
      params: { type: 'string', description: 'Preset parameters as a JSON object string, e.g. {"radius":8,"amount":1.5}. On Windows prefer `sets`, which needs no quoting.' },
      sets: { type: 'string', description: 'Comma-separated key=value overrides, e.g. "radius=8,amount=1.5". Values that look like numbers or booleans are converted. Easier than `params` in a shell.' },
      graph: { type: 'string', description: "Path to a JSON file holding an operator array, for what:'run'." },
      out: { type: 'string', description: 'Output PNG path. Defaults to out/<image>-<preset>.png.' },
    }),
    output: textOutput(),
    async execute(args, exec) {
      const argv = ['palette', args.what]
      if (args.preset !== undefined) argv.push(String(args.preset))
      if (args.image !== undefined) argv.push(here(args.image))
      if (args.graph !== undefined) argv.push('--graph', here(args.graph))
      if (args.out !== undefined) argv.push('--out', here(args.out))
      if (args.params !== undefined) argv.push('--params', String(args.params))
      // `sets` is a convenience for callers that would otherwise build a JSON string and
      // escape it twice: once for their own serialisation and once for the shell.
      if (args.sets !== undefined) {
        for (const pair of String(args.sets).split(',')) {
          const trimmed = pair.trim()
          if (trimmed === '') continue
          argv.push('--set', trimmed)
        }
      }
      const { result, stderr } = await runEngine(engineDir, argv, {
        signal: exec === undefined ? undefined : exec.signal,
      })
      return { ...result, engineNotes: stderr }
    },
  })

  // ── design_tool ─────────────────────────────────────────────────────────
  //
  // The roster of session tools: measurement and asset scripts written across earlier
  // sessions, each of which answered a real question and was then left as a loose file. The
  // measured consequence was that the next session re-wrote several of them, because there
  // was no way to know they existed. A tool nobody can find is a tool that gets written
  // again.
  //
  // `list` first. The roster is read from each tool's own header rather than from a list
  // maintained here, so it cannot fall out of step with the tools it describes.
  ctx.tools.register({
    name: 'design_tool',
    description:
      'Run one of the engine\'s session tools, or list them. These are measurement and asset scripts written while ' +
      'solving real design problems — locating a subject inside an illustration, measuring what width a piece of type ' +
      'actually sets to, inventorying an icon pack, cutting a white ground out of a character, checking how much ink a ' +
      'rectangle holds, decoding a PSD to verify it independently.\n\n' +
      'LIST THEM FIRST. Call this with action:"list" before writing any measurement script of your own. Several were ' +
      'written twice in earlier sessions precisely because there was no roster to read, and the ones already here have ' +
      'been used to catch real defects — a soft drop shadow measured at 1:1, a font that set Latin perfectly and Chinese ' +
      'as tofu, a leaf that was never attached to its branch.\n\n' +
      'WORTH KNOWING BY NAME. `crop-view` cuts a TRUE-RESOLUTION window out of a render — thumbnails hide real problems, ' +
      'and nearly every genuine defect found in this engine was found in a 1:1 crop. `text-measure` measures real text ' +
      'width through the engine\'s own font stack, so type can be sized by measurement instead of estimate. ' +
      '`subject-probe` locates and measures a subject inside an illustration. `font-specimen` and `font-try` set the ' +
      'registered faces so a choice is made by looking. `psd-audit` and `psd-decode-check` validate a layered PSD ' +
      'independently of the writer. `cutout`, `recolor-icon`, `prep-maple` prepare assets. `audit-image-over-type` ' +
      'measures how much of a text block an image actually covers, which is a rule the static checker cannot see.\n\n' +
      'Arguments pass straight through to the tool, so its own `--help`-style usage line is authoritative. Get it with ' +
      'action:"describe", which returns the purpose and usage read from the tool\'s header.',
    parameters: compileParameters({
      action: {
        required: true,
        type: 'string',
        enum: ['list', 'describe', 'run'],
        description: "'list' returns every tool with its purpose and usage; 'describe' returns one; 'run' executes one.",
      },
      tool: { type: 'string', description: "Tool name with or without .mjs, for action:'describe' or 'run'." },
      args: {
        type: 'string',
        description: 'Arguments for the tool, exactly as its usage line shows them, e.g. "out/render.png out/crop.png 0.1 0.2 0.3 0.3".',
      },
    }),
    output: textOutput(),
    async execute(toolArgs, exec) {
      if (toolArgs.action === 'list') {
        const { result, stderr } = await runEngine(engineDir, ['tool', '--list'], {
          signal: exec === undefined ? undefined : exec.signal,
        })
        return { ...result, engineNotes: stderr }
      }
      if (toolArgs.tool === undefined) throw new Error(`design_tool action:"${toolArgs.action}" needs a \`tool\` name`)
      if (toolArgs.action === 'describe') {
        const { result, stderr } = await runEngine(engineDir, ['tool', '--describe', String(toolArgs.tool)], {
          signal: exec === undefined ? undefined : exec.signal,
        })
        return { ...result, engineNotes: stderr }
      }
      // `run` inherits stdio in the engine, which prints a tool's own tables. Capturing here
      // would return nothing useful, so the engine's exit code is the result.
      const extra = toolArgs.args === undefined ? [] : String(toolArgs.args).match(/"[^"]*"|\S+/g).map((s) => s.replace(/^"|"$/g, '')) ?? []
      const { result, stderr } = await runEngine(engineDir, ['tool', String(toolArgs.tool), ...extra], {
        signal: exec === undefined ? undefined : exec.signal,
      })
      return { ...result, engineNotes: stderr }
    },
  })
}
