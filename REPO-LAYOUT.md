# 仓库结构与内容分类 · REPO-LAYOUT

**这一个仓库 = 一个平面设计 Agent + 它驱动的引擎 + 它的产出。**

本文件是「什么在哪、什么该上传、边界划在哪」的权威说明。
它描述**这套设施的结构与规则**：每个位置是干什么的、什么该进仓库、边界为什么划在那里。

```
仓库根：DSH_GraphicDesign_Tools/
首次运行：engine/ 里 npm install → 根目录 node bootstrap-workspace.mjs → node deploy-preset.mjs
全部测试：cd engine; node test/run-all.mjs
```

---

## 一、四类东西，各自的唯一位置

| 你要找的 | 在哪 | 是什么 | 进 GitHub |
|---|---|---|---|
| **环境** | 仓库根 5 个脚本/配置 | 让其余三样跑起来的胶水 | ✅ |
| **工具** | `engine/` | Node 渲染引擎 + 29 个会话工具 + Photoshop 桥 | ✅ 源码<br>❌ 依赖、产物 |
| **Agent** | `design/` | preset 的规范源：8 工具 + 7 技能 + 常驻纪律 | ✅ |
| **产出** | `examples/`（精选，进仓库）<br>`engine/out/`（成品，不进） | 成品图、效果对照表 | ✅ 精选 |
| **文档** | `docs/`（进仓库，2 份）<br>`../knowledge/`（不进，复盘库） | 方法论 vs 复盘素材 | 部分 |

**一句话记住边界**：`design/` 是 agent，`engine/` 是它的工具，`examples/` 是它的作品，
根目录那几个文件是环境与步骤。

---

## 二、仓库根

| 文件 | 作用 |
|---|---|
| `bootstrap-workspace.mjs` | **生成工作区外围**（素材库 / 项目区 / 缓存）。幂等：只补缺失，从不删除或覆盖；`--check` 只报告。 |
| `deploy-preset.mjs` | **把 `design/` 安装到 harness 的 preset 目录。** 必须跑，不是可选的——DSH 靠 `readdir` 扫描 preset 根并跳过一切非真实目录，所以 junction / symlink / settings 根都不通（三条都实测过）。`--check` 只报告差异，`--prune` 清理已删除的文件。 |
| `encrypt-doc.mjs` | **加密/解密一份文档。** scrypt(N=32768,r=8,p=1) 派生密钥 + AES-256-GCM（加密同时鉴权，口令错与文件被改都会明确报出来）。文件头明文可读，口令从不落盘、不进命令行。`inspect` 只看结构，不需要口令。 |
| `new-project.mjs` | 建项目：`node new-project.mjs <slug>` → `projects/YYYY-MM-DD-slug/` 及标准内部结构。`--list` 按最新在前列出。 |
| `make-examples.mjs` | 把 `engine/out/` 里的精选成品复制进 `examples/`。`--check` 只报告。 |
| `verify-knowledge.mjs` | 比对 `docs/` 与 `../knowledge/` 里同名文档的哈希，报告漂移。两处内容相同，**互为快照而非两处维护**。 |
| `encrypt-doc.mjs` | 加密/解密一份文档。见下方「一份锁着的文档」。 |
| `为什么做这个项目.md.enc` | **加过密的动机文档。** 全仓只有密文，**本机不留明文**——这一份密文就是保险库。 |
| `README.md` | 面向使用者的说明：它是什么、怎么开始、能做什么。 |
| `REPO-LAYOUT.md` | 本文件。 |
| `.gitignore` | 声明哪些不进仓库：依赖、构建产物、缓存、编辑器目录、工作区外围。每条都写了理由。 |
| `.gitattributes` | `* text=auto`，统一换行。 |

**引擎位置的三级回退**（`design/agent.cordis.yml` → `config.engineDir`）：

```
config.engineDir  >  环境变量 DSH_DESIGN_ENGINE  >  preset 模块内的内置默认值
```

克隆到别处时设 `$env:DSH_DESIGN_ENGINE = "<你的路径>\engine"` 即可，不必改 composition。

### 一份锁着的文档

`为什么做这个项目.md.enc` 是这个项目**为什么存在**的说明，加密存放。

```powershell
# 读完写在 .cache/ 里（可随时删），不要把明文写回仓库
node encrypt-doc.mjs decrypt 为什么做这个项目.md.enc D:\DSH_GDT\.cache\为什么做这个项目.md
node encrypt-doc.mjs inspect 为什么做这个项目.md.enc   # 只看文件头，不需要口令
```

**为什么加密**：它谈的是立场，不是方法——为什么做这件事、反对什么、把 AI 当作同事意味着什么。
方法在这个文件与 `README.md` 里，那份文档不重复它们。**加锁不是因为内容有害，是因为有些判断需要
时间才能被公正地读。** 写下立场，然后不去解释、不去辩护、不去要一个立刻的回音。

**口令不在这里，也不在任何文件里。** 加密用 scrypt(N=32768,r=8,p=1) 派生密钥、AES-256-GCM
加密并鉴权：口令错和文件被改都会明确报出来，而不是解出一段乱码。

**本机不留明文，这是有意的取舍。** 这一份密文就是保险库——本地再留一份明文，等于给保险库配一把
挂在门上的备用钥匙，而这份文档的价值恰恰在于它不被随手读到。代价必须写清楚：**口令丢了，这份东西
就找不回来了**，没有找回机制、没有第二把钥匙、没有任何副本。往里加内容之前，先确认口令还在。

---

## 三、工具（`engine/`）

### 3.1 进仓库的部分

| 目录 | 内容 |
|---|---|
| `engine/bin/` | `design.mjs` —— **全部 CLI 子命令的唯一入口** |
| `engine/src/` | 引擎本体：`render` `text` `color` `effects` `filters` `tone` `measure` `kernel` `palette` `presets` `analyze` `verify` `psd` `psd-read` `fonts` `scale` `paths` `tools-roster` |
| `engine/tools/` | 会话工具，量测与审计为主：`crop-view` `font-try` `subject-probe` `audit-plant` `video-probe` `check-render` … |
| `engine/test/` | 测试套件 + `run-all.mjs` + `_preset-locate.mjs`（辅助，不是套件） |
| `engine/jsx/` | Photoshop 桥：`psx.ps1` + 4 个 JSX 探针 |
| `engine/scenes/` | 场景 JSON（**设计的源码**）+ 生成器 `build-*.mjs` + 决策笔记 |
| `engine/package.json` · `package-lock.json` | 依赖声明。只依赖 `@napi-rs/canvas` |

**CLI 子命令**（11 个）：`render` `analyze` `critique` `verify` `gate-delivery` `check-render` `fonts` `ladder` `ramp` `palette` `tool`。

`check-render` 与 `gate-delivery` 都是 `design tool <name>` 的别名，为的是让交付步骤要用的那两条命令
能从 `--help` 里看到。判据与其它工具一样在 `tools/` 里，不在入口——入口只负责找得到。

#### GATE 1 —— 渲染是闸门，不是请求

**没有 `gates` 块的场景会被渲染器拒绝**：不写出任何文件，退出码非零，错误信息直接列出要决定的那几件事。

这条的成立理由是量出来的。之前那份常驻 policy 要求「动第一个元素前先答四问」，它**确实常驻**——
在会话记录的 `system` 字段里能查到——而接下来那一场仍然违反了它自己九条原则。**写在提示词里的要求
是可跳过的，因为跳过的代价是零。** 唯一躲不掉的形态，是跳过了就没有图。

```
render <scene.json> [--out DIR] [--name FILE] [--psd] [--scale N] [--supersample N] [--no-gates]
```

前六个键必填，闸门读它们：

| 键 | 声明什么 |
|---|---|
| `focus` | 读者唯一先看到的那样东西，以及它跟谁竞争 |
| `lightAxis` | 光从哪来 |
| `layers` | 绘制顺序（id 前缀序列）——`H4` 拿它比对真实列表 |
| `drawingRule` | 生成每一组的规则；说不出规则的组不算设计过 |
| `accentBand` | 强调色的允许平铺占比，如 `[0, 0.05]` |
| `sequence` | **11 步判定顺序**，每步写明，或标 `{ why }` 说明它为何不适用 |

**`sequence` 是这份契约里唯一一个「顺序本身可判」的键。** 11 步来自四门合成课的合并结论
（清点 → 判语言 → 定动线 → **定光轴** → 分明暗 → 分角色 → 分饱和 → 交错 → 造型 → 效果 → 质感），
顺序写在 `src/gates.mjs` 的 `DECISION_SEQUENCE` 里，所以缺步和错序都会被渲染器拒绝。**能跳的步要
给原因**——"不适用"和"没想到"从外面看是一样的，而后者是这一整类失败里最贵的一种。

两种写法，各自语义不同：

```
sequence: ["这页上有哪些物件", "参考是石版还是水彩", …]         // 数组：位置即顺序
sequence: { inventory: "…", lightAxis: "…", saturation: { why: "单色，没有饱和决策" }, … }  // 对象：指名，顺序可查
```

**数组形式里位置就是顺序**，所以数组项是字符串；要指名就用对象形式。这条是第一版判据的 bug：
它允许数组项带 `step` 名字，于是"把光轴挪到最后"永远检测不到——判据循环依赖了它要验证的那个顺序。

**可选键只在声明时才查**：`forbiddenZones`（`H4b`）、`sheetRoles`（`H5`）、`groundEntities`（`H4b` 的豁免）、
`allowTranslucent`（`H5` 的例外）。不声明不是失败，而是 SKIP 并说明原因——见下一节。

**代价随风险走，不要在算术已经回答的地方再花一次看。** 声明了 `forbiddenZones` 而几何上没有任何
元素落进去 → 直接通过，不裁图、不留物证、零代价。**只有真的相交时**才报出位置、占禁区的比例与
不透明度，打印一条可直接执行的 1:1 裁切命令，并要求看一眼——因为**几何相交不等于视觉遮挡**，
一片近乎透明的纹理压过脸是合法设计，一块不透明板压过去是事故，而这不是规则能回答的问题。

`--no-gates` 是**显式**逃生门，给引擎固件场景与一次性探针用。它需要被敲出来，这是刻意的：
默认放行就等于回到这道闸门要打破的那种沉默。

#### 为什么 `H4b` / `H5` 是声明驱动，不是正则

这两项原先靠**图层名**判断该放过谁：一张 sheet 前缀表、一张 overlay 后缀表、一张 ground 关键词表。
三张表都是从**一个项目**的命名里学来的。后果比误报更糟——换一套命名，检查会放过整个场景然后报
「通过」，而**沉默会被读成成功**。

现在它们读声明：`gates.groundEntities` 说明哪些图层是「人物站在其上的东西」，
`gates.sheetRoles` 说明哪些图层**就是**一张实体纸（也可以顺便声明哪些不是，附理由）。
两者都不声明时给的是 **SKIP 并说明原因**，不是 PASS。

这条原则本来就管着 `forbiddenZones`，而闸门自己的文件头先说过：**闸门无法发现脸在哪，所以区域必须由
场景声明。** 它同样无法知道两张满幅图层里哪一张是底——那就声明。

#### 部署漂移是断路的来源，现在有退出码

`deploy-preset.mjs --check` 的三种状态与退出码：**0 一致**、**1 有漂移**、**2 未安装**。
这条闸门是补出来的，因为确实出过一次事故：源文件改了一大轮、YAML 校验、行数统计、独立解析脚本
全部通过——**而没有 deploy**，harness 加载的还是旧的 402 行版本。所有校验都在验源文件，活的
那一份是旧的，几周没人发现。校验的全部意义，被那个没人强制执行的步骤抵消了。

#### `check-render` —— 在**交付的那张图**上量文字

```powershell
node bin/design.mjs check-render out/poster.png --report out/poster.report.json
node bin/design.mjs check-render out/poster.png --zones my-zones.json --draw out/zoned.png
```

**它补的是 `verifyScene` 结构上做不到的那件事。** 场景级检查只能拿文字层声明的颜色去比**页面声明的
`ground`**，它永远看不到字底下实际是什么——那正是 `scene.allow` 那张豁免清单存在的原因。
而这个工具读的是成品像素，也**只读成品像素**。

**为什么必须是成品**：另一张海报曾在 hero 合成图上量，那是效果与新图层**之前**的状态；
在成品上同一批区是 3.7:1 与 3.9:1。量测本身没错，**被量的对象错了**。

**两个读数，因为它们在两处各自失明：**

| 读数 | 是什么 | 什么时候用 |
|---|---|---|
| 屏幕上 | 区内像素的**墨核与底核**之比（不需要事先知道墨色） | 描述读者实际看到的对比 |
| 声明 | 场景里写的墨色对实测底子 + **屏幕上的墨是否还是那个墨** | 抓「效果改了字形、没改声明色」 |

第二列是**这个工具存在的理由**。曾经有两版文字报「80 层全部 ≥ 4.5:1」而字是灰的：一个
`outerGlow` 配 `blend: 'normal'` 把暗色**盖在笔画上**，声明的墨色没变、底子没变，改的是字形——
凡是拿那两个输入作比较的检查都看不见它。

**判据（WCAG 那一套，不另立标准）**：`ok` = 比值 ≥ 4.5 且底子撑不住的 < 10%；`warn` = ≥ 4.0 且 < 20%；
其余 `LOW`。退出码只在 `LOW` 时非零——`warn` 是「该有人看一眼」的带，让它在 `warn` 上失败会开始逼版面改形状。

**它不做的**：不判断低对比是不是有意为之（水印、压下去的字是设计决定），也量不了
「字被效果打碎了」这类比值之外的事。这两条写在 JSON 的 `limits` 里，不写在注释里。

### 3.2 不进仓库的部分

| 目录 | 为什么不进 |
|---|---|
| `engine/node_modules/` | `@napi-rs/canvas` 带**平台原生二进制**（skia）。提交了在别的机器上就是错的。`npm install` 重现。 |
| `engine/out/` | **成品**与量测报告。scene 在仓库里，约 1 秒/稿即可重出。 |
| `engine/assets/` | **使用者的输入素材**：立绘、处理后素材、标记。不是工具链的一部分——克隆的人是来做**自己的**东西。 |
| `engine/refs/` | 参考图，是 `design_analyze` 的输入，属于使用者自己的工作资料。 |

**这条边界意味着**（克隆者能做什么、不能做什么）：

| 新克隆的人 | 能用吗 |
|---|---|
| 引擎、29 个会话工具、8 个 preset 工具 | ✅ |
| 全部测试（`node test/run-all.mjs`） | ✅ **完整可用**——测试自给自足 |
| 7 个技能与 2 份方法论（`docs/`） | ✅ 新克隆即可自举 |
| 渲染 `engine/scenes/*.json` | ❌ 素材不在，且它们的 `src` 是绝对路径 |
| 重出 `examples/` 里的图 | ❌ 同上 |

**测试自给自足**，所以换任何机器都能跑：套件不加载 `engine/assets/`，也不写死任何 per-machine 路径。
需要在运行时定位的东西一律解析得到——`engine/test/_preset-locate.mjs` 负责找 preset 与 `dsh-tools`，
并支持 `DSH_TOOLS_DIR` / `DSH_PRESET_DIR` 覆盖；需要一个主体图的自检**自己画**，不依赖素材。

### 3.3 工具 ↔ Agent 的连接点

`design/design-tools-*.mjs` 里的 8 个工具，全部通过**子进程**调用 `engine/bin/design.mjs`。
引擎不 vendor 进 preset，所以它在终端里也能独立使用。

---

## 四、Agent（`design/`）

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

### 5.1 `examples/` —— 进仓库

| 文件 | 内容 |
|---|---|
| `poster-e-tooled.png` | 成品海报，**交付尺寸 2400×1350**。 |
| `poster-variants-and-scope.png` | 同一版式**六种处理**对照（flat / soft / press / light / tooled / scoped）并带标注。第 6 张是重点：C 与 F 用同一套双色调+网点，`scope` 让处理避开人脸。 |
| `effect-sheet.png` | 效果词汇总表。 |
| `README.md` | 每条图的重出命令。 |

### 5.2 `engine/out/` —— 不进仓库

**只放成品与量测报告**：poster a–e 五版 + `press-scoped`、对照表、效果表（含分层 PSD）、字体样张。

**判断规则一条**：**在 `out/` 里 = 成品；在 `../.cache/` 里 = 可随时删。**
测试与探针产物一律写到仓库外（见 §6.3），所以「这是成品还是探针残留」看路径就能回答。

### 5.3 `docs/` —— 进仓库

只留**两份方法论**，理由是**新克隆的人要能自举**：一个刚 `git clone` 下来的检出没有
`../knowledge/`，如果连规则都读不到，就只剩一个没有使用说明的引擎。
这两份也正是 `depth-and-structure` 技能所引用的规范。

| 文件 | 内容 |
|---|---|
| `设计方法原理-给agent.md` | **设计方法论**。四层级顺序、深度轴、面积占比陷阱、测量边界。 |
| `设计问题与技术问题-给agent.md` | **交付复盘**。每条都是实际犯的错，带数字。 |

### 5.4 `../knowledge/` —— 复盘与参考库（**仓库之外**，不版控）

Agent 自己用的文档库，三类。**分类判据见库内 `README.md`。**

| 分类 | 放什么（当前 N 份） | 判据 |
|---|---|---|
| `reference/` | 对着**量**的材料：参考作品的规格拆解、官方原理、早期整理 | 用来推导规格，不是用来直接搬 |
| `tooling/` | 工具怎么用：方法原理、技术与问题清单、视频测量、本机前提 | 回答「下一步跑什么、怎么读结果」 |
| `agent/` | agent 自己的复盘：交接、复盘、需求源头、场景记录 | 回答「我上次是怎么栽的」 |

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

### 6.3 `../.cache/` —— 生成缓存

一切「按需重新生成」的东西集中在这里，且放在**仓库外面**，不是放进去再 gitignore。

| 目录 | 写入者 | 可删 |
|---|---|---|
| `video/frames/` | `tools/video-probe.mjs frames` 解码的帧序列 | ✅ 从原片重解码 |
| `video/hud-frames/`、`video/survey/` | 抽帧、批量 `analyze` 的输出 | ✅ |
| `video/alpha-fixtures/` | `tools/make-alpha-fixture.mjs` | ✅ |
| `test/` | `test/run-all.mjs` 写的自检产物 | ✅ 每次跑测试都重写 |
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
定位，**不数 `..` 层级**——层级数一改就断，而向上搜索不会。

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

## 七、测试

```powershell
cd engine; node test/run-all.mjs        # 一条命令跑全部套件，一个退出码看结论
```

| 套件 | 覆盖 |
|---|---|
| `scale.mjs` | 缩放契约（`--scale`） |
| `analyze-flatness.mjs` | 区域平涂统计（主导平涂 / 可分辨色数） |
| `workspace-layout.mjs` | 工作区布局：两张表一致、各区域都在仓库之外 |
| `render-regressions.mjs` | `line` 坐标、halftone knockout |
| `scope-regions.mjs` | 作用范围（走真实渲染管线，主体图由测试自己画） |
| `scope-conflicts.mjs` | 范围冲突与 `replace` 语义 |
| `filters.mjs` | 常数时间滤镜逐像素对照 |
| `effects.mjs` | 10 个图层效果（含反例对照） |
| `palette.mjs` | 测量层、核、可分解性 |
| `palette-ops.mjs` | 逐点算子、算子图、预设 |
| `presets.mjs` | 七个滤镜预设的方向与掩码曲线 |
| `selftest.mjs` | 引擎自检 |
| `psd-roundtrip.mjs` | PSD 结构校验 |
| `tool-schemas.mjs` | preset 工具 schema 形状 |
| `tool-registry-gate.mjs` | 照抄 `register()` 与 provider 投影 |

`run-all.mjs` **拒绝运行**「存在于磁盘但不在清单里」的套件，所以新增测试文件不会被漏掉；
以 `_` 开头的是**辅助模块**，不是套件。

---

## 八、上传 GitHub 与克隆使用

### 上传步骤

```powershell
$repo = "<path>\DSH_GraphicDesign_Tools"
cd $repo

# 1. 先确认干净（三项都应无输出/无差异，测试应 exit 0）
cd engine; node test/run-all.mjs; cd ..
node deploy-preset.mjs --check                 # 期望：would copy 0, identical N, 0 extra
node verify-knowledge.mjs                      # 期望：no drift

# 2. 确认将上传的内容
git add -A --dry-run | Measure-Object

# 3. 提交与推送
git add -A
git commit -m "<message>"
git remote add origin <url>       # 首次才需要
git push -u origin main
```

### 上传前自查清单

- [ ] `engine/node_modules/`、`engine/out/`、`engine/assets/`、`engine/refs/` 都没有被加入（依赖、产物、使用者自己的素材）
- [ ] 工作区各区域 `knowledge/` `assets/` `projects/` `refs/` `.cache/` 都不在里面
- [ ] `examples/` **在**里面——它是仓库唯一的成品展示
- [ ] `docs/` 里两份方法论**在**里面——新克隆靠它们自举
- [ ] `design/` 只有一个 `design-tools-*.mjs`（换过文件名时，旧文件必须已删）
- [ ] 没有任何文件写入 harness home 的路径，也没有使用者的用户名

### 克隆之后

```powershell
git clone <url>
cd <repo>\engine; npm install
cd ..; node bootstrap-workspace.mjs; node deploy-preset.mjs
$env:DSH_DESIGN_ENGINE = "$PWD\engine"        # 仓库不在原路径时才需要
```

然后在 DSH 里开一个**选中「设计」预设**的新会话。

感谢吃白饭的大肥鱼
