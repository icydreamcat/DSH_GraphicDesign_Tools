/**
 * 双向自测：闸门必须会拒绝，也必须会放行。
 *
 * 只会拒绝的闸门会被关掉；只会放行的闸门是装饰。所以两组都要验：
 *   拒绝组 —— 每一种违规都必须 exit≠0，并给出可行动的说明
 *   放行组 —— 一个正确声明的场景必须 exit 0
 *
 * 用临时目录里的合成场景，不依赖任何素材，所以在任何机器上都能跑。
 */
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const DESIGN = join(ENGINE, 'bin', 'design.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'gate-both-ways-'))

let failed = 0
let checks = 0
const check = (label, ok, detail) => {
  checks++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : '  — ' + detail}`)
  if (!ok) failed++
}

/** 一份最小的合法场景；overrides 用来制造各种违规。 */
function scene(overrides = {}) {
  const base = {
    canvas: { width: 300, height: 200 },
    ground: '#FFFFFF',
    gates: {
      focus: 'the single black square, and it competes with nothing',
      lightAxis: 'flat, no light — this is a fixture, not a design',
      layers: ['bg', 'fg'],
      drawingRule: 'two rectangles, each stated as its own layer',
      accentBand: [0, 0.05],
      // The decision order, stated in order. An array entry IS the step at its position.
      sequence: [
        'two rectangles: a full-bleed ground and one square',
        'not a reference-driven piece — this is a fixture, so no reference language applies',
        'the square, then nothing else',
        'no depicted light; the fixture is flat on purpose',
        'one ink, one paper — no tonal banding to decide',
        'the square is the subject; the ground is the field it stands on',
        'one black accent on white, inside accentBand',
        'one material family, so nothing to interleave',
        'rectangles only, placed as declared',
        'no effects on this fixture',
        'no texture: the fixture exists to test the gate, not to look like anything',
      ],
    },
    layers: [
      { id: 'bg', shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: '#FFFFFF' },
      { id: 'fg', shape: 'rect', x: 40, y: 40, w: 80, h: 80, paint: '#000000' },
    ],
  }
  const merged = { ...base, ...overrides }
  if (overrides.gates === undefined && overrides.gates !== null) merged.gates = base.gates
  return merged
}

/** The valid gates from `scene()`, for building single-change violations. */
const goodGates = () => JSON.parse(JSON.stringify(scene().gates))

function write(name, obj) {
  const p = join(tmp, `${name}.json`)
  writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8')
  return p
}

function render(name, obj, extra = []) {
  const p = write(name, obj)
  const r = spawnSync(process.execPath, [DESIGN, 'render', p, '--out', tmp, '--name', name, ...extra],
    { encoding: 'utf8', cwd: ENGINE })
  return { status: r.status, stderr: `${r.stderr ?? ''}`, png: join(tmp, `${name}.png`) }
}

function gate(name, obj, extra = []) {
  const p = write(name, obj)
  const r = spawnSync(process.execPath, [DESIGN, 'gate-delivery', p, ...extra],
    { encoding: 'utf8', cwd: ENGINE })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

console.log('\n放行组 —— 正确声明的场景必须通过')
{
  const r = render('ok', scene())
  check('合法场景渲染成功', r.status === 0 && existsSync(r.png), `exit ${r.status}`)
  const g = gate('ok', scene())
  check('合法场景交付闸门 exit 0', g.status === 0, `exit ${g.status}`)
  check('闸门报告里点名了 H1（warnings 为空）', g.out.includes('H1'))
}

console.log('\n拒绝组 · 渲染 —— gates 的各种残次品都必须挡住')
{
  // Every case derives from the VALID declaration and changes ONE thing, so a failure names the
  // thing under test rather than "and also it had no sequence" — a test that fails for two reasons
  // stops telling you which one it is testing.
  const mutate = (fn) => { const g = goodGates(); fn(g); return scene({ gates: g }) }
  const cases = [
    ['无 gates 块', scene({ gates: null }), null],
    ['gates 是数组', scene({ gates: [] }), null],
    ['缺 focus', mutate((g) => { delete g.focus }), 'focus'],
    ['focus 是空串', mutate((g) => { g.focus = '   ' }), 'focus'],
    ['layers 只有一个（表达不了顺序）', mutate((g) => { g.layers = ['bg'] }), 'two'],
    ['accentBand 不是两个数', mutate((g) => { g.accentBand = [0.05] }), 'accentBand'],
    ['accentBand 倒置', mutate((g) => { g.accentBand = [0.5, 0.05] }), 'accentBand'],
    ['缺 drawingRule', mutate((g) => { delete g.drawingRule }), 'drawingRule'],
    // The decision order, which is the newest part of the contract and the easiest to skip.
    ['缺 sequence', mutate((g) => { delete g.sequence }), 'sequence'],
    ['sequence 少两步', mutate((g) => { g.sequence = g.sequence.slice(0, 9) }), 'does not account for step'],
    ['sequence 多一条', mutate((g) => { g.sequence = [...g.sequence, 'an extra thing'] }), 'more entries'],
    ['sequence 标不适用但没原因', mutate((g) => { g.sequence[6] = {} }), 'without a reason'],
    ['sequence 把不可跳的一步标不适用', mutate((g) => { g.sequence[0] = { why: 'skipped it' } }), 'cannot be skipped'],
    ['sequence 是空数组', mutate((g) => { g.sequence = [] }), 'empty'],
  ]
  for (const [label, obj, needle] of cases) {
    const r = render(`bad-${cases.findIndex((c) => c[0] === label)}`, obj)
    const ok = r.status !== 0 && !existsSync(r.png) && (needle === null || r.stderr.includes(needle))
    check(label, ok, `exit ${r.status}${needle === null || r.stderr.includes(needle) ? '' : `（信息里没有 "${needle}"）`}`)
  }

  // The order can only be checked where names are explicit — the object form. The array form's
  // meaning IS the sequence, so reordering it is not a detectable error, it is a different order.
  console.log('  — 顺序本身：对象形式里指名才查得到')
  const outOfOrder = goodGates()
  const keys = ['inventory', 'language', 'sightline', 'tonalBands', 'roles', 'saturation', 'interleave', 'form', 'effects', 'texture', 'lightAxis']
  const named = {}
  for (const k of keys) named[k] = 'stated'
  const r2 = render('bad-order', scene({ gates: { ...goodGates(), sequence: named } }))
  check('对象形式把光轴挪到最后 → 拦住', r2.status !== 0 && r2.stderr.includes('out of order'),
    `exit ${r2.status}`)

  // And the valid declaration must still pass in the object form, or the check would be unusable.
  const objFine = {}
  for (const k of ['inventory', 'language', 'sightline', 'lightAxis', 'tonalBands', 'roles', 'saturation', 'interleave', 'form', 'effects', 'texture']) objFine[k] = 'stated'
  const r3 = render('ok-object-form', scene({ gates: { ...goodGates(), sequence: objFine } }))
  check('对象形式按序声明 → 放行', r3.status === 0 && existsSync(r3.png), `exit ${r3.status}`)
}

console.log('\n拒绝组 · 交付闸门 —— 声明齐全但内容违规时也必须挡住')
{
  // H4：声明的顺序与实际顺序相反
  const wrongOrder = scene()
  wrongOrder.gates.layers = ['fg', 'bg']
  const g1 = gate('h4', wrongOrder)
  check('H4：声明层序与实际相反 → 非零', g1.status !== 0 && g1.out.includes('H4'), `exit ${g1.status}`)

  // H4b：前景元素压进 forbiddenZone
  const zoneHit = scene()
  zoneHit.gates.forbiddenZones = [{ name: 'face', x: 30, y: 30, w: 100, h: 100 }]
  const g2 = gate('h4b', zoneHit)
  check('H4b：元素落进 forbiddenZone → 非零', g2.status !== 0 && g2.out.includes('H4b'), `exit ${g2.status}`)

  // H4b 反例：声明底图后必须放行；用盖满画布的元素模拟底图
  const zoneOk = scene()
  zoneOk.gates.forbiddenZones = [{ name: 'face', x: 30, y: 30, w: 100, h: 100 }]
  zoneOk.gates.groundEntities = ['fg']
  const g3 = gate('h4b-ok', zoneOk)
  check('H4b：声明 groundEntities 之后放行（豁免真的生效）', g3.status === 0, `exit ${g3.status}`)

  // H4b 的代价与风险挂钩：不相交时零代价，相交时给出位置、比例与一条能直接跑的裁切命令。
  const noTouch = scene()
  noTouch.gates.forbiddenZones = [{ name: 'face', x: 200, y: 120, w: 80, h: 70 }]
  const g3b = gate('h4b-notouch', noTouch)
  check('H4b：声明了禁区但几何上不相交 → 放行，且明说不需要看图',
    g3b.status === 0 && /no look needed/.test(g3b.out), `exit ${g3b.status}`)
  check('H4b：不相交时不要求任何物证，也不打印裁切命令',
    !/LOOK:/.test(g3b.out), '未相交却要了图就是无谓开销')

  // 相交那一路：渲染出 PNG，把 --png 给闸门，裁切命令必须带真实坐标且可直接执行。
  const touched = scene()
  touched.gates.forbiddenZones = [{ name: 'face', x: 60, y: 60, w: 120, h: 100 }]
  const rendered = render('h4b-touch', touched)
  const g3c = spawnSync(process.execPath,
    [DESIGN, 'gate-delivery', write('h4b-touch-gate', touched), '--png', rendered.png],
    { encoding: 'utf8', cwd: ENGINE })
  const out3c = `${g3c.stdout ?? ''}${g3c.stderr ?? ''}`
  const lookLine = out3c.split('\n').find((l) => /LOOK:/.test(l)) ?? ''
  const coords = /(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+1\s*$/.exec(lookLine.replace(/\r$/, ''))
  check('H4b：相交时报出比例与位置', g3c.status !== 0 && /\d+% of the zone/.test(out3c), `${out3c.split('\n').find((l) => /overlaps/.test(l)) ?? '无'}`.trim().slice(0, 80))
  check('H4b：相交时打印一条可直接执行的裁切命令', lookLine !== '' && coords !== null,
    lookLine === '' ? '没有 LOOK 行' : `坐标 ${coords === null ? '缺失' : coords.slice(1).join(' ')}`)
  check('H4b：明说几何不等于遮挡，裁决要靠看', /Geometry is not occlusion/.test(out3c))
  if (coords !== null) {
    // 命令必须真的能跑 —— 一句不能执行的指示等于没给。
    const crop = spawnSync(process.execPath,
      [join(ENGINE, 'tools', 'crop-view.mjs'), rendered.png, join(tmp, 'zone-look.png'),
        coords[1], coords[2], coords[3], coords[4], '1'],
      { encoding: 'utf8', cwd: ENGINE })
    check('H4b：那条裁切命令真的跑得通', crop.status === 0 && existsSync(join(tmp, 'zone-look.png')),
      `exit ${crop.status}`)
  }

  // H5：声明为 sheet 的图层半透明
  const semi = scene()
  semi.gates.sheetRoles = ['fg']
  semi.layers = [
    { id: 'bg', shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: '#FFFFFF' },
    { id: 'fg', shape: 'rect', x: 40, y: 40, w: 80, h: 80, paint: '#000000', opacity: 0.6 },
  ]
  const g4 = gate('h5', semi)
  check('H5：声明为 sheet 却半透明 → 非零', g4.status !== 0 && g4.out.includes('H5'), `exit ${g4.status}`)

  // H5 反例：没声明 sheet 时必须 SKIP 而不是 PASS
  const g5 = gate('h5-none', scene())
  check('H5：不声明 sheet 时给 SKIP（不是 PASS）', g5.out.includes('SKIP') && g5.out.includes('H5'), '未声明应被明说')

  // H5 反例：显式声明 overlay 的图层半透明，必须放行
  const overlay = scene()
  overlay.gates.sheetRoles = [{ id: 'fg', role: 'overlay' }]
  overlay.layers = [
    { id: 'bg', shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: '#FFFFFF' },
    { id: 'fg', shape: 'rect', x: 40, y: 40, w: 80, h: 80, paint: '#000000', opacity: 0.6 },
  ]
  const g6 = gate('h5-overlay', overlay)
  check('H5：声明 role:overlay 之后放行', g6.status === 0, `exit ${g6.status}`)
}

console.log('\n拒绝组 · 渲染器自身的静默失败 —— warnings 非空必须被 H1 拦住')
{
  // 故意用一个不存在的混合模式。期望的行为是分层的：
  //   渲染：成功，但那一层失败进 warnings —— 渲染整体不该因为一层失败就崩，图里其它部分仍然有效
  //   交付：**必须被拦住**，因为 warnings 非空意味着图里少了东西而画面看不出来
  // 第一版这里断言"渲染报错"，是错的：拦在交付、不拦在渲染，正是设计意图。
  const badBlend = scene()
  badBlend.layers = [
    { id: 'bg', shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: '#FFFFFF' },
    { id: 'fg', shape: 'rect', x: 40, y: 40, w: 80, h: 80, paint: '#000000', blend: 'softLight' },
  ]
  const r = render('badblend', badBlend)
  check('拼错的混合模式：渲染仍完成（一层失败不该崩掉整张图）', r.status === 0, `exit ${r.status}`)

  const reportPath = join(tmp, 'badblend.report.json')
  let warned = false
  let warningText = ''
  if (existsSync(reportPath)) {
    const rep = JSON.parse(readFileSync(reportPath, 'utf8'))
    const w = (rep.report && rep.report.warnings) || []
    warned = w.length > 0
    warningText = w.join(' | ')
  }
  check('拼错的混合模式进了 warnings（不再静默）', warned, warningText.slice(0, 90) || 'report 里没有警告')
  check('警告里点名了那个拼错的值与合法值',
    warningText.includes('softLight') && warningText.includes('soft-light'), warningText.slice(0, 90))

  const g = gate('badblend', badBlend, ['--report', reportPath])
  check('交付闸门因 warnings 非空而拒绝（H1）', g.status !== 0 && g.out.includes('H1'), `exit ${g.status}`)
}

console.log(`\n${checks - failed}/${checks} 项通过`)
console.log(failed === 0
  ? '闸门双向都验过：会拒绝，也会放行。'
  : '有项未通过 —— 闸门在某个方向上是聋的。')
process.exit(failed === 0 ? 0 : 1)
