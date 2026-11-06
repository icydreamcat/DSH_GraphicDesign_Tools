/**
 * 建素材库：从 Poly Haven 取 CC0 贴图。
 *
 * 为什么用 API 而不是手工下：**权限和来源必须可追溯**。每张图记下 slug、类别、许可与原始 URL，
 * 写进 MANIFEST，谁都能核。许可全部是 CC0（Poly Haven 全站 CC0）。
 *
 * 尺寸取 **1k**：引擎的 `prep-plate` 会把照片裁到页面自己的工序上，
 * 1k 在 2400px 画布的一块纸面尺度上够用；4k 会让这个库从几 MB 涨到几百 MB。
 *
 * 按材质选，不按好看选——目标是把「哑光塑料」变成真的材料：
 *   布（胶带/织带）· 金属（扣件）· 皮革（封套）· 木（桌板）· 纸（纸面）· 脏（磨损）
 *
 * Run: node tools/... 不——这是**建库脚本**，不是会话工具，所以它落在 scripts/。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// 仓库根 → 工作区根 → assets/
// 这个脚本与 `bootstrap-workspace.mjs` / `new-project.mjs` 同级，都在仓库根：
// 它是**建库的基础设施**，不是某一个项目的工具，所以不该另开 scripts/ 目录。
const LIB = resolve(HERE, '..', 'assets', 'textures')
const API = 'https://api.polyhaven.com'
const CDN = 'https://cdn.polyhaven.com/asset_img'

const get = (url, dest) => {
  execFileSync('curl.exe', ['-sL', '--max-time', '90', '-o', dest, url], { stdio: 'ignore' })
  return existsSync(dest) ? statSync(dest).size : 0
}

/** 目标：材质 → 想要的贴图名（用 slug 命中），每个材质要一组而不是一张。 */
const WANT = {
  leather: { category: 'leather', pick: 2 },
  metal: { category: 'metal', pick: 3 },
  fabric: { category: 'fabric', pick: 3 },
  paper: { category: 'paper', pick: 2 },
  wood: { category: 'raw wood', pick: 2 },
  grime: { category: 'dirty', pick: 3 },
}

mkdirSync(LIB, { recursive: true })
const assetsPath = `${LIB}/_polyhaven_assets.json`
if (!existsSync(assetsPath)) {
  console.log('取资产清单…')
  get(`${API}/assets?t=textures`, assetsPath)
}
const all = JSON.parse(readFileSync(assetsPath, 'utf8'))
console.log(`资产清单 ${Object.keys(all).length} 条`)

const chosen = []
for (const [material, spec] of Object.entries(WANT)) {
  const hits = Object.entries(all)
    .filter(([, v]) => (v.categories || []).includes(spec.category))
    // 优先 1k 可用的，且名字带 diffuse/color 的（Poly Haven 都有 maps）
    .slice(0, spec.pick)
  for (const [slug, info] of hits) chosen.push({ material, slug, name: info.name ?? slug, categories: info.categories ?? [] })
}
console.log(`\n按材质选定 ${chosen.length} 张：`)
for (const c of chosen) console.log(`  ${c.material.padEnd(8)} ${c.slug}`)

const manifest = []
let bytes = 0
for (const c of chosen) {
  const dir = `${LIB}/${c.material}`
  mkdirSync(dir, { recursive: true })

  // 1) 拿这个资产的贴图清单
  const filesPath = `${dir}/_files_${c.slug}.json`
  get(`${API}/files/${c.slug}`, filesPath)
  let files = null
  try { files = JSON.parse(readFileSync(filesPath, 'utf8')) } catch { console.log(`  SKIP ${c.slug}: 取不到贴图清单`); continue }

  // 2) 从这个资产的贴图清单里挑 1k 的 url。
  //    实测结构：files[贴图类型][分辨率][格式].url —— 顶层键是 Diffuse / nor_gl / Rough / AO 等。
  //    上一版我猜的是 files.blend['1k']，错了；这次按实测的层级取。
  const wanted = [['Diffuse', 'albedo'], ['Rough', 'rough'], ['nor_gl', 'normal'], ['AO', 'ao']]
  for (const [mapKey, tag] of wanted) {
    const res = files?.[mapKey]?.['1k']
    if (res === undefined) continue
    const fmt = res.jpg ?? res.png
    if (fmt === undefined || typeof fmt.url !== 'string') continue
    const dir2 = `${dir}`
    const file = `${dir2}/${c.slug}_${tag}_1k.jpg`
    if (existsSync(file)) {
      manifest.push({ material: c.material, slug: c.slug, map: tag, file, url: fmt.url, license: 'CC0' })
      continue
    }
    const sz = get(fmt.url, file)
    if (sz > 1000) {
      bytes += sz
      manifest.push({ material: c.material, slug: c.slug, map: tag, file, url: fmt.url, license: 'CC0' })
      console.log(`  ok  ${c.material}/${c.slug}_${tag}  ${(sz / 1024).toFixed(0)}KB`)
    }
  }
}

writeFileSync(`${LIB}/MANIFEST.json`, JSON.stringify({ source: 'Poly Haven', license: 'CC0', note: 'CC0 — no attribution required, recorded anyway for traceability', entries: manifest }, null, 2), 'utf8')
console.log(`\n共 ${manifest.length} 个贴图，${(bytes / 1024 / 1024).toFixed(1)} MB → ${LIB}`)
