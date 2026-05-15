# Mac 接手与 DMG 构建说明

本文面向接手这个 Windows 工作区的 Mac 开发者或后续 Codex 进程。目标是在 macOS 上从交接 zip 恢复项目，验证当前状态，并构建一个符合 macOS 的 `.dmg` 安装包。

## 1. 当前交接状态

Windows 源项目：

```text
E:\agentGameenignine\multi-agent-game-engine
```

Git 状态：

```text
branch: codex/agent-event-system
HEAD:   c5cf0e9803710bd20f9e52ac5ae454d56b13c0bc
```

注意：

- 这个交接包会保留 `.git` 历史和当前未提交工作区内容。
- 当前工作区包含 Windows 打包、LLM/一键配置、动作扩展、叙事面板、用户手册、PPT 文本稿等进行中的改动。
- Mac 接手后应先运行 `git status --short --branch`，确认未提交文件和 Windows 端一致。

## 2. Zip 内容策略

本次 zip 是 `mac-handoff` 交接包，不是全量机器镜像。

会包含：

- 源码、测试、文档和配置。
- `.git/`，用于保留分支、历史和当前 HEAD。
- 当前 `runtime_project/`，包括 `world.sqlite`、`assets/` 和 `models/`。
- `docs/user-manual.zh-CN.md`。
- `docs/ppt-agent-engine-deck.zh-CN.md`。
- `docs/mac-handoff.zh-CN.md`。

会排除：

- `.venv/`
- `.pytest_cache/`
- `frontend/node_modules/`
- `frontend/dist/`
- `frontend/release/`
- `frontend/test-results/`
- `frontend/playwright-report/`
- `packaging/backend-build/`
- `packaging/backend-dist/`
- `packaging/*-runtime/`
- `__pycache__/`
- `*.pyc`
- `*.out.log`
- `*.err.log`

这些排除项都可以在 Mac 上重新安装或重新构建。这样可以避免把 Windows Python 虚拟环境、Windows Electron 产物和本机缓存塞进交接包。

## 3. 为什么 Windows 端不直接产出 DMG

当前 Windows 机器可以构建 Windows installer/portable，但不适合直接产出可验证的 Mac `.dmg`。

主要原因：

- Mac 版 Electron 应用和后端可执行文件需要 macOS 目标环境。
- PyInstaller 生成的后端二进制是平台相关的，Windows 的 `agent-engine-backend.exe` 不能用于 macOS。
- Mac 的 Gatekeeper、签名、notarization 和 DMG 挂载体验都需要在 macOS 上验证。

本交接包的目标是让 Mac 端用同一套源码重新构建：

```text
packaging/backend-dist/agent-engine-backend
frontend/release/Multi-Agent Engine-0.1.0-mac-<arch>.dmg
```

第一版 Mac 包不做正式 Apple Developer ID 签名和 notarization。首次运行时，系统可能需要用户在「系统设置 / 隐私与安全性」里手动允许。

## 4. Mac 环境准备

建议环境：

- macOS 13 或更新版本。
- Python 3.11。
- Node.js LTS。
- npm。
- Git。
- 可选：Ollama，用于本地 LLM。

确认命令：

```bash
python3.11 --version
node --version
npm --version
git --version
```

如果 Mac 没有 `python3.11`，建议通过 Homebrew 安装：

```bash
brew install python@3.11
```

如果没有 Node.js，建议安装 Node LTS：

```bash
brew install node
```

## 5. 解压与基础确认

把 zip 放到 Mac 上后解压：

```bash
mkdir -p ~/Projects
cd ~/Projects
ditto -x -k multi-agent-game-engine-mac-handoff-20260502.zip .
cd multi-agent-game-engine
```

确认 Git 状态：

```bash
git status --short --branch
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
```

预期：

```text
branch: codex/agent-event-system
HEAD:   c5cf0e9803710bd20f9e52ac5ae454d56b13c0bc
```

工作区会有未提交改动，这是正常的。不要用 `git reset --hard` 或 `git clean -fdx` 清理，否则会丢掉交接中的未提交代码和文档。

## 6. 安装依赖

在仓库根目录运行：

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

安装前端依赖：

```bash
cd frontend
npm install
cd ..
```

说明：

- 后端 dev 依赖包含 PyInstaller。
- 前端依赖包含 Electron 和 Electron Builder。
- Playwright Chromium 不是 Mac DMG 构建的必要条件；只有运行 e2e 测试时才需要安装。

## 7. Mac 基础验证

后端测试：

```bash
source .venv/bin/activate
python -m pytest -q
```

前端构建：

```bash
cd frontend
npm run build
cd ..
```

开发模式启动后端：

```bash
source .venv/bin/activate
export AGENT_ENGINE_PROJECT_DIR="$PWD/runtime_project"
python -m uvicorn agent_engine.api.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

另开终端启动前端：

```bash
cd frontend
npm run dev -- --port 5173
```

打开：

```text
http://127.0.0.1:5173/
```

确认：

- 页面能打开。
- 后端 `/healthz` 返回 `ok: true`。
- 当前 `runtime_project/world.sqlite` 能加载。
- 地图、agent、item、模型管理和事件日志基本可见。

## 8. 构建 Mac 后端可执行文件

在 Mac 上运行：

```bash
cd frontend
npm run build:backend:mac
cd ..
```

预期输出：

```text
packaging/backend-dist/agent-engine-backend
```

验证后端可执行文件：

```bash
chmod +x packaging/backend-dist/agent-engine-backend
export AGENT_ENGINE_PROJECT_DIR="$PWD/packaging/mac-backend-smoke-runtime"
export AGENT_ENGINE_HOST="127.0.0.1"
export AGENT_ENGINE_PORT="8133"
./packaging/backend-dist/agent-engine-backend
```

另开终端检查：

```bash
curl http://127.0.0.1:8133/healthz
```

预期返回包含：

```json
{"ok": true}
```

测试完成后停止后端进程。

## 9. 构建 Mac DMG

在 Mac 上运行：

```bash
cd frontend
npm run dist:mac
```

这个脚本会依次执行：

```text
npm run build
npm run build:backend:mac
electron-builder --mac
```

预期输出：

```text
frontend/release/Multi-Agent Engine-0.1.0-mac-<arch>.dmg
```

其中 `<arch>` 通常是：

- `arm64`：Apple Silicon Mac。
- `x64`：Intel Mac。

当前配置默认构建当前 Mac 架构的 DMG。不要在第一版里强行同时构建 `x64` 和 `arm64`，因为 PyInstaller 后端二进制也是按当前架构生成的。要做双架构分发，应分别在对应架构环境中构建，或后续单独设计 universal 后端方案。

## 10. 验证 Mac 安装包

挂载 `.dmg` 后运行应用。由于当前第一版未正式签名，macOS 可能提示无法验证开发者。

如果是本机测试包，可以在确认来源可信后执行：

```bash
xattr -dr com.apple.quarantine "/Applications/Multi-Agent Engine.app"
```

或在「系统设置 / 隐私与安全性」里手动允许打开。

启动后确认：

- 窗口出现。
- 后端自动启动。
- `~/Library/Application Support/Multi-Agent Engine/logs/` 下有日志。
- 应用可访问后端 `/healthz`。

如果要让安装版使用交接包里的运行项目数据，把仓库中的 `runtime_project` 复制到应用用户数据目录：

```bash
mkdir -p "$HOME/Library/Application Support/Multi-Agent Engine"
rsync -a runtime_project/ "$HOME/Library/Application Support/Multi-Agent Engine/runtime_project/"
```

注意：开发模式默认使用仓库内 `runtime_project/`；打包安装版默认使用：

```text
~/Library/Application Support/Multi-Agent Engine/runtime_project/
```

## 11. 模型与本地能力策略

当前主安装包不内置 Ollama 模型，也不把大型 LLM 权重塞进 `.dmg`。

原因：

- Ollama 模型通常很大，适合由用户按需下载。
- 模型许可、更新和硬件兼容性差异较大。
- 主安装包应该保持轻量、可升级。

本交接包会包含：

```text
runtime_project/models/mobile_sam/mobile_sam.pt
```

Mac 端仍需确认 MobileSAM 相关依赖和路径是否可用。如果 SAM 相关功能在 Mac 上不可用，先不要阻塞 DMG 构建，可以把它作为后续本地模型能力修复项。

Ollama 建议：

```bash
brew install ollama
ollama serve
ollama pull qwen2.5:1.5b
```

然后在应用内使用模型管理面板重新检测本地 LLM。

## 12. 常见问题

### 12.1 DMG 能打开，但后端没有启动

检查：

```bash
cat "$HOME/Library/Application Support/Multi-Agent Engine/logs/electron-main.log"
cat "$HOME/Library/Application Support/Multi-Agent Engine/logs/backend.err.log"
```

确认：

- `resources/backend/agent-engine-backend` 存在。
- 文件有执行权限。
- 没有端口冲突。
- `AGENT_ENGINE_PROJECT_DIR` 指向的目录可写。

### 12.2 开发模式正常，打包版数据不一致

这是正常的。开发模式使用仓库内：

```text
runtime_project/
```

打包版使用：

```text
~/Library/Application Support/Multi-Agent Engine/runtime_project/
```

需要时按第 10 节复制运行项目数据。

### 12.3 Mac 上不要复用 Windows release

不要把下面这些 Windows 产物用于 Mac：

```text
frontend/release/*.exe
packaging/backend-dist/agent-engine-backend.exe
```

Mac 端必须重新运行：

```bash
npm run dist:mac
```

## 13. 最小验收清单

Mac 接手完成的最低标准：

- `git status --short --branch` 能看到交接工作区。
- `python -m pytest -q` 通过。
- `npm run build` 通过。
- `npm run build:backend:mac` 生成 `packaging/backend-dist/agent-engine-backend`。
- `npm run dist:mac` 生成 `.dmg`。
- `.dmg` 安装或挂载后的 app 能打开窗口。
- app 能自动启动内置后端，`/healthz` 返回 `ok: true`。

