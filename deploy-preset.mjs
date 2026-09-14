/**
 * Deploy the preset from this repository into the harness preset root.
 *
 * WHY THIS STEP EXISTS AT ALL
 * ---------------------------
 * The composition belongs in the repository, beside the engine it drives and the documents
 * that describe it, so that one `git log` covers all three. But DSH discovers presets by
 * scanning `%USERPROFILE%\.dsh\.agent-presets\` and calling `readdir(dir, { withFileTypes: true })`,
 * then skipping any child where `isDirectory()` is false.
 *
 * That single condition rules out every way of pointing the harness at this directory:
 *
 *   * a settings root is not read at all — `resolvedRoots` is computed once in `apply()`
 *     from the composition's own `config.roots`, and the settings namespace is consulted
 *     only for `default`;
 *   * a directory JUNCTION is listed but reports `isDirectory: false` and
 *     `isSymbolicLink: true`, so it is skipped silently — no error, no roster entry;
 *   * a symlink behaves the same way and additionally needs privileges.
 *
 * Both were tried and measured. A real directory is the only thing the scan accepts, so the
 * repository holds the source and this script installs it. The indirection is deliberate and
 * is the price of keeping the preset versioned with its engine.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not touch the harness home's other presets, and it does not delete anything that
 * is not part of this deployment — `--prune` is opt-in, because a stray file in a preset
 * directory is much cheaper than a deleted one.
 *
 * Usage:
 *   node deploy-preset.mjs            # copy, reporting every file
 *   node deploy-preset.mjs --check    # report what differs, write nothing
 *   node deploy-preset.mjs --prune    # also remove deployed files no longer in the repo
 */
import { readdir, readFile, mkdir, writeFile, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { homedir } from 'node:os'

const SOURCE = join(import.meta.dirname, 'design')
const HARNESS_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const TARGET = join(HARNESS_HOME, '.agent-presets', 'design')

const mode = process.argv.includes('--check') ? 'check'
  : process.argv.includes('--prune') ? 'prune'
    : 'copy'

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12)

/** Every file under `dir`, as POSIX-style relative paths. */
async function listFiles(dir, base = dir, out = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return out
    throw error
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await listFiles(full, base, out)
    else out.push(relative(base, full).split('\\').join('/'))
  }
  return out
}

const sourceFiles = (await listFiles(SOURCE)).sort()
if (sourceFiles.length === 0) {
  console.error(`deploy-preset: nothing to deploy — ${SOURCE} is empty or missing`)
  process.exit(1)
}

console.log(`deploy-preset: ${SOURCE}`)
console.log(`            -> ${TARGET}`)
console.log(`            mode: ${mode}\n`)

const targetFiles = new Set(await listFiles(TARGET))
let copied = 0
let same = 0
const changed = []

for (const rel of sourceFiles) {
  const from = join(SOURCE, rel)
  const to = join(TARGET, rel)
  const src = await readFile(from)
  let dst = null
  try { dst = await readFile(to) } catch { /* absent */ }
  const identical = dst !== null && hash(dst) === hash(src)
  if (identical) {
    same++
    targetFiles.delete(rel)
    continue
  }
  changed.push(dst === null ? `+ ${rel}` : `~ ${rel}`)
  if (mode === 'check') { targetFiles.delete(rel); continue }
  await mkdir(dirname(to), { recursive: true })
  await writeFile(to, src)
  copied++
  targetFiles.delete(rel)
}

if (changed.length > 0) {
  console.log('changed:')
  for (const line of changed) console.log(`  ${line}`)
}

// Anything left in the target is not part of this deployment.
const extra = [...targetFiles].sort()
if (extra.length > 0) {
  console.log(`\nin the preset root but not in the repository (${extra.length}):`)
  for (const rel of extra) console.log(`  ? ${rel}`)
  if (mode === 'prune') {
    for (const rel of extra) await rm(join(TARGET, rel), { force: true })
    console.log(`  removed ${extra.length}`)
  } else if (mode === 'copy') {
    console.log('  left in place — pass --prune to remove them')
  }
}

const verb = mode === 'check' ? 'would copy' : 'copied'
console.log(`\n${verb} ${copied}, identical ${same}, ${extra.length} extra`)
if (mode === 'check' && changed.length > 0) process.exit(1)
