# ADR-0001：桌面应用与前端技术栈

- 状态：已接受（分析 PR #15）
- 日期：2026-09-01
- 决策者：MVP 0.1 架构评审
- 关联：[Issue #3](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/3)、[#5](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/5)、[#6](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/6)、[#7](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/7)、[#12](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/12)

## 背景

产品需要安全读取用户授权的本地项目、运行正式语言分析、呈现多列源码与精确来源桥梁，并在 Windows/macOS/Linux 桌面环境中恢复工作区状态。PRD 和仓库工程规则给出的默认候选是 Electron + React + TypeScript + Vite。更换路线必须有足够收益且记录迁移风险。

截至本 ADR 日期，TypeScript 生态正处于 6.x JavaScript Compiler API 向 7.x Go 实现迁移的特殊阶段；Electron Forge 的官方 Vite 插件仍标记为 experimental；CodeMirror 的官方开发仓库已经从 GitHub 迁到维护者自托管 Forgejo。技术选择必须针对当前事实，而不是沿用旧印象。

## 决策

采用以下组合：

1. Electron 作为桌面运行时和原生能力边界。
2. React 作为 renderer 的视图组合层；领域状态和索引事实不放入 React 组件本地状态。
3. Vite 构建 main、preload 和 renderer；Electron Forge 负责打包，并使用其官方 Vite plugin。
4. npm workspaces 管理多包仓库，提交并严格使用 `package-lock.json`。
5. TypeScript strict mode 覆盖所有包。MVP 的编译器 API 与类型检查基线固定在官方 `@typescript/typescript6` 兼容线；不直接依赖 TypeScript 7.0 的可编程 API，因为 7.0 官方明确没有该 API。
6. TypeScript LanguageAdapter 使用正式 TypeScript Compiler API；Tree-sitter 只作为未来非 TypeScript adapter 的候选语法层，不能替代 TypeScript 符号/类型解析。
7. 源码表面采用 CodeMirror 6 的直接包（不采用 React wrapper），配置为只读、最小扩展；通过自有 `CodeSurface` port 隔离，保留未来换 Monaco 的能力。
8. 调用桥梁采用 React/HTML 源码表面之上的 SVG retained overlay。Canvas 仅作为经性能基准证明必要后的替代渲染后端。
9. 本地持久化使用 SQLite 逻辑模型并封装在 `StoragePort` 后；具体 Node driver 需先通过 Electron ABI/打包 spike 才能锁定。

本 ADR 保留默认技术路线，没有以个人偏好更换为 Tauri、纯 Web 或 IDE 插件。

## 为什么选择 Electron + React + Vite

### Electron

Electron 的 main/preload/renderer/utility process 模型与本产品的权限和负载边界匹配：renderer 专注布局，main 管理原生授权，索引器运行在独立 utility process。官方文档明确建议对需要 fork 的 CPU 密集或易崩溃组件优先使用 utility process。

代价是安装体积、内存和 Chromium/Node 安全更新责任。MVP 接受这些代价，因为它们小于跨平台原生 WebView 差异、Node 编译器桥接和插件运行时重新设计的成本。

### React

页面由项目树、代码表面、来源 inspector、FlowPage 状态和大量可组合交互构成，React 适合声明式视图与组件测试。React 不是领域架构：索引、关系解析、循环和 FlowPage 投影必须位于 renderer 外或纯领域包中。

### Vite 与 Electron Forge

Vite 提供快速开发和明确的多入口构建；Electron Forge 提供官方打包路径。风险是 Forge Vite plugin 官方仍标为 experimental，未来 minor 版本可能包含 breaking changes。

施工约束：

- 精确锁定 Forge 和 plugin 版本，不使用 `^` 浮动升级关键打包依赖。
- main、preload、renderer 使用独立 Vite config，禁止把 Node-only 依赖打进 renderer。
- CI 至少运行 unpackaged build；开始分发安装包后加入 packaged smoke。
- 升级 Forge minor 前先读 release notes，在独立 PR 中升级并运行三进程 smoke。
- 不使用 plugin 私有 API；若实验插件阻塞，回退为显式 Vite build + Forge packaging，而不是更换产品栈。

## TypeScript 版本决策

官方在 [TypeScript 7.0 发布说明](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)中说明：7.0 不提供 API，预计 7.1 提供一个新的、不同的 API，并提供 `@typescript/typescript6` 让工具继续使用 6.0 API。

因此：

- MVP 使用 `@typescript/typescript6` 的固定补丁版本作为 Compiler API 来源和 typecheck 基线。
- `adapter-typescript` 只能调用公开导出 API；不得导入 `typescript/lib` 私有路径或 patch `ts` 对象。
- adapter contract tests 固化我们依赖的最小行为，而不是固化 AST 私有形状。
- capability manifest 明确报告支持的项目语法/配置范围；遇到超出范围的 TypeScript 7 项目显示 `limited`，不能假装完整支持。
- TypeScript 7.1 新 API 可用且文档稳定后，另建迁移 ADR；通过 adapter DTO 保持核心/UI 不变。

这比直接依赖 TypeScript 7 CLI 更保守，但避免 Issue #5 在实现时发现核心 API 根本不存在。

## CodeMirror 与 Monaco 取舍

选择 CodeMirror 6 作为首个 `CodeSurface` 实现，原因是：

- 模块化，可只装只读显示、行号、语法高亮、范围 decoration 所需能力。
- 官方数据模型使用零基 UTF-16 code unit offset，与 TypeScript source position 和本项目 `TextRange` 约定一致。
- 只绘制可视区域，适合长源码；但也意味着 offscreen bridge 必须显示 stub，而不能猜坐标。
- 直接 API 易于注册范围 decoration、测量与生命周期；无需额外 React wrapper。

Monaco 是可信且活跃的 MIT 项目，具备成熟 model/decoration API，也是可接受备选。但它更接近完整 IDE 编辑器，多实例和 worker/资源装载更重；本产品首要任务是多源码表面的阅读和桥梁，不是编辑、补全或语言服务 UI。若 CodeMirror 的范围坐标、可访问性或多实例性能在 spike 中不达标，可在 `CodeSurface` port 后切换 Monaco，不改变领域模型。

CodeMirror 的 GitHub repositories 在 2026-04 被归档是因为项目迁往自托管 Forgejo，而不是官方宣布停止维护。风险仍然存在：单维护者、源代码主站变化、企业安全工具可见性下降。因此必须锁定 npm 包、保存 lockfile、执行 license/integrity 检查，并避免绑定非公开实现。

## SVG 与 Canvas 取舍

选择 SVG 的理由：

- path、label、endpoint 都是可寻址 DOM，可直接处理 pointer/focus 和自动化测试。
- 关系状态可同时通过线型、标记、标签和颜色表达，符合 NFR-008。
- 与 HTML/CodeMirror 共用 CSS transform 和可见性管理较直接。
- 精确桥梁数量在 MVP 尚未证明高到需要 immediate-mode Canvas。

Canvas 适合非常大量且频繁重绘的边，但对象不保留 DOM 身份，命中测试、标签、焦点和无障碍都需要重建；MDN 也明确指出 Canvas 绘制内容不向无障碍工具暴露。若未来切换 Canvas，必须保留可访问关系列表和同一几何 port。

## SQLite 与驱动

SQLite 适合事务、增量关系查询、schema migration 和可重建缓存/用户资产分离。备选 driver `better-sqlite3` 是活跃 MIT 项目，但包含原生模块，会引入 Electron ABI rebuild、跨平台预构建和签名风险。本 ADR 只决定 SQLite 逻辑存储和 `StoragePort`；Issue #3/#4 实施前需要完成 driver spike：

- 在 CI 支持的操作系统安装、开发运行和 packaged app 内读写。
- utility process 可加载，renderer 不可加载。
- schema migration、事务回滚和异常退出恢复测试通过。
- 若失败，首切片可用原子 JSON 实现同一 port，但不得让 JSON 结构泄漏到领域层；在索引规模扩大前重新评审。

## 上游状态与许可证快照

以下状态由官方仓库/API 与官方文档在 2026-09-01 核验。`pushed` 仅证明近期活动，不等同于质量背书。

| 技术 | 许可证 | 当前维护证据 | 适用范围与结论 | 来源 |
| --- | --- | --- | --- | --- |
| Electron | MIT | `electron/electron` 未归档，2026-08-31 有 push，最新 release v44.1.0 | 桌面 runtime、main/preload/renderer/utility process；采用 | [repo](https://github.com/electron/electron)、[process model](https://www.electronjs.org/docs/latest/tutorial/process-model)、[security](https://www.electronjs.org/docs/latest/tutorial/security) |
| Electron Forge | MIT | `electron/forge` 未归档，2026-08-28 有 push，最新 release v7.11.2 | 打包；采用但 Vite plugin experimental，锁版本 | [repo](https://github.com/electron/forge)、[Vite plugin](https://www.electronforge.io/config/plugins/vite) |
| React | MIT | `facebook/react` 未归档，2026-08-31 有 push，最新 release v19.2.8 | renderer 组件层；采用 | [repo](https://github.com/facebook/react)、[docs](https://react.dev/learn) |
| Vite | MIT | `vitejs/vite` 未归档，2026-08-31 有 push | 开发与三入口构建；采用 | [repo](https://github.com/vitejs/vite)、[guide](https://vite.dev/guide/) |
| TypeScript 6 compatibility API | Apache-2.0 | `microsoft/TypeScript` JS 仓库进入维护期；官方提供 `@typescript/typescript6` | MVP 正式 Compiler API；采用并精确锁定 | [repo](https://github.com/microsoft/TypeScript)、[Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)、[7.0 transition](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) |
| TypeScript 7 native | Apache-2.0 | `microsoft/typescript-go` 未归档，2026-08-31 有 push，release 7.0.2 | 7.0 CLI 可用但无 API；暂不作为 adapter API | [repo](https://github.com/microsoft/typescript-go)、[7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) |
| Tree-sitter | MIT | `tree-sitter/tree-sitter` 未归档，2026-08-31 有 push，release v0.27.0 | 未来语言的增量 concrete syntax tree；不能替代 TS 语义解析 | [repo](https://github.com/tree-sitter/tree-sitter)、[docs](https://tree-sitter.github.io/tree-sitter/) |
| CodeMirror 6 | MIT | GitHub repos 2026-04 归档后迁至官方 Forgejo；官方站点与包继续维护 | 只读源码表面；采用但隔离并锁版本 | [official site](https://codemirror.net/)、[reference](https://codemirror.net/docs/ref/)、[migration](https://discuss.codemirror.net/t/codemirrors-migration-to-forgejo/9706) |
| Monaco Editor | MIT | `microsoft/monaco-editor` 未归档，2026-08-27 有 push，release v0.56.0 | `CodeSurface` 备选，完整 IDE 能力更重 | [repo](https://github.com/microsoft/monaco-editor)、[API](https://microsoft.github.io/monaco-editor/typedoc/) |
| SVG/Canvas Web APIs | Web standards / MDN 文档 | 随 Electron Chromium 提供 | SVG 采用；Canvas 为性能备选 | [SVG](https://developer.mozilla.org/en-US/docs/Web/SVG)、[Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) |
| better-sqlite3 | MIT | `WiseLibs/better-sqlite3` 未归档，2026-08-10 有 push，release v13.0.3 | SQLite driver 候选，需 ABI/package spike | [repo](https://github.com/WiseLibs/better-sqlite3) |

正式合并依赖前仍需在实现 PR 中保存精确版本、许可证扫描结果和平台 smoke 结果；本快照不能替代 lockfile。

当前项目仓库的 GitHub `licenseInfo` 为空。这不影响内部分析，但在分发源码或安装包前必须由项目所有者选择项目许可证、生成第三方 notices，并确认 Electron/Chromium 与 npm 依赖的再分发义务；实施者不得自行替项目决定许可证。

## 被否决或延期的替代方案

### Tauri + Rust

优点：安装体积和基础内存较小，权限模型更细。缺点：TypeScript Compiler API/Node adapter 需要 sidecar 或跨语言桥接；团队要同时维护 Rust、WebView 差异和插件 ABI。它没有解决核心交互难题，却扩大第一阶段施工面，因此否决。若未来体积成为有数据支持的首要约束，再立 ADR。

### 本地服务 + 浏览器

优点：前端部署简单。缺点：本地服务生命周期、端口鉴权、浏览器文件权限、打开项目和桌面恢复体验更复杂；跨平台浏览器差异也会影响桥梁测量。MVP 否决。

### IDE 插件

优点：复用编辑器和语言服务。缺点：产品定位要求独立的组合流程阅读空间；IDE API、发布渠道和布局约束会锁定产品。作为未来入口集成延期，不作为首个宿主。

### React Flow / 通用节点图库

优点：平移、缩放和连线现成。缺点：默认抽象是节点图，易违反“源码是主体”；精确源码范围锚点、长页和虚拟化仍需大量绕过。否决。

### Tree-sitter 实现 TypeScript adapter

优点：快、增量、错误容忍。缺点：concrete syntax tree 本身不提供 TypeChecker 级跨文件 import、alias、overload 和方法目标解析。作为 TS 高亮或未来语法层可以使用，但不能满足 Issue #5，否决为首个 adapter 核心。

### Monaco 作为首个源码表面

不是技术上不可行，而是相对本产品只读、多表面场景更重。延期为 CodeMirror spike 失败后的正式备选。

### Canvas 作为首个桥梁后端

性能上限高，但无 DOM retained objects，增加命中测试、标签、键盘和无障碍成本。当前没有规模数据证明必要，延期。

## 后果

正面：

- 保持既定技术候选，团队可用统一 TypeScript 语言工作。
- 权限、CPU 密集索引和 UI 有清晰进程边界。
- TypeScript 7 过渡风险被 adapter 合同吸收，而不扩散到核心/UI。
- CodeSurface、BridgeRenderer、StoragePort 都可替换，关键依赖没有成为领域模型。

负面：

- Electron 体积和更新责任不可避免。
- Forge Vite plugin、CodeMirror 维护迁移、TypeScript 6 兼容期、SQLite 原生 driver 都需要主动版本治理。
- 多进程、IPC DTO 和 runtime validation 增加首切片代码量。

## 验证门槛

实施验证继续要求：

- 三入口 build 可重复，renderer bundle 不含 Node/Compiler API。
- sandbox + context isolation + 窄 IPC 通过安全 smoke。
- TypeScript 6 compatibility API 能解析 MVP fixture 并产出精确 UTF-16 ranges。
- CodeMirror 可暴露调用/定义 anchor，在 scroll/zoom/resize 后 SVG 几何正确。
- SQLite candidate 能在 unpackaged 与 packaged utility process 中完成事务；否则启用 port 后的 JSON fallback 并记录后续决策。
