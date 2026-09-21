/**
 * 三十秒作业的分镜表 —— 一张真正的分镜板，用引擎自己画。
 *
 * 为什么用引擎画而不是手绘
 * ------------------------
 * 分镜表本身就是一件版面作品：八格构图、时间码、机位、说明、字幕原文，五层信息要在同一张图上
 * 互不打架。它还是这篇作业唯一一次能提前检查构图的机会——每一格里的画框是 9:16，**框就是相机
 * 取景范围**，内容在框里的位置就是拍摄时的位置，不是示意。
 *
 * 这张表改了四轮，四个错都是几何错而不是审美错，逐条记下来，因为它们会重复：
 *
 *   1. 画框高 800 而卡片只留得下 ~640 → 框压出卡片，底排字幕被画布切掉半行。
 *   2. 我把画布高度当成输入、回头去推导卡片高度 → 成了循环：调大画布，卡片跟着长，永远差 60px。
 *      改成**卡片是常量、画布是推导值**才收敛。
 *   3. 标注栏宽 63px、字号 17px ＝ 一行 3 个汉字，中文正文被切成一列竖排。**汉字一个字就是一个
 *      字号宽**，所以「一行几个字」是栏宽 ÷ 字号，这是硬约束，不是品味。
 *   4. 我把内容按 450×800 画完再乘 0.48 缩放。而 `resolveLength` 的规则是
 *      **0 ≤ 值 ≤ 1 当画布比例**：一条 h=2 的细线缩完是 0.96，于是被当成「画布高度的 96%」，
 *      画出两条 2385px 贯穿全图的长条。缩小设计会把尺寸推进 0..1 那个区间 ——
 *      所以**内容按最终尺寸画，不做缩放**。
 *
 * Run: node scenes/build-video-storyboard.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 相对本脚本定位，而不是相对 cwd：否则从别处运行会写到意料之外的盘根下。
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(process.argv[2] ?? resolve(HERE, '..', '..', '..', '.cache', 'storyboard-30s.png'))

// ── 版面：卡片是常量，画布是推导值 ──────────────────────────────────────────
const PAD = 40
const GUT = 20
const HEADER = 104
const COLS = 4
const ROWS = 2
const CELL_W = 690
const CELL_H = 1010

const W = PAD * 2 + CELL_W * COLS + GUT * (COLS - 1)
const H = PAD * 2 + HEADER + CELL_H * ROWS + GUT * (ROWS - 1)

// 画框＝相机取景（9:16）。216×384 是最终尺寸，框内内容直接按这个尺寸画。
const FRAME_W = 300
const FRAME_H = 534
const FRAME_X = 20
const FRAME_Y = 44
const INFO_X = FRAME_X + FRAME_W + 26
const INFO_W = CELL_W - INFO_X - 20          // ≈425px ＝ 25 个汉字/行

const INK = '#EEF2F6'
const DIM = '#9AA6B4'
const FAINT = '#5E6A78'
const CARD = '#141920'
const CARD_EDGE = '#242B34'
const SCREEN = '#0B1015'
const ACCENT = '#F0B429'
const REC = '#E5484D'
const BLUE = '#8AB4F8'
const GROUND = '#090C10'

const layers = []
const add = (l) => { layers.push(l); return l }

function card(cellX, cellY, id) {
  add({
    id: `${id}-card`, shape: 'rect', x: cellX, y: cellY, w: CELL_W, h: CELL_H,
    paint: CARD, radius: 14, opacity: 1,
    effects: [{ type: 'stroke', color: CARD_EDGE, size: 1, position: 'inside', opacity: 1 }],
  })
  add({ id: `${id}-screen`, shape: 'rect', x: cellX + FRAME_X, y: cellY + FRAME_Y, w: FRAME_W, h: FRAME_H, paint: SCREEN, radius: 5, opacity: 1 })
  add({
    id: `${id}-edge`, shape: 'rect', x: cellX + FRAME_X, y: cellY + FRAME_Y, w: FRAME_W, h: FRAME_H,
    paint: 'transparent', radius: 5, opacity: 0,
    effects: [{ type: 'stroke', color: '#3A434E', size: 1.5, position: 'inside', opacity: 1 }],
  })
  return { x: cellX + FRAME_X, y: cellY + FRAME_Y }
}

/** 框内元素：坐标相对框左上角，单位就是像素（框内空间 216×384）。 */
function inner(f, id, l) {
  const out = { ...l, id, x: f.x + (l.x ?? 0), y: f.y + (l.y ?? 0) }
  // 任何边长都不得落在 0..1 —— 那会被当成画布比例。线段/描边同样受这条约束。
  if (out.w !== undefined && out.w <= 1) out.w = Math.max(1, out.w)
  if (out.h !== undefined && out.h <= 1) out.h = Math.max(1, out.h)
  return add(out)
}
/** 一条内容块。h 至少 1px：0.96 这种值会被引擎当比例。 */
const bar = (f, id, x, y, w, h, paint, opacity) =>
  inner(f, id, { shape: 'rect', x, y, w, h: Math.max(1, h), paint, opacity: opacity ?? 1 })

/** 标注：时间码 / 镜号 / 标题 / 说明 / 字幕原文 / 器材，全部在框右侧一栏。 */
function annotate(cellX, cellY, id, a) {
  const tx = cellX + INFO_X
  const put = (suffix, y, text, size, color, weight, lh) => add({
    id: `${id}-${suffix}`, shape: 'text', x: tx, y: cellY + y, w: INFO_W,
    text, size, font: 'SansSC', weight, color, align: 'left', wrap: true,
    lineHeight: lh ?? Math.round(size * 1.5),
  })
  put('tc', 46, a.time, 26, ACCENT, 700)
  put('no', 84, `#${a.no} · ${a.kind}`, 16, FAINT, 500)
  put('title', 116, a.title, 22, INK, 700, 34)
  put('cap', 620, a.caption, 18, DIM, 400, 30)
  if (a.sub !== undefined && a.sub !== '') {
    put('subrule', 800, '—', 18, ACCENT, 700)
    put('sub', 824, a.sub, 19, INK, 500, 31)
  }
  put('rig', 950, a.rig, 16, FAINT, 400, 24)
}

// ── 底与页眉 ────────────────────────────────────────────────────────────────
add({ id: '00-ground', shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: GROUND })
add({
  id: '00-density', shape: 'rect', x: 0, y: 0, w: 1, h: 1, paint: '#4E6B8C', opacity: 0.05,
  effects: [{ type: 'halftone', size: 14, angle: 22, tone: 'source', maxTone: 0.3, color: '#7FA8D4', respectAlpha: true }],
})
add({
  id: '01-title', shape: 'text', x: PAD, y: 44, w: 1400,
  text: '30 秒 · 分镜表', size: 40, font: 'SansSC', weight: 700, color: INK, align: 'left', wrap: false,
})
add({
  id: '02-sub', shape: 'text', x: PAD, y: 96, w: 1700,
  text: '竖版 9:16 · 无旁白（全部字幕）· 一机一云台 · 结尾不给答案 · 每格画框＝相机取景范围',
  size: 19, font: 'SansSC', color: DIM, align: 'left', wrap: false,
})
add({
  id: '03-note', shape: 'text', x: W - PAD - 780, y: 44, w: 780,
  text: '0–6 屏幕｜6–9 手｜9–19 屏幕（证据段）\n19–22 日常｜22–26 保存｜26–28 退开｜28–30 黑场',
  size: 17, font: 'SansSC', color: FAINT, align: 'right', wrap: true, lineHeight: 26,
})

// ── 八格：框内按 216×384 直接画 ─────────────────────────────────────────────
const CELLS = [
  {
    time: '0–6s', no: 1, kind: '录屏', title: '一版「已完成」，然后光标停住',
    caption: '先把「完成」给出来，再让观众看见你往回翻。往回翻这个动作本身就是论点，不需要一句话解释。',
    sub: '（无字幕，只留光标停顿）',
    rig: '手机录屏 · 剪辑里加速 2–3×',
    draw(f, P) {
      bar(f, `${P}-name`, 36, 61, 153, 14, INK, 0.9)
      bar(f, `${P}-rule`, 36, 83, 222, 3, FAINT, 0.6)
      bar(f, `${P}-poster`, 36, 103, 222, 156, '#1D2A38')
      bar(f, `${P}-p1`, 50, 119, 97, 8, DIM, 0.7)
      bar(f, `${P}-p2`, 50, 136, 144, 7, FAINT, 0.6)
      bar(f, `${P}-p3`, 50, 233, 64, 8, ACCENT, 0.8)
      bar(f, `${P}-l1`, 36, 283, 222, 10, FAINT, 0.5)
      bar(f, `${P}-l2`, 36, 303, 172, 10, FAINT, 0.5)
      bar(f, `${P}-l3`, 36, 322, 197, 10, FAINT, 0.5)
      bar(f, `${P}-l4`, 36, 342, 139, 10, FAINT, 0.5)
      bar(f, `${P}-l5`, 36, 361, 192, 10, FAINT, 0.5)
      inner(f, `${P}-cursor`, { shape: 'path', path: 'M 64 417 L 64 453 L 72 444 L 81 460 L 88 456 L 79 440 L 92 439 Z', paint: INK, opacity: 0.95 })
    },
  },
  {
    time: '6–9s', no: 2, kind: '云台', title: '手在键盘上停住，不动机位',
    caption: '全片唯一允许「停着不动」的镜头。这两秒不要剪——整片的可信度有一半在这两秒里。',
    sub: '（无字幕，只有那一停）',
    rig: '云台 1:1 微距 · 三脚架模式不动',
    draw(f, P) {
      bar(f, `${P}-kb`, 0, 219, 300, 314, '#1A1F26')
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 5; c++) bar(f, `${P}-k${r}${c}`, 10 + c * 40, 172 + r * 50, 47, 56, '#242B35')
      }
      inner(f, `${P}-arm`, { shape: 'rect', x: 131, y: 39, w: 56, h: 167, paint: '#C9A88C', radius: 25, opacity: 0.95 })
      inner(f, `${P}-finger`, { shape: 'rect', x: 135, y: 172, w: 47, h: 81, paint: '#C9A88C', radius: 21, opacity: 0.95 })
      inner(f, `${P}-tip`, { shape: 'ellipse', x: 135, y: 228, w: 47, h: 38, paint: '#D8BAA0', opacity: 0.95 })
      inner(f, `${P}-still`, { shape: 'line', x1: 214, y1: 139, x2: 286, y2: 139, paint: ACCENT, opacity: 0.55 })
    },
  },
  {
    time: '9–19s', no: 3, kind: '录屏', title: '数字对不上 —— 全片最长的一段',
    caption: '同一处放大对照：第一次是 8.4:1，第二次切回来已经是 3.7:1。观众自己会看见变化怎么发生的，字幕只需要给两个数。',
    sub: '8.4 : 1  →  3.7 : 1',
    rig: '手机录屏 · 占全片 1/3，是证据段',
    draw(f, P) {
      bar(f, `${P}-hdr`, 25, 39, 133, 13, DIM, 0.8)
      bar(f, `${P}-abox`, 25, 67, 250, 133, '#16202B')
      bar(f, `${P}-albl`, 39, 83, 61, 8, FAINT, 0.7)
      bar(f, `${P}-anum`, 39, 108, 100, 24, '#63D2A0')
      bar(f, `${P}-abad`, 39, 150, 167, 7, FAINT, 0.5)
      bar(f, `${P}-bbox`, 25, 225, 250, 133, '#16202B')
      bar(f, `${P}-blbl`, 39, 242, 61, 8, FAINT, 0.7)
      bar(f, `${P}-bnum`, 39, 267, 128, 24, REC)
      bar(f, `${P}-bbad`, 39, 308, 167, 7, FAINT, 0.5)
      inner(f, `${P}-mark`, { shape: 'rect', x: 164, y: 261, w: 89, h: 39, paint: 'transparent', opacity: 0, effects: [{ type: 'stroke', color: ACCENT, size: 2, position: 'inside', opacity: 1 }] })
      inner(f, `${P}-lead`, { shape: 'line', x1: 253, y1: 281, x2: 286, y2: 281, paint: ACCENT, opacity: 1 })
      bar(f, `${P}-del1`, 25, 389, 250, 11, '#2A333E')
      bar(f, `${P}-del2`, 25, 411, 200, 11, '#2A333E')
      inner(f, `${P}-delx`, { shape: 'line', x1: 25, y1: 400, x2: 275, y2: 400, paint: REC, opacity: 0.9 })
    },
  },
  {
    time: '19–22s', no: 4, kind: '云台', title: '日常里同一个动作：把一个细节摆正',
    caption: '这一格的作用只有一个：让前面两格读成「他就是这样的人」，而不是「他在工作」。所以只拍一个动作，拍完就走。',
    sub: '（无字幕）',
    rig: '云台缓推 · 全片唯一必须用云台的一格',
    draw(f, P) {
      bar(f, `${P}-wall`, 0, 0, 300, 281, '#141A21')
      bar(f, `${P}-table`, 0, 281, 300, 253, '#1B222A')
      inner(f, `${P}-o1`, { shape: 'rect', x: 29, y: 186, w: 64, h: 94, paint: '#2C3742', radius: 4 })
      inner(f, `${P}-o2`, { shape: 'rect', x: 118, y: 175, w: 69, h: 106, paint: '#3A4756', radius: 4, rotation: 7 })
      inner(f, `${P}-o3`, { shape: 'rect', x: 214, y: 189, w: 56, h: 92, paint: '#2C3742', radius: 4 })
      inner(f, `${P}-arm`, { shape: 'rect', x: 119, y: 28, w: 64, h: 128, paint: '#C9A88C', radius: 28, opacity: 0.95 })
      inner(f, `${P}-palm`, { shape: 'rect', x: 117, y: 133, w: 78, h: 67, paint: '#C9A88C', radius: 21, opacity: 0.95 })
      inner(f, `${P}-grip`, { shape: 'ellipse', x: 133, y: 192, w: 42, h: 31, paint: '#D8BAA0', opacity: 0.95 })
    },
  },
  {
    time: '22–26s', no: 5, kind: '静止', title: '把它写进一个文件，保存',
    caption: '只拍手和半屏，不要露全文。「写下来」是整片的转折点：不是做完了，是没力气了，所以把它交出去。',
    sub: '不是做完了，是没力气了。所以我把它写下来。',
    rig: '手机架稳 · 俯拍手与半屏',
    draw(f, P) {
      bar(f, `${P}-panel`, 19, 83, 261, 219, '#141B23')
      bar(f, `${P}-fn`, 38, 103, 147, 13, INK, 0.9)
      bar(f, `${P}-ln0`, 38, 133, 200, 8, DIM, 0.55)
      bar(f, `${P}-ln1`, 38, 153, 161, 8, DIM, 0.55)
      bar(f, `${P}-ln2`, 38, 172, 119, 8, DIM, 0.55)
      bar(f, `${P}-ln3`, 38, 192, 200, 8, DIM, 0.55)
      bar(f, `${P}-ln4`, 38, 211, 161, 8, DIM, 0.55)
      bar(f, `${P}-caret`, 197, 264, 8, 19, ACCENT)
      inner(f, `${P}-hand`, { shape: 'rect', x: 93, y: 300, w: 128, h: 164, paint: '#C9A88C', radius: 36, opacity: 0.95 })
      inner(f, `${P}-knuckle`, { shape: 'ellipse', x: 106, y: 400, w: 81, h: 47, paint: '#D8BAA0', opacity: 0.9 })
    },
  },
  {
    time: '26–28s', no: 6, kind: '云台', title: '退开：桌面全景，或者你靠在椅背上',
    caption: '从内容退到「人在哪儿」。一镜到底，不要切。这一格让观众意识到前面十九秒都发生在一个人身上。',
    sub: '机器的答案很便宜。问题很贵。',
    rig: '云台慢移 · 一镜到底',
    draw(f, P) {
      bar(f, `${P}-room`, 0, 0, 300, 533, '#0F151C')
      bar(f, `${P}-desk`, 0, 360, 300, 174, '#1A222B')
      inner(f, `${P}-mon`, { shape: 'rect', x: 81, y: 167, w: 167, h: 107, paint: '#1E2A36', radius: 4 })
      inner(f, `${P}-monlit`, { shape: 'rect', x: 92, y: 178, w: 144, h: 85, paint: '#33465A', radius: 3, opacity: 0.9 })
      inner(f, `${P}-lamp`, { shape: 'ellipse', x: 26, y: 181, w: 86, h: 86, paint: ACCENT, opacity: 0.12 })
      inner(f, `${P}-back`, { shape: 'ellipse', x: 200, y: 307, w: 128, h: 186, paint: '#080B0F' })
      inner(f, `${P}-head`, { shape: 'ellipse', x: 232, y: 258, w: 61, h: 67, paint: '#080B0F' })
    },
  },
  {
    time: '28–30s', no: 7, kind: '黑场', title: '黑场：一个字都不要有',
    caption: '不要 logo、不要署名、不要「谢谢观看」。你不想被总结成一个结论，这两秒黑就是那件事本身。',
    sub: '（字幕停留 1.5–2s 后切黑）',
    rig: '纯黑 · 全片唯一的空镜',
    draw(f, P) {
      bar(f, `${P}-black`, 0, 0, 300, 533, '#000000')
      bar(f, `${P}-hint`, 100, 264, 100, 3, '#262E37')
    },
  },
  {
    time: '全片', no: 8, kind: '—', title: '两条不许破的规矩',
    caption: '一、文件用真的，不要为了拍摄造假——被看出来，全片说的东西一起塌。二、录屏先拍十几分钟素材，剪掉九成是常态。',
    sub: '真实 > 好看',
    rig: '开机前：锁对焦曝光 · 关通知 · 关自动亮度',
    draw(f, P) {
      bar(f, `${P}-box1`, 25, 83, 250, 133, '#16202B')
      bar(f, `${P}-t1`, 39, 100, 133, 14, REC)
      bar(f, `${P}-a1`, 39, 131, 200, 8, DIM, 0.7)
      bar(f, `${P}-a2`, 39, 150, 167, 8, DIM, 0.7)
      bar(f, `${P}-a3`, 39, 169, 186, 8, DIM, 0.7)
      bar(f, `${P}-box2`, 25, 244, 250, 133, '#16202B')
      bar(f, `${P}-t2`, 39, 261, 133, 14, BLUE)
      bar(f, `${P}-b1`, 39, 292, 200, 8, DIM, 0.7)
      bar(f, `${P}-b2`, 39, 311, 147, 8, DIM, 0.7)
      bar(f, `${P}-b3`, 39, 331, 193, 8, DIM, 0.7)
      // 开机清单：现场要一条条过的，画成方框
      const CHK = [
        '锁对焦与曝光',
        '关通知 / 自动亮度',
        '桌面清空，用真的文件',
        '确定今天那个日常动作',
        '先录十几分钟素材',
      ]
      CHK.forEach((label, i) => {
        // 这五条要落在两个方块**下面**：方块占到 y≈323，所以从 344 起、行距 24。
        // 第一版从 92 起，正好压在方块上——框内元素互相叠是这一格唯一会被看出「没对齐」的地方。
        const y = 344 + i * 24
        bar(f, `${P}-chkbox${i}`, 25, y, 11, 11, SCREEN)
        inner(f, `${P}-chkedge${i}`, { shape: 'rect', x: 25, y, w: 11, h: 11, paint: 'transparent', opacity: 0, effects: [{ type: 'stroke', color: FAINT, size: 1, position: 'inside', opacity: 1 }] })
        bar(f, `${P}-chk${i}`, 44, y + 2, 96, 6, DIM, 0.7)
      })
      inner(f, `${P}-eq`, { shape: 'line', x1: 25, y1: 417, x2: 275, y2: 417, paint: FAINT, opacity: 0.6 })
      bar(f, `${P}-foot`, 25, 436, 247, 8, FAINT, 0.6)
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

const scene = { canvas: { width: W, height: H }, ground: GROUND, layers }

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT.replace(/\.png$/i, '.json'), JSON.stringify(scene, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ scene: OUT.replace(/\.png$/i, '.json'), png: OUT, layers: layers.length, cell: [CELL_W, CELL_H], frame: [FRAME_W, FRAME_H], sheet: [W, H] }))
