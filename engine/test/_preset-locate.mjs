/**
 * Locate the things the tool-schema tests need, WITHOUT hard-coding this machine.
 *
 * WHY THIS EXISTS
 * ---------------
 * Both tests used to start with two absolute paths containing the author's Windows
 * username:
 *
 *   const DSH_TOOLS  = 'file:///C:/Users/<user>/AppData/Roaming/npm/node_modules/
 *                       @deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
 *   const PRESET_DIR = "C:/Users/<user>/.dsh/.agent-presets/design"
 *
 * Every suite in this directory has to run on a machine that is not this one, and
 * those two lines made two of them impossible to run anywhere else. They were wrong in
 * a second way as well: PRESET_DIR pointed at the DEPLOYED copy of the preset rather
 * than the repository's `design/` source, so the tests validated the installed artefact
 * instead of the thing under version control.
 *
 * RESOLUTION ORDER
 * ----------------
 * dsh-tools:  DSH_TOOLS_DIR  ->  the npm global root that owns the running Node
 *             ->  the usual global locations. Nothing is hard-coded per user.
 * preset:     DSH_PRESET_DIR ->  this repository's `design/`  ->  $DSH_HOME deployed copy.
 * installed:  $DSH_HOME deployed copy, and ONLY that — `installedPresetDir()` below
 *             returns undefined when there is none, because the drift suite has to be
 *             able to say "nothing is installed" instead of silently comparing the
 *             source against itself.
 *
 * The repository copy is preferred for the preset: it is the only one that exists in a
 * fresh clone, and it is the one under version control.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The `@deepseek-ai/dsh-tools` entry point, as a file:// URL for dynamic import.
 * @returns {string}
 */
export function dshToolsUrl() {
  const tried = []

  if (process.env.DSH_TOOLS_DIR) {
    const p = join(process.env.DSH_TOOLS_DIR, '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
    tried.push(p)
    if (existsSync(p)) return pathToFileURL(p).href
  }

  // Candidate npm global roots, most specific first. The running Node binary is the
  // strongest signal: on a global install it is <prefix>/node.exe or <prefix>/bin/node.
  const roots = [
    dirname(process.execPath),
    dirname(dirname(process.execPath)),
    process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'npm') : null,
  ].filter(Boolean)

  const rels = [
    ['node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'],
    ['node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'],
  ]

  for (const root of roots) {
    for (const rel of rels) {
      const p = join(root, ...rel)
      tried.push(p)
      if (existsSync(p)) return pathToFileURL(p).href
    }
  }

  throw new Error(
    'could not locate @deepseek-ai/dsh-tools.\n' +
    'Set DSH_TOOLS_DIR to the directory that CONTAINS the `@deepseek-ai` scope\n' +
    '(for a global npm install, that is usually %APPDATA%\\npm\\node_modules).\n' +
    'tried:\n  ' + tried.join('\n  '),
  )
}

/**
 * The directory holding the preset under test — the REPOSITORY's `design/`, so the
 * tests check the source that is version-controlled.
 * @returns {string} absolute path
 */
export function presetDir() {
  const candidates = []
  if (process.env.DSH_PRESET_DIR) candidates.push(process.env.DSH_PRESET_DIR)
  // This file lives at <repo>/engine/test/, so the repo's own preset is two levels up.
  candidates.push(resolve(import.meta.dirname, '..', '..', 'design'))
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  candidates.push(join(home, '.agent-presets', 'design'))

  for (const c of candidates) {
    if (existsSync(join(c, 'agent.cordis.yml'))) return c
  }
  throw new Error(
    'could not locate the design preset.\n' +
    'Set DSH_PRESET_DIR, or run `node deploy-preset.mjs` from the repository root.\n' +
    'tried:\n  ' + candidates.join('\n  '),
  )
}

/**
 * The INSTALLED copy of the preset — the one the harness actually loads, under the
 * harness home. `undefined` when nothing is installed, which is a legitimate state for
 * a fresh clone and not an error: the drift suite treats it as "nothing to compare"
 * rather than as a failure.
 *
 * Separate from `presetDir()` on purpose. That one prefers the repository's `design/`
 * because the other suites check the source under version control; a drift check has to
 * name both sides explicitly, and `deploy-preset.mjs` resolves the same two paths the
 * same way (DSH_HOME, then the home directory).
 *
 * @returns {string|undefined} absolute path, or undefined when there is no install
 */
export function installedPresetDir() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const dir = join(home, '.agent-presets', 'design')
  return existsSync(join(dir, 'agent.cordis.yml')) ? dir : undefined
}

/**
 * The engine directory for the plugin's `engineDir` config — the repository's
 * `engine/`, derived from this file's own location, so it is right on every machine.
 * @returns {string}
 */
export function engineDir() {
  return resolve(import.meta.dirname, '..')
}

/**
 * The `design-tools` module name declared by the composition, so the tests follow the
 * composition rather than hard-coding a timestampled filename.
 * @param {string} dir
 * @returns {string}
 */
export function declaredToolModule(dir) {
  const yaml = readFileSync(join(dir, 'agent.cordis.yml'), 'utf8')
  const m = /- id: design-tools\s*\n\s*name:\s*\.\/([^\s]+)/.exec(yaml)
  if (m === null) throw new Error(`could not find the design-tools row in ${dir}/agent.cordis.yml`)
  return m[1]
}

/** Sibling plugin files, so a stale one left behind by a rename is visible. */
export function toolModuleSiblings(dir) {
  return readdirSync(dir).filter((f) => /^design-tools.*\.mjs$/.test(f))
}
