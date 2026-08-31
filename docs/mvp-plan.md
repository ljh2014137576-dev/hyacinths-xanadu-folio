# MVP 0.1 实施计划

状态：提议

Milestone：[MVP 0.1](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/milestone/1)

更新：2026-09-01

## 1. 交付策略

MVP 不应按“先做完后端、再做完 UI”的水平分层路线推进。第一步先交付一条可运行、可测试、可演示的窄纵向切片，证明产品最困难的闭环：

> 用户选择本地 TypeScript fixture → 正式 Compiler API 建索引 → 选择 `createOrder()` → 只沿出站调用展开 → 源码片段为主体 → SVG 桥梁精确连接调用范围与目标定义 → 查看原文件并返回 → 重启后恢复标准 FlowPage。

之后再在同一模型上增加 LoopRegion/分支、沉浸视图/抽屉、BusinessNode。不得为每个页面创建临时 DTO 或第二套状态。

## 2. 第一条可运行纵向切片：Slice A “从目录到精确桥梁”

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
10. 关闭并重新打开应用，标准 FlowPage 入口、展开状态和 viewport 恢复。

### 2.2 包含范围

| 能力 | Slice A 验收 | Issue |
| --- | --- | --- |
| Electron 外壳 | main/preload/renderer 三边界，安全目录选择，utility indexer，开发与 build 命令 | #3 |
| 通用模型 | SourceFile、FunctionFragment、RelationBridge、FlowPage、Provenance、Diagnostic；LoopRegion 类型可定义但不要求完整 UI | #1 |
| Adapter 合同 | manifest/capabilities/version、test adapter、会话/取消/partial failure contract | #2 |
| TypeScript adapter | tsconfig、.ts/.tsx、函数/方法、跨文件 import/alias、调用/定义 UTF-16 ranges、resolved/ambiguous/unresolved | #5 |
| 索引与展开 | 渐进 batch、函数搜索、outgoing-only、最大深度/递归 guard 基础、取消和单文件失败 | #4 |
| 精确桥梁 | CodeSurface anchors + SVG overlay；scroll/zoom/resize 后准确；状态不只靠颜色 | #6 |
| 标准视图 | 项目目录、中央源码流程、右侧关系/来源详情；源码为主体 | #7 |
| 来源往返 | project-relative path、精确 reveal、返回快照、stale 范围错误 | #8 |
| 持久化 | 一个标准 FlowPage 的入口、展开、viewport 和 index metadata；事务/原子保存 | #1/#4/#7 |
| 质量门禁 | npm lockfile、lint、strict typecheck、unit/component/build CI，最小 Electron smoke | #12 |

### 2.3 明确排除

- 沉浸式视图和 Ctrl+Space 抽屉（#10/#11）。
- 完整分支查看过滤（#9）。
- 完整 LoopRegion 展示、次数与 break/continue/return/throw UI（#13）；但索引合同不得阻塞后续。
- 创建/编辑 BusinessNode（#14）。
- JavaScript、C/C++ 或第三方可安装规则包。
- 任意运行时调试、真实分支或实际循环次数。
- 自动跨进程、跨服务或跨语言调用解析。

排除项不得用硬编码临时字段占位；核心模型必须有后续扩展点，UI 只显示当前 capability。

### 2.4 Fixture

仓库内添加最小但真实的 TypeScript fixture（实现阶段完成，不属于本分析 PR）：

```text
fixtures/order-service/
  tsconfig.json
  src/controllers/order.controller.ts   # createOrder 入口
  src/services/order.service.ts          # validateOrder / buildOrder
  src/inventory/inventory.service.ts     # reserveInventory
  src/repositories/order.repository.ts   # saveOrder
  src/integrations/payment.gateway.ts    # external/dynamic 调用
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

Loop/branch fixture 在 Slice B 增加，不要为了 Slice A 的视觉演示伪造控制流结果。

### 2.5 Slice A Definition of Done

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
- FlowPage 重启恢复通过；清除可重建索引不会删除用户 FlowPage。
- PR 说明列出依赖许可证、精确版本和上游链接。

## 3. 风险先行 spikes

Spikes 必须输出测试/ADR 结论，不提交长期旁路实现。

### Spike 1：TypeScript 6 compatibility API

- 固定官方 `@typescript/typescript6` 补丁版本。
- 证明 Program/TypeChecker 可解析 fixture import/alias/method。
- 证明 offsets 与 CodeMirror UTF-16 positions 一致。
- 记录对 TypeScript 7 项目的 capability/limited 行为。

失败条件：必须依赖私有 `typescript/lib` API或不能给出精确目标范围。失败时回到 ADR 评审，不得用正则完成演示。

### Spike 2：CodeMirror + SVG anchor

- 两个只读 source surfaces，一条调用范围到定义范围的 SVG path。
- 覆盖多行、长行、scroll、zoom、resize、字体变化和 offscreen target。
- 自动测试世界坐标转换与 stale generation。

失败条件：公共 API 无法稳定测量或多实例资源不可接受。失败时在同一 `CodeSurface` port 下试 Monaco，不改 RelationBridge。

### Spike 3：Electron utility process + storage

- main 创建 indexer utility process，取消和崩溃重启可见。
- renderer 只收到 DTO，不获得绝对路径/Node API。
- SQLite driver 候选在 unpackaged 与 packaged app 事务读写成功。

失败条件：原生 driver 无可靠预构建/ABI 路径。启用原子 JSON StoragePort fallback，并为 SQLite 迁移保留 Issue/ADR。

### Spike 4：Forge Vite build

- main/preload/renderer 独立 bundle。
- sandbox/context isolation/CSP 运行。
- production build 与启动 smoke 成功。

失败时回退为显式 Vite build + Forge packaging；不擅自切换 Tauri 或取消 Vite。

## 4. 推荐 PR 序列

每个 PR 只解决一个可审查边界，合并前 CI 全绿。主要产品代码不得直接提交 main。

### PR 1：质量门与应用外壳（#3、#12 部分）

- npm workspaces、lockfile、strict tsconfig、lint/test/build scripts。
- Electron main/preload/renderer + utility process hello/health。
- CI 从文档 bootstrap 切换为真实 install/lint/typecheck/test/build。
- 安全设置、typed IPC skeleton、README 命令。

### PR 2：通用模型与 adapter contract（#1、#2）

- branded IDs、UTF-16 half-open ranges、resolution union、diagnostics、LoopRegion/FlowPage schema。
- test adapter 与 contract suite。
- serialization/migration tests。

### PR 3：TypeScript adapter 与 fixture（#5）

- 官方 TS6 compatibility API。
- project detection、Program/TypeChecker、symbols/references/ranges。
- resolved/ambiguous/unresolved/external、partial file diagnostics。
- 禁止 AST 跨合同。

### PR 4：索引、增量与出站投影（#4）

- batch transaction、progress/cancel、search。
- outgoing-only expansion、cycle/max-depth guard。
- last-good/stale revision 与 storage port。

### PR 5：标准源码页与精确桥梁（#6、#7）

- CodeSurface、AnchorRegistry、world transform、SVG renderer。
- 关系详情、highlight/dim、offscreen stub、无颜色依赖。
- 几何与组件测试。

### PR 6：来源往返与恢复（#8、#12 部分）

- source reveal、NavigationSnapshot、project-relative path、stale handling。
- FlowPage 持久化/重启恢复。
- Electron end-to-end smoke，完成 Slice A。

如果必须并行施工，PR 只能通过已合并接口或小型合同 PR 协作；不得在分支间复制不同版本的模型类型。

## 5. 后续切片

### Slice B：静态控制流可解释性（#9、#13）

目标：所有静态可能分支可见；用户过滤但不改变事实；循环体一次、回环与退出准确、递归有界。

验收：

- `if/else`/条件表达式 fixture 默认全显；仅看一支后其他变暗/折叠且显示隐藏数量。
- 页面明确提示“静态查看过滤”。
- for/while/do-while/for-of/for-in 只生成一个 LoopRegion body。
- entry/back/condition-false/break/continue/return/throw 边结构测试通过。
- upper-bound/expression/unknown 三种文案穷尽测试；没有实际次数字段。
- 嵌套循环、递归和调用环不无限增长。

### Slice C：沉浸阅读与项目抽屉（#10、#11）

目标：同一 FlowPage 在标准/沉浸视图切换，源码与桥梁占满画布，抽屉覆盖而不挤压。

验收：

- 切换后 entry、placements、expandedRelations、branchFilter、scroll/zoom 不丢失。
- 布局 generation 更新后重新测量桥梁，无旧 path 漂移。
- Ctrl+Space/Esc/图钉、focus trap、键盘搜索通过。
- 选择函数后默认关闭，固定后成为标准目录。

### Slice D：BusinessNode 与用户资产（#14）

目标：多选函数创建有来源、可保存恢复的组合语义。

验收：

- 命名、描述、排序、折叠/展开和删除关系都有服务/组件测试。
- 每个成员保留 SourceFile/range provenance；节点保存定义 provenance。
- 不嵌套，不修改源码或 RelationBridge。
- 同一函数多节点归属按当前默认允许，并在产品决定改变时收紧校验。
- 清索引/重建后 BusinessNode 不丢失，symbol relocation 不确定时要求用户处理。

## 6. Milestone 完成门槛

MVP 0.1 完成不等于“14 个 Issue 有 UI”。完成门槛是：

- #1-#14 的验收条件都有自动测试或可复现人工验收记录。
- 标准与沉浸视图均以源码为主体并共享状态。
- TypeScript adapter 使用公开正式 API，解析状态不误导。
- 默认展开严格出站-only。
- 分支过滤可发现/恢复，循环/递归有界且不伪造运行事实。
- 本地源码没有未授权网络传输，renderer 没有任意文件权限。
- 应用可从 clean checkout 安装、测试、构建和启动。
- 依赖许可证和第三方 notices 可生成；无密钥、Token、绝对用户路径、构建产物或临时文件进入仓库。

## 7. 观测与性能验收计划

PRD 尚未给出默认最大展开深度和大型项目硬指标。本阶段不臆造数字，先埋本地、无源码内容的性能测量：

- 文件/符号/关系数量、批次耗时、取消延迟。
- FlowPage placement/visible bridge 数量。
- anchor measure/route/commit 耗时与 scroll frame latency。
- 保存/恢复和 schema migration 耗时。

在 Slice A fixture 与一个经授权的中型开源 fixture 上记录 baseline，再由产品/工程评审设定可执行预算。遥测默认关闭；性能日志只含计数、时长和项目相对类别，不含源码/绝对路径。

## 8. 施工者必须遵守的约束

- 每个主要功能在独立分支/PR；不直接开发 main，不自行合并。
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
