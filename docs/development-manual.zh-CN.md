# Multi-Agent AI Game Engine 开发手册

本文面向接手开发、迁移到另一台 Windows 电脑、或者继续扩展 agent/LLM 系统的人。主 README 负责快速启动；本文负责解释项目结构、运行数据、开发流程、测试策略和常见问题。

## 1. 项目目标

这个项目是一个本地优先的多 Agent 场景引擎，核心目标是让用户在一个可视化工作台中管理地图、区域、物体和 agent，并让本地或远程 LLM 参与世界决策。

系统分成四个层次：

- 世界模型层：保存地图、区域、item、agent、事件、decision events。
- 规则和模拟层：校验动作，推进 tick，移动 agent，处理 LLM 决策。
- API 和持久化层：通过 FastAPI 暴露操作入口，用 SQLite 保存项目状态。
- 前端工作台层：React/Electron 提供 2D 工作台、浮动面板、模型管理、区域绘制、agent 控制。

## 2. 推荐开发环境

Windows 环境建议：

- Windows 10/11
- PowerShell 5.1 或 PowerShell 7
- Git
- Python 3.11
- Node.js LTS
- Ollama，可选但推荐
- VS Code 或 Cursor，可选

推荐目录不要使用带中文或过深层级的路径。当前项目可以在类似下面的位置运行：

```text
C:\Users\Administrator\Documents\New project 2
```

如果要更稳，可以迁移到：

```text
C:\Projects\multi-agent-game-engine
```

路径里有空格通常可以工作，但写脚本时要注意引号。

## 3. 新机器迁移流程

### 3.1 只迁移代码

适合只想继续开发，不需要旧机器里的场景数据。

```powershell
git clone <repo-url> multi-agent-game-engine
cd multi-agent-game-engine
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"

cd frontend
npm install
npx playwright install chromium
cd ..
```

启动后端：

```powershell
$env:AGENT_ENGINE_PROJECT_DIR = "runtime_project"
py -3.11 -m uvicorn agent_engine.api.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

启动前端：

```powershell
cd frontend
npm run dev -- --port 5173
```

打开：

```text
http://127.0.0.1:5173/
```

### 3.2 迁移代码和当前项目状态

适合要把旧电脑上的地图、素材、agent、事件历史一起带走。

从旧电脑复制：

```text
runtime_project/
```

到新电脑仓库根目录：

```text
<repo>\runtime_project\
```

至少要确认这些文件/目录存在：

```text
runtime_project/world.sqlite
runtime_project/project.json
runtime_project/assets/
```

如果使用过内置 MobileSAM，可能还有：

```text
runtime_project/models/mobile_sam/mobile_sam.pt
```

复制完成后按 3.1 安装依赖并启动即可。

### 3.3 不建议复制的内容

这些目录和文件应在新机器重新生成：

```text
.venv/
frontend/node_modules/
frontend/dist/
.pytest_cache/
test-results/
frontend/test-results/
frontend/playwright-report/
*-dev.out.log
*-dev.err.log
```

## 4. 后端架构

后端入口：

```text
backend/agent_engine/api/main.py
```

重要模块：

```text
backend/agent_engine/engine/world.py
backend/agent_engine/engine/rules.py
backend/agent_engine/engine/simulation.py
backend/agent_engine/models/provider.py
backend/agent_engine/persistence/sqlite_store.py
backend/agent_engine/engine/geometry.py
backend/agent_engine/engine/environment_ai.py
```

### 4.1 world.py

`world.py` 定义核心数据结构：

- `Point`
- `PolygonArea`
- `MapRegion`
- `RegionLayer`
- `WorldItem`
- `AgentProfile`
- `AgentState`
- `Event`
- `DecisionEvent`
- `WorldMap`
- `GameWorld`

关键设计：

- `WorldMap.regions` 是人工/模型区域的源数据。
- `WorldMap.region_layers` 是从 `regions` 同步出来的渲染层。
- `WorldItem.movable` 控制 agent 是否能拾取、移动、旋转、缩放 item。
- `AgentProfile.animation` 支持 `gif` 和 `png_sequence`，并包含 `scale`。
- `AgentProfile.dialogue_policy` 控制自动社交距离和冷却。
- `AgentState.held_item_id` 记录 agent 当前拿起的 item。
- `GameWorld.decision_events` 记录 LLM 决策审计日志。

旧数据加载时会通过 `from_dict` 和 normalize 函数补默认字段，避免新增字段破坏已有项目。

### 4.2 rules.py

`RuleEngine` 负责校验和执行动作。LLM 不能直接改世界，只能提出结构化 action，规则引擎决定是否接受。

当前核心动作：

- `move_to`
- `say`
- `observe`
- `wait`
- `interact`
- `use`
- `stop`
- `social`
- `pick_up`
- `drop_item`
- `move_item`

重要约束：

- `move_to` 必须落在可行走区域，且不能在 obstacle 内。
- `social` 需要目标 agent 存在、未隐藏、在对话距离内，并且不在冷却中。
- item 相关动作要求 item 存在、未隐藏、`movable = true`、在互动距离内。
- `stop` 永远允许当前 agent 停止或休息。

### 4.3 simulation.py

`SimulationRuntime` 是模拟循环。

它负责：

- 后台 tick loop。
- 推进 agent 移动。
- 调度 LLM provider。
- 收割模型响应。
- 将模型输出规整成动作。
- 写入普通 world events 和 decision events。
- 让 held item 跟随 agent 当前位置。

LLM observation 包含：

- 当前 tick
- agent id/name/status/position
- map id/width/height
- held item id
- nearby agents
- nearby items
- movement targets
- dialogue candidates
- recent events

模型返回动作后，会经过 `_coerce_model_action()`。这个函数会做实用修正：

- `say` 缺少 `payload.text` 时用模型正文补齐。
- `social` 缺少目标时从 `dialogue_candidates` 取第一个。
- `move_to` 缺少 target 时从 `movement_targets` 取第一个。
- `pick_up` 缺少 item id 时从附近可移动 item 取第一个。
- 无法补齐时退回 `wait` 或 `say`。

本地模型 provider 会做串行节流，避免多个 agent 同时打爆本机 Ollama。

### 4.4 provider.py

模型 provider 接口：

```python
class ModelProvider(ABC):
    async def generate(self, request: ModelRequest) -> ModelResponse:
        ...
```

当前实现：

- `MockProvider`
- `OllamaProvider`
- `OpenAICompatibleProvider`

本地地址如 `127.0.0.1`、`localhost` 会关闭 httpx 的 `trust_env`，避免系统代理拦截 Ollama 请求。

Ollama 入口：

```text
POST http://127.0.0.1:11434/api/generate
```

OpenAI-compatible 入口：

```text
POST <base_url>/chat/completions
```

### 4.5 sqlite_store.py

项目状态保存到：

```text
runtime_project/world.sqlite
```

主要内容：

- `kv` 表保存 world snapshot 和 model configs。
- `events` 表保存普通事件。
- `decision_events` 表保存 LLM 决策事件。
- `memories`、`relationships` 预留长期系统状态。

保存世界时，`region_layers` 不作为源数据直接持久化，而是由 `regions` 重新同步生成。

## 5. 前端架构

前端入口：

```text
frontend/src/main.tsx
frontend/src/App.tsx
```

重要模块：

```text
frontend/src/types.ts
frontend/src/lib/api.ts
frontend/src/lib/fallbackWorld.ts
frontend/src/lib/worldOps.ts
frontend/src/lib/canvasCoords.ts
frontend/src/components/SceneViewport.tsx
frontend/src/components/AgentPanel.tsx
frontend/src/components/SceneElementsPanel.tsx
frontend/src/components/PropertiesPanel.tsx
frontend/src/components/RegionPanel.tsx
frontend/src/components/RegionDrawPanel.tsx
frontend/src/components/ModelManagerPanel.tsx
frontend/src/components/MapStudioPanel.tsx
frontend/src/components/FloatingPanel.tsx
```

### 5.1 App.tsx

`App.tsx` 是当前前端总控制器，负责：

- world snapshot 状态。
- WebSocket/HTTP 刷新。
- selection 状态。
- floating panel 状态。
- 地图、agent、item、region 的 patch/delete/create。
- 工具模式切换。

这是目前较长的文件。后续如果继续扩展，建议优先拆分：

- `useWorldSync`
- `usePanelLayout`
- `useSelectionActions`
- `useRegionEditing`
- `useObjectContextMenu`

### 5.2 SceneViewport.tsx

主画布和世界渲染层。

负责：

- 地图背景。
- region layer SVG 渲染。
- 手绘 draft points。
- item marker 和 transform handles。
- agent marker、动画 sprite、label。
- dialogue bubble。
- 右键对象菜单触发。
- 缩放、平移、坐标换算。

当前 agent 动画渲染：

- GIF 直接使用 `<img>`。
- PNG sequence 按 `world.tick` 和 `fps` 选择帧。
- `animation.scale` 控制显示尺寸。

### 5.3 AgentPanel.tsx

Agent 面板负责：

- agent 列表。
- agent 展开详情。
- 实时坐标、目标点、手持 item。
- 停止按钮。
- 附近 agent 距离。
- 对话策略配置。
- GIF 上传。
- PNG 序列上传。
- FPS 和动画缩放配置。
- 右键菜单。

### 5.4 ModelManagerPanel.tsx

模型管理面板负责：

- 检测本地 Ollama。
- 启用本地 LLM。
- 配置远程能力。
- 安装/启用内置 MobileSAM。
- 显示模型 capability 状态。

后端模型配置变化后，会同步 `runtime.providers`，因此无需重启后端即可让新 LLM provider 生效。

## 6. API 约定

### 6.1 World snapshot

`GET /api/world` 返回完整世界快照，前端会通过 `normalizeWorldSnapshot()` 补齐字段。

重要字段：

```text
map
agent_profiles
agent_states
relationships
memories
events
decision_events
tick
running
model_tasks
```

### 6.2 Agent patch

`PATCH /api/agents/{agent_id}` 支持：

```text
name
role
identity
color
model_provider
action_space
hidden
animation
dialogue_policy
```

动画结构：

```json
{
  "kind": "gif",
  "url": "/api/assets/example.gif",
  "frames": [],
  "fps": 8,
  "max_pixels": 4096,
  "width": 64,
  "height": 64,
  "scale": 1.6
}
```

PNG 序列结构：

```json
{
  "kind": "png_sequence",
  "url": "",
  "frames": ["/api/assets/idle-01.png", "/api/assets/idle-02.png"],
  "fps": 8,
  "max_pixels": 4096,
  "width": 64,
  "height": 64,
  "scale": 1.6
}
```

### 6.3 Item patch

`PATCH /api/map/items/{item_id}` 支持：

```text
name
position
radius
scale
rotation
image
description
tags
state
hidden
movable
```

`movable = false` 时，编辑器仍可选择和管理 item，但 agent 不可拾取或移动它。

### 6.4 Actions

统一入口：

```text
POST /api/actions
```

请求结构：

```json
{
  "agent_id": "agent_mira",
  "type": "move_to",
  "payload": {
    "target": { "x": 320, "y": 240 }
  }
}
```

返回：

```json
{
  "ok": true,
  "message": "move_to applied",
  "event": {}
}
```

## 7. 区域系统

区域源数据是 `MapRegion`：

```text
id
name
points
holes
source
function
image_prompt
notes
confidence
tags
hidden
```

`function` 可选：

```text
unassigned
walkable
obstacle
action
residential
social
custom
```

保存和渲染流程：

1. 用户绘制或 SAM 生成 `regions`。
2. 后端调用 `sync_functional_regions()`。
3. `walkable/action` 同步到 `walkable_areas`。
4. `obstacle` 同步到 `obstacles`。
5. 所有 function 同步到 `region_layers`。
6. 前端使用 `region_layers` 渲染合并层，使用 `regions` 管理源轮廓。

区域布尔编辑入口：

```text
POST /api/map/regions/boolean
```

支持：

- 按 `target_ids` 对选中区域 union/subtract。
- 按 `target_function` 对某一功能层增加或扣减。

## 8. Agent 和 LLM 决策系统

### 8.1 AgentProfile

代表 agent 的长期设定：

```text
id
name
role
identity
model_provider
color
action_space
hidden
animation
dialogue_policy
```

### 8.2 AgentState

代表 agent 当前运行状态：

```text
id
position
status
speed
target
action_queue
pending_model
last_model_tick
cooldowns
held_item_id
```

### 8.3 DecisionEvent

每次模型响应都会记录：

```text
id
tick
agent_id
provider
model
observation
text
actions
results
timestamp
```

`events` 用于画面和时间线；`decision_events` 用于审计模型决策。

### 8.4 LLM 动作策略

模型被提示只能返回 JSON：

```json
{
  "text": "I will walk to Tao.",
  "actions": [
    {
      "type": "move_to",
      "payload": {
        "target": { "x": 340, "y": 260 }
      }
    }
  ]
}
```

规则：

- 一次只执行第一个 action。
- action 必须在 agent 的 `action_space` 中。
- action 会先经过 `_coerce_model_action()`，再经过 `RuleEngine.validate()`。
- 被拒绝的 action 会写入 `rejected_action` 事件和 decision event result。

## 9. 测试策略

后端测试目录：

```text
tests/
```

核心覆盖：

- geometry 和 rules。
- simulation 非阻塞模型调度。
- LLM action 规整和 provider prompt。
- API smoke、模型配置、区域语义、decision events。
- SQLite 持久化。

运行：

```powershell
py -3.11 -m pytest -q
```

前端测试目录：

```text
frontend/tests/
```

核心覆盖：

- 工作台首屏。
- 右键隐藏、显示、删除。
- agent 动画、停止、对话、item movable。
- 区域绘制。
- item transform handles。
- 渲染像素检查。

运行：

```powershell
cd frontend
npm run build
npm run test:e2e
```

只跑核心回归：

```powershell
cd frontend
npx playwright test tests/sandbox.spec.ts -g "agent panel controls|scene objects can be hidden|drawing tools create|renders the transparent"
```

## 10. 日常开发流程

推荐顺序：

1. 启动后端。
2. 启动前端 Vite。
3. 用浏览器或 Electron 操作。
4. 修改代码。
5. 运行相关 Pytest 或 Playwright。
6. 运行全量基础验证。
7. 提交代码，避免提交运行数据。

基础验证：

```powershell
py -3.11 -m pytest -q
cd frontend
npm run build
npx playwright test tests/sandbox.spec.ts -g "agent panel controls|scene objects can be hidden|drawing tools create|renders the transparent"
```

## 11. Git 和忽略规则

`.gitignore` 当前排除：

```text
.venv/
__pycache__/
.pytest_cache/
*.pyc
runtime_project/
*-dev.out.log
*-dev.err.log
frontend/node_modules/
frontend/dist/
frontend/test-results/
frontend/playwright-report/
```

注意：

- `runtime_project/` 是运行数据，不是源码。
- `test-results/` 是 Playwright 失败截图/视频/trace，不应提交。
- `docs/` 是源码文档，可以提交。

提交前检查：

```powershell
git status --short
git diff --check
```

## 12. Windows 常见问题

### 12.1 端口被占用

查找占用 8000 或 5173 的进程：

```powershell
Get-NetTCPConnection -LocalPort 8000,5173 -State Listen |
  Select-Object LocalPort, OwningProcess
```

结束进程：

```powershell
Stop-Process -Id <pid> -Force
```

也可以换端口：

```powershell
py -3.11 -m uvicorn agent_engine.api.main:app --app-dir backend --host 127.0.0.1 --port 8010
cd frontend
npm run dev -- --port 5174
```

### 12.2 PowerShell 不能激活 venv

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\.venv\Scripts\Activate.ps1
```

### 12.3 npm install 慢或失败

先确认 Node 版本：

```powershell
node -v
npm -v
```

清理后重装：

```powershell
cd frontend
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install
```

如果只是依赖已经锁定，优先使用：

```powershell
npm ci
```

### 12.4 Playwright 缺浏览器

```powershell
cd frontend
npx playwright install chromium
```

### 12.5 Ollama 检测不到模型

检查服务：

```powershell
ollama list
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

拉取模型：

```powershell
ollama pull qwen2.5:7b
```

如果后端调用本地 Ollama 报代理相关错误，确认 base URL 使用：

```text
http://127.0.0.1:11434
```

后端对 loopback 地址会绕过系统代理。

### 12.6 Electron 打开但看不到新功能

确认三件事：

1. Vite 是否在运行正确仓库：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -like "*vite*" } |
  Select-Object ProcessId, CommandLine
```

2. 后端是否在运行正确仓库：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like "*uvicorn*agent_engine.api.main*" } |
  Select-Object ProcessId, CommandLine
```

3. 当前前端是否拿到最新 world：

```powershell
Invoke-RestMethod http://127.0.0.1:5173/api/world
```

如果看到的是旧代码，重启 Vite 和 Electron。

## 13. 接下来适合做的代码结构优化

当前功能已经按后端模块和前端组件分区，但仍有几个文件偏长：

- `frontend/src/App.tsx`
- `frontend/src/components/SceneViewport.tsx`
- `backend/agent_engine/api/main.py`
- `backend/agent_engine/engine/simulation.py`

建议优先拆分低风险边界：

- 前端 world 同步 hook：`useWorldSync`
- 前端浮动面板 hook：`usePanelLayout`
- 前端选择和右键动作 hook：`useSelectionActions`
- 区域编辑 hook：`useRegionEditing`
- 后端模型配置服务：`model_config_service.py`
- 后端区域 API 服务：`region_service.py`
- 后端模型动作规整：`action_coercion.py`

拆分原则：

- 先保证测试覆盖。
- 不在同一个提交里同时改行为和大规模搬文件。
- 每次拆分后跑 Pytest、build 和关键 Playwright。

## 14. 发布或打包前检查

至少运行：

```powershell
py -3.11 -m pytest -q
cd frontend
npm run build
npm run test:e2e
```

确认：

- `git status --short` 没有意外运行数据。
- `runtime_project/` 没有被加入 Git。
- 新机器能重新安装 `.venv` 和 `node_modules`。
- 模型能力在新机器上可以重新检测。
- 必要素材已随 `runtime_project/assets/` 一起迁移。

## 15. 快速恢复命令模板

新电脑上从零恢复开发环境：

```powershell
cd <repo>
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"

cd frontend
npm install
npx playwright install chromium
cd ..

$env:AGENT_ENGINE_PROJECT_DIR = "runtime_project"
py -3.11 -m uvicorn agent_engine.api.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

另开终端：

```powershell
cd <repo>\frontend
npm run dev -- --port 5173
```

打开：

```text
http://127.0.0.1:5173/
```
