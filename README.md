# DSH Graphic Design Agent

> **这是一个「精细化设计操作」工具，不是「一键生图」。**
>
> 它假定**你有设计素养**——知道什么该是焦点、什么该让位、版面为什么成立。它不替你产生
> 审美判断，它把你**已经有的判断**变成可执行、可测量、可复现、可修改的东西。
> （以后可能不需要用户审美很高，主要还是方便精细化操作，现阶段他能做的上限取决于用户的审美上限）

主流 AI 生图给的是「看起来像那么回事，但你说不出也改不动」。你描述一个氛围，它给你一张图；
你不满意，只能说"再暗一点"，而不是"把这个色块从 42% 压到 12%，并把焦点反相"。
**尺寸、位置、层级、颜色预算全都不在你手上**，而且**事后无法验证**——
没有工具能告诉你那张图里标题到底多宽、焦点是否唯一。

这个工具链反过来：

| | 一键生图 | 这里 |
|---|---|---|
| 你的输入 | 一段描述 | **一份场景 JSON**：每层的位置、尺寸、颜色、效果都是你自己的数 |
| 尺寸与位置 | 生成器决定 | **你写多少就是多少**，≤1 是画布比例、>1 是像素 |
| 迭代成本 | 重新生成，结果不可预测 | **约 1 秒/稿**，且**确定性**——同场景重渲逐字节一致 |
| 焦点是否唯一 | 看不出来 | `design_critique` 直接报「6 个区域在领先者 20% 以内，焦点不唯一」 |
| 标题多宽、有没有溢出 | 只能目测 | 渲染报告给出逐层实际几何、`overflow`、`fontFallback` |
| 强调色占了多少 | 靠感觉 | `accent.flatShare` 报大块平涂占比（实测区间 0–2%） |
| 改一个值的影响 | 整张重来 | 改一个数，重渲，diff 两份报告 |
| 分层交付 PSD | 通常没有 | 引擎**自己写出**分层 PSD，不经过 Photoshop |

**工具负责让你能精确控制与验证；判断仍在你和 agent 手上。**
这也是为什么它把 8 个工具里的 7 个用在**测量**上——因为真实任务的复盘结论是：

> **设计能力的瓶颈不在生成，在于「判断」与「验证」。**
> 我失败最多的不是「我画不出来」，而是「我画出来了，却不知道对不对」。

---

## 它建立在「可验证的规则」上，而不是感觉上

仓库里的每一条纪律都带**判据、阈值、失败模式**，来自对真实作品与真实失败的实测：

- **面积占比相同 ≠ 设计相同。** 参考里一个区域占 42%，你放一个 42% 的色块——占比对上了，
  设计性为零，因为别人那 42% 不是一块色，是**一整片有内部层级的编排**。
  判据：主导平涂 **< 25%**、可分辨色数 200–7000（引擎可测）。
- **先定层，再定密度。** 「元素要多、要淡」是**不完整的处方**——它给了密度没给结构。
  一个平面上撒一百个 6% 的记号是糊；分布到 3–4 个深度层上才读成系统。
- **焦点靠反相，且一次只准一个。** 用第二个就不成立。
- **靠明度差建立的结构要过灰度检查。** 某层压在近黑底上对比度只有 1.144:1——屏幕成立，
  打印即消失。
- **指标是手段，不是目的。** 为了抬高「可分辨色数」而撒斑点，指标上去了，
  那片肉眼清晰可见的花纹**撤掉后色数只掉到 549**——指标没看见眼睛看见的东西。

这些规则写在 [`design/skills/`](design/skills)——**9 个技能**，由 agent 按需加载。

---

## 三样东西 + 环境

```
DSH_GraphicDesign_Tools/
├── design/       ← AGENT：preset 的规范源（8 工具 + 7 技能 + 常驻审美纪律）
├── engine/       ← 工具：Node 渲染引擎、29 个会话工具、Photoshop 桥
├── examples/     ← 产出：精选成品图
├── docs/         ← 方法论：两份规范（新克隆自举用）
├── deploy-preset.mjs    ← 把 design/ 装进 harness
├── bootstrap-workspace.mjs ← 生成工作区外围（素材库/项目区/缓存）
├── new-project.mjs      ← 开一个新项目
├── verify-knowledge.mjs ← 检查文档副本是否漂移
├── encrypt-doc.mjs      ← 加密/解密一份文档
└── REPO-LAYOUT.md       ← 每个目录的归属与边界（先读这个）
```

`design/` 是 agent，`engine/` 是它的工具，`examples/` 是它的作品。
**完整分类见 [`REPO-LAYOUT.md`](REPO-LAYOUT.md)。**

### 一份锁着的文档

[`为什么做这个项目.md.enc`](为什么做这个项目.md.enc) 是这个项目**为什么存在**的说明，
用 `encrypt-doc.mjs` 加过密（scrypt + AES-256-GCM）。它在仓库里，但只有拿到口令的人读得到。

```powershell
# 读完写在 .cache/ 里（可随时删），不要把明文写回仓库
node encrypt-doc.mjs decrypt 为什么做这个项目.md.enc ..\.cache\为什么做这个项目.md
node encrypt-doc.mjs inspect 为什么做这个项目.md.enc   # 只看文件头，不需要口令
```

它不谈方法——方法在这个 README 和 `docs/` 里。它谈的是立场：为什么做这件事、反对什么、
把 AI 当作同事意味着什么。**加锁不是因为内容有害，是因为有些判断需要时间才能被公正地读。**

**本机不留明文**：这一份密文就是保险库，没有第二把钥匙。口令丢了，它就没有了。

---

## 快速开始

```powershell
# 1. 依赖（只有一个：@napi-rs/canvas，含平台原生二进制）
cd engine; npm install

# 2. 生成工作区外围（素材库 / 项目区 / 缓存）—— 幂等，可随时再跑
cd ..; node bootstrap-workspace.mjs

# 3. 全部测试：16 套、448 项断言
cd engine; node test/run-all.mjs

# 4. 出一张图试试
node bin/design.mjs render scenes/poster-e-tooled.json --out out --name try

# 5. 把 agent 装进 harness
cd ..; node deploy-preset.mjs

# 6. 开一个新项目
node new-project.mjs my-first-kv
```

然后在 DSH 里开一个**选中「设计」预设**的新会话。（以后会做成插件，或者打包允许转接其他模型）

> 仓库不在本文件假设的路径时：`$env:DSH_DESIGN_ENGINE = "$PWD\engine"`。
> 这是唯一的绝对路径依赖，且现在有环境变量回退。

### 一次完整的精细迭代长什么样

```powershell
cd engine

# 出稿：约 1 秒，同时拿到量测报告
node bin/design.mjs render ../projects/<项目>/scenes/kv.json --out ../projects/<项目>/out --name v1

# 四问自检：删一半还完整吗 / 眯眼看焦点唯一吗 / 去色层级还在吗 / 忽略内容有性格吗
node bin/design.mjs critique ../projects/<项目>/out/v1.png

# 读研究竟哪里不对（不是"感觉不对"）
#   焦点不唯一            -> critique.focus.competingRegions
#   大区域是一块平涂       -> structure.regions[].dominantFlatShare
#   细节分布均匀像壁纸     -> spatial.cells[].detail 的峰值/最低比
#   强调色超标            -> accent.flatShare

# 改场景 JSON 里的数，重渲，比对两份报告
node bin/design.mjs render ../projects/<项目>/scenes/kv.json --out ../projects/<项目>/out --name v2
node tools/read-report.mjs ../projects/<项目>/out/v1.report.json ../projects/<项目>/out/v2.report.json
```

**关键差别**：每一步都有数、都能复现、都能只改一处。**你不需要重画整张图。**

---

## 工作区：仓库只是其中一块

```text
<WORKSPACE>/                     ← 工作区根，默认是仓库的上一级
├── DSH_GraphicDesign_Tools/    ← 本仓库
├── knowledge/                  ← 复盘与参考库：reference/ tooling/ agent/
├── assets/                     ← 共享素材库：通用素材，每次生成都读
├── projects/<YYYY-MM-DD-slug>/ ← 项目：自带 scenes/ assets/ out/ notes.md
├── refs/                       ← 供「量」的参考素材（截图/录像/官网源文件）
├── .cache/                     ← 生成缓存，可随时删
└── tools/bin/ffmpeg.exe        ← 共享工具
```

`bootstrap-workspace.mjs` 会把这些**自动生成**（幂等：只补缺失，从不删除或覆盖）。

**素材放哪的判据**：

| 判据 | 放哪 |
|---|---|
| 两个项目都会用到它 | `assets/` 共享库 |
| 只服务这一个项目 | 那个项目的 `assets/` |
| 能从别处重算出来 | `.cache/`，删了不心疼 |
| 拿来**量**的（不是拿来用的） | `refs/` |

**提升到共享库要「移动」，不是复制**——两处都留一份必然走样，而你看着的那份不会是你用过的那份。

**项目内部的文档按规则留在项目里**：每个项目的艺术拆解、逐轮决策、被否掉的方案具有**特殊性**，
只对那一个版面成立。搬进通用库会让下一个 agent 拿别人的结论去套自己的画面——
**这正是「参数接近、视觉难看」的来源之一。**

---

## 引擎能做什么

```powershell
node bin/design.mjs render   <scene.json> --out out --name X [--psd]  # 渲染 + 度量 + 设计校验 + 分层 PSD
node bin/design.mjs analyze  <image>                                  # 参考图 → 可执行规格（不是描述）
node bin/design.mjs critique <png>                                    # 四问自检
node bin/design.mjs verify   <scene.json>                             # 反模式硬约束
node bin/design.mjs fonts | ladder | ramp                             # 设计系统原语
node bin/design.mjs palette  <子命令>                                 # 滤镜词汇表（算子图）
node bin/design.mjs tool     --list                                   # 29 个会话工具的名册
```

**场景是声明式的**：一块画布、一个底色、一叠图层（rect / ellipse / line / polygon /
path / text / image / group / adjustment）。**长度 ≤1 是画布比例，>1 是像素。**

> ⚠️ 这条规则有个致命陷阱：想画 1px 的点写 `1`，会得到**铺满整幅画布的不透明矩形**。
> 实测把 300 个"斑点"里的 200 个变成满幅覆盖，主导平涂 3.5%→54.4%，**而引擎零报错**。
> **任何"1px 的点"都必须写 ≥2。**

**每次渲染同时返回量测报告**——逐层实际几何、文字是否溢出、是否发生静默字体回退、
蒙版保留率、网点数量与覆盖率、整页纹理统计。

设计层面另有 **17 个图层效果、16 种混合模式、`scope`**（把处理限制在某个区域，
这是让双色调避开人脸的办法），以及**不依赖 Photoshop 的分层 PSD 写出**。

---

## 9 个技能（agent 按需加载）

| 技能 | 什么时候用 |
|---|---|
| [`depth-and-structure`](design/skills/depth-and-structure/SKILL.md) | **开工前必读**。四层级顺序、深度轴、先定层再定密度、面积占比陷阱、合成值 vs 设计值 |
| [`design-foundations`](design/skills/design-foundations/SKILL.md) | 审美与设计理解、四问、反模式清单 |
| [`craft-and-material`](design/skills/craft-and-material/SKILL.md) | **做质感时读**。一门手艺而非配方库、合成的复杂度从哪来、为什么不能用透明做叠层、元素之间要有物理牵连、超采样与曲线质量、引擎能做什么与做不到什么 |
| [`design-judgement`](design/skills/design-judgement/SKILL.md) | **画面不对又说不清时读**。风格是看出来的不是算出来的、「高频低对比」是多而淡不是少、为什么 17 轮局部修补不可救、「量达标了」为什么是失败 |
| [`typography-and-scale`](design/skills/typography-and-scale/SKILL.md) | 排版与字阶、真实度量、中英混排 |
| [`colour-systems`](design/skills/colour-systems/SKILL.md) | OKLab 阶梯、强调色预算、调子带 |
| [`reference-analysis`](design/skills/reference-analysis/SKILL.md) | 参考规格提取（观感 → 可执行数值） |
| [`filters-and-palette`](design/skills/filters-and-palette/SKILL.md) | 滤镜词汇表、算子图、`scope` |
| [`photoshop-delivery`](design/skills/photoshop-delivery/SKILL.md) | 分层交付、Photoshop 驱动与它的坑 |

**常驻与按需的分工是故意的，不是重复。** 常驻 policy 只放**能失败**的规则——每条都对应一个会返回
非零的检查；凡是无法这样强制的，一律进技能，不在常驻段重复。这不是为了省字数：上一版常驻段是
15,640 字符的论述，它确实在每次请求里，而接下来的会话违反了它自己九条原则。**常驻不等于有约束力。**

---

## 示例

![引擎效果词汇表](examples/effect-sheet.png)

| 文件 | 内容 |
|---|---|
| [`examples/poster-variants-and-scope.png`](examples/poster-variants-and-scope.png) | 同一版式**六种处理**对照并带标注：flat / soft / press / light / tooled / **scoped**。最后一张是重点——C 与 F 用同一套双色调加网点，`scope` 让它避开人脸。 |
| [`examples/poster-e-tooled.png`](examples/poster-e-tooled.png) | 成品海报，交付尺寸 **2400×1350**。 |

只有效果表内嵌，另两张用链接——它们是 1–2 MB 的 2400px 成品图，内嵌会让仓库首页加载过重。

---

## 三条纪律（都来自踩过的坑）

1. **约束在被绘制的几何上求值；审计不得重新推导它所检查的约定。**
   用一个点代替一个框、用「两点距离小于半径和」代替「两个矩形是否相交」，是同类错误
   **连续发生六次、每次都报「0 问题」**的原因。
2. **改源码用编辑工具，不用 shell。**
   `Get-Content -Raw | Set-Content` 会把 UTF-8 按系统 ANSI 编解码：中文全变乱码，
   更隐蔽的是**多字节字符撑开分隔符、把下一行代码吞进 `//` 注释**——那行永不执行而报告全绿。
   **补丁叠加到已损坏的文件上，损伤是指数级的。**
3. **`layer failures = 0` 可能是假绿。**
   生成器崩了 → 场景没重写 → 渲染读旧文件 → 报告照样输出零失败。
   检查顺序必须是「生成器自身报错 → 渲染报告 → 产物时间戳」。

---

## 状态

引擎 **16 套测试全绿**（`node test/run-all.mjs`，exit 0，**448 项断言**）；preset 挂载通过。

**全链路可用。** preset 能挂载 → 技能能加载 → 工具能出图 → 分层 PSD 能写出，
每一环都产出过实物：多页 deck（含逐页 `report.json` 与交付 `.pptx`）、KV
（成品 `.png` 与**分层 `.psd`**）。

**但「能用」不等于「测到」。** `bin/design.mjs` 的 10 个子命令**没有一个被测试经由程序路径执行过**
——模块级断言覆盖不到参数解析与子命令分发，而 agent 的 8 个工具**恰恰通过子命令调用引擎**。
`--scale` 的比例错误就是在这条真空里出的：它渲染出了错误的画面，而报告始终 0 error / 0 warning。
详见 [`REPO-LAYOUT.md`](REPO-LAYOUT.md) §8.1。

### 克隆下来能做什么

这个仓库交付的是**工具链**，不是这台机器的旧成品：

- ✅ 引擎、29 个会话工具、8 个 preset 工具、**全部 16 套测试**——开箱可用；
- ✅ 9 个技能与两份方法论规范，新克隆即可自举；
- ❌ `engine/scenes/*.json` 与 `examples/` 里的图**重不出来**：它们的素材是本机专用的输入，
  刻意未纳入版本控制。

测试套件已专门改成自给自足（不再加载 `engine/assets/`，也不再写死任何 per-machine 路径），
所以克隆的人可以**先验证工具链，再用它做自己的东西**。

**工具链自身的技术性与流程性缺口**见 [`REPO-LAYOUT.md`](REPO-LAYOUT.md) §八。其中两条最实在的：

- **CLI 入口从未被端到端测试。** 模块级测试很密（448 项断言），但 `bin/design.mjs`
  的 10 个子命令没有一个被测试经由程序路径跑过——而 agent 的 8 个工具**恰恰通过子命令调用引擎**。
  `--scale` 那个「宽度乘两次、高度一次不乘而报告全绿」的 bug，就长在这个洞上。
- **没有任何自动化在跑这套测试。** 无 CI、无根 `package.json`，`run-all.mjs` 的执行全靠自觉。

本机环境前提、交付记录与运行记录**不写进仓库**，在本地库
`knowledge/tooling/已知缺口与本地前提.md`。

---

## 它明确做不到的事

写在最后，因为**知道边界比知道能力更重要**：

- **测量能带你到「正确」，到不了「精致」。** 以下必须由人决定，不要在信息不足时用自信的
  猜测代替判断：这个隐喻是否恰当、这个性格是否适合受众、这个构图是否真的愉悦而不只是正确。
- **静态对比度检查器看不见分层。** 它拿文字颜色对 ground 算对比度——黑字压在黄带上会被报为
  "不可见"，而它实际完全可读。**它是平面检查器。**
- **引擎对"已注册但缺该脚本字形"的字族不给警告。** 中文渲染成豆腐块可以是静默的。
- **分层是屏幕原生手法，印刷与单色下会崩。** 靠明度差建立的结构不一定活过打印。

**正确的工作方式是分工**：把这套工具用来把结构和系统建到「正确」，
**最终的美学判断交给拥有它的人。**
