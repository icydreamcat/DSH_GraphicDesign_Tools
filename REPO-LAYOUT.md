# 仓库结构与内容分类 · REPO-LAYOUT

**这一个仓库 = 一个平面设计 Agent + 它驱动的引擎 + 它的产出。**

本文件是那份「什么在哪、什么该上传」的唯一权威说明。先读它，再读 `docs/`。

- 仓库根：`DSH_GraphicDesign_Tools/`
- 首次运行：`engine/` 里 `npm install`，然后根目录 `node deploy-preset.mjs`
- 全部测试：`cd engine; node test/run-all.mjs`（14 套、398 项断言）

---

## 一、四类东西，各自的唯一位置

| 你要找的 | 在哪 | 是什么 | 进 GitHub |
|---|---|---|---|
| **环境** | 仓库根 4 个文件 | 让上面三样跑起来的胶水 | ✅ |
| **工具** | `engine/` | Node 渲染引擎 + 25 个会话工具 + Photoshop 桥 | ✅ 源码<br>❌ 依赖、产物 |
| **Agent** | `design/` | 唯一的 preset 规范源（10 文件 + 7 技能） | ✅ |
| **设计产出** | `examples/`（精选）<br>`engine/out/`（全部） | 成品图、效果对照表 | ✅ 精选<br>❌ 其余 |
| 说明 | `docs/` | 需求简报 + 交接 + 复盘 | ✅ |

**一句话记住边界**：`design/` 是 agent，`engine/` 是它的工具，`examples/` 是它的作品，
根目录那 4 个文件是环境和步骤。

---

## 二、环境（仓库根 · 4 文件 · 约 11 KB）

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
| `engine/tools/` | 25 | 134 KB | 25 个会话工具（量测与审计为主：`crop-view` `font-try` `subject-probe` `audit-plant` …） |
| `engine/test/` | 16 | 180 KB | 14 套测试 + `run-all.mjs` + `_preset-locate.mjs`。见 §六 |
| `engine/jsx/` | 5 | 36 KB | Photoshop 桥：`psx.ps1` + 4 个 JSX 探针 |
| `engine/scenes/` | 28 | 447 KB | 场景 JSON（**设计的源码**）+ 生成它们的 `build-*.mjs` + 决策笔记 `*.md` |
| `engine/package.json` · `package-lock.json` | 2 | — | 依赖声明。只依赖 `@napi-rs/canvas` |

### 3.2 不进仓库的部分

| 目录 | 大小 | 为什么不进 |
|---|---|---|
| `engine/node_modules/` | 37.5 MB | `@napi-rs/canvas` 带平台原生二进制（27 MB skia），提交了在别的机器上就是错的。`npm install` 重现。 |
| `engine/out/` | 46.8 MB | 42 个构建产物，每轮迭代都重写；每个约 1 秒即可从旁边的 scene 重出。 |
| **`engine/assets/`** | 5.9 MB | **本机专用的输入素材**：游戏立绘、处理后素材、`icons/` 标记。不是工具链的一部分——克隆的人是要做**自己的**东西，不是重出这台机器的海报。 |
| **`engine/refs/`** | 3.5 MB | 同上：参考图是 `design_analyze` 的输入，属于那台机器的工作资料。 |

> **这条边界划在哪，和它的代价**（`engine/assets/` `engine/refs/` 于本次取消跟踪，
> 文件仍留在本地磁盘）：
>
> | 新克隆的人 | 能用吗 |
> |---|---|
> | 引擎、25 个会话工具、8 个 preset 工具 | ✅ |
> | 全部 14 套测试（`node test/run-all.mjs`） | ✅ **完整可用**——为此专门把测试改成自给自足 |
> | 渲染 `engine/scenes/*.json` | ❌ 它们的 `src` 是绝对路径，素材也不在 |
> | 重出 `examples/` 里的图 | ❌ 同上 |
>
> **测试自给自足是这次的关键改动**，因为原来的套件机器绑死：
> `scope-regions.mjs` 用绝对路径加载 `assets/haruka-figure.png`；
> `tool-schemas.mjs` / `tool-registry-gate.mjs` 把**用户名**写死在路径里
> （`C:/Users/iced're'a'm/...`），而且指向的是**部署副本**而不是仓库源。
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

### 5.2 `engine/out/` —— 不进仓库（42 文件 · 46.8 MB）

全部渲染稿、量测报告与 PSD。**它们是构建产物**：scene 在仓库里，约 1 秒/稿即可重出。

> **注意一处缺口**：`docs/AGENT-REPAIR-NOTES.md` §七 交付物清单里的
> `out/muelsyse-ginkgo-kv.png` / `.psd` / `.report.json` **不在这份拷贝里**。
> 源头都在（`scenes/muelsyse-ginkgo.json`、`scenes/build-muelsyse-kv.mjs`、决策笔记），
> 按 `AGENT-REPAIR-NOTES.md` 的实测基线可以重出。`engine/out/` 里现存的是 33 张
> 迭代与探针图以及 `effect-sheet.psd`。

### 5.3 `docs/` —— 进仓库（7 文件 · 200 KB）

| 文件 | 内容 |
|---|---|
| `AGENT-BRIEF-平面设计.md` | **需求源头**（20 KB）。这个 preset 就是按它建的；含那条最重要的判断：瓶颈不在生成，在「判断」与「验证」。 |
| `HANDOVER.md` | **交接与实测结论**（55 KB，11 节）。包括 Photoshop 挂死的真正根因（是 DSH 文件沙箱，不是 GPU）、调色板词汇表、分层 PSD、以及「`tools.register()` 不编译 parameters」这个真根因。 |
| `AGENT-REPAIR-NOTES.md` | **复盘**（12 KB）。引擎真 bug、自检为何失效（6 次同类错误全报 0 问题）、缺失工具清单、设计判断。 |
| `设计方法原理-给agent.md` | **设计方法论**（34 KB）。四层级顺序、深度轴、面积占比陷阱、测量边界。**「分层与结构」技能的规范来源。** |
| `设计问题与技术问题-给agent.md` | **交付复盘**（20 KB）。每条都是实际犯的错，带数字：指标是手段不是目的、套规则前先问用途、模板盖十次≠十张设计图。 |
| `终末地设计语言拆解.md` | **规格与证据**（54 KB）。每个色值/比例都标来源与置信度，含被实测推翻的 5 条流传说法。 |
| `视频测量-录像要求与工具.md` | **只能靠录像判定的部分**（6 KB）。α 回归、分段纪律、编码偏置 ±0.02。 |

> ⚠️ **这四份方法论文档此前一直放在工作区根 `D:\DSH_GDT\`，在仓库之外** ——
> 也就是说 agent 在干活时**看不到它们**，别人克隆也拿不到。本次已收入 `docs/`，
> 并按其中内容写出技能 `design/skills/depth-and-structure/`。

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

## 六、测试（`node test/run-all.mjs` · 14 套 · 398 项）

```
scale.mjs                26   缩放契约（--scale 双重缩放，见 §十）
analyze-flatness.mjs     15   区域平涂统计（主导平涂 / 可分辨色数，见 §十一）
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

# 1. 先确认干净：14 套测试全绿
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
- [ ] `engine/out/` 没有被加入（46.8 MB 构建产物）
- [ ] `examples/` **在**里面（3.2 MB，是仓库唯一的成品展示）
- [ ] `engine/scenes/.idea/` 没有被加入
- [ ] `docs/` 三份文档都在
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
5. 本机 Photoshop 启动挂死一事，`HANDOVER.md` §2 的结论是**需要非受限 shell**；这是一条
   环境前提，不是本仓库能修的东西。
