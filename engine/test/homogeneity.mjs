/**
 * 同质化检测：细节的成对失败。
 *
 * 「细节不够」的成对失败是「同一个细节 N 遍」，而它在本文件此前所有的计数上都**看起来像成功**：
 * 元素数高、不透明度低、细节局部。13 张同一个构造复制出来的卡片全部通过。
 *
 * 所以这条判据量的是**签名重复率**（形状 + 量化尺寸），从**场景**量而不是从像素量——
 * 它是关于"重复"的断言，而场景知道什么被重复了。像素measure 在小尺寸下分不出
 * 「二十个互不相同的记号」与「二十个一模一样的记号」，那正是让倍数判据失效的分辨率限制，
 * 所以这里不重犯那个错误。
 *
 * Run: node test/homogeneity.mjs
 */
import { verifyScene } from '../src/verify.mjs'

let failed = 0
let checks = 0
function check(label, ok, detail) {
  checks++
  if (ok) console.log(`  ok    ${label}${detail === undefined ? '' : '  — ' + detail}`)
  else { failed++; console.log(`  FAIL  ${label}${detail === undefined ? '' : '  — ' + detail}`) }
}

const gates = {
  focus: 'a fixture', lightAxis: 'flat', layers: ['a', 'b'], drawingRule: 'stated',
  accentBand: [0, 0.05],
  sequence: ['x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x'],
}

/** 一张底 + n 个同尺寸的卡片；varied 为真时每张尺寸不同。 */
function sheet(n, { varied = false, cardH = 40 } = {}) {
  const layers = [{ id: 'bg', shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: '#FFFFFF' }]
  for (let i = 0; i < n; i++) {
    layers.push({
      id: `card-${i}`, shape: 'rect',
      x: 20 + (i % 8) * 90, y: 20 + Math.floor(i / 8) * 60,
      w: 80, h: varied ? cardH + i * 3 : cardH,
      paint: '#333333', opacity: 0.9,
    })
  }
  return { canvas: { width: 900, height: 600 }, ground: '#FFFFFF', gates, layers }
}

const find = (res, code) => res.issues.find((i) => i.code === code)

console.log('同质化 —— 一个构造复制 N 遍必须被报出来')
{
  const same = verifyScene(sheet(16))
  const msg = find(same, 'density.homogeneous')
  check('16 张同尺寸卡片 → error density.homogeneous', msg !== undefined && msg.severity === 'error',
    msg === undefined ? '没有报出来' : `${msg.severity}`)
  check('报出的是"同一个签名被重复了多少次"',
    msg !== undefined && /16 of 17 elements are the same signature/.test(msg.message),
    msg === undefined ? '' : String(msg.message).slice(0, 80))
  check('同时给出签名总数，好让人知道缺的是变化',
    msg !== undefined && /only \d+ distinct signatures/.test(msg.message), '')
  check('消息里点名了那个被重复的元素', msg !== undefined && /card-0/.test(msg.message), '')
  check('metrics 里给出重复率，可被闸门或报告读取',
    same.metrics.largestRepeatedShare > 0.9,
    `largestRepeatedShare = ${same.metrics.largestRepeatedShare}`)
}

console.log('\n放行组 —— 变化过的组不该被拦')
{
  const varied = verifyScene(sheet(16, { varied: true }))
  check('16 张尺寸各不相同的卡片 → 不报 error',
    find(varied, 'density.homogeneous') === undefined,
    find(varied, 'density.homogeneous') === undefined ? '' : '★ 误报')
  check('尺寸变化被算成不同签名',
    varied.metrics.distinctElementSignatures >= 16,
    `${varied.metrics.distinctElementSignatures} 个签名`)
  check('给出 note 说明变化量（告知，不是判据）',
    find(varied, 'density.varied') !== undefined, '')
}

console.log('\n边界 —— 少量重复不该被当成病')
{
  const few = verifyScene(sheet(6))
  check('只有 6 张卡片时不报同质（样本太小，判断没有意义）',
    find(few, 'density.homogeneous') === undefined && find(few, 'density.repetitive') === undefined,
    '')
  const mild = verifyScene(sheet(20, { varied: true }))
  check('变化过的 20 张不触发 repetitive',
    find(mild, 'density.repetitive') === undefined, '')
}

console.log('\n签名用形状 + 量化尺寸，不用 id')
{
  // id 天生唯一，若拿 id 当签名，任何场景都会报"完全多样"——那是恒真判据，等于没有判据。
  const a = verifyScene(sheet(16))
  check('同尺寸不同 id 被判为同一组（id 不参与签名）',
    a.metrics.largestRepeatedGroup === 16, `最大组 ${a.metrics.largestRepeatedGroup}`)
  // 形状不同则签名不同
  const mixed = sheet(16)
  mixed.layers[3].shape = 'ellipse'
  const b = verifyScene(mixed)
  check('换成椭圆后从那一组里分出（形状参与签名）',
    b.metrics.largestRepeatedGroup === 15, `最大组 ${b.metrics.largestRepeatedGroup}`)
}

console.log(`\n${checks - failed}/${checks} checks passed`)
process.exit(failed === 0 ? 0 : 1)
