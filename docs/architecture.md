# Xanadu Code Flow Browser 架构

状态：提议（供 MVP 0.1 实施评审）

更新：2026-09-01

## 1. 架构目标

Xanadu Code Flow Browser 是本地优先的静态代码阅读器。它从用户选择的入口出发，只沿向外引用展开，把源码片段组织为连续流程页，并用可交互桥梁连接具体调用范围与具体目标定义范围。

本架构以以下约束为硬边界：

- 源码片段是视觉主体；关系是辅助表达，界面不得退化为普通圆形节点图。
- 默认只查询并展开当前入口的出站关系，不自动混入无关入站调用者。
- 每条 `RelationBridge` 的起点、终点、解析状态和解析证据都必须可追溯。
- 循环体只建模一次，使用 `LoopRegion` 和回环边表达重复；调用环与递归回连已有展示项。
- 静态循环次数只能是可证明上限、表达式或未知，不得使用“实际执行 N 次”的措辞。
- 分支选择是查看过滤，不是执行轨迹；隐藏分支必须可发现、可恢复。
- `LanguageAdapter` 不向核心泄漏编译器 AST、Electron、React 或编辑器类型。
- MVP 不包含断点、变量值、实时执行跟踪、线程、进程或时间线调试。
- 源码、索引和工作区状态默认只保存在本机；没有独立授权不得上传源码。

需求追踪见 [requirements-mapping.md](requirements-mapping.md)，实施顺序见 [mvp-plan.md](mvp-plan.md)。

## 2. 系统上下文与信任边界

```text
用户
  │ 选择本地目录、入口、查看过滤
  ▼
Electron renderer（不可信 UI 边界）
  │ 仅调用窄化、类型化的 preload API
  ▼
preload / IPC 合同（校验命令、参数、sender、响应）
  │
  ├── Electron main：窗口、原生目录选择、工作区授权、进程生命周期
  │
  └── indexer utility process：文件读取、LanguageAdapter、索引、持久化
        │
        ├── 用户明确授权的本地项目目录
        └── 应用本地 userData（索引、FlowPage、BusinessNode、诊断）
```

渲染进程不直接获得任意文件系统能力，也不接收原始绝对路径。主进程把用户选择的目录转换为短生命周期 `WorkspaceHandle`；后续请求只携带句柄、项目内相对路径和请求 ID。索引进程只允许访问句柄对应的已授权根目录，并拒绝路径逃逸、符号链接逃逸和根目录外解析结果。

## 3. 进程边界

### 3.1 Electron main

职责：

- 应用和窗口生命周期、单实例与崩溃恢复入口。
- 原生目录选择器和工作区授权。
- 创建、监督、重启索引 utility process。
- 定义 IPC allowlist、校验 sender、进行运行时 DTO 校验。
- 提供应用版本、能力和受控文件导航等平台服务。

不得承担：

- TypeScript AST 遍历或大型项目索引。
- 关系展开或布局计算。
- 向 renderer 暴露 `ipcRenderer`、Node.js、Electron 对象或任意路径读取。

### 3.2 preload

preload 只暴露按用例命名的方法，例如 `selectWorkspace()`、`startIndex()`、`cancelIndex()`、`openFlowPage()` 和 `saveFlowPage()`。每个方法对应固定 IPC channel、固定 DTO 和固定错误联合类型。不得暴露通用 `send(channel, payload)`、`invoke`、事件对象或原始回调参数。

### 3.3 indexer utility process

索引是 CPU 密集且可能由解析器崩溃触发故障的组件，应使用 Electron `utilityProcess` 与 main 分离。它拥有：

- 文件系统适配器和工作区根目录防护。
- AdapterRegistry 与每项目 AdapterSession。
- TypeScript `Program`/语言服务或未来其他解析器实例。
- 符号、关系、控制流、来源和诊断的增量索引。
- 本地持久化事务。

utility process 是故障隔离边界，不是对恶意规则包的完整安全沙箱。MVP 仅加载随应用发布且列入 allowlist 的可信规则包；任意第三方代码安装、签名和权限模型不属于首条纵向切片。

### 3.4 renderer

renderer 使用 React 表达应用状态，使用只读代码表面表达源码，使用 SVG overlay 表达桥梁。renderer 只能消费语言无关 DTO，不导入 TypeScript Compiler API，也不得以 UI 状态覆盖领域事实。

## 4. 模块边界

建议采用 npm workspaces；目录名是施工建议而非对当前仓库的实现承诺。

| 模块 | 主要职责 | 允许依赖 | 禁止依赖 |
| --- | --- | --- | --- |
| `packages/model` | ID、范围、SourceFile、FunctionFragment、RelationBridge、LoopRegion、FlowPage、BusinessNode、诊断 DTO | 无平台依赖的 TypeScript | Electron、React、编译器 AST、DOM |
| `packages/adapter-api` | manifest、能力、会话、取消、索引事件、错误合同 | `model` | 具体语言包、UI |
| `packages/adapter-typescript` | tsconfig 检测、正式语法/语义解析、符号与调用解析、控制流事实 | `model`、`adapter-api`、受控 TypeScript API | Electron、React、正则替代解析 |
| `packages/index-core` | 文件清单、增量无效化、关系仓库、出站展开、诊断汇总 | `model`、`adapter-api`、storage port | React、具体编译器 AST |
| `packages/storage` | schema、迁移、事务、原子保存、缓存失效 | `model`、数据库驱动 | UI |
| `packages/flow-projection` | 从入口构造有限 FlowPage 投影、循环/递归回连、查看过滤 | `model`、index query port | 文件系统、具体 adapter |
| `apps/desktop/main` | Electron main、授权、进程监督、IPC handlers | application ports | 解析实现 |
| `apps/desktop/preload` | 窄化 bridge 与运行时校验 | 共享 IPC DTO | Node API 暴露 |
| `apps/desktop/renderer` | React 应用、标准/沉浸视图、抽屉、来源查看 | UI ports、`model` DTO | 文件系统、编译器 API |
| `packages/bridge-renderer` | anchor 测量、路由、SVG 线型、命中测试、几何测试 | DOM/SVG、`model` view DTO | 索引和编译器 |

依赖方向必须从平台/UI 指向端口与领域模型；`model` 和 `adapter-api` 永远不反向依赖 Electron 或 React。

## 5. 领域模型

### 5.1 通用身份、版本和范围

所有持久化 ID 使用带品牌的字符串类型，不使用数组下标或当前行号充当身份。

```ts
type ProjectId = string;
type SourceFileId = string;
type SymbolId = string;
type RelationId = string;
type LoopRegionId = string;

interface TextRange {
  start: number;
  end: number;
}

interface SourceAnchor {
  sourceFileId: SourceFileId;
  revision: string;
  range: TextRange;
}
```

范围统一为 UTF-16 code unit、零基、半开区间 `[start, end)`。TypeScript 与浏览器编辑器都能直接使用该约定。行列仅是从对应 `SourceFile.revision` 的 line map 派生的展示值；不得把一基/零基行列存成第二套事实来源。

`revision` 是内容摘要或等价版本戳。任何使用旧 revision 的 anchor 都必须被标为 `stale` 并重新映射，不能静默落到新文件的相同行号。

### 5.2 SourceFile

```ts
interface SourceFile {
  id: SourceFileId;
  projectId: ProjectId;
  projectRelativePath: string;
  languageId: string;
  revision: string;
  contentHash: string;
  lineStarts: readonly number[];
  indexState: 'pending' | 'indexed' | 'partial' | 'failed' | 'stale';
}
```

源码内容由受权限保护的 source repository 按需提供，不要求在每个 FlowPage 内复制。对 renderer 返回项目相对路径；绝对路径只在受信任进程的 workspace registry 中存在。

### 5.3 FunctionFragment

```ts
interface FunctionFragment {
  id: SymbolId;
  sourceFileId: SourceFileId;
  languageId: string;
  symbolKind: 'function' | 'method' | 'constructor' | 'accessor';
  displayName: string;
  qualifiedName: string;
  fullRange: TextRange;
  definitionRange: TextRange;
  bodyRange?: TextRange;
  provenance: Provenance;
}
```

`definitionRange` 是桥梁目标锚点，通常是名称或声明头的精确范围；`fullRange` 是代码片段范围。稳定 ID 由 adapter 根据项目、模块、符号容器、签名和声明指纹生成。移动或改名后的匹配是显式 relocation 结果，必须保存原 ID、候选 ID、证据和置信度，不能声称绝对稳定。

### 5.4 RelationBridge

```ts
type Resolution =
  | { status: 'resolved'; targetId: SymbolId; targetDefinition: SourceAnchor; certainty: 'exact' | 'probable' }
  | { status: 'ambiguous'; candidates: readonly RelationCandidate[] }
  | { status: 'unresolved'; reason: UnresolvedReason }
  | { status: 'external'; endpoint: ExternalEndpoint };

interface RelationBridge {
  id: RelationId;
  projectId: ProjectId;
  sourceFragmentId: SymbolId;
  callSite: SourceAnchor;
  kind: 'call' | 'construct' | 'import' | 'implementation' | 'inheritance' | 'manual';
  resolution: Resolution;
  branchContext?: BranchContext;
  loopRegionId?: LoopRegionId;
  evidence: readonly ResolutionEvidence[];
  adapter: AdapterProvenance;
}
```

`resolved` 只有一个可导航目标；`ambiguous` 显示候选而不自动选定；`unresolved` 保留调用位置和可恢复原因；`external` 表示已知在本项目之外的端点。UI 不得只用颜色区分这些状态，必须同时使用标签、线型、图标或端点形态。

### 5.5 LoopRegion

```ts
type IterationEstimate =
  | { kind: 'upper-bound'; value: number; proofRange: SourceAnchor }
  | { kind: 'expression'; expression: string; source: SourceAnchor }
  | { kind: 'unknown' };

interface LoopRegion {
  id: LoopRegionId;
  ownerFragmentId: SymbolId;
  kind: 'for' | 'while' | 'do-while' | 'for-of' | 'for-in' | 'control-flow-cycle';
  source: SourceAnchor;
  condition?: SourceAnchor;
  body: SourceAnchor;
  bodyFunctionIds: readonly SymbolId[];
  entryEdgeIds: readonly RelationId[];
  backEdgeIds: readonly RelationId[];
  exitEdges: readonly LoopExitEdge[];
  iterationEstimate: IterationEstimate;
}
```

`LoopExitEdge.reason` 至少区分 `condition-false`、`break`、`return`、`throw` 和 `normal-function-exit`。`continue` 指向更新表达式或下一次条件判断。循环体、嵌套循环和循环中的调用只存一份领域事实；展开视图引用这些事实，不生成 N 份源码。

### 5.6 FlowPage

`FlowPage` 是从索引事实生成、可持久化的阅读投影，不是另一个调用图数据库。

```ts
interface FlowPage {
  id: string;
  projectId: ProjectId;
  entry: { kind: 'function' | 'file' | 'business-node'; id: string };
  projectionRevision: string;
  placements: readonly FlowPlacement[];
  expandedRelations: readonly RelationId[];
  collapsedRegions: readonly string[];
  branchFilter: BranchViewFilter;
  viewport: FlowViewport;
  mode: 'standard' | 'immersive';
  hiddenSummary: HiddenContentSummary;
}
```

`FlowPlacement` 引用 `FunctionFragment` 或 `BusinessNode`，只保存页面位置和展示状态。函数身份与页面 placement 严格分离。投影器维护当前展开路径；遇到递归、调用环或已存在 placement 时创建回连，不复制无限节点。最大深度是防护阈值，不改变关系事实。

`BranchViewFilter` 只影响 `visible | dimmed | collapsed`；它不能删除 RelationBridge，也不能写入任何“executed”字段。`hiddenSummary` 保存隐藏分支数量和恢复入口。

### 5.7 BusinessNode

```ts
interface BusinessNode {
  id: string;
  projectId: ProjectId;
  name: string;
  description?: string;
  members: readonly { fragmentId: SymbolId; order: number }[];
  presentation: { collapsedByDefault: boolean };
  provenance: BusinessNodeProvenance;
}
```

MVP 成员只能是函数，不允许业务节点嵌套。业务节点排序是用户阅读顺序，不推导或改写真实调用顺序。一个函数是否能属于多个业务节点由模型允许、UI 默认允许，并在产品决定相反时通过校验收紧；该行为需要在实现 PR 中明确确认。

### 5.8 Provenance 与诊断

`Provenance` 至少包含来源类型、项目相对路径、revision、精确范围、adapter ID/版本、核心接口版本和生成时间。人工关系还要记录创建者标识和原始解析状态。

```ts
interface Diagnostic {
  id: string;
  code: string;
  severity: 'info' | 'warning' | 'error';
  phase: 'detect' | 'read' | 'parse' | 'bind' | 'resolve' | 'persist' | 'render';
  scope: 'project' | 'adapter' | 'file' | 'symbol' | 'relation';
  recoverability: 'retryable' | 'skipped' | 'requires-user-action' | 'fatal';
  source?: SourceAnchor;
  message: string;
  causeCode?: string;
}
```

消息不得包含不必要的用户绝对路径、源码正文、Token 或环境变量。

## 6. LanguageAdapter 插件边界

Adapter manifest 声明：

- `adapterId`、`adapterVersion`、`coreApiRange`。
- 支持的语言 ID、文件模式、项目清单和配置文件。
- `capabilities`：symbols、semanticReferences、controlFlow、loops、stableIds、incrementalUpdate、externalEndpoints。
- 运行时要求和健康状态。

核心接口分为项目检测、会话和索引事件三层：

1. `detectProject(candidateFiles, signal)` 返回带证据的匹配结果，不读取根目录外文件。
2. `openSession(project, host, signal)` 创建 adapter 私有会话；AST 和 compiler object 留在会话内。
3. `index(changes, emit, signal)` 以 DTO 事件发布 source files、symbols、relations、loops 和 diagnostics。
4. `getSourceFragment(anchor)` 校验 revision 后返回精确文本和上下文。
5. `createStableSymbolId(declaration)` 与 `relocateSymbol(previous, current)` 分开，避免把启发式迁移伪装成稳定 ID。

完整合同、兼容策略与 TypeScript 7 风险见 [ADR-0002](adr/0002-language-adapter-contract.md)。

## 7. 数据流

### 7.1 导入与索引

1. 用户通过 main 的原生选择器授权项目根目录。
2. main 创建 `WorkspaceHandle`，renderer 只收到显示名和句柄。
3. indexer 枚举受支持文件和清单，发布总量不确定的渐进进度。
4. AdapterRegistry 运行检测，返回 matched、available、missing 或 limited。
5. TypeScript adapter 读取 tsconfig，建立正式语法和语义 Program，按文件发出索引事件。
6. index-core 在文件级事务中写入 SourceFile、FunctionFragment、RelationBridge、LoopRegion 和 Diagnostic。
7. 每完成一批文件即提交可查询快照；单文件失败标为 partial/failed，不回滚整个项目。
8. renderer 可在全量完成前搜索已提交符号；状态明确标注“索引中”。

### 7.2 从入口向外展开

1. 用户选择入口 `SymbolId`。
2. flow-projection 读取入口片段及其 outgoing relations。
3. 仅对 `resolved` 关系自动提供展开；ambiguous/unresolved/external 保留端点状态。
4. 用户展开关系后，再查询目标片段的 outgoing relations。
5. 当前路径包含目标、目标属于当前 LoopRegion 或超过最大深度时，生成 back-link/cycle marker，停止新 placement。
6. inbound relation 可以存在索引中供“查找引用”等显式功能使用，但不进入默认投影查询。

必须为“默认展开不读取 inbound relation”建立领域测试，不能只依赖 UI 隐藏。

### 7.3 文件变化

1. 文件 watcher 合并短时间内的事件并计算 revision。
2. index-core 根据依赖表标记该文件的符号、出站关系以及受其导出影响的解析结果为 stale。
3. adapter 使用增量会话重建受影响部分；新结果在事务内替换旧 revision。
4. FlowPage 保留位置，但带旧 anchor 的 placement 标记 stale；成功 relocation 后显式更新。
5. relocation 不确定时保留原 placement 和诊断，要求用户选择，不静默跳转。

## 8. 持久化

推荐在 Electron `userData` 下使用每项目 SQLite 数据库，并通过 `StoragePort` 隔离驱动。仓库内默认不写入用户配置，后续可提供显式导出/导入以支持团队共享。

数据分三类：

- 可重建缓存：SourceFile fingerprint、symbols、relations、loops、adapter diagnostics。
- 用户资产：FlowPage、BusinessNode、人工关系、查看状态。
- 注册信息：workspace handle 元数据、schema 版本、adapter 版本和最后成功索引 revision。

约束：

- 用户资产和可重建缓存使用不同表/事务策略；清缓存不得删除用户资产。
- 所有 schema 迁移有前向版本号、备份和回滚失败诊断。
- 保存 FlowPage/BusinessNode 使用事务；JSON 导出使用临时文件加原子 rename。
- 数据库只保存项目相对路径；授权根目录单独保存在受信任 workspace registry。
- 启动时检测未完成事务、adapter 版本变化和内容 fingerprint，优先恢复最后成功快照再增量刷新。
- SQLite 驱动必须藏在 StoragePort 后。若采用原生 Node 扩展，Electron ABI 重建和打包需要 CI smoke test；在验证前不得让领域模块直接依赖具体驱动。

替代方案：单一 JSON 文件实现简单但不适合增量关系查询和事务；IndexedDB 把索引所有权错误地放到 renderer；把配置默认写入项目仓库会制造未授权修改并泄露本地状态。

## 9. 错误处理与恢复

| 故障 | 行为 | 用户可恢复性 |
| --- | --- | --- |
| 无法读取单文件 | 记录 file diagnostic，继续其他文件，保留最后成功版本为 stale | 修复权限或重试 |
| tsconfig 无效 | adapter limited/failed，展示诊断，不创建虚假语义关系 | 选择其他配置或修复文件 |
| 单条调用无法解析 | 保存 unresolved relation 和 call-site anchor | 查看原因、未来人工关联 |
| 多个候选目标 | 保存 ambiguous candidates 和证据，不自动选定 | 用户显式选择/确认 |
| adapter 抛出异常 | 回滚当前文件事务，标记 adapter degraded；达到阈值后重启 utility process | 重试或禁用规则包 |
| indexer utility process 崩溃 | main 保持 UI，展示最后快照和重启操作 | 自动一次、之后手动重试 |
| 范围 revision 漂移 | 阻止跳转，尝试 relocation，失败则提示 stale | 重新索引或用户选择 |
| FlowPage 保存失败 | 保留内存脏状态并重试，不覆盖最后成功版本 | 重试/导出 |

取消使用 `AbortSignal` 等价 token 从 renderer 传到 indexer；取消是正常终止状态，不记录为错误。每个长任务携带 request ID，迟到响应不得覆盖较新的项目或页面状态。

## 10. UI 与桥梁坐标模型

源码表面使用 CodeMirror 6 的只读实例，直接使用其 UTF-16 position 与 decoration API；不引入 React wrapper，以便控制实例生命周期和测量。CodeMirror 官方开发仓库在 2026 年迁移至自托管 Forgejo，GitHub archive 不代表停止维护，但增加单维护者与供应链跟踪风险，必须精确锁版本并保留替换适配层。

代码块和 SVG overlay 位于同一 `FlowCanvas` 世界坐标系。每个可连接范围注册 `AnchorHandle`：

- `{sourceFileId, revision, range, sidePreference}` 是语义身份。
- 可见 DOM rect 是瞬时测量值，不进入持久化。
- `ResizeObserver`、scroll/zoom state 和 requestAnimationFrame 批处理触发重算。
- 先把 `getBoundingClientRect()` 的 viewport 坐标转换为 FlowCanvas 世界坐标，再计算 SVG path。
- 虚拟化导致端点未挂载时，显示带标签的边缘 stub/隐藏数量，而不是连接到猜测位置。

SVG 是 MVP 的桥梁渲染方案：每条 path 保留 DOM 身份，便于 pointer/keyboard 交互、标签、线型、ARIA 描述和几何测试。Canvas 在可见关系规模经基准证明 SVG 不足时才进入后续 ADR；即使采用 Canvas，也必须保留可访问的语义列表。

详见 [ADR-0003](adr/0003-flow-rendering-model.md)。

## 11. 安全与隐私施工约束

- `nodeIntegration: false`、`contextIsolation: true`、renderer sandbox、严格 CSP。
- renderer 只加载随应用打包的本地内容；禁止把源码送入远端语法高亮、遥测或错误上报。
- 校验每条 IPC 的 sender、channel、参数、返回值和工作区句柄。
- 禁止通用 shell/路径打开接口；外部链接使用固定 `https` allowlist。
- 文件访问前规范化路径并确认仍在授权根目录内；明确处理符号链接和大小写。
- 日志默认只写项目相对路径、错误码和摘要；源码片段需显式 debug opt-in 且不得进入发布日志。
- MVP 语言规则包是可信内置代码；“可安装”首先表示 manifest/版本/能力可替换，不等于允许任意远程代码执行。
- 依赖必须锁定在 `package-lock.json`，记录许可证并由 CI 执行依赖和打包检查。

## 12. 测试边界

最低测试金字塔：

- `model`：范围、解析联合类型、LoopRegion、FlowPage 序列化和 schema migration。
- `adapter-contract`：所有 adapter 运行同一套合约测试；测试 adapter 证明核心与 TypeScript 解耦。
- TypeScript fixtures：跨文件 import、重载/别名、方法调用、动态调用、循环、break/continue/return/throw、递归、语法错误。
- index/projection：出站-only、不无限展开、partial index、取消、过期响应、增量无效化。
- bridge geometry：滚动、缩放、容器 resize、端点卸载、RTL/长行、不同 DPI。
- component：关系状态不只靠颜色、隐藏分支可恢复、模式状态共享、键盘抽屉。
- Electron smoke：选择 fixture、索引、打开 createOrder 流程、来源往返、重启恢复。

CI 必须运行 `npm ci`、lint、strict typecheck、unit/component tests、build；实施到 Electron smoke 后加入打包或启动 smoke。不得以 `any`、关闭 strict 或 snapshot-only 测试掩盖合同错误。

## 13. 关键风险

1. **TypeScript 7 API 过渡。** TypeScript 7.0 CLI 已发布，但官方说明 7.0 不带 API；MVP 必须使用官方 `@typescript/typescript6` 兼容包并锁定版本，等待 7.1 API 后另立迁移 ADR。
2. **精确锚点与虚拟化冲突。** CodeMirror 只渲染可见区域；未挂载范围不能用猜测坐标连接。桥梁适配层和 stub 状态必须先于大规模优化建立。
3. **稳定符号身份被高估。** 移动/改名只能启发式重新匹配；revision 和 relocation 证据必须持久化。
4. **第三方 adapter 执行风险。** utility process 提供故障隔离但不是完整沙箱；MVP 不开放任意安装源。
5. **Electron Forge Vite 插件仍标记 experimental。** 需要精确锁版本、构建 smoke 和受控升级，不能依赖私有插件行为。
6. **原生 SQLite 驱动打包。** Electron ABI、跨平台预构建和签名可能增加 CI 成本；必须保持 StoragePort 可替换。
7. **关系密度和视觉噪声。** 通过当前关系高亮、来源折叠、边缘 stub、标签与线型处理，不能通过删除或隐藏不确定性“优化”。
8. **静态事实被误读为运行事实。** 模型命名、UI 文案和测试中禁止 `executedPath`、`actualIterationCount` 等字段进入 MVP。

## 14. 上游证据（核验于 2026-09-01）

- Electron 多进程与 utility process：[Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)。
- Electron IPC 与安全：[IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)、[Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)、[Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security)。
- TypeScript Compiler API 的 `Program`、`CompilerHost`、`SourceFile`：[Using the Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)。该 Wiki 自身声明 API 可能变化。
- TypeScript 7 API 现状：[Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)。官方明确说明 7.0 不带 API，并提供 `@typescript/typescript6` 兼容包。
- Tree-sitter 能力边界：[Tree-sitter Introduction](https://tree-sitter.github.io/tree-sitter/)。它提供增量 concrete syntax tree，不等价于 TypeScript 的语义符号解析。
- CodeMirror 虚拟化与 UTF-16 offset：[CodeMirror Reference](https://codemirror.net/docs/ref/)；维护迁移见 [CodeMirror migration announcement](https://discuss.codemirror.net/t/codemirrors-migration-to-forgejo/9706)。
- SVG/Canvas 与测量：[SVG](https://developer.mozilla.org/en-US/docs/Web/SVG)、[Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)、[ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/Resize_Observer_API)、[getBoundingClientRect](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect)。
