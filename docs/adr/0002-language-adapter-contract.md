# ADR-0002：LanguageAdapter 合同与插件边界

- 状态：提议
- 日期：2026-09-01
- 关联：[Issue #1](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/1)、[#2](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/2)、[#4](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/4)、[#5](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/5)、[#13](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/13)

## 背景

核心产品需要统一处理 SourceFile、FunctionFragment、RelationBridge、LoopRegion、FlowPage 与 Provenance，同时让 TypeScript、JavaScript、C/C++ 等语言以不同解析能力接入。首个正式 adapter 必须用 TypeScript Compiler API 完成跨文件语义解析，不能用正则或只有语法树的实现冒充精确目标解析。

规则包还处在版本、故障和权限边界上：单文件失败不能破坏全项目，旧规则包不能加载到不兼容核心，第三方 adapter 不能在 renderer 中获得 Electron 权限。

## 决策

定义一个版本化、会话式、事件输出的 `LanguageAdapter` 合同：

- `adapter-api` 与具体编译器、Electron、React、DOM、数据库驱动解耦。
- adapter 运行在 indexer utility process，MVP 只允许可信、随应用发布并在 allowlist 中的 adapter。
- adapter 私有 AST、Program、TypeChecker、Tree-sitter tree 或 native handle 永不跨合同边界。
- 跨边界数据只使用可结构化克隆、可持久化、可运行时校验的 DTO。
- 项目检测与项目会话分开；同一项目会话负责增量状态和 compiler 生命周期。
- adapter 以批次事件输出索引事实，index-core 负责事务、一致性和查询。
- 解析状态使用判别联合类型；ambiguous/unresolved/external 不是异常，也不能降格为 `undefined`。
- SemVer 管理 adapter 版本，独立整数版本管理持久化 DTO schema；二者不可混用。

## 合同形状

以下是语义草案，实施可调整命名，但不得削弱边界。

```ts
interface LanguageAdapterManifest {
  adapterId: string;
  adapterVersion: string;
  coreApiRange: string;
  dtoSchemaVersion: number;
  languages: readonly LanguageDescriptor[];
  detection: DetectionDescriptor;
  capabilities: AdapterCapabilities;
  runtime: {
    kind: 'bundled-node';
    entrypoint: string;
  };
}

interface AdapterCapabilities {
  symbols: 'none' | 'syntax' | 'semantic';
  references: 'none' | 'syntax' | 'semantic';
  controlFlow: boolean;
  loops: boolean;
  stableIds: 'declaration' | 'relocatable';
  incrementalUpdate: boolean;
  externalEndpoints: boolean;
}

interface LanguageAdapter {
  readonly manifest: LanguageAdapterManifest;
  detectProject(request: DetectProjectRequest, context: AdapterCallContext): Promise<DetectionResult>;
  openSession(request: OpenSessionRequest, host: AdapterHost): Promise<AdapterSession>;
}

interface AdapterSession {
  index(request: IndexRequest, sink: IndexEventSink, context: AdapterCallContext): Promise<IndexSummary>;
  getSourceFragment(request: SourceFragmentRequest, context: AdapterCallContext): Promise<SourceFragmentResult>;
  relocateSymbols(request: RelocateRequest, context: AdapterCallContext): Promise<RelocationResult>;
  dispose(): Promise<void>;
}
```

PRD 中的能力名称与本合同的对应关系如下。合同选择批次事件而不是让核心逐个操纵 parser handle，但没有省略任何能力：

| PRD 能力 | 合同落点 | 输出证据 |
| --- | --- | --- |
| `detectProject` | `LanguageAdapter.detectProject` | detection status、configuration、evidence |
| `parseFile` | `AdapterSession.index` 的 parse 阶段 | file/revision、parse diagnostics；AST 留在 session |
| `extractSymbols` | `symbols` IndexEvent | FunctionFragment DTO、stable ID、ranges、provenance |
| `extractReferences` | `relations` IndexEvent 的 call-site 部分 | reference kind、call-site、branch/loop context |
| `resolveReference` | 同一 `relations` event 的 resolution 部分 | resolved/ambiguous/unresolved/external、candidates、evidence |
| `getSourceFragment` | `AdapterSession.getSourceFragment` | revision-checked source range/context |
| `createStableSymbolId` | adapter 私有 phase，结果进入 symbol DTO | ID recipe version、declaration fingerprint；迁移由 `relocateSymbols` 表达 |

实现者可以在具体 adapter 内把这些 phase 定义为独立纯函数并分别测试；核心只依赖最终事件合同，避免跨插件传递 AST handle 和产生 phase 顺序耦合。

### AdapterHost

`AdapterHost` 是 adapter 唯一的外部能力来源：

- `listFiles(globs)`：只返回授权工作区内的项目相对路径。
- `readFile(relativePath, expectedRevision?)`：读取并返回内容/revision；拒绝路径逃逸。
- `stat(relativePath)`：受控元数据。
- `resolveProjectPath(relativePath)`：只返回 opaque handle，不返回给 renderer。
- `reportProgress(event)`：批次进度。
- `now()`/`hash()`：由 host 提供以支持确定性测试。

adapter 不直接读取任意环境变量、用户主目录、网络或 renderer。具体 TypeScript API 需要文件系统时，由受控 CompilerHost/LanguageServiceHost 适配 `AdapterHost`。

### 项目检测

```ts
type DetectionResult =
  | { status: 'matched'; confidence: 'exact' | 'probable'; evidence: readonly DetectionEvidence[]; configurations: readonly ProjectConfiguration[] }
  | { status: 'not-matched'; evidence: readonly DetectionEvidence[] }
  | { status: 'limited'; reason: string; evidence: readonly DetectionEvidence[] }
  | { status: 'failed'; diagnostic: AdapterDiagnostic };
```

检测只根据扩展名、清单和配置等证据报告能力，不因为看到一个 `.ts` 文件就承诺完整项目语义。多个 tsconfig 时返回 configurations，由上层选择或展示。

### 索引事件

```ts
type IndexEvent =
  | { type: 'file'; file: SourceFileDto }
  | { type: 'symbols'; fileId: string; revision: string; symbols: readonly FunctionFragmentDto[] }
  | { type: 'relations'; fileId: string; revision: string; relations: readonly RelationBridgeDto[] }
  | { type: 'loops'; fileId: string; revision: string; loops: readonly LoopRegionDto[] }
  | { type: 'diagnostics'; diagnostics: readonly AdapterDiagnostic[] }
  | { type: 'progress'; progress: IndexProgress };
```

每个事实批次都带 file/revision。index-core 只在同一文件批次验证通过后提交事务。adapter 不返回一个巨大的全项目对象，避免内存峰值和“最后一刻才可用”。

### 精确范围

- 所有范围为零基 UTF-16 code unit 的半开区间。
- call-site 是完整可交互调用表达式或被调用名称的精确范围；adapter 必须声明其 anchor granularity。
- target definition 是目标声明名称/头的精确范围，full fragment 是完整函数/方法范围。
- range 必须引用产生它的 SourceFile revision。
- 行列从 line map 派生，不允许 adapter 用一基行列代替 offset。

### 关系解析

```ts
type ReferenceResolutionDto =
  | {
      status: 'resolved';
      targetSymbolId: string;
      targetDefinition: SourceAnchorDto;
      certainty: 'exact' | 'probable';
      evidence: readonly ResolutionEvidenceDto[];
    }
  | {
      status: 'ambiguous';
      candidates: readonly ReferenceCandidateDto[];
      reason: string;
    }
  | {
      status: 'unresolved';
      reason: 'dynamic-dispatch' | 'missing-file' | 'unsupported-syntax' | 'incomplete-project' | 'adapter-error' | 'unknown';
      detail?: string;
    }
  | {
      status: 'external';
      endpoint: ExternalEndpointDto;
    };
```

`certainty` 只在 resolved 目标内表达证据强度。不得用一个浮点 confidence 把多个候选压成伪精确目标。人工确认生成新的 `manual` RelationBridge，并保留原始 adapter resolution；不得覆写历史事实。

### 稳定 ID 与迁移

`createStableSymbolId` 只保证在相同项目、相同声明身份和相同 adapter 规则内可重复。推荐输入：

- project logical ID 与 language ID。
- normalized module path。
- symbol kind、qualified container/name、可区分重载的签名摘要。
- declaration fingerprint（去除无关 trivia 后的局部结构摘要）。

文件移动、容器变化或改名不可能无条件稳定。`relocateSymbols()` 返回：

```ts
type RelocationResult =
  | { status: 'matched'; previousId: string; currentId: string; certainty: 'exact' | 'probable'; evidence: readonly string[] }
  | { status: 'ambiguous'; previousId: string; candidates: readonly string[] }
  | { status: 'missing'; previousId: string };
```

上层显式更新 FlowPage/BusinessNode 引用并保留 migration log；不得仅按行号自动重连。

## TypeScript adapter 的正式解析策略

### 版本

截至 2026-09-01，TypeScript 7.0 官方发布说明明确表示 7.0 不提供 API，7.1 将提供新的、不同的 API。MVP adapter 因此使用官方 `@typescript/typescript6` 的固定补丁版本，并在 manifest 中声明实际 compiler API 版本。

### 公开 API 边界

adapter 可以使用公开的：

- config 读取与解析 API。
- `Program`、增量 builder 或 LanguageService 及其公开 host。
- `SourceFile`、公开 AST type guards、`TypeChecker`、`Symbol` 与 alias resolution。
- 公开的 position/line map 与 diagnostics API。

adapter 不得：

- 导入 `typescript/lib/tsserverlibrary` 私有实现路径或未导出内部模块。
- 修改 `ts` 对象、依赖内部 flags/links、保存 AST 到核心数据库。
- 用正则从源码提取函数或调用来替代 AST/TypeChecker。
- 因为 `checker.getSymbolAtLocation()` 返回空就丢弃调用；必须保存 unresolved relation。

### 解析步骤

1. 从用户选择/检测得到的 tsconfig 建立 Program，会话保存 compiler state。
2. 以公开 AST type guards 提取函数、方法、构造器和 accessor。
3. 对 CallExpression/NewExpression 等正式语法节点提取 call-site。
4. 用 TypeChecker 解析 symbol，跟随 alias，定位 declarations。
5. 只把项目内、可确定 declaration 转成 resolved target；多个声明按语言语义归并或报告 ambiguous。
6. 动态 property access、`any`、运行时容器、缺失声明和外部包按证据映射到 ambiguous/unresolved/external。
7. LoopRegion 从正式 AST 和可获得的控制流事实构造；不能用文本搜索 `for`/`while`。
8. compiler diagnostics 与 adapter diagnostics 分开保存，单文件错误不取消其他文件。

### TypeScript 7.1 迁移门

迁移只允许在以下条件满足后立独立 ADR：

- 新 API 已正式发布且官方文档覆盖 Program/SourceFile/symbol/reference 能力。
- 当前 fixture contract suite 在新 adapter 实现下通过。
- range、symbol ID、resolution 和 diagnostic DTO 不发生无计划漂移。
- migration 可以并行安装或回退到 TypeScript 6 adapter。

## Tree-sitter 的适用边界

Tree-sitter 官方定位是 parser generator 与 incremental parsing library，产出 concrete syntax tree，并能在编辑时增量更新。它适合：

- 没有官方语义 API 的语言的容错语法提取。
- 语法高亮、函数/循环语法范围和局部结构。
- 作为 C/C++ adapter 的语法层，再叠加 clangd/LibTooling 或索引数据。

它单独不保证：

- 跨文件 module/import resolution。
- 类型驱动的方法分派、重载和 alias resolution。
- 构建系统、条件编译、宏或项目配置的完整语义。

因此任何 Tree-sitter adapter 必须在 manifest 中按实际能力声明 `syntax` 或 `semantic`，不能让 UI 把语法候选显示成已解析目标。

## 版本兼容

加载步骤：

1. 读取 manifest，不执行 adapter 入口。
2. 校验 JSON schema、adapter ID allowlist、文件完整性和许可证记录。
3. 检查 `coreApiRange` 是否包含当前核心版本。
4. 检查 DTO schema 是否有已注册 decoder/migration。
5. 仅在 indexer utility process 加载入口，执行 health check。
6. 能力缺失或版本不兼容时报告 `limited`/`incompatible`，应用继续运行。

核心 API 遵循 SemVer：

- patch：不改变合同语义。
- minor：只增加可选能力/字段，旧 adapter 继续工作。
- major：可破坏合同，必须并行 adapter compatibility test 和 migration note。

持久化 DTO 使用独立 `dtoSchemaVersion`；schema 迁移由核心 storage 层执行，不要求旧 adapter 代码存在。

## 故障与取消

- 每次 detect/index/source/relocate 调用有 request ID、deadline 和 cancellation token。
- adapter 抛出的未知错误转换成结构化 diagnostic，原始 stack 只写本地 debug log。
- 文件级异常回滚该文件批次，其他批次继续。
- adapter 连续崩溃使 health 变为 degraded；main 可重启 utility process，但不无限重启。
- 取消返回 `cancelled` summary，不记为失败，不提交未完成批次。
- 旧请求结果带 generation；index-core 拒绝晚于取消、早于当前 generation 的结果。

## 安全边界

MVP 的“可安装规则包”意味着接口、manifest、版本和能力可插拔，不意味着开放网络市场或执行任意本地包。首版约束：

- 仅加载产品发布时打包、校验过的 adapter。
- adapter 无 renderer/Electron API，无网络能力，无任意工作区外文件能力。
- utility process 提供故障隔离但不是恶意代码安全沙箱；不能用它为不受信任插件背书。
- 后续若支持第三方 adapter，必须单独设计签名、来源、权限、更新、撤销和更强隔离，不由本 ADR 暗中授权。

## 替代方案

### 核心直接依赖 TypeScript Compiler API

实现最少，但核心模型、索引和 UI 会绑定 TypeScript AST/版本；TypeScript 7 API 变化将扩散全系统，也无法证明语言无关性。否决。

### 每个纯函数式 adapter 一次性解析文件

接口简单，但丢失 Program/LanguageService 的项目语义和增量状态；跨文件解析会反复重建。否决，采用项目会话。

### adapter 直接写数据库

吞吐可能较高，但 schema、事务和权限散落到插件，无法保证核心一致性。否决，adapter 发事件，index-core 提交。

### 通过通用 RPC 加载任意 npm 插件

扩展快，但没有签名、权限和供应链模型，超出本地源码产品的风险预算。MVP 延期。

### Tree-sitter 统一所有语言

统一语法层有吸引力，但无法单独满足 TypeScript 精确语义关系。否决为统一 resolver；保留为 adapter 内部工具。

### LSP 作为唯一合同

LSP 有符号/定义等通用能力，但不同 server 的调用层级、控制流、LoopRegion 和精确证据质量不一致，且 server 生命周期/安装是额外问题。未来可做 LSP-backed adapter，但不把 LSP 类型暴露为核心模型。

## 后果

正面：

- TypeScript 7.1 或其他解析器变化限制在 adapter 内。
- 核心可用测试 adapter 验证语言无关性。
- partial index、取消、版本不兼容和不确定关系都有一等状态。
- AST 不跨进程/持久化，减少内存和兼容耦合。

负面：

- DTO、runtime validation、事件批次和 contract tests 增加初期工程量。
- AdapterHost 需要适配复杂 CompilerHost 行为。
- 第三方插件安装被明确延期，概念图中的“添加规则包”首版只能展示受控内置能力。

## 施工约束与验收

- `adapter-api` 的 public types 不出现 `ts.*`、Tree-sitter、Electron、React、DOM 或数据库类型。
- 测试 adapter 与 TypeScript adapter 都运行同一 contract suite。
- fixture 至少覆盖跨文件 import、alias、方法、构造调用、external、ambiguous、unresolved、循环、递归和语法错误。
- 对每条 RelationBridge 验证 call-site revision/range、target definition 或不确定状态、adapter provenance。
- `rg` 检查产品代码不存在用正则提取 TypeScript 函数/调用的实现；允许正则用于项目文件过滤等非解析用途。
- TypeScript API 版本固定在 lockfile，并在 adapter health/detail 中可见。

## 来源

- [TypeScript: Using the Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [TypeScript: API Breaking Changes](https://github.com/microsoft/TypeScript/wiki/API-Breaking-Changes)
- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [TypeScript 7 native repository](https://github.com/microsoft/typescript-go)
- [Tree-sitter Introduction](https://tree-sitter.github.io/tree-sitter/)
- [Tree-sitter Basic Parsing](https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html)
- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
