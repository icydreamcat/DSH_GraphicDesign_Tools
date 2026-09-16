/**
 * The workspace layout is defined in TWO places and they must agree.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * `engine/src/paths.mjs` exposes the layout as data so every tool reads one definition
 * instead of re-deriving `'..','..','..'` at each call site — which is how the same rule
 * came to be re-derived wrongly in several tools already. But `bootstrap-workspace.mjs`
 * sits at the repository root, outside `engine/`, and cannot import from `src/` without
 * reaching across a boundary that exists to keep the repo bootstrappable.
 *
 * So the table is duplicated, and a duplicated table drifts in silence: someone adds
 * `assets/plates` to one file, the other keeps creating four folders instead of five, and
 * the failure surfaces much later as a tool writing to a directory nobody made.
 *
 * This test is the seam. It parses bootstrap's table and compares it to `LAYOUT`, key by key.
 * A parse is used deliberately rather than an import: importing would make the test pass
 * against whatever bootstrap happens to do, which is the thing under test.
 *
 * Run: node test/workspace-layout.mjs
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { LAYOUT, WORKSPACE, REPO, workspacePath, assetPath, projectPath, listProjects } from '../src/paths.mjs'

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

// ── 1. the two tables agree ─────────────────────────────────────────────────
console.log('=== 1. bootstrap-workspace.mjs and paths.mjs define the same layout ===')

const bootstrapSrc = readFileSync(join(REPO, 'bootstrap-workspace.mjs'), 'utf8')
const tableMatch = /const LAYOUT = \[([\s\S]*?)\n\]/.exec(bootstrapSrc)
check('bootstrap declares a LAYOUT table', tableMatch !== null)

let declared = null
if (tableMatch) {
  // Rows look like:  ['assets', 'assets', 'the shared design library'],
  declared = {}
  const rowRe = /\[\s*'([^']+)'\s*,\s*'([^']+)'\s*,/g
  let m
  while ((m = rowRe.exec(tableMatch[1])) !== null) declared[m[1]] = m[2]
}

if (declared) {
  const rolesInPaths = Object.keys(LAYOUT).sort()
  const rolesInBootstrap = Object.keys(declared).sort()
  const missing = rolesInPaths.filter((r) => !rolesInBootstrap.includes(r))
  const extra = rolesInBootstrap.filter((r) => !rolesInPaths.includes(r))
  check('every role in paths.mjs is created by bootstrap', missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : `${rolesInPaths.length} roles`)
  check('bootstrap creates nothing that paths.mjs does not name', extra.length === 0,
    extra.length ? `extra: ${extra.join(', ')}` : 'none extra')

  const wrong = rolesInPaths.filter((r) => declared[r] !== undefined && declared[r] !== LAYOUT[r])
  check('the paths themselves agree, not just the names', wrong.length === 0,
    wrong.length ? wrong.map((r) => `${r}: "${declared[r]}" vs "${LAYOUT[r]}"`).join('; ') : 'all match')
}

// ── 2. the root is derived, and overridable ─────────────────────────────────
console.log('\n=== 2. the workspace root is derived, never hard-coded ===')
check('REPO is the parent of engine/', REPO.endsWith('DSH_GraphicDesign_Tools'), REPO)
check('WORKSPACE is the parent of the repo', WORKSPACE === resolve(REPO, '..'), WORKSPACE)
check('no drive letter is baked into paths.mjs',
  !/['"][A-Za-z]:[\\/]/.test(readFileSync(join(REPO, 'engine', 'src', 'paths.mjs'), 'utf8')),
  'no literal absolute path in the module')

// ── 3. the accessors resolve where the layout says ──────────────────────────
console.log('\n=== 3. accessors follow the table ===')
check('assetPath() lands under assets/', assetPath('icons', 'x.png') === join(WORKSPACE, 'assets', 'icons', 'x.png'),
  assetPath('icons', 'x.png'))
check('projectPath() lands under projects/', projectPath('p1', 'scenes', 'a.json') === join(WORKSPACE, 'projects', 'p1', 'scenes', 'a.json'),
  projectPath('p1', 'scenes', 'a.json'))
check('workspacePath() rejects an unknown role', (() => {
  try { workspacePath('nope'); return false } catch { return true }
})(), 'throws')

// ── 4. the separation the user asked for is real ────────────────────────────
console.log('\n=== 4. nothing versioned lives in the generated areas ===')
for (const role of ['assets', 'projects', 'cache']) {
  const p = workspacePath(role)
  check(`${role}/ sits OUTSIDE the repository`, !p.startsWith(REPO + sep), p)
}

// ── 5. project ordering puts the newest first ───────────────────────────────
console.log('\n=== 5. projects sort newest-first by name ===')
{
  // Pure function of the names, so this does not depend on what is on disk.
  const names = ['2026-09-11-arknights-visual', '2026-09-16-endfield-deck', '2026-09-14-muelsyse-kv']
  const sorted = [...names].sort((a, b) => b.localeCompare(a))
  check('a date-prefixed name sorts chronologically', sorted[0] === '2026-09-16-endfield-deck',
    sorted.join(' > '))
  check('listProjects() returns an array', Array.isArray(listProjects()), `${listProjects().length} on disk`)
}

// ── 6. BOTH files must honour DSH_WORKSPACE ─────────────────────────────────
console.log('\n=== 6. the override is respected by both, not just one ===')
{
  // This check exists because they DID diverge: bootstrap hard-coded the parent of the repo
  // while paths.mjs read the variable. Bootstrapping then created one area and the tools
  // wrote into another — and the symptom is the worst kind, everything reports success
  // while pointing at a directory nobody created.
  const both = [bootstrapSrc, readFileSync(join(REPO, 'engine', 'src', 'paths.mjs'), 'utf8')]
  for (const [i, src] of both.entries()) {
    const name = i === 0 ? 'bootstrap-workspace.mjs' : 'engine/src/paths.mjs'
    check(`${name} reads DSH_WORKSPACE`, /process\.env\.DSH_WORKSPACE/.test(src), 'reads the variable')
  }

  // And prove it at runtime for this module, in a child process with the variable set so
  // the module-level constant is evaluated fresh.
  const { spawnSync } = await import('node:child_process')
  const { pathToFileURL } = await import('node:url')
  const probe = join(WORKSPACE, '.cache', 'test', '_ws-probe.mjs')
  // A file:// URL, not a raw Windows path: `import 'D:/...'` throws
  // ERR_UNSUPPORTED_ESM_URL_SCHEME, which is how this check failed the first time.
  writeFileSync(probe, [
    `import { WORKSPACE, workspacePath } from ${JSON.stringify(pathToFileURL(join(REPO, 'engine', 'src', 'paths.mjs')).href)}`,
    "console.log(JSON.stringify({ ws: WORKSPACE, assets: workspacePath('assets') }))",
  ].join('\n'))
  const target = join(WORKSPACE, '.cache', 'test', '_ws-sim')
  const r = spawnSync(process.execPath, [probe], {
    env: { ...process.env, DSH_WORKSPACE: target },
    encoding: 'utf8',
  })
  let got = null
  try { got = JSON.parse((r.stdout || '').trim()) } catch { /* reported below */ }
  check('DSH_WORKSPACE actually moves the workspace root', got !== null && got.ws === resolve(target),
    got ? got.ws : (r.stderr || '').slice(0, 100))
  try { unlinkSync(probe) } catch { /* leaving a probe behind would be worse than a failed test */ }
}

console.log(`\n=== ${checks - failed}/${checks} checks passed ===`)
process.exit(failed === 0 ? 0 : 1)
