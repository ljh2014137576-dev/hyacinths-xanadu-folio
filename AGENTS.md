# AGENTS.md

## Codebase Knowledge Graph

本项目使用 codebase-memory-mcp 维护代码知识图谱。发现代码时优先使用图谱工具：

1. `search_graph`：查找函数、类、路由和变量。
2. `trace_path`：分析调用者、被调用者和数据流。
3. `get_code_snippet`：读取已定位的具体符号源码。
4. `query_graph`：执行复杂的跨模块查询。
5. `get_architecture`：获取高层架构摘要。

只有搜索字符串字面量、错误消息、配置值、非代码文件，或图谱结果不足时，才使用 `rg` 等本地搜索工具。

## Product Invariants

- 源码片段是流程页主体；不得退化为普通圆形节点图。
- 只从当前入口沿向外引用展开；不得自动展示无关入站调用者。
- `RelationBridge` 必须连接具体调用范围与具体目标定义范围，并保留解析状态。
- `LoopRegion` 的循环体只建模一次，使用回环边表达重复。
- 静态循环次数只能是上限、表达式或未知；真实次数属于未来运行追踪阶段。
- 分支筛选是静态查看过滤，不得暗示真实执行路径；隐藏分支必须可发现和恢复。
- `LanguageAdapter` 与索引核心、领域模型和 UI 解耦；不得用正则替代 TypeScript 正式解析能力。
- 第一阶段不实现断点、变量值、实时执行追踪、线程、进程或时间线调试。
- 源码、索引和工作区数据默认本地优先，未经授权不得上传用户源码。

## Engineering Rules

- 默认技术候选为 Electron + React + TypeScript + Vite；更换路线必须用 ADR 记录理由、替代方案和风险。
- 使用 npm 并提交 `package-lock.json`。
- 保持严格类型检查，不得以大量 `any` 或关闭检查绕过问题。
- 重要功能应拆成小而清晰的提交；提交前运行相关测试。
- 不提交密钥、Token、用户绝对路径、`node_modules`、构建产物或临时文件。
- 主要产品代码不得直接在 `main` 开发；通过分支、PR、CI 和审查集成。

