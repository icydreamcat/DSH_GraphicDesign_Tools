/**
 * 新会话验收 —— 在 harness 真正加载的那份 preset 上取证，而不是在源文件上。
 *
 * 上一场的事故正是「验了源、没验活的那份」：YAML 解析通过、行数统计通过、独立脚本通过，
 * 而 deploy 从没跑过，harness 加载的还是旧的 402 行。那一刻之后的所有校验都是纸面上的。
 *
 * 所以这个脚本检查四件事，全部指向**已部署**的副本与真实运行路径：
 *   1. 活的那份 composition 里的 policy 是压缩后的短版（规则条数、字符数、不含旧段落锚点）
 *   2. policy 段落在 system prompt 里的顺序位置（紧跟 persona）
 *   3. 九个 skill 的 SKILL.md 都有合法 frontmatter（缺了会被**静默跳过**，不报错）
 *   4. GATE 1 真的会挡住渲染：拿一个没有 gates 块的场景去渲，必须非零退出
 *
 * Usage:
 *   node verify-preset-live.mjs            # 全部四项
 *   node verify-preset-live.mjs --quiet    # 只输出结论
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

import { installedPresetDir, engineDir } from './engine/test/_preset-locate.mjs'

const QUIET = process.argv.includes('--quiet')
const log = (...a) => { if (!QUIET) console.log(...a) }
let failures = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail === undefined ? '' : '  — ' + detail}`)
  if (!ok) failures++
}

// ── 1. 活的那份 policy 是短版 ────────────────────────────────────────────────
log('\n[1] 已部署的 composition：policy 是不是压缩后的短版')
const presetDir = installedPresetDir()
const compPath = join(presetDir, 'agent.cordis.yml')
check('找到已部署的 composition', existsSync(compPath), compPath)

const raw = readFileSync(compPath, 'utf8')

// 用 harness 自己的 yaml 包解析，不写第二个手写扫描器
let yaml = null
try {
  const req = createRequire(join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  yaml = req('yaml')
} catch {
  try {
    const req2 = createRequire(import.meta.url)
    yaml = req2('yaml')
  } catch { /* 下面会报告 */ }
}

if (yaml === null) {
  // 回退到文本判据，并明说这是在退而求其次
  check('policy 是短版（按文本判据）', raw.includes('DELIBERATELY SHORT'), '未找到 yaml 包，退化为文本包含判断')
} else {
  const doc = yaml.parse(raw)
  const row = doc.find((r) => r.id === 'design-policy')
  check('composition 能解析且有 design-policy 行', row !== undefined, `${doc.length} rows`)
  if (row !== undefined) {
    const text = row.config.text
    const rules = text.split('\n').filter((l) => /^\s*\d+ · /.test(l)).length
    check('policy 是短版：6 条可强制的规则', rules === 6, `${rules} 条规则，${text.length} 字符（旧版 22 条原则 / 15,640 字符）`)
    check('policy 不含 {{ （否则 design-policy.mjs 会拒绝挂载）', !text.includes('{{'))
    check('旧的 MECHANICS 段落没有被留在常驻段', !text.includes('── MECHANICS'))
    check('引用了 craft-and-material 与 design-judgement 两个新技能',
      text.includes('craft-and-material') && text.includes('design-judgement'))
  }
}

// ── 2. 段落顺序 ─────────────────────────────────────────────────────────────
log('\n[2] policy 段落在 system prompt 里的位置')
const policyMod = join(presetDir, 'design-policy.mjs')
if (existsSync(policyMod)) {
  const src = readFileSync(policyMod, 'utf8')
  const offset = /POLICY_ORDER_OFFSET = (\d+)/.exec(src)?.[1]
  check('policy 的 order 由 persona 的槽位推导（落在 DEPLOYMENT_PERSONA 与 PLAN_POLICY 之间）',
    offset !== undefined && Number(offset) > 0 && Number(offset) < 400,
    `POLICY_ORDER_OFFSET = ${offset ?? '未找到'}`)
} else {
  check('找到 design-policy.mjs', false, policyMod)
}

// ── 3. 九个 skill 的 frontmatter ─────────────────────────────────────────────
log('\n[3] 九个技能的 SKILL.md 都有合法 frontmatter（缺了会被静默跳过）')
const EXPECTED = [
  'colour-systems', 'craft-and-material', 'depth-and-structure', 'design-foundations',
  'design-judgement', 'filters-and-palette', 'photoshop-delivery', 'reference-analysis',
  'typography-and-scale',
]
const skillRoot = join(presetDir, 'skills')
const missing = []
const badFront = []
for (const name of EXPECTED) {
  const p = join(skillRoot, name, 'SKILL.md')
  if (!existsSync(p)) { missing.push(name); continue }
  const text = readFileSync(p, 'utf8')
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (fm === null || !/\bname:\s*\S/.test(fm[1]) || !/\bdescription:\s*\S/.test(fm[1])) badFront.push(name)
}
check(`九个技能都在`, missing.length === 0, missing.length === 0 ? EXPECTED.length + ' 个' : `缺 ${missing.join(', ')}`)
check('每个都有 name + description', badFront.length === 0, badFront.length === 0 ? 'ok' : `缺 frontmatter: ${badFront.join(', ')}`)

// ── 4. GATE 1 真的挡得住 ────────────────────────────────────────────────────
log('\n[4] GATE 1：没有 gates 块的场景必须被拒绝渲染')
const ENGINE = engineDir()
const tmp = mkdtempSync(join(tmpdir(), 'gate-live-'))
const bareScene = join(tmp, 'no-gates.json')
writeFileSync(bareScene, JSON.stringify({
  canvas: { width: 200, height: 120 }, ground: '#FFFFFF',
  layers: [{ id: 'a', shape: 'rect', x: 0, y: 0, w: 100, h: 100, paint: '#000000' }],
}, null, 2), 'utf8')

const refused = spawnSync(process.execPath, [join(ENGINE, 'bin', 'design.mjs'), 'render', bareScene, '--out', tmp, '--name', 'x'],
  { encoding: 'utf8', cwd: ENGINE })
check('无 gates → 非零退出', refused.status !== 0, `exit ${refused.status}`)
check('无 gates → 不写出 PNG', !existsSync(join(tmp, 'x.png')))
check('拒绝信息点名要决定的那几件事', /focus[\s\S]*lightAxis[\s\S]*layers[\s\S]*drawingRule[\s\S]*accentBand/.test(refused.stderr ?? ''))

const escaped = spawnSync(process.execPath, [join(ENGINE, 'bin', 'design.mjs'), 'render', bareScene, '--out', tmp, '--name', 'y', '--no-gates'],
  { encoding: 'utf8', cwd: ENGINE })
check('--no-gates 仍可渲染（逃生门有效）', escaped.status === 0 && existsSync(join(tmp, 'y.png')), `exit ${escaped.status}`)

// ── 结论 ────────────────────────────────────────────────────────────────────
console.log('')
if (failures === 0) {
  console.log('本地验证全部通过。剩下的只有一件事是工具查不到的：')
  console.log('新开一个会话，给一个最小任务，看它是否在放第一个元素之前就写出 gates 块 ——')
  console.log('而且不是因为你提醒了它。policy 加载成功 ≠ 被遵守，这一步只能人来判。')
} else {
  console.log(`${failures} 项未通过。先修这些，再谈新会话的行为。`)
}
process.exit(failures === 0 ? 0 : 1)
