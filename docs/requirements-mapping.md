# 需求映射与领域追踪

状态：MVP 0.1 实现追踪（PR #16）

依据：产品需求文档 v0.1（2026-08-31）、MVP 0.1 Milestone、Issues #1-#14

更新：2026-09-01

## 1. 映射规则

- “领域落点”表示需求首先约束的事实模型，不等同于唯一实现模块。
- “主 Issue”是交付该需求的主要工作项；“协作 Issue”提供必要前置或验收覆盖。
- P0/P1 取自 PRD。首条可运行纵向切片就是完整 MVP 0.1，必须在同一 builder PR/Milestone 内覆盖全部 14 个 Issue。A/B/C/D 只表示内部增量验收批次，不能作为可排除的后续产品切片，见 [mvp-plan.md](mvp-plan.md)。
- 需求状态为“已映射”不表示已经实现；当前仓库仍处于文档和启动阶段。

## 2. 产品概念到领域模型

| 产品概念 | 领域模型 | 必须保存的事实 | 明确不承载 |
| --- | --- | --- | --- |
| 源码文件 | `SourceFile` | project-relative path、language、content revision、line map、index state | UI 布局、用户绝对路径 |
| 函数/方法片段 | `FunctionFragment` | stable symbol identity、full/definition/body range、source provenance | 运行调用实例、页面坐标 |
| 来源桥梁 | `RelationBridge` | call-site anchor、target definition/candidates、kind、resolution、evidence、adapter provenance | 只靠颜色的状态、猜测目标 |
| 流程页 | `FlowPage` + `FlowPlacement` | entry、有限出站投影、布局、展开、过滤、viewport、mode | 全局调用图、源代码副本 |
| 业务节点 | `BusinessNode` | 名称、描述、ordered function members、definition provenance | 源码改写、真实调用顺序、MVP 嵌套 |
| 循环区域 | `LoopRegion` | source/condition/body、entry/back/exit edges、control exits、static estimate | 按次数复制的循环体、实际次数 |
| 来源 | `Provenance` | adapter/core versions、revision、project-relative path、range、生成来源 | 不可解释的布尔“可信”标志 |
| 语言规则包 | `LanguageAdapterManifest` + `AdapterSession` | detection evidence、capabilities、API compatibility、health、diagnostics | React/Electron 类型、跨 adapter AST |
| 静态分支查看 | `BranchContext` + `BranchViewFilter` | 条件事实、visible/dimmed/collapsed、hidden summary | executed/not-executed 事实 |
| 未来运行实例 | 未来 `ExecutionEvent` | 暂不实现；仅保留与 `SymbolId`/`RelationId` 对接空间 | 不得提前混入静态模型 |

## 3. 功能需求映射

| ID | 优先级 | 需求与不可变验收 | 领域/模块落点 | GitHub Issues | MVP 安排 |
| --- | --- | --- | --- | --- | --- |
| FR-001 | P0 | 导入本地仓库并建立索引；扫描有状态、可取消、错误可恢复 | workspace authorization、`SourceFile`、index task/diagnostic、storage | [#3](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/3)、[#4](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/4)、[#12](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/12) | 批次 A；完整纵向切片必须含目录选择、fixture 扫描、进度/取消/单文件失败 |
| FR-002 | P0 | 自动检测语言并加载规则包；缺失或受限不崩溃 | AdapterRegistry、manifest、capability/health、diagnostic | [#2](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/2)、[#3](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/3)、[#5](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/5) | 批次 A；内置 TypeScript adapter 与完整状态是最终 DoD 必选 |
| FR-003 | P0 | 函数/方法为最小节点；有稳定 ID、文件与精确范围 | `FunctionFragment`、`SourceAnchor`、adapter symbol extraction | [#1](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/1)、[#5](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/5) | 批次 A；最终 DoD 必选 |
| FR-004 | P0 | 从入口沿向外引用逐层展开；不得自动加入无关入站调用者 | outgoing relation query、flow-projection path/cycle guard | [#4](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/4) | 批次 A；领域测试证明不查询 inbound，最终 DoD 必选 |
| FR-005 | P0 | 可见桥梁精确连接调用范围与目标定义范围 | `RelationBridge`、AnchorRegistry、SVG overlay | [#1](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/1)、[#6](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/6) | 批次 A，B/C 增加控制流与模式切换几何回归；最终 DoD 必选 |
| FR-006 | P0 | 从片段查看原文件并返回原流程位置 | provenance repository、source viewer、navigation snapshot | [#7](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/7)、[#8](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/8) | 批次 A 建立往返，批次 C 验证沉浸式复用；全部属于同一纵向切片 |
| FR-007 | P0 | 标准/沉浸视图共享布局、展开、筛选与滚动状态 | 单一 `FlowPage` store、两个 view projection | [#7](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/7)、[#11](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/11) | 批次 A+C；两种视图都完成才满足最终 DoD |
| FR-008 | P0 | 沉浸式项目目录是覆盖画布的竖向抽屉；Ctrl+Space/Esc/图钉 | drawer state、focus trap、keyboard commands | [#10](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/10)、[#11](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/11) | 批次 C；同一纵向切片最终 DoD 必选 |
| FR-009 | P0 | 静态分支查看过滤；隐藏分支不删除、有数量提示、可恢复 | `BranchContext`、`BranchViewFilter`、hidden summary | [#9](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/9) | 批次 B；同一纵向切片最终 DoD 必选，文案禁止暗示执行 |
| FR-010 | P0 | LoopRegion；循环体一次；entry/back/exit 与 break/continue/return/throw；递归不无限；次数非真实 | `LoopRegion`、control-flow edges、path guard、static estimate union | [#13](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/13)、[#5](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/5)、[#4](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/4) | 批次 B；fixture、领域模型、UI 与测试均在同一纵向切片完成 |
| FR-011 | P1 | 多选函数创建、命名、描述、排序、折叠/展开业务节点 | `BusinessNode`、business-node service、UI | [#14](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/14) | 批次 D；同一纵向切片最终 DoD 必选，MVP 禁止嵌套 |
| FR-012 | P1 | 业务节点自身与成员来源完整 | `BusinessNodeProvenance`、member fragment provenance | [#14](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/14)、[#1](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/1) | 批次 D；同一纵向切片最终 DoD 必选 |
| FR-013 | P1 | 搜索文件、函数、方法、业务节点；进入新页或加入现有页 | symbol/business search index、drawer/standard navigation | [#4](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/4)、[#10](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/10)、[#14](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/14) | 批次 A/C/D 逐步接通；完整搜索范围在最终 DoD 前全部完成 |
| FR-014 | P1 | 保存/恢复 FlowPage 位置、缩放、展开、折叠与分支过滤 | `FlowPage` serialization、storage transaction、startup recovery | [#1](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/1)、[#7](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/7)、[#9](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/9)、[#11](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/11)、[#14](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/14) | A-D 共用同一 schema；最终一次恢复标准/沉浸、筛选、循环展示与 BusinessNode |
| FR-015 | P1 | 明确区分 resolved、ambiguous、unresolved；不把不确定关系伪装为确定 | `Resolution` discriminated union、bridge visuals、diagnostics | [#1](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/1)、[#4](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/4)、[#5](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/5)、[#6](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/6) | 批次 A；resolved/ambiguous/unresolved fixture 与 UI 同期完成，最终 DoD 必选 |

## 4. 非功能需求映射

| ID | 要求 | 架构决策与可验证证据 | GitHub Issues |
| --- | --- | --- | --- |
| NFR-001 | 本地优先，未授权不上传源码 | Electron 本地内容；workspace handle；索引/用户资产保存在 userData；无网络 adapter/遥测；安全测试验证 renderer 无任意 FS/API | [#3](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/3)、[#4](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/4)、[#12](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/12) |
| NFR-002 | 新语言不修改核心页面模型 | `model`/`adapter-api` 无具体编译器类型；测试 adapter 运行同一 contract suite | [#1](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/1)、[#2](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/2)、[#5](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/5) |
| NFR-003 | 每条关系可追溯到规则包、位置和解析结果 | `RelationBridge.evidence`、call-site/target revision、adapter provenance；来源 inspector | [#1](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/1)、[#2](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/2)、[#5](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/5)、[#6](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/6) |
| NFR-004 | 渐进响应、进度、取消、部分可浏览 | batch commit、task event、cancellation token、partial snapshot；集成测试取消与迟到响应 | [#4](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/4)、[#3](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/3) |
| NFR-005 | 文件变化只重建受影响关系 | 目标架构仍为 file fingerprint、dependency invalidation 与 incremental session；MVP adapter 当前诚实声明 `incrementalUpdate=false`，使用受控全量重建，不把它伪装为增量。后续启用前必须补依赖失效测试 | [#4](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/4)、[#5](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/5) |
| NFR-006 | 单文件/规则包失败不破坏全部索引 | utility process、文件级事务、last-good snapshot、structured diagnostics、contract failure tests | [#2](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/2)、[#4](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/4)、[#5](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/5) |
| NFR-007 | 核心操作支持键盘 | command registry、可见 focus、drawer focus trap、桥梁/来源详情的键盘等价操作 | [#7](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/7)、[#10](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/10)、[#11](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/11) |
| NFR-008 | 颜色不是唯一关系编码 | resolution 对应标签、线型、端点和文本；高对比/无颜色组件测试 | [#6](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/6)、[#7](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/7)、[#9](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/9)、[#11](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/11) |
| NFR-009 | 异常退出后恢复页面与业务节点 | transaction + last-good snapshot、dirty state/retry、startup migration/recovery tests | [#4](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/4)、[#12](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/12)、[#14](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/14) |
| NFR-010 | 规则包声明版本、接口版本和能力状态 | semver manifest、compatibility gate、health/capability UI、adapter matrix tests | [#2](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/2)、[#5](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/5)、[#12](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/12) |

## 5. 概念图到施工验收

| PRD 图 | 施工含义 | 对应 Issue |
| --- | --- | --- |
| 图 1：项目导入与规则匹配 | 导入状态不是单一成功/失败；每个 adapter 显示 matched/available/missing/limited 与能力 | #2、#3、#5 |
| 图 2：标准视图桥梁 | 中央是源码卡片/长页，桥梁落在行内调用范围和目标声明范围，右侧展示关系详情 | #6、#7 |
| 图 3：函数来源 | 片段与原文件是同一 revision 的两个投影；范围漂移是可恢复错误 | #1、#8 |
| 图 4：业务节点 | 成员函数 provenance 与业务节点定义 provenance 同时存在；节点不改源码 | #14 |
| 图 5：分支/循环/递归 | 图中的“循环 12 次”只能解释为可证明的静态上限；实现不得复制 12 份循环体 | #9、#13 |
| 图 6：规则包能力 | 能力逐项声明并可 degraded；“安装”不等于 MVP 可执行任意第三方代码 | #2、#5 |
| 图 7：沉浸视图 | 中央组合文档与两侧来源长页共享同一 FlowPage；源码占主要视觉面积 | #6、#11 |
| 图 8：抽屉与分支菜单 | 抽屉覆盖而不挤压画布；分支菜单是查看过滤且显示隐藏数量 | #9、#10、#11 |

## 6. Issue 交付依赖

```text
#1 通用模型 ─┬─> #2 Adapter 合同 ─> #5 TypeScript adapter
             ├─> #4 索引/出站展开 ─┬─> #9 分支过滤
             │                     └─> #13 LoopRegion
             └─> #6 精确桥梁 ─> #7 标准视图 ─> #8 来源往返

#3 Electron 外壳 ─> #4/#7 的端到端集成
#7 + #6 ─> #11 沉浸视图 ─> #10 项目抽屉
#1 + #7 + storage ─> #14 业务节点
#12 测试与 CI 横跨所有工作项，并从第一项开始启用
```

顺序含义：实现 PR 不应在模型/合同未合并前自行创造重复 DTO；UI PR 不应伪造与 adapter 不兼容的关系状态；#12 不是最后补测试的收尾 Issue。

## 7. 待产品确认但不阻塞首切片

| 决策 | 当前架构默认 | 变更影响 |
| --- | --- | --- |
| 同一函数是否允许属于多个业务节点 | 允许；成员关系是多对多 | 若禁止，只需业务服务唯一性约束，不改 FunctionFragment |
| 业务节点是否嵌套 | MVP 禁止 | 后续需要 cycle validation 和递归 provenance |
| 业务节点配置是否进仓库 | 默认 userData，本地导出；不自动改仓库 | 若团队共享，新增显式 project-file adapter 与同意流程 |
| 业务节点函数顺序 | 用户显式顺序；可并列显示系统推导关系 | 若改为系统顺序，不能覆盖用户阅读顺序字段 |
| 默认最大展开深度 | 产品值待性能测试；模型支持 per-page 设置 | 不改变关系索引，只影响 projection guard |
| 跨语言调用 | 先表达 `external`/`manual`，不自动跨进程解析 | 后续 adapter/endpoint resolver 扩展 |

## 8. 明确不映射到 MVP 的能力

断点、单步、实时高亮、变量值、真实分支、真实循环次数、异步/线程/进程泳道、时间线、回放和状态快照均不属于 Issues #1-#14 的实现范围。任何实现 PR 若引入 `actualExecution`、`runtimeValue`、`threadId`、`processId` 或等价 UI，需要先创建新的运行阶段 ADR 与 Milestone，不能借用静态字段表达。
