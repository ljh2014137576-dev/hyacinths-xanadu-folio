# MVP 0.1 实施计划

状态：提议

Milestone：[MVP 0.1](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/milestone/1)

更新：2026-09-01

## 1. 交付策略

MVP 不应按“先做完后端、再做完 UI”的水平分层路线推进。本计划中的**第一条可运行纵向切片就是完整 MVP 0.1**：它必须在同一个 builder 分支/PR 和同一个 Milestone 中覆盖 Issues #1-#14，并形成以下完整用户旅程：

> 启动 Electron/React 应用 → 选择本地 TypeScript 项目 → LanguageAdapter 建索引 → 创建 FlowPage 并只沿出站调用展开 → 精确来源桥梁与来源往返 → 标准/沉浸视图共享状态 → Ctrl+Space 项目抽屉 → 静态分支查看过滤 → LoopRegion/递归有界展示 → 创建并恢复 BusinessNode → 自动测试、CI 与 README 共同证明可安装、可运行、可恢复。

A、B、C、D 仅是同一 builder PR 内部的增量实现顺序和验收批次，用于降低施工风险；它们不是后续产品切片，也不能单独宣称完成第一条纵向切片。可以先让 A 的窄闭环运行以便尽早集成，但只有 A+B+C+D 及最终端到端门禁全部通过，builder PR 才达到完成条件。

## 2. 第一条可运行纵向切片：完整 MVP 0.1

### 2.1 用户场景

1. 启动桌面应用。
2. 通过原生目录选择器选择仓库内测试 fixture。
3. 应用显示 TypeScript adapter matched，以及索引进度/完成/诊断。
4. 用户搜索并选择 `createOrder()`。
5. 标准视图显示 `createOrder()` 源码片段，而不是圆形节点。
6. 页面列出其出站调用；用户逐一展开 `validateOrder()`、`reserveInventory()`、`saveOrder()`。
7. 每条桥梁从具体调用表达式范围连接到具体目标声明范围。
8. fixture 中一条动态调用显示为 unresolved，不能连接到猜测函数。
9. 点击来源打开原始文件精确范围，返回后保持 scroll/zoom/selection。
10. 用户对 `paid` 条件选择“仅查看已支付”；未支付路径变暗或折叠，显示隐藏数量，并可恢复“显示全部”。
11. 用户展开包含 for/while/for-of 的 LoopRegion；循环体只出现一次，回环、break/continue/return/throw 与静态次数语义准确，递归不会无限增长。
12. 用户切换到沉浸式视图；同一 FlowPage 的位置、展开和筛选不丢失，源码与桥梁占据主要画布。
13. 用户用 Ctrl+Space 打开覆盖画布的项目抽屉，用 Esc 关闭，并可用图钉转为标准视图常驻目录。
14. 用户多选函数创建、命名、描述、排序并折叠/展开“创建订单” BusinessNode；成员与节点定义来源均可查看。
15. 关闭并重新打开应用，FlowPage 模式、viewport、展开/折叠、分支过滤与 BusinessNode 全部恢复。
16. README 中记录从 clean checkout 安装、开发启动、测试和生产构建的完整命令。

### 2.2 包含范围

| 能力 | 完整纵向切片验收 | Issue |
| --- | --- | --- |
| Electron 外壳 | main/preload/renderer 三边界，安全目录选择，utility indexer，开发与 build 命令 | #3 |
| 通用模型 | SourceFile、FunctionFragment、RelationBridge、FlowPage、BusinessNode、LoopRegion、Provenance、Diagnostic 均落地并严格类型化 | #1 |
| Adapter 合同 | manifest/capabilities/version、test adapter、会话/取消/partial failure contract | #2 |
| TypeScript adapter | tsconfig、.ts/.tsx、函数/方法、跨文件 import/alias、调用/定义 UTF-16 ranges、resolved/ambiguous/unresolved | #5 |
| 索引与展开 | 渐进 batch、函数搜索、outgoing-only、最大深度/递归 guard 基础、取消和单文件失败 | #4 |
| 精确桥梁 | CodeSurface anchors + SVG overlay；scroll/zoom/resize 后准确；状态不只靠颜色 | #6 |
| 标准视图 | 项目目录、中央源码流程、右侧关系/来源详情；源码为主体 | #7 |
| 来源往返 | project-relative path、精确 reveal、返回快照、stale 范围错误 | #8 |
| 静态分支筛选 | 默认全显、仅看某分支、其他分支可发现/恢复；明确不是运行路径 | #9 |
| 项目抽屉 | Ctrl+Space/Esc/图钉、覆盖而不挤压、搜索与焦点可访问 | #10 |
| 沉浸式视图 | 与标准视图共享 FlowPage，源码与桥梁占满画布，切换状态不丢失 | #11 |
| LoopRegion | 循环体一次、entry/back/exit、break/continue/return/throw、静态次数、递归防无限 | #13 |
| BusinessNode | 创建、命名、描述、排序、折叠/展开、成员与节点来源、保存恢复、不嵌套 | #14 |
| 持久化 | 标准/沉浸 FlowPage、筛选、LoopRegion 展示状态、BusinessNode 与 index metadata 事务保存 | #1/#4/#7/#9/#11/#14 |
| 质量门禁与文档 | npm lockfile、lint、strict typecheck、unit/component/Electron E2E/build CI；README 安装/启动/测试/构建 | #3/#12 |

### 2.3 内部验收批次

| 批次 | 同一 builder PR 内的目的 | 覆盖 | 是否可单独宣称纵向切片完成 |
| --- | --- | --- | --- |
| A：基础闭环 | 尽早跑通 Electron→项目选择→TS adapter→索引→FlowPage→桥梁→来源往返 | #1-#8、#12 基础门禁 | 否 |
| B：静态控制流 | 在同一模型/fixture 上完成分支过滤、LoopRegion 与递归 | #9、#13，并扩充 #4/#5/#6 测试 | 否 |
| C：完整阅读交互 | 完成标准/沉浸共享状态和 Ctrl+Space 项目抽屉 | #10、#11，并扩充 #7/#8 测试 | 否 |
| D：用户语义与最终门禁 | 完成 BusinessNode、全状态恢复、README 和完整 Electron E2E | #14、#3/#12 最终验收、#1-#14 回归 | 只有 A+B+C+D 全部通过才是“是” |

批次可以用小提交逐步推送和评审，但 builder PR 在 D 与最终 DoD 完成前必须保持未完成状态；不得把 B/C/D 移到另一个“后续产品切片”来满足 A 的合并。

### 2.4 完整纵向切片不包含

- JavaScript、C/C++ 或任意第三方来源规则包；MVP 只要求内置 TypeScript adapter，但必须实现 manifest/能力/健康状态。
- 任意运行时调试、真实分支、变量值或实际循环次数。
- 自动跨进程、跨服务或跨语言调用解析。
- BusinessNode 嵌套。

这些排除项不得用硬编码临时字段占位；核心模型必须保留后续扩展点，UI 只显示当前 capability。

### 2.5 Fixture

仓库内添加最小但真实的 TypeScript fixture（实现阶段完成，不属于本分析 PR）：

```text
fixtures/order-service/
  tsconfig.json
  src/controllers/order.controller.ts   # createOrder 入口
  src/services/order.service.ts          # validateOrder / buildOrder
  src/inventory/inventory.service.ts     # reserveInventory
  src/repositories/order.repository.ts   # saveOrder
  src/integrations/payment.gateway.ts    # external/dynamic 调用
  src/workflows/order-flow.ts             # paid 分支、循环、break/continue/return/throw
  src/workflows/retry.ts                  # 递归与调用环
  src/shared/broken.ts                    # 可恢复语法错误 fixture
```

Fixture 必须包含：

- 命名 import、alias import 和跨文件调用。
- 类方法或对象方法调用。
- 一个可精确解析调用。
- 一个多个候选或重载相关场景。
- 一个动态/`any` 调用，产生 unresolved/ambiguous，而非伪 resolved。
- 一个自递归或 A→B→A 调用环，用于证明不会无限展开。
- 一个单文件语法错误，证明 partial index。
- 一个 paid/unpaid 条件，证明默认全显、查看过滤、隐藏数量与恢复。
- for、while、do-while、for-of、for-in、嵌套循环，以及 break/continue/return/throw 路径。
- 可证明常量上限、次数表达式和静态未知三种 iteration estimate。
- 至少四个可组合为“创建订单” BusinessNode 的函数，且来源分布在多个文件。

同一 fixture 随 A→B→C→D 内部批次增量完善，但完整内容必须在 builder PR 完成前提交。不得为了早期 A 演示伪造控制流结果。

### 2.6 完整纵向切片 Definition of Done

所有条件必须同时满足：

- 从 clean checkout 执行 `npm ci` 成功。
- `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` 成功。
- Electron smoke 从目录选择到 createOrder FlowPage 成功；无源码上传或外部网络请求。
- 解析 fixture 的确定性 snapshot/structural assertions 通过，但不只依赖 snapshot。
- 每条 resolved RelationBridge 的 call-site 与 target definition 文本/range 断言通过。
- ambiguous/unresolved 在模型与 UI 中有不同于 resolved 的标签、线型/端点和详情。
- 出站展开测试在存在入站 caller 的 fixture 中断言 caller 不出现在默认 FlowPage。
- 调用环测试断言 placement 有界并产生 back-link/cycle marker。
- scroll、zoom、resize 后桥梁端点保持在目标范围容差内。
- 来源往返恢复位置；revision 漂移时不静默跳转。
- renderer bundle 不含 Node/TypeScript Compiler API；Electron 安全设置和 IPC sender/schema 校验有测试。
- 标准/沉浸视图共享同一 FlowPage；Ctrl+Space/Esc/图钉抽屉交互与焦点测试通过。
- 分支过滤前后 RelationBridge 事实数量不变，隐藏路径可发现/恢复，UI 明示静态查看语义。
- LoopRegion 循环体只建模一次；entry/back/exit 与 break/continue/return/throw 测试通过；三种静态次数文案没有实际执行语义。
- BusinessNode 创建、排序、折叠/展开、成员与节点来源、禁止嵌套和保存恢复测试通过。
- FlowPage 模式、viewport、展开/折叠、分支过滤与 BusinessNode 重启恢复通过；清除可重建索引不会删除用户资产。
- README 从 clean checkout 的 npm install、开发启动、测试和生产构建命令经过实际验证。
- PR 说明列出依赖许可证、精确版本和上游链接。

## 3. 风险先行 spikes

Spikes 必须输出测试/ADR 结论，不提交长期旁路实现。

### Spike 1：TypeScript 6 compatibility API

- 固定官方 `@typescript/typescript6` 补丁版本。
- 证明 Program/TypeChecker 可解析 fixture import/alias/method。
- 证明 TypeScript offsets 与当前 HTML CodeSurface UTF-16 positions 一致；CodeMirror 迁移门见 ADR-0004。
- 记录对 TypeScript 7 项目的 capability/limited 行为。

失败条件：必须依赖私有 `typescript/lib` API或不能给出精确目标范围。失败时回到 ADR 评审，不得用正则完成演示。

### Spike 2：CodeSurface + SVG anchor

- MVP 采用 ADR-0004 的只读 HTML CodeSurface port；两个 source surfaces 与一条调用范围到定义范围的 SVG path。
- 覆盖多行、长行、scroll、zoom、resize、字体变化和 offscreen target。
- 自动测试世界坐标转换与 stale generation。

失败条件：公共 API 无法稳定测量或多实例资源不可接受。失败时在同一 `CodeSurface` port 下试 Monaco，不改 RelationBridge。

### Spike 3：Electron utility process + storage

- main 创建 indexer utility process，取消和崩溃重启可见。
- renderer 只收到 DTO，不获得绝对路径/Node API。
- SQLite driver 候选在 unpackaged 与 packaged app 事务读写成功。

失败条件：原生 driver 无可靠预构建/ABI 路径。启用原子 JSON StoragePort fallback，并为 SQLite 迁移保留 Issue/ADR。

### Spike 4：显式 Vite build

- main/utility、单文件 sandbox preload、renderer 独立 bundle；ADR-0004 将 Forge packaging 延至分发阶段。
- sandbox/context isolation/CSP 运行。
- production build 与启动 smoke 成功。

当前显式 Vite/tsc build 已通过 CI；未来 packaging 迁移必须满足 ADR-0004 平台门槛，不擅自切换 Tauri 或取消 Vite。

## 4. 同一 builder PR 的内部提交序列

完整纵向切片在一个 builder 分支和一个目标为 `main` 的实现 PR 中施工。下面是便于审查、回滚和持续集成的小提交顺序，不是多个可分别合并的产品 PR。builder PR 在 A+B+C+D 与最终门禁全部完成前保持 draft/未完成；主要产品代码不得直接提交 main。

### A1：质量门与应用外壳（#3、#12 部分）

- 单根包（达到第二个发布单元时再引入 npm workspaces）、lockfile、strict tsconfig、lint/test/build scripts，见 ADR-0004。
- Electron main/preload/renderer + utility process hello/health。
- CI 从文档 bootstrap 切换为真实 install/lint/typecheck/test/build。
- 安全设置、typed IPC skeleton、README 命令骨架。

### A2：通用模型与 adapter contract（#1、#2）

- branded IDs、UTF-16 half-open ranges、resolution union、diagnostics、LoopRegion/FlowPage/BusinessNode schema。
- test adapter 与 contract suite。
- serialization/migration tests。

### A3：TypeScript adapter 与完整 fixture 基础（#5）

- 官方 TS6 compatibility API。
- project detection、Program/TypeChecker、symbols/references/ranges。
- resolved/ambiguous/unresolved/external、partial file diagnostics。
- 禁止 AST 跨合同。

### A4：索引、可取消重建与出站投影（#4）

- batch transaction、progress/cancel、search；MVP 0.1 全量重建且 capability=false，可靠增量进入 MVP 0.2 #17。
- outgoing-only expansion、cycle/max-depth guard。
- last-good/stale revision 与 storage port。

### A5：标准源码页、精确桥梁与来源往返（#6、#7、#8）

- CodeSurface、AnchorRegistry、world transform、SVG renderer。
- 关系详情、highlight/dim、offscreen stub、无颜色依赖。
- source reveal、NavigationSnapshot、project-relative path、stale handling。
- 此时形成可运行的基础闭环，但**尚未完成第一条纵向切片**。

### B：静态控制流（#9、#13）

- 扩充同一 fixture 和 adapter/index 模型，完成 BranchContext、BranchViewFilter 与 LoopRegion。
- 连接分支筛选、隐藏摘要、循环/递归 UI 和全部控制流测试。

### C：沉浸阅读与项目抽屉（#10、#11）

- 完成标准/沉浸共享 FlowPage、模式切换几何重算、Ctrl+Space/Esc/图钉和焦点测试。

### D：BusinessNode、完整恢复与最终门禁（#14、#3、#12）

- 完成 BusinessNode 创建/来源/保存恢复。
- 完成全量 Electron E2E、README 实际命令验证、许可证记录和 #1-#14 回归。
- 只有此提交之后全部 DoD 通过，builder PR 才可从 draft 转为 ready for review。

如果协调者要求并行工作，只能在同一 builder PR 的共享合同上以可追踪提交协作；不得把 B/C/D 变成另一个后续产品切片，也不得在分支间复制不同版本的模型类型。

## 5. 同一纵向切片的详细验收批次

### 批次 A：基础闭环（#1-#8、#12 基础）

目标：Electron/React 可运行，用户可选择 TypeScript 项目，建立语言无关索引和 FlowPage，只沿出站引用展开，精确桥梁与来源往返可用。

验收：

- clean checkout 可安装、开发启动和构建；renderer 权限边界成立。
- TypeScript fixture 产出稳定 FunctionFragment、RelationBridge、解析状态和精确范围。
- 默认 FlowPage 不出现 fixture 中与入口无关的入站 caller。
- 标准视图源码为主体，桥梁在 scroll/zoom/resize 后仍准确。
- 来源往返和基础 FlowPage 恢复通过。

### 批次 B：静态控制流可解释性（#9、#13）

目标：所有静态可能分支可见；用户过滤但不改变事实；循环体一次、回环与退出准确、递归有界。

验收：

- `if/else`/条件表达式 fixture 默认全显；仅看一支后其他变暗/折叠且显示隐藏数量。
- 页面明确提示“静态查看过滤”。
- for/while/do-while/for-of/for-in 只生成一个 LoopRegion body。
- entry/back/condition-false/break/continue/return/throw 边结构测试通过。
- upper-bound/expression/unknown 三种文案穷尽测试；没有实际次数字段。
- 嵌套循环、递归和调用环不无限增长。

### 批次 C：沉浸阅读与项目抽屉（#10、#11）

目标：同一 FlowPage 在标准/沉浸视图切换，源码与桥梁占满画布，抽屉覆盖而不挤压。

验收：

- 切换后 entry、placements、expandedRelations、branchFilter、scroll/zoom 不丢失。
- 布局 generation 更新后重新测量桥梁，无旧 path 漂移。
- Ctrl+Space/Esc/图钉、focus trap、键盘搜索通过。
- 选择函数后默认关闭，固定后成为标准目录。

### 批次 D：BusinessNode 与用户资产（#14）

目标：多选函数创建有来源、可保存恢复的组合语义。

验收：

- 命名、描述、排序、折叠/展开和删除关系都有服务/组件测试。
- 每个成员保留 SourceFile/range provenance；节点保存定义 provenance。
- 不嵌套，不修改源码或 RelationBridge。
- 同一函数多节点归属按当前默认允许，并在产品决定改变时收紧校验。
- 清索引/重建后 BusinessNode 不丢失，symbol relocation 不确定时要求用户处理。

这些批次均属于同一第一条纵向切片；任何一批缺失都只能标记为“实现中”，不能把已完成批次当成用户要求的 MVP 0.1。

## 6. 第一条纵向切片的 #1-#14 完成门槛

| Issue | 完成证据；全部必须在同一 builder PR 中提供 |
| --- | --- |
| #1 通用模型 | SourceFile、FunctionFragment、RelationBridge、FlowPage、BusinessNode、LoopRegion、Provenance 可序列化、严格类型检查和 schema 测试通过 |
| #2 LanguageAdapter | manifest、版本/能力/健康、测试 adapter、取消/partial failure 合同测试通过，核心无 TypeScript AST 类型 |
| #3 应用外壳 | Electron/React/Vite 可开发启动和生产构建；main/preload/utility/renderer 边界、安全项目选择及 README 命令验证通过 |
| #4 索引 | 渐进、取消、失败恢复、搜索、outgoing-only、cycle/max-depth 测试通过；增量 capability=false 并由 ADR-0004/MVP 0.2 #17 跟踪 |
| #5 TypeScript 规则包 | 正式 Compiler API 解析 tsconfig、函数/方法、跨文件 import/alias、调用目标与精确范围；不确定调用不伪装 resolved |
| #6 来源桥梁 | call-site→target-definition 精确锚定；scroll/zoom/resize、状态线型/标签、unresolved 几何测试通过 |
| #7 标准视图 | 左目录/中央源码 FlowPage/右来源详情可运行，源码是主体，主要交互测试通过 |
| #8 来源查看 | 原文件精确范围、project-relative path、返回上下文与 stale/缺失文件恢复测试通过 |
| #9 分支筛选 | 默认全显、仅看分支、隐藏数量/恢复、跨模式/重启保持；明确静态查看语义 |
| #10 项目抽屉 | Ctrl+Space/Esc/图钉、覆盖不挤压、搜索/最近页/目录、焦点与可访问性测试通过 |
| #11 沉浸视图 | 源码/桥梁占满画布，pan/scroll/zoom 可用，与标准视图共享 FlowPage 并保持状态 |
| #12 测试与 CI | `npm ci`、lint、strict typecheck、unit/component/Electron E2E、build 在 PR CI 全绿，失败禁止合并 |
| #13 LoopRegion | 五类源码循环体只建模一次，entry/back/exit 和 break/continue/return/throw 正确，三类静态次数与递归/嵌套测试通过 |
| #14 BusinessNode | 多选、命名、描述、排序、折叠/展开、成员与节点来源、不嵌套、保存恢复测试通过 |

跨 Issue 的最终门槛：

- A+B+C+D 全部完成；完整 Electron E2E 按 2.1 的用户场景从项目选择运行到重启恢复。
- 标准与沉浸视图均以源码为主体并共享状态。
- 默认展开严格出站-only；分支过滤、循环次数和递归不伪造运行事实。
- 本地源码没有未授权网络传输，renderer 没有任意文件权限。
- 应用可从 clean checkout 安装、测试、构建和启动，README 命令与实际脚本一致。
- 依赖许可证和第三方 notices 可生成；无密钥、Token、绝对用户路径、构建产物或临时文件进入仓库。

## 7. 观测与性能验收计划

PRD 尚未给出默认最大展开深度和大型项目硬指标。本阶段不臆造数字，先埋本地、无源码内容的性能测量：

- 文件/符号/关系数量、批次耗时、取消延迟。
- FlowPage placement/visible bridge 数量。
- anchor measure/route/commit 耗时与 scroll frame latency。
- 保存/恢复和 schema migration 耗时。

在完整 MVP fixture 与一个经授权的中型开源 fixture 上记录 baseline，再由产品/工程评审设定可执行预算。遥测默认关闭；性能日志只含计数、时长和项目相对类别，不含源码/绝对路径。

## 8. 施工者必须遵守的约束

- A/B/C/D 在同一 builder 分支/PR 内以小提交推进；不直接开发 main，不把未完成批次拆成后续产品切片，不自行合并。
- 使用 npm 和已提交 lockfile；不手工改 lockfile。
- strict typecheck；禁止用大面积 `any`、`@ts-ignore` 或关闭规则绕过合同。
- TypeScript 解析只用正式 Compiler API；正则不得替代 AST/TypeChecker。
- renderer 不读取本地文件、不加载 adapter、不保存绝对路径。
- FlowPage 只沿 outgoing relation 展开；入站 caller 仅在显式“查找引用”功能中出现。
- RelationBridge 两端是 source ranges，不是函数卡中心点。
- hidden/ambiguous/unresolved/stale 都是一等状态，不得因演示简化而丢弃。
- LoopRegion body 一份；静态上限、表达式、未知与未来实际次数严格分离。
- 任何缓存可删除并重建，任何用户资产必须事务保存并迁移。
- 提交前运行受影响测试、全量 CI 命令、敏感信息/绝对路径/构建产物检查。
