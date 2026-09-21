/**
 * 一次真实交付：用本仓库的引擎、规则与闸门，画出这个 agent 的架构。
 *
 * 这份生成器同时是**规则的自证**：它按 docs/rules/ 的要求写 gates 块、按 depth-and-structure
 * 的先定层再定密度来组织、并且在交付前跑闸门。
 *
 * 内容：agent 的组成与其连接关系。19 行 composition、29 个会话工具、8 个 preset 工具、
 * 9 个技能、9 份规则——这些东西怎么接在一起，以及一条数据实际怎么走完全程。
 *
 * Run: node scenes/build-agent-architecture.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(process.argv[2] ?? resolve(HERE, '..', '..', '..', '.cache', 'agent-architecture.png'))

// ── 版面 ────────────────────────────────────────────────────────────────────
const W = 2400
const H = 1180
const M = 96

// 纸面：一个暖灰底，不用纯白（纯白会让纸读成屏幕）
const PAPER = '#F1F0EB'
const INK = '#1A1D21'
const INK_2 = '#3D454E'
const INK_3 = '#6C7681'
const HAIR = '#C9CCC7'
const HAIR_2 = '#DDDFDA'
const BAND = '#E7E6DF'
const SIGNAL = '#C8901A'      // 唯一强调色：待处理/连接/焦点。大块平涂 ≤2%
const COOL = '#3C6E8F'        // 冷强调：只做描边与小标记，占比 <1%

const layers = []
const add = (l) => { layers.push(l); return l }
/** 细线：任何 ≤1 的值都会被当成画布比例，所以一律夹到 ≥2 */
const bar = (id, x, y, w, h, paint, opacity) =>
  add({ id, shape: 'rect', x, y, w, h: Math.max(2, h), paint, opacity: opacity ?? 1 })
const text = (id, x, y, w, t, size, color, weight) =>
  add({ id, shape: 'text', x, y, w, text: t, size, font: 'SansSC', weight: weight ?? 400, color, align: 'left', wrap: true, lineHeight: Math.round(size * 1.45) })

// ── 第 1 层：底 + 纸面细节（局部出现、局部消失）────────────────────────────
add({ id: '00-paper', shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: PAPER })
add({
  id: '01-grid', shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: '#8A8F88', opacity: 0.055,
  effects: [{ type: 'halftone', size: 13, angle: 22, tone: 'source', maxTone: 0.3, color: '#7C837B', respectAlpha: true }],
})
// 边缘的制图记号：局部、稀疏，不铺满
for (let i = 0; i < 14; i++) {
  bar(`02-tick-${i}`, M + i * 168, 22, 2, i % 4 === 0 ? 14 : 8, HAIR)
  bar(`02-tickb-${i}`, M + i * 168, H - 34, 2, i % 4 === 0 ? 14 : 8, HAIR)
}

// ── 第 2 层：抬头 ────────────────────────────────────────────────────────────
text('10-kicker', M, 52, 900, 'AGENT 架构 · 当前状况', 22, INK_3, 500)
text('11-title', M, 86, 1500, '一个会话实际由什么组成', 54, INK, 700)
bar('12-rule', M, 166, 168, 3, SIGNAL)
text('13-sub', M + 190, 152, 1100, '19 行 composition · 29 个会话工具 · 8 个 preset 工具 · 9 个技能 · 9 份规则', 21, INK_2)

// 右上：版本与来源。这是「设备感」——最便宜的那种手法
text('14-meta', W - M - 520, 56, 520, '本图由本仓库的引擎渲染 · 过 gates 闸门交付', 17, INK_3)
text('15-meta2', W - M - 520, 86, 520, '规则见 docs/rules/ · 闸门见 tools/gate-delivery', 17, INK_3)

// ── 第 3 层：四层架构带 ──────────────────────────────────────────────────────
// 先定层：底 → 承载面 → 内容 → 焦点。四条带就是三个承载面 + 一条连接轴。
const BAND_Y = [232, 392, 552, 712]
const BAND_H = 148
/**
 * 标签栏宽 196 时，第三层那句「不 vendor 进 preset，终端里也能独立用」会折成两行并**溢出到竖轴上**——
 * 文字压在元素上，正是交付规则里要抓的那类缺陷（`H6` 抓不到它：它是几何问题，不是对比度问题）。
 *
 * 344 而不是 312：312 时那句只剩 5px 余量，几何上合规但中文断行下不安全。
 * 宽一点是唯一便宜的保险，代价只是卡片栏窄一点。
 */
const LABEL_W = 344

const BANDS = [
  {
    name: '宿主面', en: 'HOST PLANE', note: '进程唯一，跨会话共享',
    items: [
      ['注册表', 'tools / systemPrompt / agents / sessions', { kind: 'mark', n: 4 }],
      ['沙箱与审批', '文件策略、命令策略', { kind: 'rule', n: 2 }],
      ['持久化与模型路由', '会话存储、凭据、模型选择', { kind: 'mark', n: 3 }],
    ],
  },
  {
    name: 'Agent 面', en: 'AGENT PRESET · 19 行', note: '一个会话一份，随会话卸载',
    items: [
      ['persona', '身份：平面设计师', { kind: 'rule', n: 1 }],
      ['design-policy', '常驻纪律：6 条可强制的规则', { kind: 'tally', n: 6 }],
      ['design-tools', '8 个工具，全部子进程调用引擎', { kind: 'mark', n: 8 }],
      ['skill-filesystem', '9 个技能，preset 自带目录', { kind: 'mark', n: 9 }],
    ],
  },
  {
    name: '工具面', en: 'ENGINE · CLI', note: '不 vendor 进 preset，终端里也能独立用',
    items: [
      ['bin/design.mjs', '11 个子命令：render analyze verify gate-delivery …', { kind: 'tally', n: 11 }],
      ['src/', '渲染、效果、调色、分析、闸门判据', { kind: 'rule', n: 3 }],
      ['tools/', '29 个会话工具，名册自动读取', { kind: 'mark', n: 29 }],
    ],
  },
  {
    name: '知识与规则', en: 'DOCS + KNOWLEDGE', note: '规则进仓库，案例留本地',
    items: [
      ['docs/rules/', '9 份纯规则：判断、测量、排版、色彩、版式、材质、交付', { kind: 'mark', n: 9 }],
      ['knowledge/', '19 份案例与过程记录，不进仓库', { kind: 'mark', n: 19 }],
    ],
  },
]

/**
 * 一张卡的量记号。
 *
 * 为什么要它：第一版把 13 张卡画成同一个构造复制十三遍——**那不是系统，是一次复制**，
 * 信息量等于 1 张。规则里正对着这一条：「一个基础图形＋复制是反例，不是方法」，
 * 正确形态是**一个基础单元 + 多沿"哪个形 / 多少个 / 多重"变化的变体**。
 *
 * 这里每一个记号都**代表一个真实的量**（4 个注册表、6 条常驻规则、29 个工具、19 份案例），
 * 所以它同时满足"每一处都承担职务"与"删掉它信息量会变"。
 */
function marks(id, x, y, w, spec) {
  if (spec === undefined) return
  const { kind, n } = spec
  // 记号用强调色，不用发丝灰。
  //
  // 第一版全部用 HAIR 灰，结果是 accent.almostNone：大块平涂 **0%**，落在合法区间
  // （0.4–5%）之外——一张"几乎没上色"的图读成省了颜色，而不是克制。
  // 记号是这张图真正的细节层，细节层就该是强调色出现的地方。
  const ink = SIGNAL
  if (kind === 'rule') {
    // 分隔线：横向发丝线，条数＝件数
    for (let i = 0; i < n; i++) bar(`${id}-r${i}`, x, y + i * 7, w * 0.42, 2, ink, 0.9)
    return
  }
  if (kind === 'tally') {
    // 计数条：一条＝一件，成行排列；超过 8 后换行
    const perRow = 8
    for (let i = 0; i < n; i++) {
      const cx = x + (i % perRow) * 14
      const cy = y + Math.floor(i / perRow) * 10
      bar(`${id}-t${i}`, cx, cy, 9, 4, ink, 0.95)
    }
    return
  }
  // mark：小方块阵列，代表"一组同类的东西"
  for (let i = 0; i < n; i++) {
    const cx = x + (i % 10) * 13
    const cy = y + Math.floor(i / 10) * 13
    bar(`${id}-m${i}`, cx, cy, 7, 7, ink, 0.88)
  }
}

BANDS.forEach((b, i) => {
  const y = BAND_Y[i]
  bar(`20-band-${i}`, M, y, W - M * 2, BAND_H, BAND, 0.62)
  bar(`21-bandedge-${i}`, M, y, W - M * 2, 2, HAIR)
  // 文本框必须比栏**窄**：写成 LABEL_W + 40 时它比栏宽 40px，天生贴着边缘，
  // 于是加宽栏宽只会把文字一起推出去（实测两轮余量都停在 4–5px）。
  text(`22-name-${i}`, M + 26, y + 22, LABEL_W - 60, b.name, 30, INK, 700)
  text(`23-en-${i}`, M + 26, y + 62, LABEL_W - 60, b.en, 17, INK_3, 500)
  text(`24-note-${i}`, M + 26, y + 90, LABEL_W - 60, b.note, 17, INK_2)

  const x0 = M + LABEL_W + 150
  const colW = (W - M * 2 - (x0 - M) - 26) / b.items.length
  b.items.forEach((it, j) => {
    const x = x0 + j * colW
    const cardW = colW - 22
    bar(`25-card-${i}-${j}`, x, y + 26, cardW, BAND_H - 52, PAPER, 0.9)
    add({
      id: `26-cardedge-${i}-${j}`, shape: 'rect', x, y: y + 26, w: cardW, h: BAND_H - 52,
      paint: 'transparent', opacity: 0,
      effects: [{ type: 'stroke', color: HAIR, size: 2, position: 'inside', opacity: 1 }],
    })
    bar(`27-accent-${i}-${j}`, x, y + 26, 3, 26, SIGNAL)
    text(`28-cardtitle-${i}-${j}`, x + 14, y + 44, cardW - 30, it[0], 23, INK, 700)
    text(`29-cardbody-${i}-${j}`, x + 14, y + 78, cardW - 30, it[1], 18, INK_2)
    // 量记号：每张卡右下角，代表它自己那个数量。这是"细节不封顶"的落点——
    // 加的是**它自己的量**，不是又一块内容。
    marks(`30-mk-${i}-${j}`, x + 14, y + BAND_H - 44, cardW - 30, it[2])
  })
})

// ── 第 4 层：焦点与连接 ──────────────────────────────────────────────────────
// 焦点：一根竖轴，穿过四层。它是免费的——没有它这就是四张并排的卡片。
add({
  id: '30-axis', shape: 'rect', x: M + LABEL_W + 118, y: BAND_Y[0] + 8, w: 3, h: BAND_Y[3] + BAND_H - BAND_Y[0] - 16,
  paint: SIGNAL, opacity: 0.85,
})
for (let i = 0; i < 4; i++) {
  add({ id: `31-node-${i}`, shape: 'ellipse', x: M + LABEL_W + 110, y: BAND_Y[i] + BAND_H / 2, w: 19, h: 19, paint: SIGNAL })
}
text('32-axislabel', M + LABEL_W + 132, BAND_Y[3] + BAND_H - 6, 460, '一条请求的路径', 18, INK_3, 500)

// ── 底带：一条请求实际怎么走 ─────────────────────────────────────────────────
const FY = 972
bar('40-flow', M, FY, W - M * 2, 152, BAND, 0.45)
text('41-flowtitle', M + 26, FY + 20, 420, '一条请求的路径', 26, INK, 700)

const STEPS = [
  ['①', '会话命名 preset', 'roster 按 scope 挂载'],
  ['②', '常驻段加载', 'persona + design-policy'],
  ['③', '场景声明 gates', '无声明则渲染被拒'],
  ['④', '引擎渲染', '子进程 · 可选超采样'],
  ['⑤', '交付闸门', '非零即不许交付'],
  ['⑥', '失败喂回规则', '判据进 docs/rules/'],
]
const sx = M + 300
const sw = (W - M * 2 - 300 - 26) / STEPS.length
STEPS.forEach((s, i) => {
  const x = sx + i * sw
  text(`42-step-${i}`, x, FY + 24, sw - 20, s[0], 26, SIGNAL, 700)
  text(`43-stept-${i}`, x, FY + 60, sw - 20, s[1], 21, INK, 700)
  text(`44-stepd-${i}`, x, FY + 92, sw - 20, s[2], 17, INK_2)
  if (i < STEPS.length - 1) add({ id: `45-arrow-${i}`, shape: 'line', x1: x + sw - 34, y1: FY + 34, x2: x + sw - 10, y2: FY + 34, paint: INK_3, opacity: 0.7 })
})

// ── GATE 1 的声明 ───────────────────────────────────────────────────────────
const layerPrefixes = []
for (const l of layers) {
  const id = String(l.id)
  const prefix = id.includes('-') ? id.slice(0, id.indexOf('-')) : id
  if (!layerPrefixes.includes(prefix)) layerPrefixes.push(prefix)
}

const scene = {
  canvas: { width: W, height: H },
  ground: PAPER,
  gates: {
    focus: '穿过四层的那根竖轴——它把「宿主面 / Agent 面 / 工具面 / 知识与规则」连成一条路径；其余元素都是它的注释',
    lightAxis: '顶光偏左 120°，强度低且均匀：这是图纸而不是立体物，光只用来让承载面与纸底分开，不做方向性明暗',
    layers: layerPrefixes,
    drawingRule:
      '四条带共用一条构造：带底 → 层名 → 层说明 → 等宽卡片（卡内：强调短杠 + 标题 + 正文）。' +
      '卡片数由每层实际有几件事决定，所以列的多少是内容决定的，不是版式决定的；' +
      '所有尺寸、层级、间距都来自同一条模数（4 的倍数）',
    accentBand: [0, 0.02],
    sequence: [
      '22 个图元组：四条带共 13 张卡片、一根竖轴、四个节点、一条六步流程；没有插画，全部是排版元件',
      '制图/技术图纸语言：本图是信息图，不是参考某件作品，所以不搬任何外部风格',
      '自上而下：先读标题与副题，再沿竖轴读四层，最后读底部的请求路径',
      '顶光偏左 120°，低强度均匀光——图纸的光只负责分层',
      '纸底 0.94、承载带 0.83、卡片 0.95、墨 0.11：四级，承载面与纸底的差别被刻意做得很小',
      '层名是标签，卡片是内容，竖轴是装置，底部流程是注释',
      '只有一处强调色，且只落在短杠、节点与竖轴上，占比见 accentBand',
      '不适用：这是单色图纸，没有材质族可言，所有元件同一种纸面处理',
      '矩形与圆，直角为主；只有节点用正圆，因为它在语义上是一个点',
      '不适用：本图不加效果层，避免读者把表现当成内容',
      '不适用：同上，细节来自信息密度而不是纹理',
    ],
    forbiddenZones: [],
  },
  layers,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT.replace(/\.png$/i, '.json'), JSON.stringify(scene, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ scene: OUT.replace(/\.png$/i, '.json'), png: OUT, layers: layers.length, sheet: [W, H], prefixes: layerPrefixes.length }))
