/**
 * Curate the example renders that ship WITH the repository.
 *
 * WHY THIS IS A SCRIPT AND NOT A COPY-PASTE
 * -----------------------------------------
 * `engine/out/` is gitignored on purpose: 42 files and 46 MB of intermediate figures that
 * change on every iteration. But a design engine with no picture in its repository is
 * asking to be taken on faith, so a handful of the renders that represent the toolchain
 * are promoted into `examples/`, which IS versioned.
 *
 * The promoted set is chosen to cover the engine's surface, not to be the prettiest:
 *   * a finished poster at full 2400x1350 delivery size;
 *   * the variant comparison sheet, which is the clearest single statement of what the
 *     seventeen layer effects and the `scope` mechanism actually do;
 *   * the effect sheet, which is small and shows the vocabulary side by side.
 *
 * Everything here is regenerable — see examples/README.md for the exact commands — so a
 * reader can prove the images came from the committed scenes rather than from an editor.
 *
 * Usage:
 *   node make-examples.mjs            # copy the curated set, reporting each file
 *   node make-examples.mjs --check    # report what would be copied, write nothing
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

const ROOT = import.meta.dirname
const OUT = join(ROOT, 'engine', 'out')
const DEST = join(ROOT, 'examples')
const checkOnly = process.argv.includes('--check')

/** source (in engine/out) -> destination name (in examples/) */
const CURATED = [
  ['poster-e-tooled.png', 'poster-e-tooled.png'],
  ['compare-posters.png', 'poster-variants-and-scope.png'],
  ['effect-sheet.png', 'effect-sheet.png'],
]

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12)
const kb = (n) => (n / 1024).toFixed(0) + ' KB'

console.log(`make-examples: ${OUT}`)
console.log(`            -> ${DEST}`)
console.log(`            mode: ${checkOnly ? 'check' : 'copy'}\n`)

if (!checkOnly) await mkdir(DEST, { recursive: true })

let copied = 0
let same = 0
let missing = 0

for (const [from, to] of CURATED) {
  const src = join(OUT, from)
  const dst = join(DEST, to)
  let buf
  try {
    buf = await readFile(src)
  } catch {
    missing++
    console.log(`  MISSING  ${from}   (render it first: see examples/README.md)`)
    continue
  }
  let existing = null
  try { existing = await readFile(dst) } catch { /* absent */ }
  if (existing !== null && hash(existing) === hash(buf)) {
    same++
    console.log(`  identical ${to.padEnd(34)} ${kb(buf.length)}`)
    continue
  }
  if (checkOnly) {
    console.log(`  would copy ${to.padEnd(33)} ${kb(buf.length)}`)
    continue
  }
  await writeFile(dst, buf)
  copied++
  console.log(`  copied    ${to.padEnd(34)} ${kb(buf.length)}`)
}

const total = await Promise.all(CURATED.map(([, to]) => stat(join(DEST, to)).then((s) => s.size).catch(() => 0)))
console.log(`\n${checkOnly ? 'would copy' : 'copied'} ${copied}, identical ${same}, missing ${missing}`)
console.log(`examples/ total size: ${kb(total.reduce((a, b) => a + b, 0))}`)
if (missing > 0) {
  console.log('\nA missing source is not an error: engine/out/ is a build artifact and is')
  console.log('gitignored, so a fresh clone has nothing there until it renders once.')
}
