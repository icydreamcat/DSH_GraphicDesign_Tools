/**
 * Where the workspace lives, and what lives in it.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The repository is one part of the working area. Beside it sit three things that must not
 * be versioned but must always be present:
 *
 *   ../assets/    shared design library, read on every generation
 *   ../projects/  one folder per project, each with its own private assets
 *   ../.cache/    everything regenerated on demand
 *
 * Before this module those paths were reconstructed ad hoc at each call site — `'..','..','..'`
 * counts in some files, a literal `D:\DSH_GDT\...` in one — which is why the same rule had
 * to be re-derived, and re-derived wrongly, in each new tool. The layout is now DATA, here,
 * and every tool reads it.
 *
 * WHAT IS AND IS NOT VERSIONED
 * ----------------------------
 * None of `assets/`, `projects/` or `.cache/` is in the repository: the library is bulk
 * binary material that is usually not ours to redistribute, project folders are someone's
 * actual work, and the cache is scratch by definition. What IS versioned is this file and
 * `bootstrap-workspace.mjs`, so a fresh clone can materialise the same layout and know the
 * paths without being told.
 *
 * `engine/test/workspace-layout.mjs` asserts that `bootstrap-workspace.mjs`'s table and
 * `LAYOUT` below still agree, because two copies of a layout definition drift silently.
 *
 * WHY `resolve` AND NOT A HARD-CODED ROOT
 * ---------------------------------------
 * The root is derived from this file's own location (`<workspace>/<repo>/engine/src/`), so a
 * checkout anywhere behaves identically. `DSH_WORKSPACE` overrides it for the case where the
 * library is deliberately kept on another drive.
 */
import { resolve, join, isAbsolute } from 'node:path'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'

/** The repository root — the parent of `engine/`. */
export const REPO = resolve(import.meta.dirname, '..', '..')

/** The workspace root — the parent of the repository, overridable. */
export const WORKSPACE = process.env.DSH_WORKSPACE
  ? resolve(process.env.DSH_WORKSPACE)
  : resolve(REPO, '..')

/**
 * The workspace layout, as data.
 *
 * Keys are the roles tools ask for by name; values are paths relative to WORKSPACE. This
 * table is the contract — `bootstrap-workspace.mjs` materialises it and the layout test
 * proves the two agree.
 */
export const LAYOUT = {
  /** Shared design library, read on every generation. */
  assets: 'assets',
  'assets/icons': 'assets/icons',
  'assets/textures': 'assets/textures',
  'assets/type': 'assets/type',
  'assets/plates': 'assets/plates',
  /** One folder per project, each with private assets. */
  projects: 'projects',
  /** Everything regenerated on demand. Safe to delete. */
  cache: '.cache',
  'cache/video': '.cache/video',
  'cache/test': '.cache/test',
  'cache/render-scratch': '.cache/render-scratch',
  /** Reference material to measure, not to ship. */
  refs: 'refs',
}

/**
 * Absolute path for a layout role. Creates nothing.
 * @param {keyof LAYOUT} role
 * @returns {string}
 */
export function workspacePath(role) {
  const rel = LAYOUT[role]
  if (rel === undefined) {
    throw new Error(`unknown workspace role "${role}". Known: ${Object.keys(LAYOUT).join(', ')}`)
  }
  return join(WORKSPACE, rel)
}

/** Absolute path for a file or folder in the shared asset library. */
export function assetPath(...parts) {
  return join(workspacePath('assets'), ...parts)
}

/**
 * Absolute path inside a named project.
 * @param {string} project - the folder name, e.g. `2026-09-16-endfield-deck`
 * @param {...string} parts
 */
export function projectPath(project, ...parts) {
  return join(workspacePath('projects'), project, ...parts)
}

/** Absolute path for a cache role, created if missing so writers never fail on a fresh clone. */
export function cachePath(role, ...parts) {
  const dir = workspacePath(role)
  mkdirSync(dir, { recursive: true })
  return join(dir, ...parts)
}

/**
 * The projects present, newest first.
 *
 * Sorting is by NAME descending, which is why the convention is `YYYY-MM-DD-slug`: the name
 * order IS the chronological order, so a listing is a status report without opening
 * anything. See the projects README that bootstrap writes.
 * @returns {{name:string, path:string}[]}
 */
export function listProjects() {
  const dir = workspacePath('projects')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: join(dir, e.name) }))
    .sort((a, b) => b.name.localeCompare(a.name))
}

/**
 * Make a new project folder with the standard inside, and return it.
 *
 * Idempotent: an existing project is returned untouched rather than duplicated.
 * @param {string} slug - a short name; a leading `YYYY-MM-DD-` is added unless present
 * @param {string} [date] - override the date (YYYY-MM-DD), for backfilling
 * @returns {{name:string, path:string, created:boolean}}
 */
export function newProject(slug, date) {
  const clean = String(slug).trim().replace(/[^A-Za-z0-9\u4e00-\u9fff._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (clean === '') throw new Error('a project needs a name')
  const stamped = /^\d{4}-\d{2}-\d{2}-/.test(clean)
    ? clean
    : `${date ?? new Date().toISOString().slice(0, 10)}-${clean}`
  const dir = workspacePath('projects')
  const path = join(dir, stamped)
  const created = !existsSync(path)
  if (created) {
    for (const sub of ['scenes', 'assets', 'out']) mkdirSync(join(path, sub), { recursive: true })
  }
  return { name: stamped, path, created }
}

/** True when the workspace has been bootstrapped far enough to work in. */
export function workspaceReady() {
  return existsSync(workspacePath('assets')) && existsSync(workspacePath('projects')) && existsSync(workspacePath('cache'))
}

/** A one-line human summary, for tool output and error messages. */
export function describeWorkspace() {
  return `workspace ${WORKSPACE} (assets: ${existsSync(workspacePath('assets')) ? 'yes' : 'missing'}, projects: ${listProjects().length})`
}

/** Resolve a user-supplied path against the workspace when it is not absolute. */
export function fromWorkspace(p) {
  const s = String(p)
  return isAbsolute(s) ? s : resolve(WORKSPACE, s)
}
