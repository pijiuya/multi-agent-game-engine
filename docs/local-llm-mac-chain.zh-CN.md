# Mac 本地 LLM 链路档案

本文记录本项目在当前 Mac 上启用本地 LLM 的环境链条、诊断入口、推荐模型档位和上下文节约策略。目标是让 Electron 版本能用最小本地推理成本支撑较长时间的场景运行。

## 当前机器基线

- 设备：Mac mini，Apple M4，10 核 CPU。
- 内存：16 GB。
- 系统：macOS 26.2。
- 推荐本地模型：`qwen2.5:1.5b` 做实时 agent 决策，`qwen2.5:7b` 做高质量手动档或长等待任务，`qwen2.5vl:3b` 做视觉标签。
- 不建议默认使用：14B、32B 或更大模型。16 GB 内存下可以实验，但不适合作为默认 Electron 运行档位。

## 一键诊断

后端新增诊断入口：

```bash
curl http://127.0.0.1:8000/api/local-llm/mac-diagnostics
```

返回内容包括：

- Homebrew 是否存在。
- `ollama` 命令路径。
- `http://127.0.0.1:11434` 是否可连接。
- Ollama 已安装模型列表。
- 项目 `model_configs` 中启用的 LLM 配置。
- runtime 当前默认 provider。
- 推荐恢复命令。

Electron 中的模型面板仍可使用原来的“本地 LLM”安装/启用流程；诊断入口用于精确判断卡在安装、服务启动、模型下载还是项目配置。

## 手动恢复命令

如果诊断显示未安装 Ollama：

```bash
brew install ollama
```

启动服务：

```bash
ollama serve
```

下载推荐模型：

```bash
ollama pull qwen2.5:7b
ollama pull qwen2.5:1.5b
ollama pull qwen2.5vl:3b
```

确认模型列表：

```bash
ollama list
curl http://127.0.0.1:11434/api/tags
```

启用项目本地 LLM：

```bash
curl -X POST http://127.0.0.1:8000/api/model-capabilities/llm/configure-local
```

如果模型尚未下载，也可以让后端安装任务处理：

```bash
curl -X POST http://127.0.0.1:8000/api/model-capabilities/llm/install-local
```

Mac 上后端会优先尝试 Homebrew；Windows 上仍保留 `winget` 分支。

## Electron 验证

1. 启动后端和 Electron。
2. 打开模型面板，确认“语言模型 LLM”显示为本地 Ollama 配置。
3. 启动仿真，等待 1-2 个 agent 决策周期。
4. 检查事件流中是否出现非 `mock` provider 的决策。
5. 调用 `/api/world`，确认 `decision_events` 里包含：

```json
{
  "provider": "ollama",
  "model": "qwen2.5:1.5b",
  "results": [
    {
      "input_chars": 1234,
      "elapsed_ms": 456.7
    }
  ]
}
```

普通移动/观察可能由 `rule-prefilter` 接管，这是正常的省算力行为。实时 agent 默认优先使用 `qwen2.5:1.5b`，避免 7B 模型在 16GB Mac 上频繁超过仿真等待时间；如需更高质量可在高级配置中手动改回 `qwen2.5:7b`。

## 上下文节约策略

第一版不引入向量数据库，使用现有 `events`、`decision_events`、`memories` 和 `narrative_state`。

- `ContextCompressor` 会裁剪 agent observation，只保留短窗口最近事件、场景记忆、对话和移动候选。
- 当重要事件、事件数量阈值或上下文字符预算触发时，压缩器会更新 `narrative.recent_summary` 并写入 `__scene__` 记忆。
- Scene Director 优先使用 `qwen2.5:1.5b`；如果小模型不存在，则使用当前启用的 LLM。
- 实时 agent 优先使用 1.5B 模型处理社交、物品、复杂状态变化等高价值决策；7B 适合手动切换到更长等待时间后使用。
- 普通移动、等待、观察由 `rule-prefilter` 直接生成动作，并仍写入 `decision_events` 供审计。

## 故障排查

- `ollama not found`：运行 `brew install ollama`，或确认 `/opt/homebrew/bin` 在 PATH 中。
- `Failed to connect to 127.0.0.1:11434`：运行 `ollama serve`。
- 模型面板显示可安装但不可启用：先运行 `ollama pull qwen2.5:1.5b`。
- 场景运行很慢：把 `AGENT_ENGINE_LLM_CONCURRENCY=1`，或先使用 `qwen2.5:1.5b`。
- 场景像停住但后台仍有压力：运行时会自动释放超过 `AGENT_ENGINE_MODEL_WATCHDOG_SECONDS` 的 agent 决策任务，并让该模型 provider 进入 `AGENT_ENGINE_PROVIDER_RECOVERY_SECONDS` 的恢复窗口；这段时间 agent 会暂用本地轻量规则继续行动。运行监控面板会显示“模型拥堵自愈中”。
- 对话上下文越来越大：确认 `/api/world` 中 `scene_context.context_budget.trimmed` 或 `context_budget.trimmed` 是否出现，并检查 `narrative.recent_summary` 是否持续更新。

## 推荐环境变量

```bash
export AGENT_ENGINE_LLM_CONCURRENCY=1
export AGENT_ENGINE_AGENT_DECISION_SECONDS=6
export AGENT_ENGINE_LLM_TIMEOUT_SECONDS=45
export AGENT_ENGINE_MODEL_WATCHDOG_SECONDS=18
export AGENT_ENGINE_SCENE_WATCHDOG_SECONDS=20
export AGENT_ENGINE_PROVIDER_RECOVERY_SECONDS=30
export AGENT_ENGINE_CONTEXT_BUDGET_CHARS=6000
export AGENT_ENGINE_ACTION_PREFILTER=1
```

这些默认值偏保守，适合 M4/16GB 上的 Electron 本地运行。需要更多实时性时，可以先缩短 agent 决策间隔，而不是直接增加模型并发。
