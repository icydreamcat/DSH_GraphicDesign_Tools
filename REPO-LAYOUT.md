# 仓库结构与内容分类 · REPO-LAYOUT

**这一个仓库 = 一个平面设计 Agent + 它驱动的引擎 + 它的产出。**

本文件是那份「什么在哪、什么该上传」的唯一权威说明。先读它，再读 `docs/`。

- 仓库根：`DSH_GraphicDesign_Tools/`
- 首次运行：`engine/` 里 `npm install`，然后根目录 `node deploy-preset.mjs`
- 全部测试：`cd engine; node test/run-all.mjs`（15 套、416 项断言）

---

## 一、四类东西，各自的唯一位置

| 你要找的 | 在哪 | 是什么 | 进 GitHub |
|---|---|---|---|
| **环境** | 仓库根 4 个文件 | 让上面三样跑起来的胶水 | ✅ |
| **工具** | `engine/` | Node 渲染引擎 + 28 个会话工具 + Photoshop 桥 | ✅ 源码<br>❌ 依赖、产物 |
| **Agent** | `design/` | 唯一的 preset 规范源（10 文件 + 7 技能） | ✅ |
| **设计产出** | `examples/`（精选）<br>`engine/out/`（全部） | 成品图、效果对照表 | ✅ 精选<br>❌ 其余 |
| 说明 | `docs/` | 需求简报 + 交接 + 复盘 | ✅ |

**一句话记住边界**：`design/` 是 agent，`engine/` 是它的工具，`examples/` 是它的作品，
根目录那 4 个文件是环境和步骤。

---

## 二、环境（仓库根 · 6 文件 · 约 30 KB）

| 文件 | 作用 |
|---|---|
| `deploy-preset.mjs` | **把 `design/` 安装到 harness 的 preset 目录。** 必须跑，不是可选的——DSH 靠 `readdir` 扫描 preset 根并跳过一切非真实目录，所以 junction / symlink / settings 根都不通（三条都实测过）。`--check` 只报告差异，`--prune` 清理已删除的文件。 |
| `make-examples.mjs` | 把 `engine/out/` 里精选的成品复制进 `examples/`。`--check` 只报告。 |
| `.gitignore` | 声明哪些不进仓库：依赖、`engine/out/`、编辑器目录、harness home。每条都写了理由。 |
| `.gitattributes` | `* text=auto`，统一换行。 |

**唯一的绝对路径**（全仓库仅此一处，仓库搬家就要改它）：
`design/agent.cordis.yml` → `config.engineDir`。
它现在有三级回退：`config.engineDir` > 环境变量 `DSH_DESIGN_ENGINE` > 内置默认值。
**克隆到别处**：`$env:DSH_DESIGN_ENGINE = "<你的路径>\engine"` 即可，不必改 composition。

---

## 三、工具（`engine/` · Node 工程）

### 3.1 会进仓库的部分

| 目录 | 文件 | 大小 | 内容 |
|---|---|---|---|
| `engine/bin/` | 1 | 21 KB | `design.mjs` —— **全部 CLI 子命令的唯一入口**（render / analyze / critique / verify / fonts / ladder / ramp / palette / tool） |
| `engine/src/` | 17 | 388 KB | 引擎本体：`render` `text` `color` `effects` `filters` `tone` `measure` `kernel` `palette` `presets` `analyze` `verify` `psd` `psd-read` `fonts` `scale` `tools-roster` |
| `engine/tools/` | 28 | 176 KB | 28 个会话工具（量测与审计为主：`crop-view` `font-try` `subject-probe` `audit-plant` `video-probe` …） |
| `engine/test/` | 18 | 190 KB | 15 套测试 + `run-all.mjs` + `_preset-locate.mjs`。见 §六 |
| `engine/jsx/` | 5 | 36 KB | Photoshop 桥：`psx.ps1` + 4 个 JSX 探针 |
| `engine/scenes/` | 28 | 447 KB | 场景 JSON（**设计的源码**）+ 生成它们的 `build-*.mjs` + 决策笔记 `*.md` |
| `engine/package.json` · `package-lock.json` | 2 | — | 依赖声明。只依赖 `@napi-rs/canvas` |

### 3.2 不进仓库的部分

| 目录 | 大小 | 为什么不进 |
|---|---|---|
| `engine/node_modules/` | 37.5 MB | `@napi-rs/canvas` 带平台原生二进制（27 MB skia），提交了在别的机器上就是错的。`npm install` 重现。 |
| `engine/out/` | 23.4 MB | 18 个**成品**与报告。scene 在仓库里，约 1 秒/稿即可重出。**测试与探针产物不在其中**（见 §5.4）。 |
| **`engine/assets/`** | 5.9 MB | **本机专用的输入素材**：游戏立绘、处理后素材、`icons/` 标记。不是工具链的一部分——克隆的人是要做**自己的**东西，不是重出这台机器的海报。 |
| **`engine/refs/`** | 3.5 MB | 同上：参考图是 `design_analyze` 的输入，属于那台机器的工作资料。 |

> **这条边界划在哪，和它的代价**（`engine/assets/` `engine/refs/` 于本次取消跟踪，
> 文件仍留在本地磁盘）：
>
> | 新克隆的人 | 能用吗 |
> |---|---|
> | 引擎、28 个会话工具、8 个 preset 工具 | ✅ |
> | 全部 15 套测试（`node test/run-all.mjs`） | ✅ **完整可用**——为此专门把测试改成自给自足 |
> | 渲染 `engine/scenes/*.json` | ❌ 它们的 `src` 是绝对路径，素材也不在 |
> | 重出 `examples/` 里的图 | ❌ 同上 |
>
> **测试自给自足是这次的关键改动**，因为原来的套件机器绑死：
> `scope-regions.mjs` 用绝对路径加载 `assets/haruka-figure.png`；
> `tool-schemas.mjs` / `tool-registry-gate.mjs` 把 **Windows 用户名**写死在路径里
> （`C:/Users/<用户名>/...`，且空格之类还被 URL 编码成 `%27`），
> 而且指向的是**部署副本**而不是仓库源。
> 结果是：除了原作者这台机器，**任何人在任何地方都跑不了这套测试**。
> 现在改为运行时解析（`engine/test/_preset-locate.mjs`），并支持
> `DSH_TOOLS_DIR` / `DSH_PRESET_DIR` 覆盖。
>
> 结论：新克隆的人拿到的是一个**能验证、能开工**的工具链，而不是一份无法复现的旧成品。

### 3.3 工具 ↔ Agent 的连接点

`design/design-tools-*.mjs` 里的 8 个工具，全部通过**子进程**调用
`engine/bin/design.mjs` 工作。引擎不 vendor 进 preset，所以它在终端里也能独立使用。

---

## 四、Agent（`design/` · 10 文件 · 124 KB）

**这里是 preset 的规范源。** harness 用的是它的**副本**，不是它本身：

```
design/                                    ← 仓库里的规范源（改这里）
      │  node deploy-preset.mjs
      ▼
%USERPROFILE%\.dsh\.agent-presets\design\  ← harness 实际加载的副本（不要手改）
```

| 文件 | 作用 |
|---|---|
| `agent.cordis.yml` | composition：29 行组成，含工具行、技能行、shell、文件系统、jobs、goals |
| `design-policy.mjs` | 常驻审美纪律 prompt（**文本在 YAML 里，改文字不需要重启**） |
| `design-tools-260914-2212.mjs` | **8 个工具**：`design_render` `design_analyze` `design_critique` `design_verify` `design_system` `design_photoshop` `design_palette` `design_tool` |
| `preset.yml` | roster 里显示的 id / 名称 / 描述 |
| `skills/`（6 个） | `design-foundations` `typography-and-scale` `colour-systems` `reference-analysis` `filters-and-palette` `photoshop-delivery` |

> ⚠️ **改 `design-tools-*.mjs` 必须换文件名并同步 `agent.cordis.yml`。**
> Cordis Loader 对本地 `.mjs` 用 `await import(url)` 且无缓存破坏参数，一个文件名在一个
> 进程内只求值一次；照旧名字改内容会得到「改了但没生效」，而且报错指向**旧代码**。
> 本次已按此规则把 `231512` 改名为 `260914-2212`，并用 `deploy-preset.mjs --prune` 清掉了
> 部署目录里的旧文件。`design-policy.mjs` 不受此限。

**技能目录自动挂载**：`skill-filesystem` 的 `customSkillDirs` 指向 preset 自己的
`skills/`，新增技能只需建目录，不必改 composition。

---

## 五、设计产出（两类，别混）

### 5.1 `examples/` —— 进仓库（4 文件 · 3.2 MB）

| 文件 | 内容 |
|---|---|
| `poster-e-tooled.png` | 成品海报，**交付尺寸 2400×1350**。地面、强调色带、抠像立绘、214px 标题、尺线系统、`emboss`+`pattern` 字效。 |
| `poster-variants-and-scope.png` | 同一版式的**六种处理**对照（flat / soft / press / light / tooled / scoped）并带标注。第 6 张是重点：C 与 F 用同一套双色调+网点思路，`scope` 让处理避开人脸。 |
| `effect-sheet.png` | 效果词汇总表，128 KB。 |
| `README.md` | 每条图的重出命令，以及一句诚实说明：对照表那张的拼版脚本当年是临时写的、没有留存。 |

### 5.2 `engine/out/` —— 不进仓库（18 文件 · 23.4 MB，**只有成品**）

真正的渲染成品与量测报告：poster a–e 五版 + `press-scoped`、对照表、效果表（含 12 MB PSD）、
字体样张。**它们是产物**：scene 在仓库里，约 1 秒/稿即可重出。

> **这个目录现在只放成品——这是本次整理的结果，也是维护上最要紧的一条。**
> 整理前它混着四类东西：成品、测试重写的图（`scope-*`、`selftest.png`）、
> 多轮探针覆盖的迭代图（`iso-*`、`step*`、`screen-*`、`probe-grain`）、以及临时报告。
> 44 个条目里只有一半是成品，「这是成品还是探针残留」看路径答不出来。
>
> 现在：**测试与探针产物一律写到仓库外的 `../.cache/`**，见 §5.4。
> 判断规则简化成一条：**在 `out/` 里 = 成品；在 `.cache/` 里 = 可随时删。**

> **注意一处缺口**：`knowledge/agent/AGENT-REPAIR-NOTES-复盘.md` §七 交付物清单里的
> `out/muelsyse-ginkgo-kv.png` / `.psd` / `.report.json` **不在这份拷贝里**。
> 源头都在（`scenes/muelsyse-ginkgo.json`、`scenes/build-muelsyse-kv.mjs`、决策笔记），
> 按那份复盘的实测基线可以重出。

### 5.4 `../.cache/` —— **仓库之外**（1,220 文件 · 1.14 GB）

一切「按需重新生成」的东西都集中在这里，而且放在**仓库外面**（与仓库同级），
不是放进去再 gitignore。

| 目录 | 写入者 | 体积 | 可删 |
|---|---|---|---|
| `video/frames/` | `tools/video-probe.mjs frames` | 953 文件 / **1,084 MB** | ✅ 从原片重解码约 1 分钟 |
| `video/hud-frames/` | 手工抽帧 | 8 文件 / 41 MB | ✅ 前提是原录像还在 |
| `video/survey/` | `design analyze` 批量跑截图 | 25 文件 / 11 MB | ✅ |
| `video/alpha-fixtures/` | `tools/make-alpha-fixture.mjs` | 234 文件 / 0.5 MB | ✅ |
| `test/` | `test/run-all.mjs` | 6 文件 / 0.2 MB | ✅ 每次跑测试都重写 |
| `render-scratch/` | 一次性探针与迭代图 | 25 文件 / 21 MB | ✅ |

`D:\DSH_GDT\.cache\README.md` 是它的说明，含 `DSH_VIDEO_CACHE` 覆盖方式。

> **为什么不放仓库里再 gitignore**：树里的缓存照样会被备份、被整目录搬走，
> 最要紧的是——**照样会被误认成交付物**。代价是实测的：一次暂存扫进了
> **948 个抽帧（1.06 GB）**；`out/` 也曾把 25 个测试/探针图混在 18 个成品里。

### 5.3 `docs/` —— 进仓库（2 文件 · 54 KB）

只留**两份方法论**，理由是**新克隆的人要能自举**：一个刚 `git clone` 下来的检出没有
`knowledge/`，如果连规则都读不到，就只剩一个没有使用说明的引擎。
这两份也正是 `design/skills/depth-and-structure/` 技能所引用的规范。

| 文件 | 内容 |
|---|---|
| `设计方法原理-给agent.md` | **设计方法论**（34 KB）。四层级顺序、深度轴、面积占比陷阱、测量边界。**「分层与结构」技能的规范来源。** |
| `设计问题与技术问题-给agent.md` | **交付复盘**（20 KB）。每条都是实际犯的错，带数字：指标是手段不是目的、套规则前先问用途、模板盖十次≠十张设计图。 |

**其余文档已迁到工作区的复盘库**（见 §5.5）：`HANDOVER`、`AGENT-REPAIR-NOTES`、
`AGENT-BRIEF`、`终末地设计语言拆解`、`视频测量` —— 它们是过程材料，不是交付物。

> ⚠️ 这两份的**工作区内副本已合并进复盘库**，两边内容相同，**互为快照而非两处维护**：
> `node verify-knowledge.mjs` 逐份比对哈希并报告任何一处改动。
> 一段内容存在两份必然悄悄分岔，而**你读到的那份不会是你用过的那份**。

### 5.5 `../knowledge/` —— 复盘与参考库（**仓库之外**，不版控）

Agent 自己用的文档库，三类：

| 分类 | 放什么 | 判据 |
|---|---|---|
| `reference/` | 对着**量**的材料（6 份）：终末地规格、timeline KV 拆解、官方原理、三份 prior 整理 | 用来推导规格，不是用来直接搬 |
| `tooling/` | 工具怎么用（3 份）：设计方法原理、设计问题与技术问题、视频测量 | 回答"下一步跑什么、怎么读结果" |
| `agent/` | agent 自己的复盘（5 份）：HANDOVER、REPAIR-NOTES、BRIEF、两份场景记录 | 回答"我上次是怎么栽的" |

> ### 硬边界：**项目自己的艺术拆解不进这个库**
>
> 每个项目的艺术拆解、逐轮决策、被否掉的方案放在**项目内部**（`projects/<项目>/`），
> 因为它们**具有特殊性**——只对那一个版面成立。搬进通用库会让后来的 agent
> 拿别人的结论去套自己的画面，这正是「参数接近、视觉难看」的来源之一。
>
> 实例：`projects/2026-09-16-endfield-language-deck/终末地设计语言拆解.md`、
> `projects/2026-09-15-shiroko-kv/scenes/shiroko-kv-notes.md`。
> **泛化的那一份**才进 `reference/`。

---

## 五之二、设计方法论 → 技能（本次新增）

四份文档的**可执行部分**已抽成一个技能：`design/skills/depth-and-structure/SKILL.md`（22 KB）。

**为什么必须新增而不是并入既有技能**：实测统计，`深度 / 分层 / layering / 主导平涂 /
可分辨色数 / 合成值 / 设计值` 这些概念在原有 6 个技能里 **命中 0 次**。
原有的 `design-foundations` 讲到了「四层级顺序」，但**缺深度轴**，
而深度轴恰恰是这四份文档里被标注为「本文最重要的一节」的那一维。
这正是它每次被略过的原因：**没有任何技能要求它。**

| 新技能覆盖 | 来源 |
|---|---|
| 四层级顺序，以及「从第四层开始做」为何不可挽回 | 方法原理 §0 |
| **深度轴**：3–4 层、每层一种职务、焦点靠反相、分层≠半透明 | 方法原理 §4、拆解 §5.11 |
| **面积占比相同 ≠ 设计相同**：主导平涂 <25%、可分辨色数 200–7000 | 问题与技术 §1.1、方法原理 §5.1 |
| 细节 ≠ 层级；补层级的五条手段 | 问题与技术 §1.2 |
| **先定层，再定密度**（构建顺序六步） | 方法原理 §4.5/§5、拆解 §8 |
| 合成值 vs 设计值；六条「读错的数字」 | 方法原理 §8、拆解 §9.2 |
| 两条元规则：指标是手段；套规则前先问用途 | 问题与技术 §0 |

**配套的引擎改动**：该技能的核心判据（主导平涂占比、可分辨色数）**原先引擎测不出来**
——文档里的数字是用别的工具量的。已在 `src/analyze.mjs` 增加 `regionFlatness()`，
把这两个数挂到 `structure.regions[]` 的每个区域上（5 bit/通道量化，与既有 `findAccents`
口径一致），并加 `test/analyze-flatness.mjs`（15 项）保证它持续可分辨。

---

## 五之三、工作区：仓库之外的区域

仓库只是工作区的一半。旁边还有几块区域，**必须存在、不进版本控制、且新克隆会自动生成**（`knowledge/` 例外，它由 Agent 逐步积累）：

```
D:\DSH_GDT\                        ← 工作区根（WORKSPACE）
├── DSH_GraphicDesign_Tools\       ← 本仓库
├── knowledge\                     ← 复盘与参考库（agent 自己用；见 §5.5）
│   ├── reference\  tooling\  agent\
├── assets\                        ← 共享素材库（通用设计素材，每次生成都读）
│   ├── icons\  textures\  type\  plates\
├── projects\                      ← 项目区（按项目排序，每个项目自带私有素材）
├── refs\                          ← 供测量的参考素材（截图/录像/官网源文件）
├── .cache\                        ← 生成缓存（可随时删）
└── tools\bin\ffmpeg.exe           ← 共享工具，video-probe.mjs 自己会找到它
```

> `refs/` 与 `assets/` 的区别，别混：
> **`refs/` 是拿来「量」的**（别人的截图、录像、官网源文件，用来推导规格）；
> **`assets/` 是拿来「用」的**（标记、纹理、字体参考、底板，直接进版面）。
> 一个是读的对象，一个是写的材料。

> `tools/bin/ffmpeg.exe`（77 MB）留在这里而不是进仓库：它是**平台二进制**，
> 提交了在别的机器上就是错的。`video-probe.mjs` 按
> 「显式参数 → `DSH_FFMPEG` → 仓库旁的 `tools/bin` → PATH」的顺序自己找它。

### 5.3.1 三块区域的分工，以及**素材该放哪**

| 区域 | 放什么 | 判据 |
|---|---|---|
| **`assets/`** 共享素材库 | 通用设计素材：标记、纹理、字体参考、底板 | **两个项目都会用到它** → 放这里 |
| **`projects/<项目>/assets/`** | 该项目专用素材 | **只服务这一个项目** → 放项目里，随项目一起归档/删除 |
| **`.cache/`** | 按需重新生成的一切 | **能从别处重算出来** → 放这里，删了不心疼 |

> **一条纪律**：两处都留一份必然走样，而**你正看着的那份不会是你实际用过的那份**。
> 提升到共享库要**移动**，不是复制。**一份文件，一个家。**

判据要明写，因为「这个素材算通用还是项目专用」正是最容易含糊、最容易两边都放一份的地方。

### 5.3.2 项目排序：`YYYY-MM-DD-slug`

```
projects\
  2026-09-16-endfield-deck\        ← 按名字倒序 = 时间倒序，最新的永远在最上面
  2026-09-14-muelsyse-kv\
  2026-09-11-arknights-visual\
```

日期前缀是**承重的**：有了它，`ls` 一次就是一份状态报告，不必打开任何文件夹。
「这六个文件夹哪个是当前的」这个问题，是几个月后才发现的那种问题。

每个项目内固定四个位置：

| 目录 | 用途 |
|---|---|
| `scenes/` | 场景 JSON —— **这个项目的唯一真相源** |
| `assets/` | 仅本项目素材 |
| `out/` | 本项目的渲染与报告 |
| `notes.md` | 决策、被否掉的方案与原因 |

### 5.3.3 指向写进了规则，而不是靠记忆

**路径是数据，定义在 `engine/src/paths.mjs`**，工具读它，不再各自数 `'..','..','..'`
（之前 `video-probe.mjs` 里就出现过凭空写死的 `D:\DSH_GDT\tools\bin`）。

```js
import { WORKSPACE, assetPath, projectPath, cachePath, listProjects, newProject } from './paths.mjs'
assetPath('icons', 'mark-cross.png')          // <WORKSPACE>/assets/icons/mark-cross.png
projectPath('2026-09-16-endfield-deck', 'out')// <WORKSPACE>/projects/<项目>/out
```

根目录由**本文件自身位置**推导（`<workspace>/<repo>/engine/src/`），所以克隆到哪都一样；
`DSH_WORKSPACE` 可覆盖（素材库想放别的盘时用），`DSH_VIDEO_CACHE` 覆盖视频缓存。

### 5.3.4 克隆之后自动生成

```powershell
git clone <url>
cd <repo>\engine; npm install
cd ..
node bootstrap-workspace.mjs        # 生成 assets/ + 四个分类 + projects/ + .cache/
node deploy-preset.mjs              # 装 preset
node new-project.mjs --list         # 看项目；建新的：node new-project.mjs <slug>
```

`bootstrap-workspace.mjs` 是**幂等**的：只补缺失，从不删除或覆盖，可以随时再跑。
`--check` 只报告不写。

> **为什么需要一个脚本，而不是写进 README 让人手敲 mkdir**：
> 一个会往 `../assets/` 写文件的工具，在 A 机器上能跑、在 B 机器上失败，就因为没人建过那个目录——
> 那不叫可移植。**布局是数据，脚本是它落地的方式。**

> **两张表必须一致**：`paths.mjs` 有 `LAYOUT`，`bootstrap-workspace.mjs` 有它自己的表
> （它位于仓库根，不能 import `src/`，否则仓库就没法自举）。**重复的表会静默走样**，
> 所以 `engine/test/workspace-layout.mjs`（15 项）逐键比对两者，并断言三个区域都在仓库之外。

---

## 六、测试（`node test/run-all.mjs` · 15 套 · 416 项）

```
scale.mjs                26   缩放契约（--scale 双重缩放，见 §十）
analyze-flatness.mjs     15   区域平涂统计（主导平涂 / 可分辨色数）
workspace-layout.mjs     18   工作区布局：两张表一致、三区在仓库之外
render-regressions.mjs   11   line 坐标、halftone knockout
scope-regions.mjs         9   作用范围（真实渲染管线，自给自足 fixture）
scope-conflicts.mjs      13   范围冲突与 replace 语义
filters.mjs              22   常数时间滤镜逐像素对照
effects.mjs              58   10 个图层效果（含反例对照）
palette.mjs              40   测量层、核、可分解性
palette-ops.mjs          56   逐点算子、算子图、预设
presets.mjs              66   七个滤镜预设的方向与掩码曲线
selftest.mjs             42   引擎自检
psd-roundtrip.mjs        24   PSD 结构校验
tool-schemas.mjs          8   preset 工具 schema 形状
tool-registry-gate.mjs    8   照抄 register() 与 provider 投影
```

`run-all.mjs` 会拒绝运行「存在于磁盘但不在清单里」的套件，这样新增测试文件不会被漏掉；
以 `_` 开头的是**辅助模块**（如 `_preset-locate.mjs`），不是套件。

---

## 七、上传 GitHub 的完整步骤

```powershell
$repo = "D:\DSH_GDT\DSH_GraphicDesign_Tools"
cd $repo

# 0. git 不在 PATH 上时（本机由 GitHub Desktop 自带）
$env:Path = "$env:LOCALAPPDATA\GitHubDesktop\app-3.6.5\resources\app\git\cmd;$env:Path"

# 1. 先确认干净：15 套测试全绿
cd engine; node test/run-all.mjs; cd ..

# 2. 确认 preset 与仓库源一致
node deploy-preset.mjs --check        # 期望：would copy 0, identical 10, 0 extra

# 3. 确认将上传的内容（期望 128 files / 约 13.8 MB）
git add -A --dry-run | Measure-Object

# 4. 提交
git add -A
git commit -m "design agent: engine, preset, skills, examples and handover docs"

# 5. 推到 GitHub（先建空仓库，不要勾选 README）
git remote add origin https://github.com/<你>/<仓库名>.git
git branch -M main
git push -u origin main
```

### 上传前的自查清单

- [ ] `engine/node_modules/` 没有被加入（37.5 MB 原生二进制）
- [ ] `engine/out/` 没有被加入（23.4 MB 成品；测试与探针产物已移到仓库外的 `.cache/`）
- [ ] `examples/` **在**里面（3.2 MB，是仓库唯一的成品展示）
- [ ] `engine/scenes/.idea/` 没有被加入
- [ ] `docs/` 七份文档都在（含四份设计方法论）
- [ ] `design/` 只有 **10** 个文件（没有残留的旧 `design-tools-*.mjs`）
- [ ] 没有任何地方写入 harness home 的路径

### 克隆之后怎么用

```powershell
git clone <url>
cd <repo>\engine; npm install
cd ..; node deploy-preset.mjs
# 仓库不在原绝对路径时：
$env:DSH_DESIGN_ENGINE = "$PWD\engine"
```

然后在 DSH 里用一个**选中「设计」预设**的新会话，让它跑一次 `design_render` 验证闭环。

---

## 八、已知缺口（诚实清单）

1. **`design` preset 从未被任何会话真正运行过。** 16 份历史会话的 `agentPreset` 是
   `standard`(8)/`unity`(6)/`cordis`(2)，没有一份是 `design`。挂载与 schema 都已验证，
   「模型能看到并调得动这 8 个工具」只有 schema 层证据，没有一次真实运行。
2. **`design_render` 在历史里从未被调用过**（只有 `design_analyze`×2、`design_verify`×2、
   `design_critique`×1、`design_photoshop`×1）。`--scale` 的致命 bug 因此一直没暴露。
3. **`muelsyse-ginkgo-kv` 成品不在本拷贝**（见 §5.2）。
4. **对照表的拼版脚本没有留存**（见 `examples/README.md`）。
5. 本机 Photoshop 启动挂死一事，`knowledge/agent/HANDOVER-交接与实测结论.md` §2 的结论是
   **需要非受限 shell**；这是一条环境前提，不是本仓库能修的东西。
