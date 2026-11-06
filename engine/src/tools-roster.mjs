/**
 * The session tools, as a roster that can be read and run.
 *
 * WHY THIS EXISTS
 * ---------------
 * Twenty-five measurement and asset tools were written across earlier sessions — probes for
 * where a subject sits, how wide a piece of type really is, what an icon pack contains, how
 * much ink a rectangle holds. Every one of them answered a real question and every one of them
 * was then left as a loose script in `tools/`, discoverable only by listing the directory.
 *
 * The consequence was measured: the next session re-wrote several of them, because there was
 * no way to know they already existed. A tool nobody can find is a tool that will be written
 * again.
 *
 * So this reads each tool's OWN header rather than keeping a hand-written list — a roster
 * maintained separately from the tools would go stale, and going stale is what it is here to
 * prevent.
 *
 * WHAT IT DOES AND DOES NOT DO
 * ----------------------------
 * It enumerates and it runs. It does NOT reimplement anything: `run` spawns the tool exactly
 * as a person would, so the two cannot diverge.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Read one tool's purpose and usage out of its header comment.
 *
 * Headers were written in several styles, so the first substantial prose line becomes the
 * purpose and anything mentioning `node tools/` becomes the usage. What cannot be read is
 * reported as null rather than guessed at.
 */
export function describeTool(name) {
  const path = resolve(ENGINE, 'tools', name.endsWith('.mjs') ? name : `${name}.mjs`)
  let text
  try { text = readFileSync(path, 'utf8') } catch { return null }
  const block = /^\/\*\*?([\s\S]*?)\*\//.exec(text)
  const lines = (block === null ? '' : block[1])
    .split('\n')
    .map((l) => l.replace(/^\s*\*?\s?/, '').trim())
    .filter((l) => l.length > 0)
  const usage = lines.find((l) => /node tools\//.test(l)) ?? null
  const purpose = lines.find((l) => !/node tools\//.test(l) && !/^Usage/i.test(l) && l.length > 18) ?? null
  return { name: name.endsWith('.mjs') ? name : `${name}.mjs`, purpose, usage }
}

/** Every tool, with what it is for. Sorted, because a roster is read by scanning. */
export function listTools() {
  return readdirSync(resolve(ENGINE, 'tools'))
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
    .sort()
    .map((f) => describeTool(f))
    .filter((t) => t !== null)
}

/**
 * Run one tool with the remaining arguments, streaming its output through.
 *
 * Inherited stdio rather than captured: these tools print human-readable tables and progress,
 * and capturing them to re-emit would both mangle the formatting and hide it until the end.
 */
export function runTool(name, args) {
  return new Promise((resolveCall) => {
    const file = resolve(ENGINE, 'tools', name.endsWith('.mjs') ? name : `${name}.mjs`)
    const child = spawn(process.execPath, [file, ...args], { cwd: ENGINE, stdio: 'inherit' })
    child.on('error', () => resolveCall(1))
    child.on('close', (code) => resolveCall(code ?? 1))
  })
}
