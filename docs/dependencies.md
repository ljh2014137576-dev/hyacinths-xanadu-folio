# MVP 0.1 依赖、许可证与风险

本清单记录直接依赖的用途和已知风险。精确版本以 `package-lock.json` 为事实来源；`npm run license:check` 同时检查全部传递依赖的许可证字段。

| 依赖 | 锁定版本 | 许可证 | 用途 | 已知风险与控制 |
| --- | ---: | --- | --- | --- |
| `electron` | 44.1.0 | MIT | 桌面 main/preload/renderer/utility 运行时 | 安装体积与 Chromium/Node 安全更新责任；固定版本，CI 跑真实 Electron smoke |
| `react` / `react-dom` | 19.2.8 | MIT | renderer 组件组合 | 只承载视图；领域模型和索引不放入组件私有事实 |
| `vite` / `@vitejs/plugin-react` | 8.2.2 / 6.1.1 | MIT | renderer 与 sandbox preload bundle | 多入口配置需要 smoke；preload 打成单文件 CJS，不放松 sandbox |
| `@typescript/typescript6` | 6.0.2 package，Compiler `6.0.3` | Apache-2.0 | 官方 TypeScript 6 Compiler API/TypeChecker 与 `tsc6` | TypeScript 7.0 无编程 API；仅使用公开 API，adapter DTO 隔离未来迁移 |
| `zod` | 4.5.4 | MIT | IPC 与持久化运行时校验 | schema 与领域品牌类型需同步；测试覆盖错误输入和 round-trip |
| `eslint` / `typescript-eslint` | 10.9.1 / 8.69.0 | MIT | strict 静态检查 | 升级可能改变规则；关键版本固定，不用大面积 disable |
| `vitest` / `@vitest/coverage-v8` | 4.1.11 | MIT | 单元与组件测试 | jsdom 不等于 Electron；另有真实 Electron E2E |
| `@testing-library/*` / `jsdom` | 16.3.3、14.6.6、7.0.1 / 30.0.1 | MIT | 组件交互、键盘和可访问性测试 | DOM 几何不真实；桥梁使用纯几何测试和 Electron 截图补足 |
| `@playwright/test` | 1.62.1 | Apache-2.0 | Electron E2E、运行截图 | 首次环境准备可能下载 Electron 测试资源；CI 使用单 worker 与 xvfb |
| `concurrently` / `wait-on` / `cross-env` / `rimraf` | 10.0.5 / 9.1.0 / 10.1.0 / 6.1.3 | MIT | 开发编排、跨平台环境与清理构建目录 | 仅用于开发脚本，不进入 renderer 权限边界 |

当前 lockfile 许可证集合为：0BSD、Apache-2.0、BSD-2-Clause、BSD-3-Clause、BlueOak-1.0.0、CC0-1.0、ISC、MIT、MIT-0、MPL-2.0。MPL-2.0 是文件级 copyleft，当前来自构建/测试传递依赖；分发前仍应生成完整第三方 notices 并由项目所有者审核。
