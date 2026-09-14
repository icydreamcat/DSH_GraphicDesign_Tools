# design preset — 交接说明（构建者留给后续维护）

这个文件记录**构建过程中真实发现的东西**，供后续维护与排障使用。
不重复 `AGENT-BRIEF-平面设计.md` 的内容——那份简报是需求来源，这份是实测结论。

## 〇、仓库位置与 preset 的部署

仓库根是 `D:\DSH_GDT\DSH_GraphicDesign_Tools`，下面三个目录：

| 目录 | 内容 |
|---|---|
| `engine/` | Node 工程（渲染、度量、PSD 写出） |
| `design/` | agent preset 的**规范源** |
| `docs/` | 这两份文档 |

**preset 必须先由仓库部署到 harness 的 preset 根，会话才用得上它。** 在仓库根执行：

```powershell
node deploy-preset.mjs            # 复制，逐个文件报告
node deploy-preset.mjs --check    # 只报告差异，不写任何东西
```

**为什么要多这一步**（这一层是刻意的，不要试图省掉）：DSH 靠扫描
`%USERPROFILE%\.dsh\.agent-presets\` 发现 preset，扫描方式是 `readdir(dir, { withFileTypes: true })`，
然后**跳过任何 `isDirectory()` 为 false 的子项**。实测过的三条路都不通：

- **settings 里的根根本不会被读**——roster 在 `apply()` 里一次性从 composition 自己的
  `config.roots` 算出根列表，settings 只被问 `default`；
- **目录 junction 与 symlink 都会被列出来**，但报告 `isDirectory: false` /
  `isSymbolicLink: true`，于是被**静默跳过**——不报错、名单里也没有它。

两种都试过。扫描只接受真实目录，所以仓库存源、脚本安装。

**整个 composition 里唯一的绝对路径**是 `design/agent.cordis.yml` 里的 `engineDir`，
当前值 `D:/DSH_GDT/DSH_GraphicDesign_Tools/engine`。仓库若再搬家，要改的就是这一行；
其余一切通过 `baseUrl` 解析。

因此**改 preset 就是改仓库里的 `design/`，然后跑 `node deploy-preset.mjs`**。

---

## 一、最重要的一条：旧简报里的「Photoshop 不可用 API」是误判

旧简报第 6 节列出了一批「不可用」的 Photoshop 功能，并据此得出
「自动化接口被裁剪 ⇒ 必须脚本搭骨架 + 人工补完」的结论。

**逐条复核后：这些几乎全是 ExtendScript 写法错误，不是 Photoshop 的能力边界。**

| 旧简报结论 | 实测真相 |
|---|---|
| 文字颜色不可用（`RGBColor` 报内部错误） | 用 `SolidColor` + `.rgb.hexValue` 正常 |
| 调整层不可用（`Mk`+`adjustmentLayer` 报错） | 用 `Usng` + `contentLayer` + `Adjs` 正常 |
| 图层蒙版不可用 | `Mk` + `Nw `:`Chnl` + `Usng`:`UserMaskEnabled` + `RvlS` 正常 |
| 剪贴蒙版不可用（`GrpC`） | 用 `groupEvent` + `setd` 且 `putBoolean` 直接入描述符 正常 |
| 渐变填充不可用 | `contentLayer` + `gradientForm` + `colors` 色标列表 正常 |
| `halftonePattern` 不可用 | **仅灰度文档可用**；RGB 上要用 `colorHalftone` |
| 曲线不可用 | 光栅层上 `curves` 正常 |

**结论的意义**：被裁剪的是**脚本写法**，不是 Photoshop。
所以「脚本做结构、人工做调子」这个分工的理由不成立——
按需求本可以全自动做调子。这一点已写进 `design_photoshop` 工具的描述里。

另外，真正的瓶颈不是能力而是**速度**：COM 冷启动 40–60 秒/轮。
引擎迭代约 1 秒/稿，所以正确的分工是
**引擎负责迭代与自检，Photoshop 只负责最终分层交付**。

## 二、Photoshop 在这台机器上启动即挂死，并持续泄漏 Adobe 许可进程（待用户处理）

**现象**：`Photoshop.exe` 启动后常驻约 910 MB、`Responding=False`、COM 永不出现，
窗口标题正常（`Adobe Photoshop 2026`）。

### 更正：之前把两件事混为一谈了

初版本文档把这次挂死归因于 GPU，依据是 `PSErrorLog.txt` 里的
`imgraphcut.h : 1608 : REQUIRE failed` 和 sniffer 探到的
Intel RaptorLake-S 集显。**那两份证据都是旧的**：

- `PSErrorLog.txt` 的**最后写入时间是 2026/7/24 22:37:32**，今天的挂死
  **没有产生任何新条目**。
- OpenCL sniffer 的输出是更早一次运行留下的。

**所以：今天的症状不是崩溃，是挂起**——进程不退出、不报错、不响应。这与
7 月那批断言失败是**两个不同的问题**，把它们混在一起会把排查带偏。

同时：`PSUserConfig.txt`（`OverrideOpenCLEnable 0` / `UseGraphicsProcessor 0`）
**已删除**。它没有解决挂死，留着只会给下一次排查增加一个未验证变量。
**先按「未知原因的启动期挂起」重新查，不要沿 GPU 这条线。**

### 真正的危害：许可进程无界泄漏

**实测（2026/9/11 21:10 – 22:36）**：

| 观测 | 数值 |
|---|---|
| `adobe_licensing_wf.exe` 峰值 | **38**（清理前） |
| 累计内存峰值 | **349 MB** |
| 每个实例 | 约 9.5 MB、**单线程、116 句柄**、启动后再不退出 |
| 增长方式 | **每次 Photoshop 启动失败尝试 = +1 个**，且**从不退出** |

**关键判定**：清理掉全部 38 个后，新进程只出现 1 个并稳定在 1 个停留 150 秒——
说明**这正是健康状态**。而旧的那批是 38 个、单线程、116 句柄、CPU 时间单调递增、
**零退出**，是卡住的积压。所以判别标准很简单：

```
正常：0-1 个，且新进程会自己退出
异常：持续增长且永不退出   <- 本次
```

**机理**：Photoshop 启动失败 → 某种机制反复重试启动 → 每次重试都让 Adobe 许可
子系统（`C:\Program Files\Common Files\Adobe\Adobe Desktop Common\NGL\adobe_licensing_wf.exe`）
新起一个许可检查进程 → 该进程卡住不退出。`AdobeUpdateService` 是 **Stopped**，
它们也不是 Photoshop 的子进程。

### 根因已查明并验证：**DSH 文件沙箱**，与 Photoshop、GPU、Adobe 都无关

用户明确指出「我手动是可以正常启动并使用的」。这直接排除了 GPU 与环境故障，把问题
锁定到**启动方式**上。随后逐步验证：

**1. 从受限 shell 启动，可稳定复现挂死**

```
t=0s   launched PID
t=20s  MB=909  CPU=10.1s  Responding=False  threads=155
...
t=240s MB=908  CPU=11.7s  Responding=False  threads=136
```

CPU 停在约 10 秒后再不动、线程数稳定、**不崩溃、不报错**——这是**阻塞**，不是慢。

**2. 沙箱写入边界实测**（这是根因）

| 目标 | 受限 shell |
|---|---|
| `D:\DSH`（工作区） | **可写** |
| `%TEMP%`（沙箱私有） | **可写** |
| `%APPDATA%\Adobe\...`（Photoshop 设置） | **拒绝** |
| `%APPDATA%\Adobe` | **拒绝** |
| `%TEMP%`（普通用户 Temp） | **拒绝** |
| `%LOCALAPPDATA%\Adobe` | **拒绝** |

**Photoshop 每次启动都要写自己的设置、工作区与对话框偏好**（`Adobe Photoshop 2026
Prefs.psp`、`Workspace Prefs.psp`、`DialogPreferences.psp` —— 实测这些文件的
`LastWriteTime` 会随每次成功启动更新）。**从受限 shell 启动时这些写入被拒绝，它就此
阻塞。** 这解释了全部现象：不崩溃、不报错、CPU 停住、`Responding=False`。

**3. 解除限制后，一次成功**

```
$ pwsh -File jsx/psx.ps1 -Up        # 非受限
[22:51:43] launched Photoshop PID=32368, waiting for COM...
[22:51:52] COM ready in 9.4s, version 27.6.0
```

**9.4 秒**就绪，`Responding=True`。

**4. 自动化全链路实测通过（1.3–3.2 秒/次）**

| 操作 | 结果 |
|---|---|
| 新建文档 | OK |
| 文字层 + `SolidColor` + `MiSans-Regular` | OK（墨迹框 472×78） |
| 打开引擎写出的分层 PSD，逐层读 `kind`/`opacity`/`blend` | OK |
| 导出 PNG | OK |
| 保存分层 PSD | OK |
| 关闭 | OK |
| 许可进程 | **0**（不再泄漏） |

**当初我写 `PSUserConfig.txt` 禁用 GPU，是在完全错误的方向上动手。**

### 准确的方案

**要跑 Photoshop 集成，桥接必须以非受限方式运行**，因为 Photoshop 需要写
`%APPDATA%\Adobe`，而 DSH 默认的 `workspace-write` 只放行工作区与沙箱私有 Temp。
具体做法：调用 `jsx/psx.ps1`（或 `design_photoshop` 工具背后的同一命令）时带上
`danger-full-access`。**这不是懒得修，而是唯一可行的边界**——Photoshop 的设置目录
不在工作区内，无法靠改工作区路径绕开。

**若不想开放权限**（可以理解）：**完全不要用 Photoshop**。设计循环与分层 PSD 都不
依赖它（第七节），引擎自己就能写出 21 层的 PSD。Photoshop 的价值只剩「交付一个能
给人手工精修的分层文件」，而这已经不是必需项。

### 一个真实的能力边界（8 种写法全部失败）

**Photoshop 2026 的 ExtendScript 无法创建调整图层。** 这一点与简报的说法**相反**，
所以值得写清楚它的验证过程，避免以后又当成语法问题绕进去：

| 尝试 | 结果 |
|---|---|
| A `Mk` + `adjustmentLayer` + `Type` | FAIL |
| B `Mk` + `adjustmentLayer` + `Type` + `Adjs` 载荷 | FAIL |
| C `Mk` + `contentLayer` + `Adjs` 载荷 | FAIL |
| D curves（同上） | FAIL |
| E levels（**对照组**，另一个调整族） | FAIL |
| F 批量试 8 种调整类型 | **无一可用** |
| G `Type` 放在顶层、不带 `Usng` | FAIL |
| H `brightnessContrast`、不带 `Usng` | FAIL |

另外两条硬证据：

- **`LayerKind` 枚举在本版本里是空的**（`for (var k in LayerKind)` 得 0 个常量）。
  调整图层的 kind 常量**根本没有暴露给 ExtendScript**。
- 报错稳定为通用错误 + `命令"建立:"当前不可用`。

八种写法、含对照组、且 API 常量缺失——**这不是语法问题，是 2026 版的真实边界。**

**注意它仍然可以**：新建/打开文档、图层与组、文字层（含颜色与字体）、栅格化、滤镜、
选区、混合、导出 PNG、保存分层 PSD、读取已有图层的全部属性。也就是说
**Photoshop 侧只少了「创建调整图层」这一件事**。

### 这对工作流意味着什么

**调子工作本来就应该在引擎里做**，而引擎能做得更好：

- 调整层路径：**曲线、色相/饱和度、去色、双色调、噪点、调子擦拭**，全部逐像素精确
- 迭代成本：引擎约 **1–2 秒/稿**，Photoshop COM 一次 1.3–3.2 秒但需要保持常驻

所以正确分工是（与简报结论相反，但要说得更准确）：

```
引擎  -> 全部设计、全部调子、自检、成品 PNG、分层 PSD
PS    -> 只在需要给人「可精修的分层文件」时作为出口，且是可选项
```

**不要**为了调子去调 Photoshop——那不是它的长处，而且它现在也做不了。

### 排查过程中我犯的三个错（留给后续维护者）

真相查明之前，我把原因判错了三次，方向分别是「GPU 故障」「Photoshop 自我重启」「未知的
外部程序」。三次都写在这里，因为**判错的方式**比结论更有用：

1. **把旧日志当成了新证据。** 我用 `PSErrorLog.txt` 里的 `imgraphcut.h` 断言和 OpenCL
   sniffer 输出断定是 GPU 问题。那份日志的**最后写入时间是 2026/7/24**——今天的挂死
   **没有产生任何新条目**。**用一份日志下结论前，先看它的时间戳。**
2. **用「我的日志里没有」排除自己。** 我拿桥接日志 `ps.log` 证明「不是我干的」，
   但那份日志**只覆盖经过桥接脚本的调用路径**。我当时还起了两个后台任务直接持有
   `psx.ps1` 进程，**对那份日志完全不可见**。查 `job_list` 只要十秒，我绕了两个小时。
   **归因前先确认自己的证据覆盖了所有可能路径。**
3. **在用户同时操作时宣布因果结论。** 我宣称一个「4 分钟只观察不干预」的实验证明了
   结论——而那段时间用户正在手动关闭进程。**观察性实验的前提是没人在动它。**

**另外一条操作教训**：我用 `run_in_background` 起了启动外部进程的探测，用完再没引用，
**从未 `job_kill`**，两个任务因此存活了两个多小时并反复轮询。**凡是后台任务启动外部
进程的，结束前必须收尾并确认。**

**还有一条诊断教训**：我反复杀挂死的 Photoshop「让它重来」，结果每杀一次都给那些
轮询任务一次新的启动机会，也让许可进程多累积一个。**杀症状之前先搞清楚谁在喂它。**

### 已做：桥接脚本的护栏（防止 preset 喂大循环）

`jsx/psx.ps1` 的 `-Up`：

1. **先看进程表，绝不先碰 COM**。对着挂死的 Photoshop 调
   `New-Object -ComObject Photoshop.Application` 会**无限阻塞**。
2. **把「带超时的后台 runspace」这个思路整个删掉了**，并在文件里写明原因：超时会
   触发，但 `$ps.Stop()` **无法中断阻塞在跨进程 COM 调用里的线程**，等待返回后脚本
   又卡在清理上——实测仍超过两分钟，比它要解决的问题更糟。
3. 进程表里只要有 Photoshop 就**拒绝启动**，退出码 4，打印 PID / 内存 / Responding。
4. 启动失败时**顺手清理**，不让挂死实例成为循环的种子。
5. `-Status` 0.3 秒返回并**直接报告许可进程数**；`-Down` 也会提醒它们仍在。

实测：`-Status` 0.3s；`-Up` 0.1s 拒绝且**没有**新起进程。

**教训**：挂死的 Photoshop **什么都问不得**。所有判断都从 `Get-Process` 出
（瞬时、必定应答），只有在进程自己报告 `Responding=$true` 之后才碰 COM。

### 待用户决定：泄漏清理

判别标准同上：**持续增长且永不退出**就是异常，可以清掉。
清理后健康状态应停在 0–1 个，且新进程会自己退出。

**注意**：清理只解决积压。**只要 Photoshop 还在反复尝试启动，泄漏就会重新累积**，
所以真正的修复是让 Photoshop 能启动，或停止重试它。

**影响范围**：不影响 preset 可用性。设计循环完全不依赖 Photoshop，分层 PSD 由
引擎自己写出（第七节）。

## 三、引擎里几个「看起来像设计问题、其实不是」的坑

都已修复，记录原因以免回退：

1. **半调不能「叠加」，必须「替换」**
   在一层实的填充上叠网点只能**增加**墨，实底仍在，网点永远看不见
   （实测：画了 1660 个点，面板内 0 个透明像素）。
   形状级 `tone` 默认 `replace: true`——网点成为该层唯一的墨。

2. **形状级 tone 必须在形状自己的框内运行**
   tone 运算作用于整画布缓冲。形状级 `tone` 会按形状的 box 取子矩形再做，否则
   网点会溢出形状几何、并（在 replace 模式）清掉缓冲里其他内容。

3. **tone / coverage 斜坡的坐标系是形状的，不是画布的**
   一个占画布 28% 宽的面板，其自身 0–1 只对应画布 0.60–0.88。
   早期版本因此让「本应淡出到零」的网点一直保持满强度直到硬边。

4. **网点尺寸跟随「调子」，不跟随「墨色」**
   用墨色明度推导半径，会让深色墨产生巨大网点（面积 ~99%），完全反了。

5. **透明像素不是暗像素**
   读 RGBA 直算意味着空像素 RGB=0,0,0 → 判为最暗 → 网点画到形状外的空白处，
   形成一圈「矩形雾」。现在会跳过未上墨像素，网点自然取得主体轮廓。

6. **蒙版渐变的作用域是形状自己的框**
   写 `w:1,h:1` 的蒙版形状 = 整画布。一个淡出写在「左边缘 0、30% 处 0.9」
   会在 x=720 就完成，而位于 x=1435 的面板整块落在平坦的 0.9 区——
   结果四边全是硬边。

7. **halftonePattern 只在灰度文档可用**，RGB 上静默失败或报通用错误。

## 四、本机字体要点

`@napi-rs/canvas` 自带 Skia，**它看得见的字体不是系统报告的字体**——
必须显式 `registerFromPath`。已在 `src/fonts.mjs` 注册 31 个，含：

- **Noto Sans SC VF / Noto Serif SC VF**：可变字体，`wght` 轴 100–900 / 200–900
  真实可用（24px 下 100 与 900 的 ascender 40 vs 42、宽度也会变）。
- **Bahnschrift**：`wdth` 轴 75–100 **实测有效**；但 `wght` 轴**实测无效**
  （300 与 700 度量完全相同）。因此 `fonts.mjs` **故意不声明**它的 `wght`，
  否则会承诺一个渲染不出来的字重。
- 静态字重族（Segoe UI Light/Semilight/Bold/Black、Georgia、Calibri、Arial 等）
  用于不需要可变轴的场合。

**注意**：`SourceHanSansSC-*.otf` 与 `dingliesong*.ttf` 在
`%LOCALAPPDATA%\Microsoft\Windows\Fonts`（用户字体目录），不在 `C:\Windows\Fonts`。
`fonts.mjs` 两个目录都会找。

**关键陷阱**：可变字体用 `font = '900 48px NotoSC'` 这种**字重令牌是无效的**
（实测 400 与 900 度量相同）。必须通过 `fontVariationSettings` 设置 `wght` 轴。
`styleFor()` 把 `font` 与 `variationSettings` 成对返回，就是为了防止只设一半。

## 五、实测基线：参考图 vs 旧尝试 vs 本引擎

用同一套 `design_critique` 度量（这是本 preset 的核心价值：把「观感」变成可比数值）。

| 指标 | 参考图 (timeline) | 旧尝试 (ps-editorial) | 本引擎 (kv-final) |
|---|---|---|---|
| 版面栅格 | **35px 列栅格** | **无**（规则太碎，不构成线） | **80px** |
| 焦点唯一 | 是 | **否 — 4 个区域竞争** | 是 |
| 版面自带气质 | 是 | **否** | 是 |
| 峰值细节 | 0.061 | 0.082（但靠高对比堆出来） | **0.063** |
| 强调色（平涂占比） | 0.031 | **0.107**（严重超标） | **0.028** |

旧尝试的两处硬伤正好被量化出来：**没有栅格**、**焦点不唯一**——
与简报自述的「四条关系错误」吻合。

## 六、目录与命令

引擎：`D:\DSH_GDT\DSH_GraphicDesign_Tools\engine`

```powershell
node bin/design.mjs render  <scene.json> --out out --name X [--psd]  # 渲染 + 度量 + 设计校验 + 分层 PSD
node bin/design.mjs analyze <image>                            # 参考图 → 规格
node bin/design.mjs critique <png>                             # 四问自检
node bin/design.mjs verify  <scene.json> [--png X]             # 反模式硬约束
node bin/design.mjs fonts | ladder | ramp                      # 设计系统原语
node bin/design.mjs palette <子命令>                           # 滤镜词汇表（见六之二），子命令：
                                                              #   ops | presets | show <预设>
                                                              #   apply <png> <预设> [--set k=v]
                                                              #   run <png> --graph <json>
node bin/design.mjs tool <子命令>                              # 25 个会话工具的正式名册，子命令：
                                                              #   --list | --describe <名> | <名> [参数...]
pwsh jsx/psx.ps1 -Up | -Status | -Run <file.jsx> | -Down       # Photoshop 桥
```

**全部 13 个测试套件（383 项断言，必须全绿）**：

一条命令跑完，一条退出码看结论：

```powershell
node test/run-all.mjs            # 13 套全跑，任一失败即非零退出
```

`run-all.mjs` 会**拒绝运行**「存在于 `test/` 但不在它清单里」的套件，所以新增测试文件
不会被悄悄漏在门外。逐套清单：

```powershell
node test/palette.mjs            # 40  测量层、核、可分解性主张
node test/palette-ops.mjs        # 56  逐点算子、算子图、预设
node test/presets.mjs            # 66  七个滤镜预设的效果方向与掩码曲线
node test/effects.mjs            # 58  10 个图层效果（含反例对照）
node test/filters.mjs            # 22  常数时间滤镜与直接实现逐像素对照
node test/scope-regions.mjs      #  9  作用范围（真实渲染管线）
node test/scope-conflicts.mjs    # 13  作用范围冲突检测与 replace 语义
node test/render-regressions.mjs # 11  line 坐标、halftone knockout
node test/scale.mjs              # 26  缩放契约（--scale；见 §十）
node test/selftest.mjs           # 42  引擎自检
node test/psd-roundtrip.mjs      # 24  PSD 结构校验
node test/tool-schemas.mjs       #  8  preset 工具 schema
node test/tool-registry-gate.mjs #  8  照抄 register() 与 provider 投影
```

> 为什么要有 `run-all.mjs`：这些套件原本是一个一个手敲的，于是
> `tool-schemas.mjs` 里一条**过期守卫**（`registered.length === 6`，而工具已增到 8 个）
> 让它在 8/8 全过的情况下 exit 1，长期没人发现——**没人会去读一条自己刚敲的命令的退出码**。
> 现已改成下界 `>= 6`：注册数为 0 仍会大声失败，新增工具不会再把它误报成红。

`src/` 十七个模块，其中本阶段新增的五个是下一节的主题：`measure` · `kernel` ·
`palette` · `presets` · `tools-roster`。

preset 源：`D:\DSH_GDT\DSH_GraphicDesign_Tools\design\`（部署到 `~\.dsh\.agent-presets\design\`，见第〇节）

```
agent.cordis.yml       29 行组成（mount-validation 通过）
design-policy.mjs      常驻纪律 prompt（文本在 YAML 里，改文本无需重启）
design-tools-*.mjs     8 个工具
skills/
  design-foundations/     审美与设计理解（四层理解路径、四问、反模式清单）
  typography-and-scale/   排版与字阶（真实度量、字距、中英混排）
  colour-systems/         色彩系统（OKLab 阶梯、强调色预算、调子带）
  reference-analysis/     参考规格提取（观感 → 可执行数值）
  filters-and-palette/    滤镜词汇表、算子图、作用范围、如何验证滤镜真的生效
  photoshop-delivery/     分层交付与 Photoshop 驱动
```

**五个技能目录自动挂载**：`skill-filesystem` 的 `customSkillDirs` 指向 preset 自己的
`skills/`，所以新增技能只需建目录，**不必改 composition**。自定义根优先于用户根，
所以 `~/.dsh/skills` 里的同名技能无法覆盖它们。

**每次改完工具插件必须换文件名**：Cordis Loader 对本地 `.mjs` 用
`await import(url)` 且**无缓存破坏参数**，所以**一个进程内同一文件名只求值一次**。
本次实测又踩了一次，而且症状极具误导性：

```
failed to apply loader entry design-tools (./design-tools.mjs):
tool "design_render" must declare output { schema, render, presentationMeta? }
```

**文件本身是对的**——直接 `import` 它、把 6 个工具过一遍真实的
`defineTool()`，**6/6 全过**；逐个检查 `typeof output.render === 'function'` 也全过。
报错的原因是 **loader 服务的是该文件名的旧求值结果**，与磁盘内容无关。
**换成新文件名后，mount 立刻成功。**

**这件事的危险之处在于：测试通过而 preset 挂载失败。** 所以
`test/tool-schemas.mjs` 现在**从 composition 里读出文件名**（而不是硬编码），并
**逐字复现 registry 的那道门**（`output.render` 必须是函数），因为那条报错的信息
读起来像 schema 有问题，实际不是——它说的是 `render` 不是函数，而失败的工具什么都
注册不上，会把整个 preset 的挂载一起拖倒。

**操作规则**：改 `design-tools-*.mjs` 的内容后，**复制成新的时间戳文件名**并更新
`agent.cordis.yml`。不要原地改再指望重挂载。`design-policy.mjs` 不受此限，因为它的
文本在 YAML 里。

---

## 六之二、调色板：把「滤镜」变成数据

**这一节是本阶段最大的结构性变化，也是后续扩展的入口。** 前面几节描述的是一批**写死的
效果**；这一节描述的是一套**可以组合出未写过滤镜的词汇表**。

### 为什么要有它

最初的做法是「缺一个滤镜就写一个」。这条路有两个尽头：效果越加越多，
而**每一次新增都是新代码、新约定、新失败模式**；以及——更要紧的——**描述不了没写过的
滤镜**。设计工作里真正需要的东西往往不在清单上。

观察是：**几乎所有空间滤镜都是同一个运算配不同的核**。高斯、镜头、动感、方框、
表面模糊、USM、浮雕、查找边缘、中值，全都是「合并一个邻域」，差别只在**哪个邻域、什么
权重**。所以**核是参数，不是实现**。

### 核：一个采样模式，不是一次卷积

`src/kernel.mjs` 定义六种核形状，每一种由**可测量的量**描述（半径、角度、长度、衰减
指数），**从不用「柔和」「电影感」这类形容词**。核被保存为**数据**而不是函数，因为它要
能序列化进场景、能比较相等、能被报告。

| 形状 | 覆盖 | 常数时间实现 |
|---|---|---|
| `box` | 方形 | SAT 矩形，O(1)/像素 |
| `gaussian` | 高斯 | 三次 SAT 方框，O(1)/像素 |
| `line` | 沿角度的线段 | 方向前缀和，O(1)/像素 |
| `disc` | 圆盘（`falloff` 0 为平顶，同真实光圈） | 通用路径 |
| `ring` / `cross` | 环 / 十字 | 通用路径 |
| `custom` | 任意权重表 | 通用路径 |

**成本分层是实测的**（1600×900）：box ~30ms、gaussian ~90ms、line ~55ms，
**且与半径无关**；`disc`/`ring`/`cross`/`custom` 才随核增长。这个分层由
`describeGraph()` 在**执行前**报出来（`mayBeSlow`），而不是让人跑完才发现。

**一条原则**：**一个形状只有一个核**。曾经 `disc` 在快路径走 `lensBlur`（九宫格近似）、
在通用路径走权重表，两者**不是同一个核**——实测把平场推到纯白 255。近似是**另一个形状**，
不是隐藏替换。

**另有一条秩统计**：`rank` 用同一邻域取百分位（中值），**不是加权和**。调色板若只有线性
滤波就无法表达「去掉斑点但保住边缘」——那正是扫描件和压缩素材需要的运算。

### 四类算子

| 类别 | 数学 | 具现 |
|---|---|---|
| **空间采样** | `out(p) = Σ w(k)·src(p+k)` | `sample`（核：box/gaussian/disc/line/ring/cross/custom）· `rank`（百分位） |
| **逐点映射** | `out(p) = f(src(p))` | 11 个：`lightness` `contrast` `exposure` `hueRotate` `chroma` `invert` `threshold` `posterize` `curve` `gradientMap` `duotone` |
| **混合** | `out = base + (over−base)·amount` | `blend` · `similarityMask` · `luminanceMask` |
| **常量源** | 不推进当前图像 | `solid` · `noise`（带种子、确定性） |

**一个滤镜 = 一串类型化算子。** 全部是数据，**无一是函数**——所以能序列化进场景、
能比较相等、能在事后被报告。

### 组合是精确的，不是近似的

这是本阶段最重要的一条方法学结论。原先 `sample` 有一个 `gate` 回调参数，一个参数就能把
box 变成表面模糊。它**能工作，但被移除了**，因为：

1. **带门的采样不是一个运算，而是三个**——模糊、判定哪些像素相似、混合两者。压成一个
   参数就把结构藏了起来，而结构正是「可描述」的来源。
2. **回调无法序列化**，所以含回调的预设无法被检查、比较、验证——而「是数据」正是整个
   调色板的价值。

替代方案是**精确的**而非近似：`blend(base, blur(base), mask)` 复现带门模糊，
因为**门就是遮罩**。实测：中间过渡像素 360（纯盒）→ 120（组合），硬边保住。

**同两个算子**还能做出 USM 锐化（`blend(input, blurred, -0.8)`）、高反差保留、
溶解——**零新代码**。

### 准确性由 OKLab 承担，并被实测

逐点算子全部在 **OKLab** 里做。这不是风格选择：HSL 不是感知均匀的，在恒定「明度」下旋转
色相，黄和蓝的感知亮度变化不同，**同一参数会做不同的事情**，于是描述的结果换个颜色就
不成立。

实测：**十二个色相各旋转 47°，L 的偏移最大 0.0058**。

### 预设 = 算子图 + 证据

预设**不是黑盒**：它是同一串算子加一个名字，**再加捕获时的测量值**。方向是双向的——
`expandPreset` 把预设展开成图（可检查、可编辑、可测量），`capturePreset` 把图捕获成
预设（跑一遍验证通过才存）。

**预设自带证据**：`verifyPreset` 重跑并比对测量值。改了核、收紧了校验、动了色彩转换，
**漂移的预设会自己举手**，而不是悄悄产出不同的图。

### 每个算子必须自证

`run()` 返回逐步报告，**没做事的步骤会被标记**：

```
a no-op step is flagged — changed 0.000% of pixels, expected more than 0.000%
```

`expectNoChange: true` 可声明「这是有意为之」（常量源就用它），避免误报。
**这是 halftone「报 7007 个点、画 0 个」那个 bug 的自动化版本。**

`src/measure.mjs` 提供 `delta()`、`assertDid()`、`sameWithin()`，以及
`solidity` / `coverage` / `lumaMean` / `lumaSd` / `channelMean` / `changedFraction` /
`edgeEnergy`。其中 **`changedFraction` 是最有用的一条**。

### 七个预设（全部由算子组合而成）

`unsharp` · `surfaceBlur` · `highPass` · `posterize` · `levels` · `duotonePress` ·
`filmGrain`。参数照搬公开文档的名称与区间（如 GIMP 的 unsharp：radius 0–1500、
amount 0–300%、threshold 0–1）。**这份清单同时是词汇表充分性的证据**：一个成熟滤镜
若写不出来，缺口就在这里暴露——`filmGrain` 正是这样暴露出来的，它需要
`luminanceMask`，而当时没有。

### 场景里直接用

```json
{ "type": "graph", "operators": ["sample","similarityMask","blend","duotone"],
  "steps": [ { "op": "sample", "changedFraction": 0.042 },
             { "op": "similarityMask", "selectedFraction": 0.989 } ],
  "inertSteps": 0 }
```

### Agent 怎么用它：`design_palette` 与 `filters-and-palette`

一个能力若没有到达 agent 的手里，就等于不存在。所以这一节有两条配套：

**`design_palette`（preset 的第 7 个工具）** 五种查询：`ops` 列出算子与核；`presets`
列出命名库及其参数与区间；`show` 打印某预设会构建的算子图；`apply` 把预设作用到 PNG；
`run` 跑一份手写的图 JSON。**`show` 是关键**：预设因此不是黑盒，可以被读出、改写、
再作为 `{ graph: [...] }` 贴回场景。

**`skills/filters-and-palette/`** 覆盖：四类算子、核与成本、如何写图（`input` /
`current` / `as` 三个名字）、两个遮罩构建器的区别、七个预设各自的构成、`scope` 的
语义与实测数字、以及**如何验证滤镜真的生效**。

两者都在 preset 里，由 composition 的 29 行组成加载——**不需要改 composition**。

### `scope`：让效果有「范围」

**每个效果原本作用于整层**，这是「强度」无法表达的一件事。实测：满强度双色调把角色压成
纯橄榄剪影（脸和细节全无），降低强度则变成一个「半抹掉的角色」——**更糟**。缺的不是强度，
是**范围**。

一条不变式，作用于**全部三类效果**：

```
after = before +（effected − before）× scope
```

遮罩为 1 处用效果结果、为 0 处原图**逐字节保留**、中间插值。**效果先无范围地跑完，
再按遮罩混合**——反过来（限制输入）会让模糊、斜角、发光这些读邻域的效果算错。

形式：`ramp`（按自己的框归一化）、`shape`（走真实形状管线）、数组相乘取交、
`invert`（「除了脸以外全都抽象化」靠它写）。

**实测**（主体中轴）：保护椭圆内橄榄占比 **0.867 → 0.006**、红色 **0.000 → 0.747**，
椭圆外 **0.911 → 0.911 一字未动**。

`test/scope-conflicts.mjs` 还检测**「后续效果推翻前面作用范围保护的区域」**并写入
报告警告——这类「每个效果单独看都对、合起来互相拆台」的问题，报告原本完全看不见。

### 这一节踩过的坑（都是「单位/信道/基色错了」）

1. **`tools.register()` 不编译 parameters**（详见第九节）——与本主题同类：**声明对了，
   但到达使用点时已经变了形**。
2. **`luminanceMask` 从 stop 的 alpha 取覆盖度** —— `#000000` 与 `#FFFFFF` 的 alpha 都是
   1，**遮罩恒为满**；且三个颜色通道乘了 255 而 alpha 留在 0–1 范围。
3. **遮罩按线性光索引** —— `#808080` 的相对亮度只有 0.216，驼峰峰顶落在**像素值 188**
   而非 128：**颗粒跑到高中间调去了**。改成感知尺度后峰顶正落在 128。
4. **`blend` 的基色选错** —— 高反差保留需要 `原图 − 模糊`，而从 `base = 原图` 出发
   **在数学上得不到差值**（`blend(input, blurred, -1)` 是 `2·input − blurred`）。
   正解是 `blend(midgrey, blurred, -1)` 再 `blend(that, input, 0.5)`，平坦图精确落在 128。
5. **`solid` 推进了「当前图像」** —— 后续 `sample` 去模糊那张灰常量图（实测
   `changed 0.000%`），整条链全错。正解是 `produces: true` 声明「值生成器」。
6. **背景：`halftone replace` 清空整张缓冲**（详见 `render-regressions` 测试）——
   它把前面效果保护的区域也擦掉，并且**清空 alpha 后又饿死了网点自己**（网点从传入 alpha
   判定剪影，于是看到空剪影、一颗点不画、却仍报告 7007 个点）。

**共同形状**：不是「想错了」，而是**声明与到达使用点时的实际值不是一回事**。

## 七、分层 PSD：不依赖 Photoshop

`--psd` 由引擎自己写出真正的分层 PSD，**不经过 Photoshop**。

这解决了两件事：一是「分层交付」曾被认为必须依赖 Photoshop，二是
这台机器上 Photoshop 挂死（第二节），任何经过它的交付路径都不可靠。

**已验证**（`node test/psd-roundtrip.mjs`，24/24）：

- 头字段（8BPS / 版本 1 / RGB / 8bpc）、画布尺寸、图像资源块
- **两个外层长度字段互相自洽**（`layerAndMask = layerInfo + 8`）
- 21 个图层：名称、顺序、几何、不透明度、混合签名 `8BIM`/`norm` 全部往返
- 每层 4 个非空通道，alpha 为 `-1` 且排在首位（PSD 层通道是 alpha 优先，
  与合成图像数据相反）
- **合成预览与渲染 PNG 逐字节相同**
- 文件末尾与合成声明一致（`trailingBytes = 0`）

**不做的事（诚实说明）**：不逐通道解码 22 MB 的所有像素。完整解码路径在
约 3 MB 处漂移，继续深挖的收益低于剩余预算——而漂移在**校验路径**里，不在
写出的文件里：PackBits 本身精确往返（4 个单元用例）、每个声明长度内部自洽、
合成预览逐字节相等。真正需要保证的事（图层与渲染一致）是由**构造**保证的：
图层像素采集自渲染器合成的同一批缓冲，不可能与 PNG 不一致。

### 更正（2026/9/11，由 `tools/psd-audit.mjs` 查出）：上面这段结论当时是错的

写遥的海报时，交付的 56 MB PSD **在 Photoshop 里会错位**，而 24/24 的往返
校验完全没发现。原因是那句"漂移在**校验路径**里，不在写出的文件里"——
**漂移就在写出的文件里**，只是写入器和校验器共享了同一个错误，于是互相印证。

**两个真实缺陷：**

1. **每个通道声明的长度少了 RLE 行计数表。**
   `channelHeaders.push(be(2 + e.body.length, 4))` 漏掉了 `height × 2`
   字节的行计数表。本画布 3394 行 ⇒ **每通道少 6788 字节**。
   92 个通道里 89 个声明错误，而任何真读者都不看这个声明长度——它读压缩字、
   再读 height 个 u16 行计数并求和。于是**第一个通道之后的每个通道都落在流中间**。

2. **layer-info 尾部多写了一个填充字节，却写了未填充的长度。**
   结果 `layerAndMaskLen - layerInfoLen = 9`，而格式要求 8。layer-info 载荷
   本身不需要偶数对齐——只有记录内部的 Pascal 名字段需要，`pascal()` 已经处理了。

**为什么 24/24 没抓到**：`psd-roundtrip.mjs` 用自己的读者校验自己的写入器，而那个
读者**信任声明长度**。两者一致地错，就对格式一致地错。这正是 `design-foundations`
里那条纪律的实例：**自检通过 ≠ 正确**，要拿独立实现或独立度量来比。

**修好之后的独立验证**（`node tools/psd-audit.mjs out/haruka-kv.psd`）：
按规范从头部走到尾，用**真读者**的方式走通道流（压缩字 + height 个行计数 + 求和），
不用声明长度。结果：

```
layerAndMaskLen - layerInfoLen : 8   (correct)
records+mask+chan : 42187215 | layerInfoLen : 42187215   (exact)
channels 92 | problems 0 | stream ends at 42187283
layer-info payload ends at     42187283
PASS — header, length fields, records and channel stream all consistent
```

**仍然遗留**：`src/psd-read.mjs` 自己读这个文件时仍在第一个通道报
`compression 129`——即**读者自身**的通道偏移算错了（写入器已正确）。复核边界：
这条只影响本引擎的校验路径，不影响交付文件（已用独立解析器逐个通道验证 92/92）。

### 更正二（2026/9/11，用户反馈「PSD 打不开，显示与当前版本不兼容」后查出）

用户报 Photoshop 2026 (27.6) 拒绝打开交付的 PSD。查证过程与结论：

**诊断顺序（每一步都用了独立于写入器的工具）**

| 检查 | 工具 | 结果 |
|---|---|---|
| 头字段、长度域、图层记录 | `tools/psd-audit.mjs` | PASS |
| 合成图像数据能否解码 | `tools/psd-decode-check.mjs` | **3 个通道全部解码，行计数与解码器一致，尾部 0 字节** |
| 解码出的合成图与渲染 PNG 是否一致 | 逐样本比对 | **0 个样本不同** |
| 图层是否有 Photoshop 需要的附加信息块 | 直接读字节 | **一个都没有** ← 根因 |

**根因一：图层没有 `luni`（Unicode 图层名）块。**
写入器只写了 Pascal 名字（`01-ground`），这是规范允许的，但 Photoshop 认不出
这些图层——报的正是「与当前版本不兼容」。修复：按规范写入
`'8BIM' + 'luni' + u32(长度) + Unicode 字符串`（**UTF-16BE，带 4 字节码元计数，
不是 Pascal、不是 UTF-8**），并补 `lyid` 图层 ID。现在 23 层（v12 为 62 层）
每层都有 `luni` + `lyid`，实测可解出 `name="01-ground" units=10`。

**根因二：图像资源段是空的。** 现代 Photoshop 靠这一段识别文档：
补 `1005 ResolutionInfo`（300dpi，16.16 定点）与 `1057 VersionInfo`
（版本号 + `hasRealMergedData` + 写入器/读取器 Unicode 名 + 文件版本）。

**根因三：`layerAndMaskLen - layerInfoLen` 曾等于 9。** 写入器给 layer-info
载荷补了一个偶数字节，却写了**未含该填充**的长度。规范要求这个差恒为 8；
layer-info 载荷本身不需要偶数对齐，只有记录内部的 Pascal 名字段需要。
去掉多余的填充字节后为 8。

**一个方法论要点，值得记住**：
`psd-roundtrip.mjs` 的 24/24 通过**不能证明文件能被打开**，因为它的读者信任
声明长度、与写入器共享假设；而 `psd-audit.mjs` 只验长度与总量的**自洽**，
也不足以证明可打开——它当时同样报了 PASS。真正定案的是
**解码合成数据并与渲染结果逐像素比对**，以及**按规范逐字节检查 Photoshop
实际依赖的那些块**。三层检查，缺一层就得不出结论。

**v12 交付物的最终验证**（62 图层，82 MB）：
```
layerAndMaskLen - layerInfoLen : 8
records+mask+chan : 64135855 | layerInfoLen : 64135855  (exact)
composite: 3 planes decoded, row counts agree, 0 bytes left
每层含 luni + lyid
PASS — header, length fields, records and channel stream all consistent
```

**仍未做的一件事**：本机 `design_photoshop` 无法启动（`spawn pwsh ENOENT`），
所以这个 PSD **没有真正在 Photoshop 里打开过**。上面的结论来自独立解析器与
解码器，不是来自 Photoshop 本身。要 100% 确认，需要在能跑 Photoshop 的环境
打开一次。


**记录两个写 PSD 时极易踩中、且 hex dump 看不出来的坑**：

1. `layerInfoLen` 度量的是**它自己之后**的载荷，不含自身 4 字节；
   `layerAndMaskLen` 则**包含**其内部 `layerInfoLen` 字段。写错任何一个都会
   让所有读取器提前 4 字节，从长度字段中间读出图层数，报「0 图层」而文件
   看起来完全正常。
2. **Pascal 字符串补齐到偶数边界，不是 4 的倍数**。空名字写成 `u16(0)` 与
   写成真正的 Pascal 串都是 2 字节——但读取器会把 `00 00` 解析成「长度 0 +
   1 个填充字节」，多吞掉下一个字段的 1 字节。这个错误让文件大小看起来合理，
   hex 也完全正常。

## 七之二、技术之外：设计判断已移入 agent

交接文档与复盘里的技术结论都已进了代码与测试，但**判断力没有去处**——它既不是 API 也
不是断言，所以它原本只活在这两份文档里，而 agent 读不到它们。这一步把技术之外的部分
抽出、归纳，并放进 agent 真正会读到的地方。

### 分两处放，因为两处的用途不同

| 去处 | 形态 | 为什么在那里 |
|---|---|---|
| `design-policy` 的 `config.text`（常驻 prompt） | 短，每条两句 | 常驻，每轮都在上下文里。长了会挤占别的，所以只放**能立刻改变行为**的那些 |
| `skills/design-foundations/` 新增「Design judgement」节 | 长，每条带**失败的原因** | 技能按需加载。规则本身不能迁移，**原因才能**，所以这里把每条背后的具体失败写出来 |

复盘的第四节标着「判断，不是规则」，这个区分被保留了下来：**能测的进测试，能判的进
这两处**。技术性的那些（生成规则、材质要画不能贴、分层）本来就在代码与技能里，这里只
补判断的部分。

### 归纳后的十一条

1. **参考图给的是语汇，不是风格** —— 它的径向仪表标记存在，是因为那一页**本身**是虚构
   企业档案。把标记搬进讲银杏的页，等于在没有数据的文档上放数据读数。取参考的**腔调**，
   让**你的题材**决定需要什么标记；对每个借来的元素问「我的题材里有什么为它辩护」。
2. **同一素材在不同语境读作不同东西** —— 环就是环。参考里是仪表，这里可以是枝叶。
   **不肯复用只是因为参考先用了它，和整份照抄一样错。** 不能迁移的是参考的**题材**。
3. **一条生成规则胜过一百次摆放** —— 无规则地逐个摆放，得到的是一页「排得很整齐的
   陌生人」。检验很便宜：**说出生成这一组的规则**。「沿视线递变小变淡」是规则，
   「哪里好看放哪里」不是，而无规则的组经不起挪动。
4. **差异是机制，不是点缀** —— 同款同浓的一页是**纹理，纹理没有方向**。要沿视线递变，
   且**三个维度同时变**：用哪款、用几枚、多浓。只变尺寸，纹理仍然是平的。
5. **标记按功能分两类，不可互换** —— **标记性**（径向对称、无轴向）价值在**位置**，
   四枚定义矩形，眼睛把框住的范围读成整体，所以**放四角而非撒开**；**指向性**（有头有尾）
   价值在**它描述的路径**。混用会得到忙而不结构的一页。
6. **标记不能与字标抢** —— 用**组不透明度 + 尺寸比**压住，**比例是常被忘掉的那个**。
   32px 标记对 218px 字标是 1:7，这个比才让标记读作场域而非小竞争者。只降不透明度不够——
   淡的竞争者仍是竞争者。
7. **两幅图要共享一道工艺** —— 否则读作「一张印刷品加一张贴图」，无论两半各自多好。
   让它们过同一道工序：同一个网点、同一个双色调、同一种墨。
8. **照片是块面，不是纹理** —— 字落在它**让出**的空处，不是压在它上面。压在大块面中部，
   是让页面失去可读性而**所有度量仍然通过**的最常见方式——对比度检的是文字下方的均值，
   均值可以很舒服而逐个像素不是。
9. **材质要画或改造，不能贴** —— 复制来的形没有解剖结构，**旋转变不出另一个姿态**。
   但**真实素材优于生成的几何——前提是题材对**：条件就是这条规则的全部内容，
   **题材是否决权，不是技法**。
10. **换素材必须同时删旧素材** —— 只加不删会让两代设计同处一页，而旧的那代往往正是
    上一轮被否掉的。见过上一轮的人会把半替换的页面读成退步。
11. **字可以是材质** —— 放大的描边字标横跨全页是一块**面**，能像形状一样承担构图。
    注意在那个尺寸它先被读作形而非词，这是关于「这件作品是干什么的」的决定。

### 验证

真实 YAML 解析器读回：`design-policy` 的 `text` 是 string、7356 字符、**24 段**、
**不含 `{{`**（prompt 段会被扫描变量引用，未知的会让整个装配失败——插件里为此有硬保护）。
`design-foundations` 229 → 327 行，frontmatter 单一 `description` 且已提及新内容——
**description 决定技能何时加载，不更新它等于新内容不会被读到**。
composition 仍为 29 行、mount OK。

## 八、已知缺口

1. **PSD 逐通道解码未跑通**（见第七节）。写出的文件结构已验证自洽，合成预览
   逐字节相等；未跑通的是**校验器**的完整解码路径。
2. **Photoshop 在这台机器上挂起**（见第二节）。分层交付不依赖它，所以不阻塞设计；
   但若要用它，**必须无沙箱运行**（DSH 沙箱拒绝写 `%APPDATA%\Adobe`，Photoshop 会阻塞
   而非快速失败）。
3. **没有初始化 git**。已加 `.gitignore` 排除生成物（`out/`、`node_modules/`、
   `.probe/` 等），但仓库不存在，所以**任何一次误删都不可恢复**。这一条已经付过代价：
   本阶段一次 `Copy-Item` 被沙箱拒绝后 `Remove-Item` 仍然执行，preset 的工具模块被删而
   无法从任何地方找回，只能重建。
4. **25 个会话工具已可枚举、可直调，但没有逐个现代化**。`design tool --list` 读的是每个
   工具**自己的头注释**，所以名册不会与工具脱节；`design_tool` 让 agent 能看见它们。
   但格式与参数风格并不统一（有的用 `--flag value`，有的用位置参数），且不少是围绕某一
   次具体设计写的，**换一个题材未必直接可用**。
5. **`audit-plant.mjs` 与 `audit-leaf-attachment.mjs` 曾有逐字相同的头注释**，导致名册
   无法区分。已修正后者的头注释（它只做连接与拥挤，且从图层自己的 `anchorY` 读连接点；
   前者是更宽的连通性 + 重叠 + 分布检查）。**两者都是植物几何探索的产物**，与当前
   海报方向无关，保留是为了那段探索的教训。

## 九、真正的根因：`tools.register()` 不编译 parameters（已修复）

**症状**（实测出现三次，跨会话、跨工具名）：

```
Invalid schema for function 'design_analyze':
schema must be a JSON Schema of 'type: "object"', got 'type: null'.
```

### 根因

`dsh-tools` 的 `register()` **不编译**定义，只是原样存下来：

```js
register(definition) {
  ... // 只校验 output.render 与 output.schema
  return this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), ...)
}
```

而交付层的 `schemaOf(definition)` 把 `parameters` 直接 `snapshotJsonValue` 投影出去。

**内置工具包看起来是"直接用字面量"，其实都套了一层 `defineTool({...})`——
编译参数的是 `defineTool`，不是 `register`。**

而本 preset 写的是 `ctx.tools.register({...})`，参数用的是从内置包源码抄来的
ParameterSchemaSpec 字面量，**却漏掉了外面那层 `defineTool`**。于是送给 API 的是：

```json
{"image":{"type":"string","required":true,"description":"…"}}    // 没有 type
```

provider 于是报 `got 'type: null'`。

**这一条解释了全部现象**：为什么失败会在工具之间"游走"（与具体工具的 schema 内容
无关）、为什么曾经成功过一次（那次定义是编译过的）、为什么我改输出 schema、删
`required`、删 `enum`、换文件名全都没用——**改的都不是出问题的地方**。

### 修复

preset 目录**无法 import `@deepseek-ai/dsh-tools`**（Node 从 preset 所在位置向上找
`node_modules`，用户根目录之上没有包树），所以在 preset 模块内**自己实现编译**：

```js
function compileParameters(spec) {
  const properties = {}; const required = []
  for (const [name, def] of Object.entries(spec)) {
    const prop = { type: def.type }
    if (def.description !== undefined) prop.description = def.description
    if (def.enum !== undefined) prop.enum = [...def.enum]
    properties[name] = prop
    if (def.required === true) required.push(name)
  }
  const schema = { type: 'object', properties }
  if (required.length > 0) schema.required = required
  return schema
}
```

六个工具的 `parameters` 现在都写成 `compileParameters({ ...原字面量... })`，原字面量
留在原地以便阅读与复核。

**验证**（`test/tool-registry-gate.mjs`：照抄 `register()` 的严格门 + 照抄 provider 的投影）：

```
registered through the strict gate: 6
API-facing projection:
  ok    design_render      parameters.type=object, 4 propert(ies)
  ok    design_analyze     parameters.type=object, 4 propert(ies)
  ok    design_critique    parameters.type=object, 1 propert(ies)
  ok    design_verify      parameters.type=object, 2 propert(ies)
  ok    design_system      parameters.type=object, 5 propert(ies)
  ok    design_photoshop   parameters.type=object, 3 propert(ies)
6/6 tools project to a valid API schema
```

### 我在这条路上犯的四个错，以及测试怎么抓住的

1. **把 `parameters` 和 `output.schema` 的形状搞混。** 我一度把参数写成
   `{ type:'object', additionalProperties:true, properties:{} }`——那是 **ValueSchemaSpec**
   的形状，而 `parameters` 要的是 **ParameterSchemaSpec**（参数名 → 类型定义的映射）。
   `test/tool-schemas.mjs` 当场报 `parameters.type must be a value schema object`，
   我据此回滚。**没有这条测试，我会交付一组"没有任何参数"、模型根本调不动的工具。**
2. **删了 `enum` 却忘了取值要在别处可见。** `enum` 是模型唯一能看到合法取值的地方。
   发现后把取值写回**描述文本**（`One of: 'fonts', 'ladder', 'ramp'`）。
3. **误判 `validateJsonSchemaValue` 的协议。** 它**返回违规数组**而不是抛异常，
   我一度按"抛异常"来断言，导致两个测试都报假失败。
4. **把 mount-validation 当成了 schema 校验。** `register()` 几乎什么都收，失败发生在
   **provider 校验请求**时。所以现在有**两道独立的门**：`tool-schemas.mjs`（schema 形状与
   编译）与 `tool-registry-gate.mjs`（照抄 register 与 provider 的投影）。

### 仍然成立的加载器约束

**改完工具插件必须换文件名**：Loader 对本地 `.mjs` 用 `await import(url)` 且**无缓存
破坏参数**，一个进程内同一文件名只求值一次；而 standing mount 又只按 **composition
文件的戳**重建。两个效应叠加，会让"改了却没生效"。本次每次修复都同时换名 + 更新戳。

（本节之前的版本把这个失败归因于"嵌套 object 缺少 additionalProperties"——那是一个
真实的坑，但**不是这个症状的原因**。更正保留在此，以免后人重走。）

---

## 十、`--scale` 把画面压扁：同一个错误在两处（搬迁后复核发现，已修）

**症状**：`design render --scale s` 出来的图比例是错的，而报告里
`errors` 与 `warnings` **都是空数组**。

| 传入 | 应为 | 实际得到 | 比例 |
|---|---|---|---|
| `1` | 2400×1350 | 2400×1350 | ✅ |
| `0.5` | 1200×675 | **600×675** | 1.78 → 0.89 |
| `0.25` | 600×338 | **150×338** | 1.78 → 0.44 |
| `0.2` | 480×270 | **96×270** | 1.78 → 0.36 |

**宽度被乘了两次，高度一次都没有。** 两个轴甚至不是对称地错：宽度在第一次乘法之后
还够大，于是被第二次捕获；而取整后的高度已经掉到 338 以下不再 `> 1`，就被跳过了。

### 根因：同一个错误出现两次 —— 一个值被两条代码路径各乘一次

1. **canvas**：代码先重写 `scene.canvas`，紧接着 `Object.values(scene)` 又走到了它，
   因为 `width`/`height` 都在绝对键表里。
2. **`font.size`**：被专门的 `if (o.font.size …)` 分支乘了一次，然后又被遍历
   `Object.values(layer)` 乘了第二次——`font` 就是 layer 自己的值之一。
   218px 的标题在 0.5 草稿上变成 **54px**。这不是边角情况：**一半的真实场景把字号放在
   这里**（`muelsyse-ginkgo.json` 用 `font: { size: 218 }`，`poster-a-flat.json` 用 `size: 214`）。

### 修法（不变量，而不是补丁）

**每个数值叶子最多被乘一次**，靠两件事保证：每个对象只访问一次（`WeakSet`），
且**不从外部伸手进对象的值**——那条 `font.size` 专线被删掉了，因为 `font` 会像其它值
一样被遍历到。同时 `size` 加进绝对键表，字符串字体的 `layer.size` 才有人管。

### 为什么长期没人发现（这才是重点）

- `design_render` **在全部 16 份历史会话里从未被调用过**（只有 `design_analyze`×2、
  `design_verify`×2、`design_critique`×1、`design_photoshop`×1）；
- 报告是**干净的**：0 error / 0 warning，`verifyScene` 也不报。

这正是 §二 那条结论的又一次应验：**与被测代码共享假设的检查器测不出任何东西**，
而**一条从未被执行的代码路径，等于没有测试**。所以修复同时把它做成可测的模块
（`src/scale.mjs`）并加了 `test/scale.mjs`（26 项）——断言的**不是「图变小了」**
（那个对被改坏的版本同样通过），而是**长宽比不变**，也就是缺陷的签名。

### 顺带修正的一处环境脆弱点

`engineDir` 是全仓库唯一的绝对路径，克隆到别处就断。现在三级回退：
`config.engineDir` > 环境变量 `DSH_DESIGN_ENGINE` > 内置默认值，
且报错会说明**是哪一级**解析出来的。

---

## 附：曾经误判为此坑的记录（嵌套 object 的 openness）

第一次实测时报了：

```
本轮运行失败  Invalid schema for function 'design_analyze':
schema must be a JSON Schema of 'type: "object"', got 'type: null'.
```

**这条消息是误导的。** 声明的 schema 根部明明写了 `type: 'object'`。真正的原因
在 DSH 的 schema 编译器里：

```
unsupported JSON schema: schema.properties.verification.additionalProperties
must be explicitly true or false
```

**DSH 要求 schema 里每一个 object 节点——包括嵌套的——都显式声明
`additionalProperties`。** 缺了它，编译在构建 schema spec 时抛错，该工具就拿不到
可用 schema，API 在模型发出工具调用之前就拒掉整个请求。六个工具**全部**中招。

嵌套的报告对象本质上是开放的（每次引擎量到什么就带什么），所以正解是 `true`。

**为什么 mount-validation 抓不到**：这个失败发生在**为 API 请求编译 schema**
的时候，不在插件加载的时候。preset 挂载完全正常，工具也确实注册进了注册表——
只有真正发起一次请求才会炸。

**因此补了 `test/tool-schemas.mjs`**：用 DSH 自己的
`parameterSchemaSpecToJsonSchema` / `valueSchemaSpecToJsonSchema` 编译每个工具
的参数与输出 schema，并断言 ① 根部是 object ② `required` 标记真的传进了编译结果
③ 每个嵌套 object 都声明了 openness。这个测试现在是这套工具真正的守门人，
mount-validation 不是。

**教训**：错误信息指向的往往不是原因。`type: null` 说的问题在**根**，而真正的
违规在**叶子**；排查时应该把整个 schema 丢进真实的编译器看它到底抱怨什么，
而不是盯着消息里指的那个位置。
