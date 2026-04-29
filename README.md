# Multi-Agent AI Game Engine

一个本地优先的多 Agent 场景模拟与编辑器。项目由 Python/FastAPI 后端、React/Vite 前端、Electron 桌面壳组成，用于构建可视化地图、区域、物体、Agent 动作、LLM 决策事件和本地模型工作流。

当前版本重点支持：

- 在 2D 工作台中导入/生成地图，绘制和编辑道路、障碍、行动区、居住区、社交区等区域。
- 管理 agent、item、区域轮廓，并支持右键隐藏、显示、删除。
- 让 LLM 或 mock provider 管理 agent 的移动、停止、社交、发言、拾取和移动可交互 item。
- 记录普通世界事件和 `decision_events`，用于追踪“哪个 agent 的哪个模型做了什么决策”。
- 给 agent 绑定 GIF 或 PNG 序列帧动画，并配置序列 FPS、最大像素数和显示缩放。
- 管理本地模型能力，包括 Ollama LLM、图像识别、内置 MobileSAM 分层。

## 技术栈

- Backend: Python 3.11, FastAPI, Uvicorn, Pydantic, Shapely, SQLite
- Frontend: React 18, TypeScript, Vite, Three.js, Pixi.js, Lucide icons
- Desktop: Electron
- Tests: Pytest, Playwright
- Local models: Ollama, embedded MobileSAM

## 目录结构

```text
.
├─ backend/agent_engine/        # 后端 API、规则、模拟、模型 provider、持久化
├─ frontend/src/                # React 编辑器和桌面工作台 UI
├─ frontend/electron/           # Electron 主进程和 preload
├─ frontend/tests/              # Playwright 前端回归测试
├─ tests/                       # Pytest 后端测试
├─ docs/                        # 中文开发和功能手册
├─ runtime_project/             # 本机运行数据，默认不提交
├─ pyproject.toml               # Python 包和测试配置
└─ README.md
```

## Windows 快速启动

以下命令默认在 PowerShell 中执行，工作目录为仓库根目录。

### 1. 安装后端依赖

建议使用 Python 3.11。

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

如果 PowerShell 阻止激活脚本，可以只对当前用户放开脚本执行：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### 2. 安装前端依赖

```powershell
cd frontend
npm install
cd ..
```

如需运行 Playwright 测试，首次安装浏览器：

```powershell
cd frontend
npx playwright install chromium
cd ..
```

### 3. 启动后端

```powershell
$env:AGENT_ENGINE_PROJECT_DIR = "runtime_project"
py -3.11 -m uvicorn agent_engine.api.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/healthz
```

### 4. 启动网页编辑器

另开一个 PowerShell：

```powershell
cd frontend
npm run dev -- --port 5173
```

打开：

[http://127.0.0.1:5173/](http://127.0.0.1:5173/)

### 5. 启动 Electron 桌面工作台

```powershell
cd frontend
npm run electron:dev
```

Electron 会打开同一套 Vite 前端，并尝试检测/启动本地后端。浏览器开发时仍建议手动启动后端，便于查看日志。

## 常用命令

```powershell
# 后端测试
py -3.11 -m pytest -q

# 前端类型检查和生产构建
cd frontend
npm run build

# 前端 Playwright 回归
cd frontend
npm run test:e2e

# 只跑核心工作台回归
cd frontend
npx playwright test tests/sandbox.spec.ts -g "agent panel controls|scene objects can be hidden|drawing tools create|renders the transparent"
```

## 本地模型配置

模型管理面板按能力划分：

- `语言模型 LLM`：推荐安装 Ollama，并准备 `qwen2.5:7b`、`qwen2.5:1.5b` 或 `gemma3:1b`。点击“重新检测”后可一键启用本地 LLM。
- `图片生成`：当前可导入图片或使用 mock 候选；如需真实生成，可在高级配置接入 ComfyUI 或兼容服务。
- `SAM 分层`：可一键安装并启用内置 MobileSAM。模型权重默认缓存到 `runtime_project/models/mobile_sam/`。
- `图像识别`：检测到 Ollama 视觉模型时会注册为 vision labeling 能力，例如 `qwen2.5vl:3b`。

命令行安装 Ollama 模型示例：

```powershell
ollama pull qwen2.5:7b
ollama pull qwen2.5:1.5b
ollama pull gemma3:1b
ollama pull qwen2.5vl:3b
```

后端会从模型配置中同步 runtime provider。agent 默认 `model_provider = "mock"` 时，如果存在启用的真实 LLM，会优先使用当前默认 LLM provider。

## 项目数据和迁移

默认运行数据目录是 `runtime_project/`，它被 `.gitignore` 排除，不会提交到 Git。

`runtime_project/` 里通常包含：

- `world.sqlite`：地图、agent、item、事件、decision events、模型配置等主要状态。
- `project.json`：项目元数据。
- `assets/`：上传的地图背景、item 图片、agent GIF/PNG 序列帧。
- `models/`：内置 MobileSAM 等本地缓存模型。

把仓库转移到另一台 Windows 电脑时有两种方式：

1. 只转代码：复制 Git 仓库或 `git clone`，不复制 `runtime_project/`。新机器启动后会创建一个全新的项目状态。
2. 转代码和当前场景：复制 Git 仓库，同时把旧机器的 `runtime_project/` 整个目录复制到新机器仓库根目录。这样地图、agent、上传素材、模型配置和事件历史都会保留。

不要把以下目录当作源代码迁移：

- `frontend/node_modules/`
- `frontend/dist/`
- `.venv/`
- `.pytest_cache/`
- `test-results/`
- `*-dev.out.log`、`*-dev.err.log`

## 新 Windows 电脑迁移清单

1. 安装 Git、Python 3.11、Node.js LTS。
2. 可选安装 Ollama，并拉取需要的模型。
3. 复制或 clone 本仓库。
4. 如需保留当前场景，复制旧电脑的 `runtime_project/` 到仓库根目录。
5. 在仓库根目录创建 `.venv` 并安装 Python 依赖。
6. 在 `frontend/` 执行 `npm install`。
7. 启动后端和前端，打开 `http://127.0.0.1:5173/`。
8. 在模型管理面板点击“重新检测”，确认 LLM/SAM/视觉模型状态。
9. 运行 `py -3.11 -m pytest -q` 和 `npm run build` 做基础验收。

更详细的开发、迁移和排障说明见：

[docs/development-manual.zh-CN.md](docs/development-manual.zh-CN.md)

动作扩展设计说明见：

[docs/action-extension-manual.zh-CN.md](docs/action-extension-manual.zh-CN.md)

## API 入口

常用 HTTP 入口：

- `GET /healthz`：后端健康检查。
- `GET /api/world`：读取当前世界快照。
- `PUT /api/world`：替换世界快照。
- `PATCH /api/map`：更新地图基础字段。
- `POST /api/map/regions`：创建手绘区域。
- `POST /api/map/regions/boolean`：区域增加/扣减。
- `PATCH /api/agents/{id}`：更新 agent 名称、隐藏状态、动画、对话策略等。
- `PATCH /api/map/items/{id}`：更新 item 位置、图片、可移动状态等。
- `POST /api/actions`：提交 agent 动作。
- `POST /api/simulation/start`、`POST /api/simulation/pause`、`POST /api/simulation/tick`：控制模拟。
- `GET /api/models`、`PATCH /api/models`：管理模型配置。
- `POST /api/model-capabilities/{capability}/configure-local`：一键启用本地能力。

WebSocket：

- `ws://127.0.0.1:8000/ws`：持续推送 world snapshot，并可接收 start/pause/action 消息。

## 当前开发重点

当前分支正在推进 agent 系统和 LLM 事件系统：

- LLM 决策真实驱动 agent 移动、停止、社交和 item 互动。
- `decision_events` 记录模型响应、动作、校验结果和关联 world event。
- item 分为可移动/不可移动；不可移动 item 不能被 agent 拾取或移动。
- agent 动画支持 GIF 和 PNG 序列，并支持显示缩放。
- 区域绘制、布尔编辑、隐藏/删除和右键菜单层级是当前编辑器的关键回归范围。

## 许可证

当前仓库未声明开源许可证。正式发布或对外分发前，请先补充许可证和第三方模型/素材使用说明。
