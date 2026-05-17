# Windows EXE 打包说明

本文面向在 Windows 11 x64 上构建最终 `installer.exe` 和 `portable.exe` 的开发者。Mac 不能直接产出可验证的 Windows PyInstaller 后端 exe，最终构建必须在 Windows 环境执行。

## 1. 环境准备

安装：

- Git
- Python 3.11 x64
- Node.js LTS x64
- 可选：Ollama，用于本地 LLM 测试

确认：

```powershell
git --version
py -3.11 --version
node --version
npm --version
```

## 2. 获取源码

把仓库复制到 Windows 后，进入项目根目录：

```powershell
cd path\to\multi-agent-game-engine
git status --short --branch
```

不要复制 Mac 的 `.venv`、`frontend/node_modules`、`frontend/release`、`packaging/backend-build`、`packaging/backend-dist`。

## 3. 安装依赖

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\python -m pip install -e ".[dev]"
cd frontend
npm ci
cd ..
```

## 4. 构建 Windows 分发包

```powershell
npm --prefix frontend run dist:win:kit
```

该命令会：

- 构建前端。
- 生成空白 Windows seed runtime。
- 用 PyInstaller 生成 `packaging\backend-dist\agent-engine-backend.exe`。
- 用 Electron Builder 生成 installer 和 portable。
- 生成 `frontend\release\Multi-Agent-Engine-0.1.0-win-install-kit`。

最终客户分发目录：

```text
frontend\release\Multi-Agent-Engine-0.1.0-win-install-kit\
```

## 5. 验证 portable

```powershell
powershell -ExecutionPolicy Bypass -File packaging\windows\smoke-portable.ps1
```

预期输出包含：

```text
WINDOWS_PORTABLE_SMOKE_OK
backend_healthz=http://127.0.0.1:8257/healthz
narrative_sidecar_default=not_started
```

## 6. 手动验收 installer

在一台没有旧数据的 Windows 11 x64 机器上：

1. 双击 `Multi-Agent Engine-0.1.0-win-installer-x64.exe`。
2. SmartScreen 出现时选择「更多信息 / 仍要运行」。
3. 完成安装并启动应用。
4. 确认界面打开，后端连接正常。
5. 确认 `%APPDATA%\Multi-Agent Engine\runtime_project\world.sqlite` 已创建。
6. 确认首次项目为空白地图，没有开发机当前的 agent、item 或素材。

## 7. 正式签名

当前策略是临时未签名。要减少或消除 SmartScreen/未知发布者提示，需要：

- Authenticode 代码签名证书。
- Electron Builder Windows signing 配置。
- 对 installer 和 portable 签名。
- 最好建立可信下载来源和版本发布记录。

没有证书时，不要在文档里承诺“不会出现安全提示”。
