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
 * THIS IS A GATE, SO IT HAS AN EXIT CODE
 * ---------------------------------------
 * `--check` used to print the differences and exit 0 whatever they were. That made
 * it a report rather than a check, and the cost of that is on record: a long series
 * of edits went into `design/agent.cordis.yml` and was validated every way available
 * — YAML parsed, line counts, a checker script — but `deploy` was never run, so the
 * harness kept loading a stale installed copy for weeks. Every validation had been
 * performed against the SOURCE while the live artefact was old. The one step nobody
 * enforced was the one that mattered, so the step is now enforced: the exit code is
 * the verdict, and `engine/test/deploy-drift.mjs` asserts it in the test gate.
 *
 * Three states, and what each exit code means:
 *
 *   in sync        source and installed copy are byte-identical          0
 *   drift          any file differs, is missing or is extra             1
 *   not installed  no preset directory under the harness home at all    2
 *
 * Code 2 is a STATE, not a failure: a fresh clone has never been deployed, so
 * "not installed" is a legitimate answer for `--check` to give. It is still non-zero
 * so that no gate can mistake "nothing to compare" for "compared and clean".
 *
 * `--prune` cannot be combined with `--check` — the comparison does not depend on
 * the extra-file flag, so parse the two as mutually exclusive.
 *
 * Usage:
 *   node deploy-preset.mjs            # copy, reporting every file; exit 0 on success
 *   node deploy-preset.mjs --check    # report what differs, write nothing; exit code = verdict
 *   node deploy-preset.mjs --prune    # also remove deployed files no longer in the repo
 */
import { readdir, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { homedir } from 'node:os'

const SOURCE = join(import.meta.dirname, 'design')
const HARNESS_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const TARGET = join(HARNESS_HOME, '.agent-presets', 'design')

// "Not installed" has to be a state of its own rather than a special case of drift.
// Comparing file-by-file cannot tell the two apart — an absent directory reports every
// source file as `+`, which reads as drift — and the two want different answers: drift
// is a fault to fix, a fresh clone that has never been deployed is normal. The
// directory itself is the evidence, because an installed preset always has one.
const installed = existsSync(TARGET)

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

// ── the verdict ─────────────────────────────────────────────────────────────
//
// Printed on its own line and last, because the exit code is the whole point of
// `--check` and a gate should say out loud what its code means. See the header for
// the three states; the numbers here are the contract, not a convention.
if (mode === 'check') {
  if (!installed) {
    console.log(`verdict: not installed — ${TARGET} does not exist (exit 2)`)
    process.exit(2)
  }
  const differences = changed.length + extra.length
  if (differences > 0) {
    console.log(`verdict: DRIFT — ${changed.length} differing or missing, ${extra.length} extra (exit 1)`)
    process.exit(1)
  }
  console.log(`verdict: in sync — ${same} files identical (exit 0)`)
}
