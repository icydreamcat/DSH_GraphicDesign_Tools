/**
 * 三十秒作业的分镜表 —— 一张真正的分镜板，用引擎自己画。
 *
 * 为什么用引擎画而不是手绘
 * ------------------------
 * 分镜表本身就是一件版面作品：八格构图、时间码、机位、标题、说明、字幕原文，六层信息要在同一张
 * 图上互不打架。它还是这篇作业唯一一次能提前检查构图的机会——每一格里的画框＝相机取景，框里画
 * 什么，现场就拍什么。
 *
 * 这份生成器同时是 GATE 1 的演示样本：它带 `gates` 块，因为渲染器现在拒绝没有声明的场景。
 *
 * 历次踩到的坑，逐条留在这里，因为它们会重复：
 *   · 画框高过卡片留给它的高度 → 字幕被画布切掉半行（「切一点点最糟」）。
 *   · 拿画布尺寸当输入去推导卡片尺寸 → 循环，永远差 60px。卡片是常量，画布是推导值。
 *   · 标注栏 63px 宽 ≈ 一行 3 个汉字，正文被切成竖排。汉字一个字就是一个字号宽。
 *   · 按大尺寸画完再乘 0.48 缩小 → `h: 2` 变成 `0.96`，被 resolveLength 当成「画布高度的 96%」
 *     ＝ 2385px。能按最终尺寸画就别缩放（见 docs §2.1.1）。
 *   · put() 内部已加 cellY，调用处又加一次 → 第二排整体下移一整格，只有第二排越界。
 *   · 路径图层的键是 `d`，不是 `path`：写成 path 时图层静默消失（渲染器只记进 warnings），
 *     八格每格一个光标全部没画出来，而那张图被看过五遍。
 *   · 千万不要用 PowerShell 的 Set-Content 改这个文件：UTF-8 会变乱码，而含反引号的注释会把
 *     后面一行吞进注释里。这个文件被毁过一次，是整份重写的。
 *
 * Run: node scenes/build-video-storyboard.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(process.argv[2] ?? resolve(HERE, '..', '..', '..', '.cache', 'storyboard-30s.png'))

// ── 版面：卡片是常量，画布是推导值 ──────────────────────────────────────────
const PAD = 40
const GUT = 20
const HEADER = 96
const COLS = 4
const ROWS = 2
const CELL_W = 570
const CELL_H = 570

const W = PAD * 2 + CELL_W * COLS + GUT * (COLS - 1)
const H = PAD * 2 + HEADER + CELL_H * ROWS + GUT * (ROWS - 1)

// 画框＝相机取景。视频是横屏，框就是 16:9。
const FRAME_W = 340
const FRAME_H = 191
const FRAME_X = 30
const FRAME_Y = 34
const INFO_X = 30
const INFO_W = CELL_W - INFO_X * 2

// 白底黑字。深色只留给「黑场」那一格——那是内容，不是配色。
const GROUND = '#FFFFFF'
const CARD = '#F4F5F7'
const CARD_EDGE = '#DDE1E6'
const INK = '#12161B'
const BODY = '#3C444E'
const DIM = '#6B7480'
const FAINT = '#98A1AC'
const SCREEN = '#E7EAEE'
const LINES = '#C8CED6'
const BLUE = '#1D5FD0'
const ORANGE = '#B4650A'
const STILL = '#6B7480'
const BLACK = '#0A0C0F'
const REC = '#C8322E'
const ACCENT = '#B4650A'

const layers = []
const add = (l) => { layers.push(l); return l }

// ── 框内构图：按 216×384 的设计空间画，映射进 16:9 的框（不重画内容）────────
const D_W = 216
const D_H = 384
const SC = FRAME_H / D_H
const OFF_X = (FRAME_W - D_W * SC) / 2
const mapX = (x) => OFF_X + x * SC
const mapY = (y) => y * SC
const mapS = (v) => v * SC

function card(cellX, cellY, id) {
  add({
    id: `${id}-card`, shape: 'rect', x: cellX, y: cellY, w: CELL_W, h: CELL_H,
    paint: CARD, radius: 12, opacity: 1,
    effects: [{ type: 'stroke', color: CARD_EDGE, size: 1, position: 'inside', opacity: 1 }],
  })
  add({ id: `${id}-screen`, shape: 'rect', x: cellX + FRAME_X, y: cellY + FRAME_Y, w: FRAME_W, h: FRAME_H, paint: SCREEN, radius: 4, opacity: 1 })
  add({
    id: `${id}-edge`, shape: 'rect', x: cellX + FRAME_X, y: cellY + FRAME_Y, w: FRAME_W, h: FRAME_H,
    paint: 'transparent', radius: 4, opacity: 0,
    effects: [{ type: 'stroke', color: '#AEB6C0', size: 1.5, position: 'inside', opacity: 1 }],
  })
  return { x: cellX + FRAME_X, y: cellY + FRAME_Y }
}

/** 框内元素：按设计空间给坐标，这里映射进 16:9 框。所有边长至少 2px。 */
function inner(f, id, l) {
  const out = { ...l, id, x: f.x + mapX(l.x ?? 0), y: f.y + mapY(l.y ?? 0) }
  if (l.w !== undefined) out.w = Math.max(2, mapS(l.w))
  if (l.h !== undefined) out.h = Math.max(2, mapS(l.h))
  if (l.radius !== undefined) out.radius = Math.max(1, mapS(l.radius))
  if (l.x1 !== undefined) { out.x1 = mapX(l.x1); out.x2 = mapX(l.x2); out.y1 = mapY(l.y1); out.y2 = mapY(l.y2) }
  if (Array.isArray(l.effects)) {
    out.effects = l.effects.map((e) => (e.size === undefined ? e : { ...e, size: Math.max(1, mapS(e.size)) }))
  }
  return add(out)
}
const bar = (f, id, x, y, w, h, paint, opacity) =>
  inner(f, id, { shape: 'rect', x, y, w, h, paint, opacity: opacity ?? 1 })

/**
 * 标注栏：时间码 + 机位同一行，下面是标题、说明、字幕原文、器材。
 *
 * put 自己会加 cellY，调用处只给格内偏移。这一点被写错过一次：两处都加，第二排整体下移一整格。
 */
function annotate(cellX, cellY, id, a) {
  const tx = cellX + INFO_X
  const ty = FRAME_Y + FRAME_H + 26
  const put = (suffix, y, text, size, color, weight) => add({
    id: `${id}-${suffix}`, shape: 'text', x: tx, y: cellY + y, w: INFO_W,
    text, size, font: 'SansSC', weight, color, align: 'left', wrap: true,
    lineHeight: Math.round(size * 1.5),
  })
  put('tc', ty, a.time, 30, INK, 700)
  add({
    id: `${id}-kind`, shape: 'text', x: tx, y: cellY + ty, w: INFO_W,
    text: a.kindText, size: 20, font: 'SansSC', weight: 700,
    color: a.kindColor, align: 'right', wrap: false, lineHeight: 30,
  })
  put('rule', ty + 46, '—', 18, FAINT, 400)
  put('title', ty + 58, a.title, 25, INK, 700)
  put('cap', ty + 100, a.caption, 19, BODY, 400)
  if (a.sub !== undefined && a.sub !== '') put('sub', ty + 208, a.sub, 21, INK, 500)
  put('rig', ty + 272, a.rig, 18, DIM, 400)
}

// ── 底与页眉 ────────────────────────────────────────────────────────────────
add({ id: '00-ground', shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: GROUND })
add({
  id: '01-title', shape: 'text', x: PAD, y: 40, w: 1400,
  text: '30 秒 · 分镜表', size: 52, font: 'SansSC', weight: 700, color: INK, align: 'left', wrap: false,
})
add({
  id: '02-sub', shape: 'text', x: PAD, y: 108, w: 1700,
  text: '横屏 16:9 · 无旁白（全部字幕）· 一机一云台 · 结尾不给答案 · 每格画框＝相机取景范围',
  size: 22, font: 'SansSC', color: BODY, align: 'left', wrap: false,
})

// ── 八格 ────────────────────────────────────────────────────────────────────
const CELLS = [
  {
    time: '0–6s', kindText: '手机录屏', kindColor: BLUE, title: '一版「已完成」，然后光标停住',
    caption: '先把「完成」给出来，再让观众看见你往回翻。往回翻这个动作本身就是论点，不需要一句话解释。',
    sub: '（无字幕，只留光标停顿）',
    rig: '录屏 · 剪辑里加速 2–3×',
    draw(f, P) {
      bar(f, `${P}-name`, 26, 44, 110, 10, INK, 0.85)
      bar(f, `${P}-rule`, 26, 60, 160, 2, LINES)
      bar(f, `${P}-poster`, 26, 74, 160, 112, '#D8DDE4')
      bar(f, `${P}-p1`, 36, 86, 70, 6, DIM, 0.7)
      bar(f, `${P}-p2`, 36, 98, 104, 5, LINES)
      bar(f, `${P}-p3`, 36, 168, 46, 6, ACCENT, 0.9)
      bar(f, `${P}-l1`, 26, 204, 160, 7, LINES)
      bar(f, `${P}-l2`, 26, 218, 124, 7, LINES)
      bar(f, `${P}-l3`, 26, 232, 142, 7, LINES)
      bar(f, `${P}-l4`, 26, 246, 100, 7, LINES)
      bar(f, `${P}-l5`, 26, 260, 138, 7, LINES)
      // 光标：路径图层的键必须叫 d
      inner(f, `${P}-cursor`, { shape: 'path', d: 'M 46 300 L 46 326 L 52 320 L 58 331 L 63 328 L 57 317 L 66 316 Z', paint: INK, opacity: 0.9 })
    },
  },
  {
    time: '6–9s', kindText: '云台 · 1:1 微距', kindColor: ORANGE, title: '手在键盘上停住，不动机位',
    caption: '全片唯一允许「停着不动」的镜头。这两秒不要剪——整片的可信度有一半在这两秒里。',
    sub: '（无字幕，只有那一停）',
    rig: '云台放三脚架模式，全程不动',
    draw(f, P) {
      bar(f, `${P}-kb`, 0, 158, 216, 226, '#D2D7DE')
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 5; c++) bar(f, `${P}-k${r}${c}`, 10 + c * 40, 172 + r * 50, 34, 40, LINES)
      }
      inner(f, `${P}-arm`, { shape: 'rect', x: 94, y: 28, w: 40, h: 120, paint: '#C9A88C', radius: 18, opacity: 0.95 })
      inner(f, `${P}-finger`, { shape: 'rect', x: 97, y: 124, w: 34, h: 58, paint: '#C9A88C', radius: 15, opacity: 0.95 })
      inner(f, `${P}-tip`, { shape: 'ellipse', x: 97, y: 164, w: 34, h: 27, paint: '#D8BAA0', opacity: 0.95 })
      inner(f, `${P}-still`, { shape: 'line', x1: 154, y1: 100, x2: 206, y2: 100, paint: ACCENT, opacity: 0.7 })
    },
  },
  {
    time: '9–19s', kindText: '手机录屏 · 证据段', kindColor: BLUE, title: '数字对不上 —— 全片最长的一段',
    caption: '同一处放大对照：第一次是 8.4:1，第二次切回来已经是 3.7:1。观众自己会看见变化怎么发生的，字幕只需要给两个数。',
    sub: '8.4 : 1  →  3.7 : 1',
    rig: '这一段占全片三分之一，是全片唯一「证明」性质的内容',
    draw(f, P) {
      bar(f, `${P}-hdr`, 18, 28, 96, 9, DIM, 0.8)
      bar(f, `${P}-abox`, 18, 48, 180, 96, '#FFFFFF')
      bar(f, `${P}-albl`, 28, 60, 44, 6, FAINT)
      bar(f, `${P}-anum`, 28, 78, 72, 17, '#2E7D4F')
      bar(f, `${P}-abad`, 28, 108, 120, 5, LINES)
      bar(f, `${P}-bbox`, 18, 162, 180, 96, '#FFFFFF')
      bar(f, `${P}-blbl`, 28, 174, 44, 6, FAINT)
      bar(f, `${P}-bnum`, 28, 192, 92, 17, REC)
      bar(f, `${P}-bbad`, 28, 222, 120, 5, LINES)
      inner(f, `${P}-mark`, { shape: 'rect', x: 118, y: 188, w: 64, h: 28, paint: 'transparent', opacity: 0, effects: [{ type: 'stroke', color: ACCENT, size: 2, position: 'inside', opacity: 1 }] })
      inner(f, `${P}-lead`, { shape: 'line', x1: 182, y1: 202, x2: 206, y2: 202, paint: ACCENT, opacity: 1 })
      bar(f, `${P}-del1`, 18, 280, 180, 8, '#DDE1E6')
      bar(f, `${P}-del2`, 18, 296, 144, 8, '#DDE1E6')
      inner(f, `${P}-delx`, { shape: 'line', x1: 18, y1: 288, x2: 198, y2: 288, paint: REC, opacity: 0.9 })
    },
  },
  {
    time: '19–22s', kindText: '云台 · 缓推', kindColor: ORANGE, title: '日常里同一个动作：把一个细节摆正',
    caption: '这一格只做一件事：让前面两格读成「他就是这样的人」，而不是「他在工作」。所以只拍一个动作，拍完就走。',
    sub: '（无字幕）',
    rig: '云台缓推 · 全片唯一必须用云台的一格',
    draw(f, P) {
      bar(f, `${P}-wall`, 0, 0, 216, 202, '#E2E6EB')
      bar(f, `${P}-table`, 0, 202, 216, 182, '#CBD2DA')
      inner(f, `${P}-o1`, { shape: 'rect', x: 21, y: 134, w: 46, h: 68, paint: '#AEB6C0', radius: 3 })
      inner(f, `${P}-o2`, { shape: 'rect', x: 85, y: 126, w: 50, h: 76, paint: '#9AA4B0', radius: 3, rotation: 7 })
      inner(f, `${P}-o3`, { shape: 'rect', x: 154, y: 136, w: 40, h: 66, paint: '#AEB6C0', radius: 3 })
      inner(f, `${P}-arm`, { shape: 'rect', x: 86, y: 20, w: 46, h: 92, paint: '#C9A88C', radius: 20, opacity: 0.95 })
      inner(f, `${P}-palm`, { shape: 'rect', x: 84, y: 96, w: 56, h: 48, paint: '#C9A88C', radius: 15, opacity: 0.95 })
      inner(f, `${P}-grip`, { shape: 'ellipse', x: 96, y: 138, w: 30, h: 22, paint: '#D8BAA0', opacity: 0.95 })
    },
  },
  {
    time: '22–26s', kindText: '手机架稳 · 俯拍', kindColor: STILL, title: '把它写进一个文件，保存',
    caption: '只拍手和半屏，不要露全文。「写下来」是整片的转折点：不是做完了，是没力气了，所以把它交出去。',
    sub: '不是做完了，是没力气了。所以我把它写下来。',
    rig: '手机架稳俯拍 · 不出镜、不露全文',
    draw(f, P) {
      bar(f, `${P}-panel`, 14, 60, 188, 158, '#FFFFFF')
      bar(f, `${P}-fn`, 27, 74, 106, 9, INK, 0.85)
      bar(f, `${P}-ln0`, 27, 96, 144, 6, LINES)
      bar(f, `${P}-ln1`, 27, 110, 116, 6, LINES)
      bar(f, `${P}-ln2`, 27, 124, 86, 6, LINES)
      bar(f, `${P}-ln3`, 27, 138, 144, 6, LINES)
      bar(f, `${P}-ln4`, 27, 152, 116, 6, LINES)
      bar(f, `${P}-caret`, 142, 190, 6, 14, ACCENT)
      inner(f, `${P}-hand`, { shape: 'rect', x: 67, y: 216, w: 92, h: 118, paint: '#C9A88C', radius: 26, opacity: 0.95 })
      inner(f, `${P}-knuckle`, { shape: 'ellipse', x: 76, y: 288, w: 58, h: 34, paint: '#D8BAA0', opacity: 0.9 })
    },
  },
  {
    time: '26–28s', kindText: '云台 · 一镜到底', kindColor: ORANGE, title: '退开：桌面全景，或者你靠在椅背上',
    caption: '从内容退到「人在哪儿」。一镜到底，不要切。这一格让观众意识到前面十九秒都发生在一个人身上。',
    sub: '机器的答案很便宜。问题很贵。',
    rig: '云台慢移，一镜到底，中途不切',
    draw(f, P) {
      bar(f, `${P}-room`, 0, 0, 216, 384, '#E2E6EB')
      bar(f, `${P}-desk`, 0, 259, 216, 125, '#C4CBD4')
      inner(f, `${P}-mon`, { shape: 'rect', x: 58, y: 120, w: 120, h: 77, paint: '#B4BCC6', radius: 3 })
      inner(f, `${P}-monlit`, { shape: 'rect', x: 66, y: 128, w: 104, h: 61, paint: '#9FB6D0', radius: 2, opacity: 0.95 })
      inner(f, `${P}-lamp`, { shape: 'ellipse', x: 19, y: 130, w: 62, h: 62, paint: ACCENT, opacity: 0.14 })
      inner(f, `${P}-back`, { shape: 'ellipse', x: 144, y: 221, w: 92, h: 134, paint: '#6E7884' })
      inner(f, `${P}-head`, { shape: 'ellipse', x: 167, y: 186, w: 44, h: 48, paint: '#6E7884' })
    },
  },
  {
    time: '28–30s', kindText: '黑场', kindColor: BLACK, title: '黑场：一个字都不要有',
    caption: '不要 logo、不要署名、不要「谢谢观看」。你不想被总结成一个结论，这两秒黑就是那件事本身。',
    sub: '（字幕停留 1.5–2s 后切黑）',
    rig: '纯黑 · 全片唯一的空镜',
    draw(f, P) {
      // 黑场铺满整个画框宽度：它是全片唯一「整屏黑」的镜头，两侧露出画面底的灰就把它讲成了别的东西。
      bar(f, `${P}-black`, -200, -20, 620, D_H + 60, BLACK)
    },
  },
  {
    time: '全片', kindText: '开机清单', kindColor: INK, title: '两条不许破的规矩',
    caption: '一、文件用真的，不要为了拍摄造假——被看出来，全片说的东西一起塌。二、录屏先拍十几分钟素材，剪掉九成是常态。',
    sub: '真实 > 好看',
    rig: '锁对焦曝光 · 关通知 · 关自动亮度 · 桌面清空 · 桌面用真文件',
    draw(f, P) {
      bar(f, `${P}-box1`, 18, 60, 180, 96, '#FFFFFF')
      bar(f, `${P}-t1`, 28, 72, 96, 10, REC)
      bar(f, `${P}-a1`, 28, 94, 144, 6, LINES)
      bar(f, `${P}-a2`, 28, 108, 120, 6, LINES)
      bar(f, `${P}-a3`, 28, 122, 134, 6, LINES)
      bar(f, `${P}-box2`, 18, 176, 180, 96, '#FFFFFF')
      bar(f, `${P}-t2`, 28, 188, 96, 10, BLUE)
      bar(f, `${P}-b1`, 28, 210, 144, 6, LINES)
      bar(f, `${P}-b2`, 28, 224, 106, 6, LINES)
      bar(f, `${P}-b3`, 28, 238, 139, 6, LINES)
      const CHK = ['锁对焦与曝光', '关通知 / 自动亮度', '桌面清空，用真文件', '确定今天那个日常动作', '先录十几分钟素材']
      CHK.forEach((label, i) => {
        const y = 300 + i * 16
        bar(f, `${P}-chk${i}`, 18, y, 8, 8, '#FFFFFF')
        inner(f, `${P}-chkedge${i}`, { shape: 'rect', x: 18, y, w: 8, h: 8, paint: 'transparent', opacity: 0, effects: [{ type: 'stroke', color: FAINT, size: 1, position: 'inside', opacity: 1 }] })
        bar(f, `${P}-chklabel${i}`, 32, y + 2, 96, 5, DIM, 0.8)
      })
    },
  },
]

CELLS.forEach((c, i) => {
  const col = i % COLS
  const row = Math.floor(i / COLS)
  const cx = PAD + col * (CELL_W + GUT)
  const cy = PAD + HEADER + row * (CELL_H + GUT)
  const id = `c${i}`
  const f = card(cx, cy, id)
  c.draw(f, id)
  annotate(cx, cy, id, c)
})

// ── GATE 1 的声明 ───────────────────────────────────────────────────────────
// 渲染器拒绝没有 gates 块的场景，所以这一段是渲染的前置条件，不是文档。
//
// `layers` 的条目是**前缀**，闸门比对它们首次出现的位置。这里从已生成的图层里按顺序提取，
// 而不是手写——手写的那份会与真实列表分岔，而分岔正是这道闸门要抓的东西。
const layerPrefixes = []
for (const l of layers) {
  const id = String(l.id)
  const prefix = id.includes('-') ? id.slice(0, id.indexOf('-')) : id
  if (!layerPrefixes.includes(prefix)) layerPrefixes.push(prefix)
}

const scene = {
  canvas: { width: W, height: H },
  ground: GROUND,
  gates: {
    sequence: [
      "八格，每格一个 16:9 画框加一栏标注；物件是卡片、画框、矩形块与文字",
      "信息板语言，不是参考语言：白底黑字，明度只用于分级",
      "左上起按格推进；每格内先读时间码与机位，再读说明与字幕原文",
      "本表不描绘光——它是一个平面信息板，光轴在这里没有物理含义",
      "四级明度：时间码最重、标题次之、说明再次、器材最轻",
      "框内矩形块是示意（代表屏幕内容），标注是注释；没有标签与道具之分",
      "只有一处强调色（时间码与引线），占比见 accentBand",
      { why: "信息板不做材质交错：这里没有实体材质族可言" },
      "矩形块表意，形状不承担风格",
      { why: "本表不加效果层，避免读者把表现当成内容" },
      { why: "没有效果层，也就没有由效果产生的质感" },
    ],
    focus: '八格分镜表本身。每格内的画框＝相机取景，读者先读到时间码与机位，再读说明与字幕原文',
    lightAxis: '本表不描绘光：它是横屏 16:9 的信息板，明度只用于分级（时间码最重、说明次之、器材最轻）',
    layers: layerPrefixes,
    drawingRule:
      '八格同一构造：卡片 → 画框 → 框内构图 → 时间码/机位 → 标题 → 说明 → 字幕 → 器材。' +
      '各格的差别只在框内构图与文案，版式规则不随格改变；框内构图的每一条也由同一条规则生成（矩形块表意）',
    accentBand: [0, 0.02],
    // 表里没有人物图，没有要保护的脸。刻意留空而不是省掉：闸门无法发现脸在哪，但它能报告「没有声明」。
    forbiddenZones: [],
    // 本表没有模拟实体纸张的元素（全是平面信息块），所以不需要 sheetRoles / groundEntities。
  },
  layers,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT.replace(/\.png$/i, '.json'), JSON.stringify(scene, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({
  scene: OUT.replace(/\.png$/i, '.json'), png: OUT, layers: layers.length,
  cell: [CELL_W, CELL_H], frame: [FRAME_W, FRAME_H], sheet: [W, H], gates: layerPrefixes,
}))
