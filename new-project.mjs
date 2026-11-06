/**
 * Create a project folder with the standard inside.
 *
 * WHY A SCRIPT AND NOT JUST mkdir
 * -------------------------------
 * The project convention is `YYYY-MM-DD-slug`, and the date prefix is load-bearing: sorting
 * the projects directory by name then gives chronological order, so a plain listing is a
 * status report and the newest work is always at the top. A convention that has to be
 * remembered by hand is one that gets applied inconsistently, and "which of these six
 * folders is current?" is discovered months later.
 *
 * The layout lives in `engine/src/paths.mjs` (role `projects`), so this script does not
 * carry its own opinion about where projects go.
 *
 * Usage:
 *   node new-project.mjs endfield-deck              # projects/2026-09-16-endfield-deck/
 *   node new-project.mjs 2026-09-01-legacy-retro    # date already present, kept as-is
 *   node new-project.mjs endfield-deck --date 2026-08-30   # backfill
 *   node new-project.mjs --list                     # newest first
 */
import { newProject, listProjects, workspacePath, WORKSPACE, workspaceReady } from './engine/src/paths.mjs'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)

if (argv.includes('--list') || argv.length === 0) {
  if (!workspaceReady()) {
    console.error(`the workspace is not bootstrapped yet. Run:  node bootstrap-workspace.mjs`)
    process.exit(1)
  }
  const projects = listProjects()
  console.log(`projects in ${workspacePath('projects')} (newest first)\n`)
  if (projects.length === 0) {
    console.log('  none yet. Create one:  node new-project.mjs <slug>')
    process.exit(0)
  }
  for (const p of projects) {
    let files = 0
    try {
      const walk = (d, depth) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory()) { if (depth > 0) walk(join(d, e.name), depth - 1); continue }
          files++
        }
      }
      walk(p.path, 2)
    } catch { /* unreadable is not fatal for a listing */ }
    let when = ''
    try { when = statSync(p.path).mtime.toISOString().slice(0, 10) } catch { /* ignore */ }
    console.log(`  ${p.name.padEnd(38)} ${String(files).padStart(4)} file(s)  modified ${when}`)
  }
  if (argv.length === 0) console.log('\n(a slug is needed to create one:  node new-project.mjs <slug>)')
  process.exit(0)
}

const slug = argv.find((a) => !a.startsWith('--'))
const dateIdx = argv.indexOf('--date')
const date = dateIdx >= 0 ? argv[dateIdx + 1] : undefined

if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`--date wants YYYY-MM-DD, got "${date}"`)
  process.exit(1)
}

if (!workspaceReady()) {
  console.error('the workspace is not bootstrapped yet. Run:  node bootstrap-workspace.mjs')
  process.exit(1)
}

const { name, path, created } = newProject(slug, date)

console.log(`${created ? 'created' : 'already exists'}  ${path}`)
if (created) {
  console.log('\n  scenes/   the scene JSON — this project\'s source of truth')
  console.log('  assets/   material for THIS project only; goes away with the folder')
  console.log('  out/      renders and reports')
  console.log(`\n  anything a second project would also reach for belongs in`)
  console.log(`  ${workspacePath('assets')} instead — promote by MOVING, never by copying.\n`)
  console.log(`  render into it:`)
  console.log(`    cd engine`)
  console.log(`    node bin/design.mjs render ../projects/${name}/scenes/kv.json --out ../projects/${name}/out`)
} else {
  console.log('  (left untouched — a later run never overwrites a project)')
}
