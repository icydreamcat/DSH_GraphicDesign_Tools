# 仓库结构与内容分类 · REPO-LAYOUT

**这一个仓库 = 一个平面设计 Agent + 它驱动的引擎 + 它的产出。**

本文件是「什么在哪、什么该上传、边界划在哪」的权威说明。**它描述当前状况，不记录变更过程**——
每条断言都是可以从磁盘上核对的事实，不是某次操作的叙述。

```
仓库根：DSH_GraphicDesign_Tools/
首次运行：engine/ 里 npm install → 根目录 node bootstrap-workspace.mjs → node deploy-preset.mjs
全部测试：cd engine; node test/run-all.mjs    （15 套、416 项断言）
```

---

## 一、四类东西，各自的唯一位置

| 你要找的 | 在哪 | 是什么 | 进 GitHub |
|---|---|---|---|
| **环境** | 仓库根 5 个脚本/配置 | 让其余三样跑起来的胶水 | ✅ |
| **工具** | `engine/` | Node 渲染引擎 + 28 个会话工具 + Photoshop 桥 | ✅ 源码<br>❌ 依赖、产物 |
| **Agent** | `design/` | preset 的规范源：8 工具 + 7 技能 + 常驻纪律 | ✅ |
| **产出** | `examples/`（精选，进仓库）<br>`engine/out/`（成品，不进） | 成品图、效果对照表 | ✅ 精选 |
| **文档** | `docs/`（进仓库，2 份）<br>`../knowledge/`（不进，复盘库） | 方法论 vs 复盘素材 | 部分 |

**一句话记住边界**：`design/` 是 agent，`engine/` 是它的工具，`examples/` 是它的作品，
根目录那几个文件是环境与步骤。

---

## 二、仓库根（13 项 · 约 80 KB）

| 文件 | 作用 |
|---|---|
| `bootstrap-workspace.mjs` | **生成工作区外围**（素材库 / 项目区 / 缓存）。幂等：只补缺失，从不删除或覆盖；`--check` 只报告。 |
| `deploy-preset.mjs` | **把 `design/` 安装到 harness 的 preset 目录。** 必须跑，不是可选的——DSH 靠 `readdir` 扫描 preset 根并跳过一切非真实目录，所以 junction / symlink / settings 根都不通（三条都实测过）。`--check` 只报告差异，`--prune` 清理已删除的文件。 |
| `new-project.mjs` | 建项目：`node new-project.mjs <slug>` → `projects/YYYY-MM-DD-slug/` 及标准内部结构。`--list` 按最新在前列出。 |
| `make-examples.mjs` | 把 `engine/out/` 里的精选成品复制进 `examples/`。`--check` 只报告。 |
| `verify-knowledge.mjs` | 比对 `docs/` 与 `../knowledge/` 里同名文档的哈希，报告漂移。两处内容相同，**互为快照而非两处维护**。 |
| `README.md` | 面向使用者的说明：它是什么、怎么开始、能做什么。 |
| `REPO-LAYOUT.md` | 本文件。 |
| `.gitignore` | 声明哪些不进仓库：依赖、构建产物、缓存、编辑器目录、工作区外围。每条都写了理由。 |
| `.gitattributes` | `* text=auto`，统一换行。 |

**引擎位置的三级回退**（`design/agent.cordis.yml` → `config.engineDir`）：

```
config.engineDir  >  环境变量 DSH_DESIGN_ENGINE  >  preset 模块内的内置默认值
```

克隆到别处时设 `$env:DSH_DESIGN_ENGINE = "<你的路径>\engine"` 即可，不必改 composition。

---

## 三、工具（`engine/` · 133 文件 · 约 34 MB，其中 assets 占 5.7 MB）

### 3.1 进仓库的部分

| 目录 | 文件 | 内容 |
|---|---|---|
| `engine/bin/` | 1 | `design.mjs` —— **全部 CLI 子命令的唯一入口** |
| `engine/src/` | 18 | 引擎本体：`render` `text` `color` `effects` `filters` `tone` `measure` `kernel` `palette` `presets` `analyze` `verify` `psd` `psd-read` `fonts` `scale` `paths` `tools-roster` |
| `engine/tools/` | 28 | 会话工具，量测与审计为主：`crop-view` `font-try` `subject-probe` `audit-plant` `video-probe` … |
| `engine/test/` | 18 | 15 套测试 + `run-all.mjs` + `_preset-locate.mjs`（辅助，不是套件） |
| `engine/jsx/` | 5 | Photoshop 桥：`psx.ps1` + 4 个 JSX 探针 |
| `engine/scenes/` | 28 | 场景 JSON（**设计的源码**）+ 生成器 `build-*.mjs` + 决策笔记 |
| `engine/package.json` · `package-lock.json` | 2 | 依赖声明。只依赖 `@napi-rs/canvas` |

**CLI 子命令**（9 个）：`render` `analyze` `critique` `verify` `fonts` `ladder` `ramp` `palette` `tool`。

### 3.2 不进仓库的部分

| 目录 | 体积 | 为什么不进 |
|---|---|---|
| `engine/node_modules/` | 36.7 MB | `@napi-rs/canvas` 带平台原生二进制（27 MB skia）。提交了在别的机器上就是错的。`npm install` 重现。 |
| `engine/out/` | 23.4 MB | 18 个**成品**与量测报告。scene 在仓库里，约 1 秒/稿即可重出。 |
| `engine/assets/` | 5.7 MB | **本机专用的输入素材**：游戏立绘、处理后素材、标记。不是工具链的一部分。 |
| `engine/refs/` | 3.5 MB | 参考图，是 `design_analyze` 的输入，属于那台机器的工作资料。 |

**这条边界的代价**（克隆者能做什么、不能做什么）：

| 新克隆的人 | 能用吗 |
|---|---|
| 引擎、28 个会话工具、8 个 preset 工具 | ✅ |
| 全部 15 套测试（`node test/run-all.mjs`） | ✅ **完整可用**——测试已改成自给自足 |
| 7 个技能与 2 份方法论（`docs/`） | ✅ 新克隆即可自举 |
| 渲染 `engine/scenes/*.json` | ❌ 素材不在，且它们的 `src` 是绝对路径 |
| 重出 `examples/` 里的图 | ❌ 同上 |

测试自给自足的含义是具体的：套件**不再加载 `engine/assets/`**，
也**不再写死任何 per-machine 路径**（原先 `tool-schemas.mjs` / `tool-registry-gate.mjs`
把 Windows 用户名写死在路径里，`scope-regions.mjs` 用绝对路径加载立绘——
除了原作者那台机器，任何地方都跑不了）。现在改为运行时解析（`engine/test/_preset-locate.mjs`），
并支持 `DSH_TOOLS_DIR` / `DSH_PRESET_DIR` 覆盖。

### 3.3 工具 ↔ Agent 的连接点

`design/design-tools-*.mjs` 里的 8 个工具，全部通过**子进程**调用 `engine/bin/design.mjs`。
引擎不 vendor 进 preset，所以它在终端里也能独立使用。

---

## 四、Agent（`design/` · 11 文件 · 148 KB）

**这是 preset 的规范源。** harness 用的是它的**副本**，不是它本身：

```
design/                                    ← 仓库里的规范源（改这里）
      │  node deploy-preset.mjs
      ▼
%USERPROFILE%\.dsh\.agent-presets\design\  ← harness 实际加载的副本（不要手改）
```

| 文件 | 作用 |
|---|---|
| `agent.cordis.yml` | composition：工具行、技能行、shell、文件系统、jobs、goals |
| `design-policy.mjs` | 常驻审美纪律 prompt（**文本在 YAML 里，改文字不需要重启**） |
| `design-tools-260914-2212.mjs` | **8 个工具**：`design_render` `design_analyze` `design_critique` `design_verify` `design_system` `design_photoshop` `design_palette` `design_tool` |
| `preset.yml` | roster 里显示的 id / 名称 / 描述 |
| `skills/`（7 个） | 见下表 |

| 技能 | 覆盖 |
|---|---|
| `depth-and-structure` | **开工前必读**：四层级顺序、深度轴、先定层再定密度、面积占比陷阱、合成值 vs 设计值 |
| `design-foundations` | 审美与设计理解、四问、反模式清单 |
| `typography-and-scale` | 排版与字阶、真实度量、中英混排 |
| `colour-systems` | OKLab 阶梯、强调色预算、调子带 |
| `reference-analysis` | 参考规格提取（观感 → 可执行数值） |
| `filters-and-palette` | 滤镜词汇表、算子图、`scope` |
| `photoshop-delivery` | 分层交付、Photoshop 驱动与它的坑 |

> ⚠️ **改 `design-tools-*.mjs` 必须换文件名并同步 `agent.cordis.yml`。**
> Cordis Loader 对本地 `.mjs` 用 `await import(url)` 且无缓存破坏参数，一个文件名在一个
> 进程内只求值一次；照旧名字改内容会得到「改了但没生效」，而且报错指向**旧代码**。
> `design-policy.mjs` 不受此限，因为它的文本在 YAML 里。

**技能目录自动挂载**：`skill-filesystem` 的 `customSkillDirs` 指向 preset 自己的
`skills/`，**新增技能只需建目录**，不必改 composition。技能需要 YAML frontmatter
（`name` + `description`），缺失会被**静默跳过**——不报错。

---

## 五、产出与文档

### 5.1 `examples/` —— 进仓库（4 文件 · 3.1 MB）

| 文件 | 内容 |
|---|---|
| `poster-e-tooled.png` | 成品海报，**交付尺寸 2400×1350**。 |
| `poster-variants-and-scope.png` | 同一版式**六种处理**对照（flat / soft / press / light / tooled / scoped）并带标注。第 6 张是重点：C 与 F 用同一套双色调+网点，`scope` 让处理避开人脸。 |
| `effect-sheet.png` | 效果词汇总表，128 KB。 |
| `README.md` | 每条图的重出命令，以及对照表拼版脚本未留存这件事。 |

### 5.2 `engine/out/` —— 不进仓库（18 文件 · 23.4 MB）

**只放成品与量测报告**：poster a–e 五版 + `press-scoped`、对照表、效果表（含 12 MB PSD）、字体样张。

**判断规则一条**：**在 `out/` 里 = 成品；在 `../.cache/` 里 = 可随时删。**
测试与探针产物一律写到仓库外（见 §6.3），所以「这是成品还是探针残留」看路径就能回答。

### 5.3 `docs/` —— 进仓库（2 文件 · 54 KB）

只留**两份方法论**，理由是**新克隆的人要能自举**：一个刚 `git clone` 下来的检出没有
`../knowledge/`，如果连规则都读不到，就只剩一个没有使用说明的引擎。
这两份也正是 `depth-and-structure` 技能所引用的规范。

| 文件 | 内容 |
|---|---|
| `设计方法原理-给agent.md` | **设计方法论**（34 KB）。四层级顺序、深度轴、面积占比陷阱、测量边界。 |
| `设计问题与技术问题-给agent.md` | **交付复盘**（20 KB）。每条都是实际犯的错，带数字。 |

### 5.4 `../knowledge/` —— 复盘与参考库（**仓库之外**，不版控 · 34 文件）

Agent 自己用的文档库，三类。**分类判据见库内 `README.md`。**

| 分类 | 放什么（当前 N 份） | 判据 |
|---|---|---|
| `reference/` | 对着**量**的材料（6）。终末地规格、timeline KV 拆解、官方原理、三份早期整理 | 用来推导规格，不是用来直接搬 |
| `tooling/` | 工具怎么用（4）。设计方法原理、设计问题与技术问题、视频测量、**已知缺口与本地前提** | 回答「下一步跑什么、怎么读结果」 |
| `agent/` | agent 自己的复盘（5）。HANDOVER、REPAIR-NOTES、BRIEF、两份场景记录 | 回答「我上次是怎么栽的」 |

> ### 硬边界：**项目自己的艺术拆解不进这个库**
>
> 每个项目的艺术拆解、逐轮决策、被否掉的方案放在**项目内部**（`projects/<项目>/`），
> 因为它们**具有特殊性**——只对那一个版面成立。搬进通用库会让后来的 agent
> 拿别人的结论去套自己的画面，这正是「参数接近、视觉难看」的来源之一。
>
> **泛化的那一份**才进 `reference/`；抽不出来的，说明它确实属于那个项目。

---

## 六、工作区：仓库之外的区域

仓库只是工作区的一半。其余几块**必须存在、不进版本控制、由脚本生成**：

```
<WORKSPACE>\                       ← 工作区根，默认是仓库的上一级
├── DSH_GraphicDesign_Tools\       ← 本仓库
├── knowledge\                     ← 复盘与参考库（§5.4）
├── assets\                        ← ① 共享素材库：通用素材，每次生成都读
│   └── icons\ textures\ type\ plates\
├── projects\                      ← ② 项目区：每个项目自带私有素材
├── refs\                          ← ③ 供「量」的参考素材：截图、录像、官网源文件
├── .cache\                        ← ④ 生成缓存：可随时删
└── tools\bin\ffmpeg.exe           ← 共享工具
```

### 6.1 四块区域的分工，以及**素材该放哪**

| 区域 | 放什么 | 判据 |
|---|---|---|
| **`assets/`** | 通用设计素材：标记、纹理、字体参考、底板 | **两个项目都会用到** → 这里 |
| **`projects/<项目>/assets/`** | 该项目专用素材 | **只服务一个项目** → 项目里，随项目归档 |
| **`refs/`** | 别人的截图、录像、官网源文件 | **拿来「量」的**，推导规格用 |
| **`.cache/`** | 按需重新生成的一切 | **能重算出来** → 删了不心疼 |

> **`refs/` 与 `assets/` 的区别**：一个是**读的对象**（测量用），一个是**写的材料**（直接进版面）。
>
> **一条纪律**：两处都留一份必然走样，而**你正看着的那份不会是你实际用过的那份**。
> 提升到共享库要**移动**，不是复制。**一份文件，一个家。**

### 6.2 项目排序：`YYYY-MM-DD-slug`

```
projects\
  2026-09-16-endfield-language-deck\   终末地视觉语言 deck（含作品集交付版与 v1 归档）
  2026-09-15-shiroko-kv\               明日方舟白子 KV
```

日期前缀是**承重的**：有了它，`ls` 一次就是一份状态报告，不必打开任何文件夹。
**一个项目可以包含多个交付物与多代版本**：后继版本留在同一项目内，
被取代的那代归档为 `v1/`。

每个项目内固定位置：

| 目录 | 用途 |
|---|---|
| `scenes/` | 场景 JSON —— **这个项目的唯一真相源**，以及它自己的生成/预处理脚本 |
| `assets/` | 仅本项目素材 |
| `out/` | 本项目的渲染与报告 |
| `notes.md` | 决策、被否掉的方案与原因 |
| `v1/`、`archive/` | 被取代的版本，与**不再运行**的历史物 |

**`archive/` 放的是「评估过、决定不修」的东西**，并附一份 `archive/README.md` 写明理由，
让下一个读者不必重新打开一个已经结案的问题。

### 6.3 `../.cache/`（1,256 文件 · 约 1.16 GB）

一切「按需重新生成」的东西集中在这里，且放在**仓库外面**，不是放进去再 gitignore。

| 目录 | 写入者 | 可删 |
|---|---|---|
| `video/frames/` | `tools/video-probe.mjs frames` | ✅ 从原片重解码约 1 分钟 |
| `video/hud-frames/`、`video/survey/` | 手工抽帧、批量 `analyze` | ✅ |
| `video/alpha-fixtures/` | `tools/make-alpha-fixture.mjs` | ✅ |
| `test/` | `test/run-all.mjs` | ✅ 每次跑测试都重写 |
| `render-scratch/` | 一次性探针与迭代图 | ✅ |

> **为什么不放仓库里再 gitignore**：树里的缓存照样会被备份、被整目录搬走，
> 最要紧的是——**照样会被误认成交付物**。所以边界按「路径」划分，而不是按「忽略规则」。

### 6.4 指向写进了规则，而不是靠记忆

**路径是数据，定义在 `engine/src/paths.mjs`**，工具读它，不各自数 `'..','..','..'`。

```js
import { WORKSPACE, assetPath, projectPath, cachePath, listProjects, newProject } from './paths.mjs'
assetPath('icons', 'mark-cross.png')            // <WORKSPACE>/assets/icons/mark-cross.png
projectPath('2026-09-16-endfield-language-deck', 'out')
```

根目录由**该文件自身位置**推导（`<workspace>/<repo>/engine/src/`），所以克隆到哪都一样。
`DSH_WORKSPACE` 覆盖工作区根，`DSH_VIDEO_CACHE` 覆盖视频缓存。

**各项目脚本同样自锚**：从自身位置推出项目根，引擎靠**向上搜索** `DSH_GraphicDesign_Tools/engine`
定位——**不数层级**，因为层级数正是当初产生写死绝对路径的病因，项目一移动就断。

**两张表必须一致**：`paths.mjs` 有 `LAYOUT`，`bootstrap-workspace.mjs` 也有自己的一份
（它位于仓库根，不能 import `src/`，否则仓库没法自举）。重复的表会静默走样，
所以 `engine/test/workspace-layout.mjs` 逐键比对两者，并断言各区域都在仓库之外。

### 6.5 克隆之后自动生成

```powershell
git clone <url>
cd <repo>\engine; npm install
cd ..
node bootstrap-workspace.mjs        # 生成 assets/ + 分类目录 + projects/ + .cache/
node deploy-preset.mjs              # 装 preset
node new-project.mjs --list         # 看项目；新建：node new-project.mjs <slug>
```

> **为什么需要一个脚本，而不是写进 README 让人手敲 mkdir**：
> 一个会往 `../assets/` 写文件的工具，在 A 机器上能跑、在 B 机器上失败，
> 就因为没人建过那个目录——那不叫可移植。**布局是数据，脚本是它落地的方式。**

---

## 七、测试（`cd engine; node test/run-all.mjs` · 15 套 · 416 项）

```
scale.mjs                26   缩放契约（--scale）
analyze-flatness.mjs     15   区域平涂统计（主导平涂 / 可分辨色数）
workspace-layout.mjs     18   工作区布局：两张表一致、各区域在仓库之外
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

`run-all.mjs` **拒绝运行**「存在于磁盘但不在清单里」的套件，所以新增测试文件不会被漏掉；
以 `_` 开头的是**辅助模块**，不是套件。

---

## 八、上传 GitHub 与克隆使用

### 上传步骤

```powershell
$repo = "<path>\DSH_GraphicDesign_Tools"
cd $repo

# 1. 先确认干净
cd engine; node test/run-all.mjs; cd ..        # 期望 15/15，exit 0
node deploy-preset.mjs --check                 # 期望 would copy 0, identical 10, 0 extra
node verify-knowledge.mjs                      # 期望 no drift

# 2. 确认将上传的内容
git add -A --dry-run | Measure-Object

# 3. 提交与推送
git add -A
git commit -m "<message>"
git remote add origin <url>       # 首次才需要
git push -u origin main
```

### 上传前自查清单

- [ ] `engine/node_modules/` 没有被加入（36.7 MB 原生二进制）
- [ ] `engine/out/` 没有被加入（23.4 MB 成品）
- [ ] `engine/assets/`、`engine/refs/` 没有被加入（本机专用输入素材）
- [ ] `examples/` **在**里面（3.1 MB，仓库唯一的成品展示）
- [ ] 工作区四区 `knowledge/` `assets/` `projects/` `.cache/` `refs/` 都不在里面
- [ ] `docs/` 恰好两份方法论
- [ ] `design/` 只有 **11** 个文件，且只有一个 `design-tools-*.mjs`
- [ ] 没有任何文件写入 harness home 的路径，也没有本机用户名

### 克隆之后

```powershell
git clone <url>
cd <repo>\engine; npm install
cd ..; node bootstrap-workspace.mjs; node deploy-preset.mjs
$env:DSH_DESIGN_ENGINE = "$PWD\engine"        # 仓库不在原路径时才需要
```

然后在 DSH 里开一个**选中「设计」预设**的新会话。

---

## 九、已知缺口

**这一节只写工具链自身的技术缺口与流程缺口** —— 代码结构、测试结构、工程流程上的洞。

| 不写什么 | 为什么 | 写在哪 |
|---|---|---|
| 本机环境前提、交付记录、运行记录 | 换机器/换工作区/用几次就失效 | `../knowledge/tooling/已知缺口与本地前提.md` |
| 用户与会话的操作记录 | 那是「用过什么」，不是项目缺口 | 同上，标记为记录而非缺口 |

### 9.1 CLI 入口没有端到端测试 —— 这是覆盖空缺的根

**技术缺口。** 现状：

```
CLI 子命令（9 个）：render analyze critique verify fonts ladder ramp palette tool
把 CLI 当程序跑的测试文件：0
  （run-all.mjs 与 workspace-layout.mjs 会 spawn 进程，但分别是为了「跑套件」和「验证环境变量」）
18 个 src 模块中，被测试直接 import 的：16
```

模块级测试很密（416 项断言），**但没有任何测试经由 CLI 走一遍**。
而 agent 的 8 个工具**恰恰通过 CLI 子进程调用引擎**——于是整条面向使用者的路径
（参数解析、子命令分发、JSON 输出契约、退出码）**处在测试之外**。

这不是理论风险：`--scale` 把画布宽度乘两次、高度一次不乘（2400×1350 在 `--scale 0.5`
下变成 600×675），**而报告始终 0 error / 0 warning**。它被真实调用过 8 次，
**每一次都带着比例错误出了图**——一个被使用、看起来成功、却没有任何检查会失败的路径。

**修法**：加一套把 CLI 当程序驱动的测试（spawn + 校验 JSON 与退出码）。
这类测试是唯一能抓住「参数解析写错」的那种；**使用次数增加不会消掉这个缺口，只有测试会。**

### 9.2 preset 里留着一个写死的作者路径

**技术缺口。** `design/design-tools-*.mjs` 里：

```js
const DEFAULT_ENGINE = 'D:\\DSH_GDT\\DSH_GraphicDesign_Tools\\engine'
```

它**当前不可达**（composition 总是显式给 `engineDir`），也是**有文档的兜底**，
报错信息会说明来源。但它是**作者机器上的路径**，与本文件 §6.4「指向应当是数据」相冲突：
别人 clone 之后若那一行被走到，报错会指向一个他从未听说过的目录。

**修法**：兜底改为「从模块自身位置向上搜索仓库」——
`engine/test/_preset-locate.mjs` 与各项目脚本已经用了这个模式。

### 9.3 没有任何自动化在跑这套测试

**流程缺口。** 现状：`无 .github/workflows`、`无其他 CI 配置`、`无根 package.json`；
测试入口只在 `engine/` 内。

后果具体：`run-all.mjs` 的设计意图是「一条命令、一个退出码」，
但**没有任何东西强制它在每次改动后被执行**。而它存在的理由正是
「守卫过期、8/8 通过却 exit 1 而长期无人发现」——**它的执行仍然是自愿的。**

**修法**：加一个最小 CI（一个 job：`npm install` → `node test/run-all.mjs`），
或至少在根加 `package.json` 统一入口，让「跑测试」不必先记住 `cd engine`。
