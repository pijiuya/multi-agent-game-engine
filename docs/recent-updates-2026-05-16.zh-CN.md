# 最近工作更新说明（2026-05-16）

本文汇总这几天围绕 Multi-Agent Engine 做的主要更新，方便项目接手、客户沟通和后续打包发布。

## 1. Agent 运行与对话稳定性

- 修复暂停按钮不可用的问题：点击暂停后，前端会立即进入暂停状态，后端也会同步停止模拟循环，避免旧 WebSocket 快照把界面又顶回“运行中”。
- 提高 Agent 对话连续性：场景叙事系统暂时不再抢占默认对话链路，模拟运行时 Agent 更容易继续产生对话和行动。
- Agent 面板新增两个独立调节项：
  - `Item 互动可能性`
  - `Item 提及可能性`
- Item 相关行为现在更可控：`0%` 表示不会自动互动或提及，`100%` 表示在距离、冷却、物体质量等条件满足时尽量触发。
- 默认 `Item`、`Object`、未命名物体等低信息物体不会被反复拿来当对话重点，减少无意义重复。

## 2. 场景叙事系统处理

- 场景叙事系统已暂时默认关闭，避免本地叙事 sidecar 端口未启动时持续报错。
- 独立叙事服务不再默认启动，也不会默认连接 `127.0.0.1:8011`。
- 如果未来重新启用叙事服务，需要显式开启；当前版本优先保证 Agent 对话和模拟稳定运行。
- 已保留叙事相关接口、字幕 UI 和恢复层基础，后续可以继续迭代，而不会影响当前核心模拟体验。

## 3. macOS 安装包准备

- 已生成 Mac 临时分发包：
  - `Multi-Agent Engine-0.1.0-mac-arm64.dmg`
  - `Multi-Agent-Engine-0.1.0-mac-install-kit`
- Mac install kit 中包含：
  - DMG 安装包
  - `install-multi-agent-engine.command`
  - Mac 安装说明
  - 用户手册
  - SHA256 校验文件
- 安装辅助脚本会自动完成：
  - 挂载 DMG
  - 复制 `.app`
  - 清除 macOS 下载隔离标记
  - 修复执行权限
  - 补做本机 ad-hoc 签名
  - 启动应用
- 已做“冷安装模拟”：把 kit 放入全新临时目录、模拟浏览器下载隔离、安装、启动打包 app，并确认内置后端 `/healthz` 正常。
- 说明限制：当前 Mac 包没有 Apple Developer ID 正式签名和 notarization，因此首次运行仍可能需要用户右键「打开」或在系统设置里允许。

## 4. Windows EXE 打包准备

- 已准备 Windows x64 打包链路，目标产物为：
  - `Multi-Agent Engine-0.1.0-win-installer-x64.exe`
  - `Multi-Agent Engine-0.1.0-win-portable-x64.exe`
- 新增 Windows release kit 生成脚本，最终 kit 会包含 installer、portable、安装说明、用户手册和 SHA256 校验文件。
- Windows 包首次启动改为使用空白项目，不再内置当前开发机的大体积 `runtime_project`。
- 新增空白 runtime 生成脚本，已验证生成结果：
  - agent 数量为 `0`
  - item 数量为 `0`
  - 场景叙事关闭
  - 默认 mock 模型配置可用
- 新增 Windows portable smoke 脚本，用于在真实 Windows 机器验证：
  - 应用可启动
  - 内置后端 `/healthz` 正常
  - 首次数据目录自动创建
  - 空白项目没有当前开发机的 agent、item、素材
  - 叙事 sidecar 默认不启动
- 说明限制：Windows 后端 exe 必须在真实 Windows 环境通过 PyInstaller 构建，Mac 端不会伪造 Windows exe。

## 5. 文档与交付物

- 新增或更新的主要文档：
  - `docs/mac-installation.zh-CN.md`
  - `docs/windows-installation.zh-CN.md`
  - `docs/windows-packaging.zh-CN.md`
  - `docs/user-manual.zh-CN.md`
- 已准备 Windows 接手打包源码压缩包：
  - `output/windows-handoff/multi-agent-game-engine-windows-handoff-20260516-112202.zip`
- 这个 handoff 包用于移植到 Windows 机器继续打包 exe，已排除：
  - `.venv`
  - `node_modules`
  - 现有 release
  - Mac DMG
  - 构建缓存
  - 临时目录
  - 当前大体积 `runtime_project`

## 6. 已执行验证

- 后端测试通过：

```bash
.venv/bin/python -m pytest tests/test_simulation.py tests/test_api.py tests/test_model_provider.py tests/test_persistence.py -q
```

- 前端构建通过：

```bash
npm --prefix frontend run build
```

- 前端 e2e 过滤用例通过：

```bash
npm --prefix frontend run test:e2e -- -g "pause|agent item|scene subtitle|narrative"
```

- Mac 打包和冷安装模拟通过。
- Windows kit 脚本已在 Mac 上用 dummy exe 验证复制和 SHA256 逻辑；最终 Windows exe 构建和 smoke 测试需在 Windows 机器执行。

## 7. 当前推荐下一步

1. 将 Windows handoff zip 拷贝到 Windows 11 x64 机器。
2. 按 `docs/windows-packaging.zh-CN.md` 安装 Python 3.11、Node.js LTS 和依赖。
3. 运行：

```powershell
npm --prefix frontend run dist:win:kit
```

4. 运行：

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\smoke-portable.ps1
```

5. 如果 smoke 通过，就把生成的 `Multi-Agent-Engine-0.1.0-win-install-kit` 发给 Windows 客户测试。

