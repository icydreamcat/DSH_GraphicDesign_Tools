/**
 * Bootstrap the workspace that surrounds this repository.
 *
 * WHY THIS EXISTS
 * ---------------
 * The repository is only one part of the working area. Beside it live the things that
 * must NOT be versioned but must always exist for work to happen:
 *
 *   ../assets/     the shared design library — read on every generation
 *   ../projects/   one folder per project, each with its own private assets
 *   ../.cache/     everything regenerated on demand
 *
 * None of them belongs in a commit: the asset library is bulk binary material, project
 * folders are someone's actual work, and the cache is scratch. But the paths must be
 * knowable, identical on every machine, and — this is the part that was missing — the
 * directories must EXIST. A tool that writes to `../assets/` on machine A and fails on
 * machine B because nobody created it is not a portable tool.
 *
 * So the layout is data (see WORKSPACE in engine/src/paths.mjs) and this script is how
 * a fresh clone materialises it. It is idempotent: safe to run any time, creates only
 * what is missing, and never deletes or overwrites anything.
 *
 * Usage:
 *   node bootstrap-workspace.mjs            # create what is missing, report each
 *   node bootstrap-workspace.mjs --check    # report only, write nothing
 */
import { mkdirSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(fileURLToPath(import.meta.url))

// The workspace root. `DSH_WORKSPACE` overrides it, and it MUST be honoured here for the
// same reason engine/src/paths.mjs honours it: the library can legitimately live on another
// drive. If only one of the two files respected the override they would bootstrap one area
// and write into another — so both read it, and engine/test/workspace-layout.mjs asserts
// that they do.
const WORKSPACE = process.env.DSH_WORKSPACE
  ? resolve(process.env.DSH_WORKSPACE)
  : resolve(REPO, '..')

const checkOnly = process.argv.includes('--check')

/**
 * The layout. Keys are the roles the engine refers to; values are paths relative to the
 * workspace root. `engine/src/paths.mjs` reads THIS table's equivalent, and the two are
 * kept in step by engine/test/workspace-layout.mjs.
 */
const LAYOUT = [
  ['assets', 'assets', 'shared design library — read on every generation'],
  ['assets/icons', 'assets/icons', 'marks, glyphs, cut-out silhouettes'],
  ['assets/textures', 'assets/textures', 'grain, paper, halftone, ruling'],
  ['assets/type', 'assets/type', 'font references and specimens'],
  ['assets/plates', 'assets/plates', 'backgrounds and full-bleed plates'],
  ['projects', 'projects', 'one folder per project, newest work first'],
  ['cache', '.cache', 'everything regenerated on demand — delete freely'],
  ['cache/video', '.cache/video', 'decoded frames, ffmpeg temp, alpha fixtures'],
  ['cache/test', '.cache/test', 'what the test suites write'],
  ['cache/render-scratch', '.cache/render-scratch', 'probe and iteration renders'],
  ['refs', 'refs', 'reference material to measure, not to ship'],
]

const ASSETS_README = `# assets — the shared design library

Material that is **read on every generation** and belongs to no single project: marks,
glyphs, textures, type references, plates. If two projects would both reach for it, it
lives here rather than inside either one.

**Not versioned.** This directory is created by \`node bootstrap-workspace.mjs\` and its
contents are yours — bulk binaries that would bloat the repository and are usually not
ours to redistribute.

| Folder | What goes in it | Typical use |
|---|---|---|
| \`icons/\` | marks, glyphs, cut-out silhouettes | registration marks, specks, technical symbols |
| \`textures/\` | grain, paper, halftone, ruling | sub-threshold detail, tonal grounds |
| \`type/\` | specimens and face references | choosing a face before setting type |
| \`plates/\` | backgrounds, full-bleed images | grounds, hero imagery |

## The rule that keeps this useful

**Ask whether the element serves this project alone.**

- Serves one project → that project's own \`assets/\` folder. It goes away with the project.
- Serves several → here. Promote it deliberately, don't leave a copy in both places.
- Serves nobody yet → don't add it. A library of unused material is worse than an empty
  one, because every later search has to rule it out.

A file that lives in both places will drift, and the version you see will not be the
version someone else used. **One copy, one home.**

## How work reads it

Relative to the workspace root, and the engine resolves these without being told:

\`\`\`js
// engine/src/paths.mjs
import { WORKSPACE, assetPath, projectPath } from './paths.mjs'
\`\`\`

Override the root with \`DSH_WORKSPACE\` when the library lives on another drive.
`

const PROJECTS_README = `# projects — one folder per project

Each project owns its own folder and its own private assets. **Sorted so the newest work
is easiest to find** — the sort key is in the name, see below.

**Not versioned.** Created by \`node bootstrap-workspace.mjs\`. This is your work.

## Naming, so a directory listing is a status report

\`\`\`
projects/
  2026-09-16-endfield-deck/      <- YYYY-MM-DD-slug, newest first when sorted desc
  2026-09-14-muelsyse-kv/
  2026-09-11-arknights-visual/
\`\`\`

Leading date + slug. Sorting the directory by name then gives you chronological order for
free, and \`2026-09-16\` does not collide the way "final" and "final2" do. Renaming a
project folder is cheap; discovering six months later which folder is current is not.

## What a project folder holds

| Inside | Purpose |
|---|---|
| \`scenes/\` | the scene JSON — this is the design's source of truth |
| \`assets/\` | material for THIS project only; goes away with the folder |
| \`out/\` | renders and reports for this project |
| \`notes.md\` | decisions, what was rejected and why |

## The split between here and \`../assets/\`

Project-private material stays inside the project; anything a second project would also
reach for is promoted to the shared library at \`../assets/\`. Promoting means **moving**,
not copying — a file in both places drifts, and the copy you are looking at will not be
the copy someone else used.

## Starting a project

\`\`\`powershell
cd D:\\DSH_GDT\\DSH_GraphicDesign_Tools
node new-project.mjs endfield-deck        # creates projects/2026-09-16-endfield-deck/
\`\`\`

Then render into it:

\`\`\`powershell
cd engine
node bin/design.mjs render ../projects/2026-09-16-endfield-deck/scenes/kv.json --out ../projects/2026-09-16-endfield-deck/out
\`\`\`
`

const created = []
const present = []
const problems = []

for (const [key, rel, what] of LAYOUT) {
  const abs = join(WORKSPACE, rel)
  if (existsSync(abs)) { present.push([rel, what]); continue }
  if (checkOnly) { created.push([rel, what]); continue }
  try {
    mkdirSync(abs, { recursive: true })
    created.push([rel, what])
  } catch (error) {
    problems.push([rel, error.message])
  }
}

// Seed the two READMEs that carry the RULES. Written only when absent, so a reader's
// edits are never overwritten by a later bootstrap.
if (!checkOnly) {
  for (const [file, text] of [['assets/README.md', ASSETS_README], ['projects/README.md', PROJECTS_README]]) {
    const abs = join(WORKSPACE, file)
    if (!existsSync(abs)) {
      try { writeFileSync(abs, text); created.push([file, 'the rule for this area']) }
      catch (error) { problems.push([file, error.message]) }
    }
  }
}

console.log(`bootstrap-workspace: ${WORKSPACE}`)
console.log(`            repo at: ${REPO}`)
console.log(`            mode: ${checkOnly ? 'check' : 'create'}\n`)

console.log(`already there (${present.length}):`)
for (const [rel, what] of present) console.log(`  =  ${rel.padEnd(24)} ${what}`)

if (created.length) {
  console.log(`\n${checkOnly ? 'would create' : 'created'} (${created.length}):`)
  for (const [rel, what] of created) console.log(`  +  ${rel.padEnd(24)} ${what}`)
}
if (problems.length) {
  console.log(`\nFAILED (${problems.length}):`)
  for (const [rel, msg] of problems) console.log(`  !  ${rel.padEnd(24)} ${msg}`)
}

// Report what the library and the project area actually hold, so a first run tells the
// reader whether they are starting empty or rejoining an existing workspace.
function countFiles(dir, depth = 2) {
  if (!existsSync(dir)) return 0
  let n = 0
  const walk = (d, left) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (left > 0) walk(join(d, e.name), left - 1); continue }
      n++
    }
  }
  walk(dir, depth)
  return n
}

const lib = countFiles(join(WORKSPACE, 'assets'))
const projectsDir = join(WORKSPACE, 'projects')
const projects = existsSync(projectsDir)
  ? readdirSync(projectsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort().reverse()
  : []

console.log(`\nshared library : ${lib} file(s)${lib === 0 ? ' — empty; add material you would reuse' : ''}`)
console.log(`projects       : ${projects.length === 0 ? 'none yet' : projects.length}`)
for (const p of projects.slice(0, 10)) console.log(`  -  ${p}`)
if (projects.length > 10) console.log(`  … and ${projects.length - 10} more`)

console.log(`\n${checkOnly ? 'would create' : 'created/verified'} ${created.length}, already present ${present.length}, failed ${problems.length}`)
process.exit(problems.length === 0 ? 0 : 1)
