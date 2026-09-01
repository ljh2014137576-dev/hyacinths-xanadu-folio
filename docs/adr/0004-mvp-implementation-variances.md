# ADR-0004：MVP 0.1 实施偏差与后续迁移门

- 状态：接受候选（随 PR #16 合并生效）
- 日期：2026-09-01
- 细化/部分取代：ADR-0001 的 Forge Vite plugin、立即启用 npm workspaces、CodeMirror 6 首发决定；ADR-0003 的首个 CodeSurface backend
- 关联：[PR #16](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/pull/16)、[Issue #17](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/17)、[MVP 0.2](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/milestone/2)

## 背景

ADR-0001/0003 在分析 PR #15 中接受了产品边界和默认技术方向。MVP 0.1 实施验证了 Electron/React/TypeScript/Vite、utility process、窄 IPC、源码范围锚点与 SVG 桥梁，但选择了两个更窄的首发实现。若不显式记录，accepted ADR、实际依赖和 DoD 会互相矛盾。

本 ADR 不改变源码为主体、outgoing-only、精确 UTF-16 anchor、静态/运行事实分离、renderer 无文件系统权限等产品不变量。

## 决策 1：显式 Vite build 取代 Forge Vite plugin

MVP 0.1 使用三个受控构建步骤：Vite renderer、TypeScript main/utility、Vite 单文件 CJS sandbox preload。根包保持单 package；尚无第二个可独立发布的应用或 adapter package，因此不建立空的 npm workspaces。生产构建由 `npm run build` 证明，暂不生成平台安装器。

原因：

- Forge Vite plugin 在接受 ADR 时仍为 experimental，且 utility/preload 的安全打包需要明确产物控制。
- 显式构建能直接扫描 renderer bundle，证明其中没有 Node/Electron/Compiler API。
- 当前单包结构避免为尚不存在的发布单元制造 workspace 边界。

替代方案：继续采用 Forge plugin；或完全更换 Tauri/其他宿主。前者未给 MVP 增加用户能力，后者违反既定路线，因此均未采用。

风险：当前没有安装器、签名、自动更新或 packaged-app 平台矩阵。迁移到 Forge 或其他 packager 前必须在独立 PR 中证明 Windows/macOS/Linux 打包、sandbox preload、utility 读写、签名和启动 smoke，不得改变 IPC/领域合同。

## 决策 2：只读 HTML CodeSurface port 取代直接 CodeMirror 依赖

MVP 0.1 的首个 CodeSurface 后端使用只读 `<pre>/<code>`、精确 range span、SourceAnchor registry 和 SVG overlay。它不是普通节点图，也不编辑源码。CodeSurface 语义仍保持 UTF-16 half-open range、revision、measure/reveal/dispose 边界。

原因：

- MVP fixture 和当前源码页可在不引入编辑器 worker/虚拟化生命周期的情况下验证精确 call-site→definition 桥梁。
- HTML range span 使 probable/exact、ARIA、内部滚动重测和 deterministic geometry test 更直接。
- 现有后端已通过真实 Electron 的 idle/scroll/zoom/mode bridge 复验。

风险：超长文件没有编辑器级虚拟化；语法高亮较轻；大量并列 source surface 的 DOM 成本需要测量。迁移到 CodeMirror 的门槛是：经授权的中型项目基准证明 HTML 后端超过帧延迟/内存预算，或需要 offscreen virtualization；迁移必须保持同一 AnchorKey、未挂载 stub、ARIA、SourceAnchor 和 FlowPage 状态测试。

## NFR-005：增量索引延期

MVP 0.1 的 TypeScript adapter 明确声明 `incrementalUpdate=false`。它执行可取消、realpath-contained、partial-aware 的全量重建；只有 completed generation 写成功缓存。不得把 changedFiles 请求描述为增量。

可靠的 per-session incremental builder、affected relation invalidation 与 watcher generation ordering进入 MVP 0.2 Issue #17。只有该 Issue 的全部验收通过后才能把 capability 改为 `true`。

## 后果与文档规则

- ADR-0001/0003 的产品边界和可替换 port 继续有效；上述两项具体首发后端由 ADR-0004 细化。
- architecture、requirements mapping、MVP plan、README 和 dependencies 必须引用本 ADR，不得继续把 Forge、CodeMirror 或 incrementalUpdate=true 描述为当前事实。
- 未来更换 build/CodeSurface/incremental backend 均使用小型迁移 ADR，不修改领域模型来迁就工具。
