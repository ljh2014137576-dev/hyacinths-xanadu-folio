# ADR-0003：流程页与来源桥梁渲染模型

- 状态：已接受（分析 PR #15）
- 日期：2026-09-01
- 关联：[Issue #6](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/6)、[#7](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/7)、[#8](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/8)、[#9](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/9)、[#10](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/10)、[#11](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/11)、[#13](https://github.com/ljh2014137576-dev/xanadu-code-flow-browser/issues/13)

## 背景

产品的核心表达不是抽象调用图，而是并排/组合的真实源码表面。每条关系需要从调用语句的具体范围连接到目标函数定义的具体范围，并在滚动、缩放、视图切换、来源折叠和虚拟化后保持准确。

同时，静态分支、循环、递归、不确定引用和隐藏来源都需要明确但不过度喧宾夺主。通用节点图库或仅按文件/函数中心点连线无法满足这些要求。

## 决策

采用四层渲染模型：

1. **领域事实层**：FunctionFragment、RelationBridge、LoopRegion 与解析状态，不含像素坐标。
2. **FlowPage 投影层**：有限的出站展开、placement、分支查看过滤、折叠与 viewport，不复制源码身份。
3. **HTML/CodeMirror 源码层**：源码长页/片段及精确范围 decoration，是视觉主体。
4. **SVG overlay 层**：在统一世界坐标中连接已挂载 anchor，表达关系状态、标签和交互。

SVG 与源码层共享一个 `FlowCanvas` transform。标准视图和沉浸式视图消费同一个 FlowPage store，只改变 chrome、来源排列和 viewport projection，不创建第二套页面状态。

## 1. FlowPage 不是调用图

FlowPage 持久化以下内容：

- 入口（函数、文件或 BusinessNode）。
- placement 引用、顺序、列/区域和用户位置。
- 已展开 RelationId、已折叠 region/source。
- `BranchViewFilter` 与隐藏摘要。
- 标准/沉浸 mode、scroll、zoom、selection/focus。
- projection/index revision 与 stale 状态。

它不持久化：

- AST/TypeChecker 对象。
- 源码正文副本。
- 关系的像素 path。
- “真实执行”“已走过”“实际循环次数”等运行事实。

### 展开算法

展开是一项显式用户动作：

1. 从当前 placement 的 outgoing RelationBridge 列表开始。
2. resolved 关系可创建/复用目标 placement；ambiguous/unresolved/external 创建状态端点，不伪造代码卡。
3. 投影器维护当前 expansion path 和页面 target registry。
4. 目标已在当前 path 中表示递归/调用环：桥梁回连已有 placement，显示 cycle/recursion label。
5. 关系属于当前 LoopRegion 的 back edge：回连 LoopRegion 条件/更新 anchor。
6. 达到最大深度：保留可展开 stub 和剩余数量，不删除索引事实。
7. 默认查询永远只读取 outgoing；入站关系只有用户明确执行“查找引用”时进入独立结果，不合并到流程页。

## 2. 源码表面

MVP `CodeSurface` 使用 CodeMirror 6 只读实例。组件通过 adapter 暴露最小能力：

```ts
interface CodeSurface {
  setDocument(file: SourceFileView): void;
  setDecorations(decorations: readonly SourceDecoration[]): void;
  revealRange(range: TextRange, options?: RevealOptions): void;
  measureRange(range: TextRange): readonly DOMRect[] | 'not-mounted';
  onViewportChange(listener: () => void): Unsubscribe;
  dispose(): void;
}
```

约束：

- CodeMirror/Monaco 类型不得进入 FlowPage、RelationBridge 或 bridge geometry public DTO。
- 每个范围仍以 UTF-16 `[start, end)` 和 source revision 标识。
- 调用范围和目标定义使用真实 inline/line decoration；不得覆盖源码文本生成假锚点。
- 只读 surface 关闭编辑、自动完成、格式化、写文件和语言服务网络能力。
- 多表面实例必须显式 dispose；React unmount 不是唯一资源清理机制。

CodeMirror 只渲染可见区域。`measureRange()` 返回 `not-mounted` 是正常状态，不是异常；桥梁层必须处理。

## 3. AnchorRegistry

```ts
interface AnchorKey {
  sourceFileId: string;
  revision: string;
  start: number;
  end: number;
  role: 'call-site' | 'definition' | 'loop-entry' | 'loop-back' | 'loop-exit';
}

interface MeasuredAnchor {
  key: AnchorKey;
  worldRects: readonly Rect[];
  visibility: 'visible' | 'clipped' | 'not-mounted' | 'stale';
  generation: number;
}
```

测量流程：

1. CodeSurface 注册语义 AnchorKey。
2. CodeSurface/DOM 返回 viewport-relative DOMRect。
3. geometry service 读取 FlowCanvas rect、scroll origin 和 transform inverse，把 rect 转换成世界坐标。
4. 多行 range 可能返回多个 rect；按桥梁方向选择最接近目标的一段，但保留完整高亮。
5. 每轮测量带 layout generation；旧 generation 结果不提交。

触发重算：

- anchor 挂载/卸载。
- CodeMirror viewport change。
- FlowCanvas scroll/pan/zoom。
- ResizeObserver 报告源码表面或容器变化。
- 字体加载、主题/字号/line-height 改变。
- 标准/沉浸视图切换和来源折叠。

所有触发在 requestAnimationFrame 中去重；测量 read phase 与 SVG write phase 分开，避免 layout thrashing。

## 4. SVG BridgeRenderer

BridgeRenderer 接收已解析的 view DTO 和 MeasuredAnchor，不读索引/文件。每条桥梁包含：

- 可见宽 hit path（透明）和实际 stroke path。
- 起点/终点 marker。
- 条件、关系类型或解析状态标签。
- `data-relation-id` 与可访问描述。
- selected/related/dimmed/hidden 状态。

### 路由

MVP 采用确定性正交或平滑三次 Bézier 路由：

- 起点/终点位于 range 边缘而不是卡片中心。
- 同一来源的多条线按稳定 RelationId 排序分配 lane，避免每次 render 跳动。
- path 不穿过自己的源码文本区；必要时走列间 gutter。
- 目标在左侧时允许回连，但必须有方向 marker/label。
- 路由失败时显示直线与 diagnostic，不静默消失。

不得在 MVP 引入具有隐藏语义的自动全局图布局。源码卡顺序由出站展开与用户 placement 决定，桥梁服务只路由连接。

### 解析状态视觉

| 状态 | 线型/端点 | 标签 | 行为 |
| --- | --- | --- | --- |
| resolved exact | 实线 + 实心目标 marker | 可选 relation kind | 可直接导航/展开 |
| resolved probable | 实线或细虚线 + `可能` 标记 | `可能目标` | 展示 evidence，可导航但不伪装 exact |
| ambiguous | 分叉/虚线 stub + 候选计数 | `N 个可能目标` | 打开候选列表，用户显式确认 |
| unresolved | 断线/开放端点 | `未解析：原因` | 保留 call-site，高亮诊断 |
| external | 指向外部端点 glyph | endpoint type/name | 不创建本地函数定义卡 |
| manual | 与原始状态可区分的双线/人工 badge | `人工关联` | 显示创建 provenance |

颜色只能增强，不得成为唯一编码。

### 未挂载端点

若一端 `not-mounted` 或被折叠：

- 不使用缓存像素坐标连接到旧位置。
- 在可见容器边缘显示 stub、方向、目标名称/状态和隐藏计数。
- 激活 stub 时 reveal/mount 目标，再在下一 generation 连接精确 anchor。
- stale revision 则禁止激活跳转，先要求重新索引/relocation。

## 5. 分支查看过滤

BranchContext 是 adapter/index 事实，BranchViewFilter 是 FlowPage 用户状态。两者不可合并。

默认 `show-all`。选择某一分支后：

- 所选分支后续保持 normal。
- 其他分支变为 dimmed 或 collapsed；不得从 placement/relation 集合删除。
- 分支点显示“隐藏 N 个分支/关系”的恢复入口。
- 页面固定显示“静态查看过滤，不代表真实执行路径”。
- 保存/恢复与标准/沉浸切换复用同一 filter。

不得出现 `executed`、`taken`、`notTaken` 等运行时语义字段。测试应直接断言过滤前后领域关系数量不变。

## 6. LoopRegion、递归与调用环

LoopRegion 渲染粒度：

- collapsed：条件摘要、循环类型、内部函数数量、iterationEstimate、回环 marker。
- expanded：条件、循环体、entry/back/exit、break/continue/return/throw 路径。
- single-iteration-explanation：只用于讲解一次循环体顺序，文案明确“抽象单次迭代”。

次数文案映射：

| 模型 | 允许文案 | 禁止文案 |
| --- | --- | --- |
| `{kind: 'upper-bound', value: 12}` | `静态上限 12 次` | `循环 12 次`、`实际 12 次` |
| `{kind: 'expression', expression: 'order.items.length'}` | `次数：order.items.length` | 推测具体数字 |
| `{kind: 'unknown'}` | `次数：静态未知` | `0 次`、`无限` |

递归/调用环回连已有 placement，默认折叠，允许按层显式展开直到 page guard。每层是展示 placement，不创建新的 FunctionFragment 身份。

## 7. 标准与沉浸视图

### 标准视图

- 左：常驻项目目录/搜索。
- 中：FlowCanvas 源码流程页。
- 右：来源、符号、当前 RelationBridge/Diagnostic inspector。
- 适合管理、搜索、BusinessNode 和详细来源。

### 沉浸视图

- 隐藏常驻目录与属性 panel。
- 中央组合流程文档，两侧可展开原始源码长页。
- 支持 pan、纵向 scroll、整体 zoom；源码仍占主要面积。
- Ctrl+Space 抽屉以 overlay 覆盖，不改变 FlowCanvas 尺寸/placement；Esc 关闭，图钉切回标准常驻目录。

两者共享：

- 同一 FlowPage store 和 projection revision。
- selection、focus target、expandedRelations、collapsedRegions、branchFilter。
- 逻辑 viewport；各模式可以保存自己的 chrome visibility，但不得复制业务状态。

模式切换完成后，等待布局稳定并增加 generation，再测量全部可见 anchor。不得复用切换前的 SVG path。

## 8. 来源往返

点击 FunctionFragment 或 RelationBridge 来源时保存 `NavigationSnapshot`：

- flowPageId/mode/projection revision。
- world scroll/zoom。
- focused placement/relation/range。
- expanded/collapsed/filter state 的版本引用。

Source view reveal 精确 range 和必要上下文。返回时先恢复 FlowPage 状态与 viewport，再 focus 原 anchor。若 source revision 已变：

- 显示 stale diagnostic。
- 尝试 adapter relocation。
- matched 后让用户看到旧/新范围证据；ambiguous/missing 不自动跳。

所有路径在 renderer 只显示 project-relative path。

## 9. 性能策略

没有实际基准前不承诺任意“大项目”数字。MVP 先建立测量指标：

- 可见 CodeSurface/源码行/bridge 数量。
- anchor measure、route、SVG commit 各阶段耗时。
- scroll/zoom 帧延迟与 dropped frame。
- utility process index batch latency 与 renderer payload 大小。

优化顺序：

1. 批量状态更新和 requestAnimationFrame 测量。
2. 只路由可见/邻近 bridge，其他使用可发现 stub。
3. 折叠无关来源，保持关系事实不丢失。
4. CodeSurface 虚拟化和稳定 line height。
5. 简化 path/label 层，不先牺牲解析状态。
6. 基准仍不达标时，评审 Canvas/WebGL 后端，并保留可访问 DOM 列表。

不得通过自动删除入站/不确定/隐藏关系来获得性能；默认入站不进入 FlowPage 是产品语义，不是性能捷径。

## 10. 无障碍与键盘

- 每个 RelationBridge 有可聚焦的等价列表项或 SVG focus target，描述来源、目标、状态和条件。
- 键盘可从调用 anchor 移到 relation detail，再到目标定义；未解析时移到 diagnostic。
- 线型、marker、文字与颜色共同编码状态。
- 抽屉打开时焦点进入并受控，关闭时返回触发点。
- zoom 不应只依赖鼠标滚轮，提供键盘命令和可见百分比。
- Canvas 若未来采用，必须保留隐藏/可见的语义关系列表，因为绘制对象本身不进入无障碍树。

## 11. 替代方案

### 通用节点图/React Flow

平移缩放现成，但源代码会被压成节点，精确 range 锚点与长页布局变成例外，直接违反产品不变量。否决。

### 纯 HTML/CSS border 连线

简单关系可用，但跨列曲线、marker、标签、回环、hit target 和 zoom 下路由难以维护。否决为主后端。

### Canvas 2D 首发

大量边性能潜力高，但无 retained DOM，命中测试、焦点、标签与自动化测试成本高；当前规模未证明确有必要。延期。

### WebGL

性能上限最高，开发、文字/无障碍、调试和打包成本也最高。MVP 否决。

### 缓存像素 path 到 FlowPage

恢复快但与字体、DPI、窗口、视图、CodeMirror viewport 强耦合，极易漂移。否决；只保存语义 placement/viewport，path 每次派生。

### 为每次循环复制节点

能直观看起来像运行轨迹，但静态阶段不知道真实次数，会导致错误语义和无限增长。明确禁止。

## 12. 后果

正面：

- 源码和来源关系保持同一视觉空间，符合全部概念图。
- 关系状态、分支过滤、循环/递归都由领域事实驱动，不依赖颜色或偶然布局。
- 标准/沉浸切换不会产生两套状态。
- SVG 几何和交互可确定性测试，未来可替换渲染后端。

负面：

- DOM 测量、CodeMirror 虚拟化与 SVG 世界坐标需要专门基础设施。
- 多行 range、字体/DPI、offscreen endpoints 和模式切换有较高几何测试成本。
- 非常密集关系可能最终需要 Canvas 后端。

## 13. 施工约束与验收

- 任何 bridge path 都能回溯到 RelationId、call-site AnchorKey 和 target/unresolved 状态。
- scroll、zoom、resize、来源折叠和模式切换后运行几何测试，误差阈值由 CSS pixel/DPI fixture 明确。
- 未挂载/stale anchor 不得使用旧像素坐标。
- 分支过滤前后 RelationBridge 数量相同，隐藏摘要可恢复。
- LoopRegion 领域 fixture 只有一份循环体；UI 文案按 estimate union 穷尽检查。
- 页面 DOM/截图测试确认源码面积和层级是主体，不出现通用圆形节点画布。
- `BridgeRenderer` 不导入索引、文件系统或 TypeScript Compiler API。

## 来源

- [CodeMirror Reference Manual](https://codemirror.net/docs/ref/)
- [CodeMirror System Guide](https://codemirror.net/docs/guide/)
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/typedoc/)
- [MDN SVG](https://developer.mozilla.org/en-US/docs/Web/SVG)
- [MDN Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)
- [MDN Resize Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Resize_Observer_API)
- [MDN getBoundingClientRect](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect)
