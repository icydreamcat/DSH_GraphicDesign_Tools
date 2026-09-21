# Preset 改动记录与加载验证

> 对象：`D:\DSH_GDT\DSH_GraphicDesign_Tools\design\`（平面设计 agent preset）
> 改动日期：本轮会话
> **这份文件是给下一个会话做加载验证用的。**

---

## 一、这次改了什么

### 1. 修改的文件（唯一一个）

```
D:\DSH_GDT\DSH_GraphicDesign_Tools\design\agent.cordis.yml
```

- 原 **402 行** → 现 **448 行**
- 只在 **`- id: design-policy` 的 `config.text` 块内**追加内容
- 块内：原 16 个非空行 → 现 **52 个非空行**；**15,640 字符**
- **没有动任何其它 row**，没有动任何 `skills/*/SKILL.md`，没有动任何 `.mjs`

### 2. 新增的文件（引擎工具目录）

```
D:\DSH_GDT\DSH_GraphicDesign_Tools\engine\tools\gate-delivery.mjs
```

**这是目标里要求的「会返回非零退出码的自动检查」。**

自测结果（两个方向都验过，一个只会拒绝的闸门没用）：

| 场景 | 结果 |
|---|---|
| `gen/gate-selftest-pass.json`（合法示范场景） | **exit 0**，7 项通过 |
| `gen/scene-final.json`（本会话真实场景） | **exit 1**，报「缺 `gates` 声明」+「近白字 1.04:1」 |

修掉的三类**误报**（会误报的闸门等于没有闸门）：

1. `H5` 把叠在纸上的**纹理层**（`-fib`/`-cok`/`-pig`）当成半透明纸体 → 加 OVERLAY 排除；
   排除前报 18 处，其中 15 处是纹理层，真正的纸体全是实的
2. `H4b` 把**全幅底图**当成"压在人身上的元素"→ 加 ground-like 排除；
   排除前连自己的自测场景都过不了
3. `H6` 已知局限：它只比"字色 vs 纸底"，**看不到字坐在自己的面板上**。
   已在输出里写明"先 1:1 裁切再据此行动"

### 3. 追加进 policy 的内容（**不是原则，是机制**）

文件里原本已有 22 条原则（intent before form / one generating rule / subtracting /
two images share a craft …）与 7 个 skill。**原则已经饱和**，所以这次只加
**本会话实测出来、原文里确实没有的机制**：

| 新增段 | 内容 | 来自哪次失败 |
|---|---|---|
| **四问 + 先答后放** | 放第一个元素前，在回复里写下：这是什么物件／唯一焦点与竞争者／光轴／深度层与生成规则 | 17 版一次都没写过 |
| **层序是设计变量** | 顺序要在声明深度层时一并声明；纸画在人物之前 → 读作纸透明 | 改了六轮"不透明度"，真因是层序 |
| **读 warnings 数组** | 每个失败图层都在那里，图里永远看不到 | `softLight` 拼写错 → 6 层纹理静默消失；路径串有洞 → 4 条连线没画 |
| **1:1 裁切** | 说缺陷之前先裁 1:1；工具与眼睛冲突时信图 | 验证器只比"字 vs 底"，看不见中间的面板 |
| **工具名册是固定集合** | 开工时点名用哪些；三个是闸门不是辅助 | 29 个工具只用 5 个 |
| **改症状名字 vs 改病因** | 说出可检验的机制，再检查，再改 | "纸透明"查了六轮透明度 |
| **值从底往上读** | 换底会重判已定的所有对比；高频低对比 = 更多更淡，不是更少 | `#FFFA00` 深底 15.26:1 / 奶油 1.07:1 |
| **先立色彩架构** | 由一个色相带全族，用 ramp 工具建；插画与底要合一，且在**插画**上做，不能用半透明矩形盖 | 两个色系各走各的 |
| **重复资产的诚实形式** | 同一素材多尺寸 ≠ 系统；系统 = 一个基础单元 + 多变体，沿三轴变化 | 「一个基础图形＋复制」我只做了复制 |
| **GATE 1** | 开工前：四问写完，否则停 | |
| **GATE 2** | 交付前 9 条，每条要给出证明值，不许写"是" | |

---

## 二、加载机制（已从源码确认）

### 1. `design-policy` 的文本从 YAML 读，改 YAML 即生效

`design-policy.mjs` 文件头注释原文：

> **THE TEXT IS CONFIGURATION, NOT CODE** … a standing mount is rebuilt from a
> composition-file stamp whenever a new session starts, so **a YAML edit takes
> effect on the next session with no Host restart.**
> Text baked into this module would not — the Cordis Loader imports a local
> plugin with a plain `await import(url)` and no cache-busting parameter.

**结论：本次改的是 YAML，不是 `.mjs` → 下一会话自动生效。**

### 2. `.mjs` 插件则必须改名（本次没触发）

`agent.cordis.yml` 第 151–157 行：

> **THE FILENAME MUST CHANGE WHENEVER THIS FILE'S CONTENT CHANGES.** … Editing in
> place therefore produces "changed but not in effect", reported as an error
> about the OLD code.

→ **本次没有修改 `design-tools-260914-2212.mjs` 或 `design-policy.mjs`，所以不需要改名。**
（将来若改这两个文件，**必须同时改文件名并更新 YAML 里的 `name:`**。）

### 3. skill 从 preset 自己的目录加载

`agent.cordis.yml` 第 219–223 行：

```yaml
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - !!js process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))
```

注释：**custom roots 优先于 user roots**，而项目自己的 `.dsh/skills` 优先级更高、
可按仓库覆盖。

→ 七个 skill 在 `design/skills/<name>/SKILL.md`。**本次未改动它们。**

### 4. 花括号不会误触插值（已查源码）

`dsh-system-prompt/index.js` 第 103 行：

> a lone `{{` without any later `}}` is **literal prose**

`README.md` 第 172 行：

> No escape syntax for literal `{{…}}` braces — every **complete group** is
> interpolated

新增文本用的是**单字符制表线** `──`，未构成 `{{` 组。
且 `design-policy.mjs` 自带守卫（含 `{{` 即抛错）**已通过检查**。

---

## 三、改动后的校验结果（本轮已做）

### 手写扫描器

```
YAML 总行数                    448      （原 402）
design-policy text 块           行 79 → 172
块内非空行                     52        （原 16）
字符数                         15,640
低于块基础缩进的行             0        （10 行更深，是 gates 代码样例，合法）
含 '{{'                        否（模块守卫通过）
段落锚点                       MECHANICS / GATES / GATE 1 / GATE 2 / gate-delivery.mjs / gates: { 全部 present
块边界                         第 173 行 = '- id: agent-instructions'
```

### 独立验证（用 harness 自己的 `yaml` 包，不是我的手写脚本）

```
document parsed   : ok
top-level type    : array
row count         : 19
ids               : persona design-policy agent-instructions design-tools tool-bash tool-pwsh
                    tool-fs tool-fs-search tool-jobs skill-filesystem tool-skill command-goal
                    tool-goal planning compaction delegation tool-ask-user tool-todo tool-web
design-policy.config.text : string, 15640 chars, 不含 {{，GATE 1/2 与 gate-delivery 均在
skill-filesystem.config.customSkillDirs : ["…fileURLToPath(new URL('skills/', baseUrl))"]
```

**结论：composition 能解析、policy 文本合法、闸门说明确实在文本内。**

---

## 三之二、全盘复查的结论（目标要求的那一项）

逐份读过并给出处置。**核心判断：原则层已经饱和，不要再加原则。**

| 文件 | 复查结论 | 处置 |
|---|---|---|
| `agent.cordis.yml` · persona | 身份段，与 policy 分工清楚（身份 vs 工作纪律） | **不改** |
| `agent.cordis.yml` · design-policy text | 已有 **22 条原则**，含 intent-before-form、one generating rule、subtracting、two-images-share-a-craft、markers vs pointers、marks-vs-wordmark ratio | **不动原则，只加机制**（见 §1.3） |
| `agent.cordis.yml` · design-tools row | 头部写明：每个工具是 `bin/design.mjs` 的薄包装，"No tool reimplements any part of the engine" | **不改**（正因如此，新增闸门无需包装、无需改名） |
| `agent.cordis.yml` · skill-filesystem row | `customSkillDirs` 指向 preset 自己的 `skills/`，custom roots 优先于 user roots | **不改** |
| `design-policy.mjs` | 文本从 YAML 读、含两条守卫（非空、不含 `{{`）。改 YAML 即可，**改这个 .mjs 就必须改名** | **不改** |
| `design-tools-260914-2212.mjs` | 同上；改名规则写在 YAML 第 151–157 行 | **不改** |
| `preset.yml` | 2 行，name + description。描述里"审美纪律常驻、能力按需调用"与实现一致 | **不改** |
| `skills/` × 7 | `design-foundations`（四层理解路径、四问、反模式表）、`depth-and-structure`（深度轴、fill≠organisation、阈值）、`typography-and-scale`（字阶、跟踪、变量字体陷阱）、`colour-systems`（OKLab ramp、强调预算 3%、色调带）、`reference-analysis`、`filters-and-palette`、`photoshop-delivery` | **不改**。它们与 policy 有重叠但**角度不同**（skill 给操作与阈值，policy 给常驻纪律），删任何一边都是净损失 |
| `knowledge/` 下本会话 9 份文档 | 四门课拆解 ×4、总纲、清单、引擎缺件、遮罩溶解、清点方法 | **保留供人查阅**，但**它们不是执行机制**——本轮把其中真正可执行的部分（机制 + 闸门）移进了 preset |

### 去重结论：**不合并**

policy 与 skill 的重叠是**有意的分工**：
- **policy** 是常驻的、每轮都在上下文里的**纪律**——它的价值在于"躲不掉"
- **skill** 是按需载入的**操作与阈值**——它的价值在于"细节够深"

把 policy 压成一句"见 skill"，就等于把纪律变成"要记得去读"，而那正是这一场失败的原因。
**所以本次不做结构性合并，只做一处真去重**：`knowledge/` 里那些可执行的内容不再重复陈述，
而是指向 preset 权威位置。

---

## 四、给下一个会话的加载验证清单

**新开一个会话后，按顺序做这四步，把结果贴回来：**

1. **policy 是否加载** —— 回复里能否引用到新增段落。最直接的探针：
   > 问："你现在的 working policy 里，GATE 1 要求哪四件事？"
   > 期望答出：这是什么物件／唯一焦点与竞争者／光轴／深度层与生成规则。

2. **段落顺序是否对** —— policy 应紧跟在 persona 之后、在任何工具说明之前
   （`design-policy.mjs` 里 `POLICY_ORDER_OFFSET = 100`，落在
   `DEPLOYMENT_PERSONA`(0) 与 `PLAN_POLICY`(500) 之间）。

3. **skill 是否注册** —— 让新会话列出可用 skill。
   期望看到这七个：`colour-systems`、`depth-and-structure`、`design-foundations`、
   `filters-and-palette`、`photoshop-delivery`、`reference-analysis`、
   `typography-and-scale`。

4. **实际按 GATE 1 走一遍** —— 给一个小任务（哪怕只是"画一张卡片"），
   看新会话**是否在放第一个元素之前、在回复里写出四问**。
   **这一步才是真正的验证**：policy 加载成功不等于被遵守。
   如果它跳过了四问直接开始摆元素，说明 policy 文本还不够硬，需要再改。

---

## 五、本次没做、需要别的会话做的

- **没有改任何 `SKILL.md`。** 原则层没有缺口，不需要加；
  真正的问题是执行，而执行靠 policy 常驻段与两个闸门，不靠再加一份 skill。
- **没有修 `design-policy.mjs` / `design-tools-*.mjs`。**
  （若要修，必须改名，见上面 §2.2。）
- **`design-tools-260914-2212.mjs` 的 `engine` 之外没有改动**；
  若将来要给引擎加"交付闸门"作为**工具**（而不是提示词），
  需要在 `engine/tools/` 下新增脚本，并在该 `.mjs` 里注册 —— **那一步要改名。**
- **本会话在 `knowledge/` 下写的 9 份文件**（四门课拆解、总纲、清单等）
  **保留在原地供人查阅**，但它们**不是执行机制**，不要指望它们自动生效。
