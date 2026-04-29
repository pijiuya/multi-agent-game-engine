import { Bot, CheckCircle2, Cloud, ImagePlus, Layers3, RefreshCw, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { ModelCapabilityId, ModelCapabilityStatus, ModelCapabilityTask, ModelConfig } from "../types";

type RemoteDraft = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

type Props = {
  statuses: ModelCapabilityStatus[];
  tasks: Partial<Record<ModelCapabilityId, ModelCapabilityTask>>;
  models: ModelConfig[];
  onRefresh: () => void;
  onConfigureLocal: (capability: ModelCapabilityId) => void;
  onInstallLocal: (capability: ModelCapabilityId) => void;
  onConfigureRemote: (capability: ModelCapabilityId, draft: RemoteDraft) => void;
};

const CAPABILITY_ORDER: ModelCapabilityId[] = ["llm", "image_generation", "segmentation"];

const CAPABILITY_META: Record<
  ModelCapabilityId,
  { title: string; subtitle: string; icon: typeof Bot; localLabel: string; setupSteps: string[] }
> = {
  llm: {
    title: "语言模型 LLM",
    subtitle: "控制 agent 的语言、意图和身份表达",
    icon: Bot,
    localLabel: "一键使用本地 LLM",
    setupSteps: [
      "安装并打开 Ollama。",
      "准备 qwen2.5:1.5b、qwen2.5:7b 或 gemma3:1b。",
      "回到这里点击重新检测，再一键使用本地 LLM。"
    ]
  },
  image_generation: {
    title: "图片生成",
    subtitle: "生成 2D 地图背景和后续局部重绘",
    icon: ImagePlus,
    localLabel: "一键使用本地图片服务",
    setupSteps: [
      "首版可以先用内置测试候选或直接导入图片。",
      "要接本地图片模型时，启动 ComfyUI 或同类本地图片生成器。",
      "生成器给出服务地址后，在高级配置里填入并保存。"
    ]
  },
  segmentation: {
    title: "SAM 分层",
    subtitle: "把背景图切分成可命名、可设定功能的区域",
    icon: Layers3,
    localLabel: "一键使用本地 SAM",
    setupSteps: [
      "点击安装并启用内置 SAM。",
      "程序会自动安装 MobileSAM 并缓存轻量权重。",
      "完成后回到地图工作台直接开始 SAM 分层。"
    ]
  }
};

export function ModelManagerPanel({ statuses, tasks, models, onRefresh, onConfigureLocal, onInstallLocal, onConfigureRemote }: Props) {
  const [activeCapability, setActiveCapability] = useState<ModelCapabilityId>("llm");
  const [advancedOpen, setAdvancedOpen] = useState<Record<ModelCapabilityId, boolean>>({
    llm: false,
    image_generation: false,
    segmentation: false
  });
  const [remoteDrafts, setRemoteDrafts] = useState<Record<ModelCapabilityId, RemoteDraft>>(() => ({
    llm: defaultRemoteDraft("llm", models),
    image_generation: defaultRemoteDraft("image_generation", models),
    segmentation: defaultRemoteDraft("segmentation", models)
  }));
  const statusMap = new Map(statuses.map((status) => [status.id, status]));

  useEffect(() => {
    setRemoteDrafts((current) => {
      let changed = false;
      const next = { ...current };
      for (const capability of CAPABILITY_ORDER) {
        const currentDraft = current[capability];
        if (currentDraft.baseUrl || currentDraft.apiKey || currentDraft.model) {
          continue;
        }
        const defaultDraft = defaultRemoteDraft(capability, models);
        if (defaultDraft.baseUrl || defaultDraft.apiKey || defaultDraft.model) {
          next[capability] = defaultDraft;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [models]);

  function updateRemoteDraft(capability: ModelCapabilityId, patch: Partial<RemoteDraft>) {
    setRemoteDrafts((current) => ({
      ...current,
      [capability]: {
        ...current[capability],
        ...patch
      }
    }));
  }

  return (
    <div className="model-manager-panel" data-testid="model-manager-panel">
      <div className="panel-section-label">模型管理</div>
      <div className="model-capability-cards" data-testid="model-capability-cards">
        {CAPABILITY_ORDER.map((capability) => {
          const status = statusMap.get(capability) ?? fallbackStatus(capability);
          const meta = CAPABILITY_META[capability];
          const Icon = meta.icon;
          return (
            <button
              className={activeCapability === capability ? "model-capability-card active" : "model-capability-card"}
              data-testid={`model-capability-${capability}`}
              key={capability}
              onClick={() => setActiveCapability(capability)}
              type="button"
            >
              <Icon size={16} />
              <span>
                <strong>{meta.title}</strong>
                <small>{statusBadge(status)}</small>
              </span>
            </button>
          );
        })}
      </div>

      <CapabilityDetail
        advancedOpen={advancedOpen[activeCapability]}
        capability={activeCapability}
        draft={remoteDrafts[activeCapability]}
        onConfigureLocal={onConfigureLocal}
        onInstallLocal={onInstallLocal}
        onConfigureRemote={() => onConfigureRemote(activeCapability, remoteDrafts[activeCapability])}
        onRefresh={onRefresh}
        task={tasks[activeCapability] ?? null}
        onToggleAdvanced={() => setAdvancedOpen((current) => ({ ...current, [activeCapability]: !current[activeCapability] }))}
        onUpdateDraft={(patch) => updateRemoteDraft(activeCapability, patch)}
        status={statusMap.get(activeCapability) ?? fallbackStatus(activeCapability)}
      />
    </div>
  );
}

function CapabilityDetail({
  capability,
  status,
  draft,
  advancedOpen,
  task,
  onRefresh,
  onConfigureLocal,
  onInstallLocal,
  onConfigureRemote,
  onToggleAdvanced,
  onUpdateDraft
}: {
  capability: ModelCapabilityId;
  status: ModelCapabilityStatus;
  draft: RemoteDraft;
  advancedOpen: boolean;
  task: ModelCapabilityTask | null;
  onRefresh: () => void;
  onConfigureLocal: (capability: ModelCapabilityId) => void;
  onInstallLocal: (capability: ModelCapabilityId) => void;
  onConfigureRemote: () => void;
  onToggleAdvanced: () => void;
  onUpdateDraft: (patch: Partial<RemoteDraft>) => void;
}) {
  const meta = CAPABILITY_META[capability];
  const canUseLocal = Boolean(status.recommended_local);
  const canInstallLocal = capability === "segmentation" && status.installable;
  const isInstalling = task?.status === "running";
  const isReady = status.status === "ready";
  const actionLabel = isInstalling
    ? `安装中 ${task.progress}%`
    : canInstallLocal
      ? "安装并启用内置 SAM"
      : isReady
        ? readyActionLabel(capability)
        : meta.localLabel;
  const taskMessage = task?.status === "error" ? task.error || task.message : task?.message;
  return (
    <section className="model-capability-detail" data-testid={`model-capability-detail-${capability}`}>
      <div className="model-dialogue-row">
        <strong>{meta.title}</strong>
        <small>{meta.subtitle}</small>
      </div>
      <div className={status.status === "ready" || status.status === "local_available" ? "model-status-card ready" : "model-status-card"}>
        {status.status === "ready" ? <CheckCircle2 size={16} /> : <WandSparkles size={16} />}
        <span>{status.summary}</span>
      </div>
      {status.recommended_local ? (
        <div className="model-dialogue-row">
          <span>推荐本地方案</span>
          <strong>{status.recommended_local.name}</strong>
          <small>{status.recommended_local.model || status.recommended_local.provider}</small>
        </div>
      ) : null}
      {status.suggestions.map((suggestion) => (
        <div className="model-suggestion" key={suggestion}>{suggestion}</div>
      ))}
      {status.status !== "ready" ? (
        <div className="model-setup-steps">
          <span>最快路径</span>
          <ol>
            {meta.setupSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {task ? (
        <div className={task.status === "error" ? "model-install-progress error" : "model-install-progress"} data-testid={`model-install-task-${capability}`}>
          <div>
            <span style={{ width: `${task.progress}%` }} />
          </div>
          <small>{taskMessage}</small>
        </div>
      ) : null}
      <div className="model-action-row">
        <button
          className="panel-action-button"
          disabled={isInstalling || (!canUseLocal && !canInstallLocal)}
          onClick={() => (canInstallLocal ? onInstallLocal(capability) : onConfigureLocal(capability))}
          title={isReady ? "重新确认当前本地模型配置，并在这里显示结果" : undefined}
          type="button"
        >
          <CheckCircle2 size={15} />
          {actionLabel}
        </button>
        <button className="panel-action-button" onClick={onRefresh} type="button">
          <RefreshCw size={15} />
          重新检测
        </button>
      </div>
      <button className="model-advanced-toggle" data-testid={`model-advanced-toggle-${capability}`} onClick={onToggleAdvanced} type="button">
        <Cloud size={14} />
        {advancedOpen ? "收起高级配置" : "高级配置"}
      </button>
      {advancedOpen ? (
        <div className="model-advanced-panel" data-testid={`model-advanced-${capability}`}>
          <label>
            <span>服务地址</span>
            <input aria-label={`${meta.title} 服务地址`} onChange={(event) => onUpdateDraft({ baseUrl: event.currentTarget.value })} value={draft.baseUrl} />
          </label>
          <label>
            <span>API Key</span>
            <input aria-label={`${meta.title} API Key`} onChange={(event) => onUpdateDraft({ apiKey: event.currentTarget.value })} value={draft.apiKey} />
          </label>
          <label>
            <span>模型名称</span>
            <input aria-label={`${meta.title} 模型名称`} onChange={(event) => onUpdateDraft({ model: event.currentTarget.value })} value={draft.model} />
          </label>
          <button className="panel-action-button" disabled={!draft.baseUrl.trim()} onClick={onConfigureRemote} type="button">
            保存远程备用配置
          </button>
        </div>
      ) : null}
    </section>
  );
}

function statusBadge(status: ModelCapabilityStatus) {
  const labels: Record<ModelCapabilityStatus["status"], string> = {
    ready: "已配置",
    local_available: "检测到本地方案",
    installable: "可安装",
    mock_only: "仅测试 Mock",
    missing: "未配置"
  };
  return labels[status.status];
}

function readyActionLabel(capability: ModelCapabilityId) {
  if (capability === "llm") {
    return "重新启用本地 LLM";
  }
  if (capability === "segmentation") {
    return "重新启用内置 SAM";
  }
  return "重新启用本地模型";
}

function defaultRemoteDraft(capability: ModelCapabilityId, models: ModelConfig[]): RemoteDraft {
  const existing = models.find((model) => model.kind === "remote" && model.capabilities.includes(capability));
  return {
    baseUrl: existing?.baseUrl ?? "",
    apiKey: existing?.apiKey ?? "",
    model: existing?.model ?? ""
  };
}

function fallbackStatus(capability: ModelCapabilityId): ModelCapabilityStatus {
  return {
    id: capability,
    label: CAPABILITY_META[capability].title,
    status: "missing",
    summary: "等待后端检测本机模型环境",
    configured: false,
    configured_model_id: null,
    configured_model_name: null,
    local_available: false,
    installable: capability === "segmentation",
    recommended_local: null,
    suggestions: ["点击重新检测获取本机模型状态。"]
  };
}
