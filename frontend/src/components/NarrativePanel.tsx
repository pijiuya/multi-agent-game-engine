import { BookOpenText, Loader2, Pause, Play, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ModelConfig, NarrativeConfig, NarrativeServiceStatus, NarrativeSubtitleStatus, WorldEvent, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  models: ModelConfig[];
  subtitle: NarrativeSubtitleStatus | null;
  service: NarrativeServiceStatus | null;
  onUpdate: (
    patch: Partial<
      Pick<NarrativeConfig, "enabled" | "premise" | "tone" | "cadence_ticks" | "model_provider" | "dedicated_service_enabled" | "service_model">
    >
  ) => void;
  onUpdateService: (patch: { enabled?: boolean; model?: string }) => void;
};

export function NarrativePanel({ world, models, subtitle, service, onUpdate, onUpdateService }: Props) {
  const [draft, setDraft] = useState(() => draftFromNarrative(world.narrative));
  const [dirty, setDirty] = useState(false);
  const eventLine = useMemo(() => latestNarrativeLine(world.events), [world.events]);
  const eventError = useMemo(() => latestSceneDirectorError(world.events), [world.events]);
  const latestLine = subtitle ? subtitle.line : eventLine;
  const latestError = subtitle ? subtitle.error : eventError;
  const serviceStatus = service ?? subtitle?.service ?? null;
  const captionStatus = captionStatusText(world, latestLine, latestError, subtitle);
  const llmModels = useMemo(() => llmModelOptions(models, world.narrative.model_provider), [models, world.narrative.model_provider]);
  const modelNote = useMemo(() => sceneDirectorModelNote(world, models, draft.model_provider, subtitle), [world, models, draft.model_provider, subtitle]);
  const sceneMemories = world.memories.filter((memory) => memory.agent_id === "__scene__").slice(-12).reverse();
  const agentStates = Object.entries(world.agent_states)
    .map(([agentId, state]) => ({ agent: world.agent_profiles[agentId], state }))
    .filter((entry) => entry.agent && Object.keys(entry.state.narrative_state ?? {}).length > 0);

  useEffect(() => {
    if (!dirty) {
      setDraft(draftFromNarrative(world.narrative));
    }
  }, [dirty, world.narrative]);

  function saveDraft() {
    setDirty(false);
    onUpdate({
      premise: draft.premise,
      tone: draft.tone,
      cadence_ticks: Number(draft.cadence_ticks) || 50,
      model_provider: draft.model_provider
    });
  }

  return (
    <div className="narrative-panel">
      <div className="narrative-status-row">
        <span className={world.narrative.enabled ? "narrative-status active" : "narrative-status"}>
          <BookOpenText size={15} />
          {world.narrative.enabled ? "叙事运行" : "叙事关闭"}
        </span>
        {world.scene_director?.pending ? (
          <span className="narrative-pending">
            <Loader2 size={14} />
            生成中
          </span>
        ) : null}
        <button
          className="panel-icon-button"
          title={world.narrative.enabled ? "暂停场景叙事" : "开启场景叙事"}
          aria-label={world.narrative.enabled ? "暂停场景叙事" : "开启场景叙事"}
          onClick={() => onUpdate({ enabled: !world.narrative.enabled })}
        >
          {world.narrative.enabled ? <Pause size={15} /> : <Play size={15} />}
        </button>
      </div>

      <section className="narrative-caption-preview">
        <div>
          <span>画布字幕预览</span>
          <small>{captionStatus.label}</small>
        </div>
        <p>{latestLine?.message ?? captionStatus.message}</p>
      </section>

      <label className="narrative-field">
        <span>场景前提</span>
        <textarea
          value={draft.premise}
          rows={4}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setDirty(true);
            setDraft((current) => ({ ...current, premise: value }));
          }}
        />
      </label>

      <div className="narrative-grid">
        <label className="narrative-field">
          <span>语气</span>
          <input
            value={draft.tone}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDirty(true);
              setDraft((current) => ({ ...current, tone: value }));
            }}
          />
        </label>
        <label className="narrative-field">
          <span>节奏</span>
          <input
            min={1}
            type="number"
            value={draft.cadence_ticks}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDirty(true);
              setDraft((current) => ({ ...current, cadence_ticks: value }));
            }}
          />
        </label>
      </div>

      <label className="narrative-field">
        <span>场景导演模型</span>
        <select
          value={draft.model_provider}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setDirty(true);
            setDraft((current) => ({ ...current, model_provider: value }));
          }}
        >
          {llmModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
        {modelNote ? <small className="narrative-model-note">{modelNote}</small> : null}
      </label>

      <section className="narrative-service-card">
        <div className="narrative-service-heading">
          <span>独立字幕服务</span>
          <small className={serviceStatus?.healthy ? "service-ok" : "service-error"}>
            {world.narrative.dedicated_service_enabled ? (serviceStatus?.healthy ? "已连接" : "离线") : "已关闭"}
          </small>
        </div>
        <label className="narrative-service-toggle">
          <input
            type="checkbox"
            checked={world.narrative.dedicated_service_enabled}
            onChange={(event) => onUpdateService({ enabled: event.currentTarget.checked })}
          />
          <span>字幕生成优先走本地 sidecar，不占用 Agent 对话模型</span>
        </label>
        <label className="narrative-field">
          <span>字幕本地模型</span>
          <select
            value={world.narrative.service_model || serviceStatus?.model || ""}
            onChange={(event) => onUpdateService({ model: event.currentTarget.value })}
            disabled={!world.narrative.dedicated_service_enabled}
          >
            {serviceModelOptions(serviceStatus, world.narrative.service_model, models).map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <small>
            {serviceStatus?.url ? `端口 ${serviceStatus.url}` : "等待本地叙事服务上报端口"}
            {serviceStatus?.last_error ? `；${compactServiceError(serviceStatus.last_error)}` : ""}
          </small>
        </label>
      </section>

      <button className="panel-action-button" onClick={saveDraft}>
        <Save size={15} />
        保存叙事设定
      </button>

      <section className="narrative-section">
        <span>字幕记录</span>
        <p>{latestLine?.message ?? captionStatus.message}</p>
        {latestError ? <small>{latestError.message}</small> : null}
        {subtitle?.recent_summary || world.narrative.recent_summary ? <small>{subtitle?.recent_summary || world.narrative.recent_summary}</small> : null}
      </section>

      <section className="narrative-section">
        <span>近期记忆</span>
        <div className="narrative-memory-list">
          {sceneMemories.length ? sceneMemories.map((memory) => <p key={memory.id}>{memory.text}</p>) : <p>暂无场景记忆</p>}
        </div>
      </section>

      {agentStates.length ? (
        <section className="narrative-section">
          <span>Agent 叙事状态</span>
          <div className="narrative-agent-list">
            {agentStates.map(({ agent, state }) => (
              <p key={agent.id}>
                <strong>{agent.name}</strong>
                {Object.entries(state.narrative_state).map(([key, value]) => ` ${key}:${String(value)}`).join(" / ")}
              </p>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function latestNarrativeLine(events: WorldEvent[]) {
  const reversed = [...events].reverse();
  return (
    reversed.find((event) => ["narration", "hint", "weather", "environment"].includes(event.type)) ??
    reversed.find((event) => event.type === "system" && event.payload?.source === "scene_director") ??
    null
  );
}

function latestSceneDirectorError(events: WorldEvent[]) {
  return [...events].reverse().find((event) => event.type === "scene_director_error") ?? null;
}

function captionStatusText(world: WorldSnapshot, latestLine: WorldEvent | null, latestError: WorldEvent | null, subtitle: NarrativeSubtitleStatus | null) {
  if (latestLine) {
    return { label: "最近字幕", message: latestLine.message };
  }
  if (latestError) {
    return { label: "生成错误", message: "场景导演生成失败，错误详情见下方记录。" };
  }
  if (subtitle?.status === "pending" || subtitle?.pending) {
    return { label: "生成中", message: "场景导演正在生成第一条独立字幕。" };
  }
  if (subtitle?.status === "disabled") {
    return { label: "叙事关闭", message: "开启场景叙事后，运行模拟会生成独立画布字幕。" };
  }
  if (subtitle?.status === "waiting_for_run") {
    return { label: "等待运行", message: "叙事已开启，运行模拟后会生成独立画布字幕。" };
  }
  if (!world.narrative.enabled) {
    return { label: "叙事关闭", message: "开启场景叙事后，运行模拟会生成独立画布字幕。" };
  }
  if (world.scene_director?.pending) {
    return { label: "生成中", message: "场景导演正在生成第一条独立字幕。" };
  }
  if (!world.running) {
    return { label: "等待运行", message: "叙事已开启，运行模拟后会生成独立画布字幕。" };
  }
  return { label: "等待字幕", message: "叙事已开启，导演将在下一个叙事节奏生成字幕。" };
}

function draftFromNarrative(narrative: NarrativeConfig) {
  return {
    premise: narrative.premise,
    tone: narrative.tone,
    cadence_ticks: String(narrative.cadence_ticks),
    model_provider: narrative.model_provider || "mock"
  };
}

function llmModelOptions(models: ModelConfig[], currentProvider: string) {
  const options = models
    .filter((model) => model.enabled && model.capabilities.includes("llm"))
    .map((model) => ({
      id: model.id,
      name: model.name || model.model || model.id
    }));
  if (!options.some((option) => option.id === "mock")) {
    options.unshift({ id: "mock", name: "Mock LLM" });
  }
  if (currentProvider && !options.some((option) => option.id === currentProvider)) {
    options.push({ id: currentProvider, name: `${currentProvider}（当前不可用）` });
  }
  return options;
}

function serviceModelOptions(service: NarrativeServiceStatus | null, currentModel: string, models: ModelConfig[]) {
  const configuredModels = models
    .filter((model) => model.enabled && model.provider === "ollama" && model.capabilities.includes("llm") && model.model)
    .map((model) => model.model);
  const options = [...configuredModels, ...(service?.available_models ?? [])];
  const active = currentModel || service?.model || "qwen2.5:1.5b";
  if (active && !options.includes(active)) {
    options.unshift(active);
  }
  return Array.from(new Set(options.length ? options : ["qwen2.5:1.5b"]));
}

function compactServiceError(error: string) {
  if (!error) {
    return "";
  }
  if (error.includes("Connection refused") || error.includes("Errno 61")) {
    return "服务暂未连接，主后端会继续尝试启动；重启应用或后端后应恢复。";
  }
  return error.length > 120 ? `${error.slice(0, 120)}...` : error;
}

function sceneDirectorModelNote(world: WorldSnapshot, models: ModelConfig[], currentProvider: string, subtitle: NarrativeSubtitleStatus | null) {
  const provider = currentProvider || world.narrative.model_provider || "mock";
  const visibleAgentProviders = new Set(
    Object.values(world.agent_profiles)
      .filter((agent) => !agent.hidden)
      .map((agent) => agent.model_provider)
      .filter(Boolean)
  );
  const conflict = subtitle?.model_conflict ?? (provider !== "mock" && visibleAgentProviders.has(provider));
  const recommended = subtitle?.recommended_model_provider || recommendedSceneDirectorModel(models, provider, visibleAgentProviders);
  const recommendedName = recommended ? modelName(models, recommended) : "";
  if (conflict && recommendedName) {
    return `与 Agent 共用，可能影响对话；建议场景导演改用 ${recommendedName}。`;
  }
  if (conflict) {
    return "与 Agent 共用，可能影响对话；建议为场景导演配置独立 LLM。";
  }
  if (recommendedName && models.filter((model) => model.enabled && model.capabilities.includes("llm")).length > 1) {
    return `可用独立模型：${recommendedName}。`;
  }
  return "";
}

function recommendedSceneDirectorModel(models: ModelConfig[], currentProvider: string, agentProviders: Set<string>) {
  return (
    models.find((model) => model.enabled && model.capabilities.includes("llm") && model.id !== currentProvider && !agentProviders.has(model.id))?.id ?? ""
  );
}

function modelName(models: ModelConfig[], providerId: string) {
  const model = models.find((item) => item.id === providerId);
  return model?.name || model?.model || providerId;
}
