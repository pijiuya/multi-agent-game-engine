import { Check, ChevronDown, ChevronRight, ImageUp, PauseCircle, Plus, RotateCcw, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  checkActionExtension,
  createActionExtension,
  deleteActionExtension,
  getActionExtensions,
  patchActionExtension,
  postAction,
  uploadAsset
} from "../lib/api";
import type {
  ActionExtension,
  ActionExtensionCheckResult,
  AgentAnimation,
  AgentAnimationClip,
  AgentProfile,
  DialoguePolicy,
  ModelConfig,
  Point,
  SelectionState,
  WorldSnapshot
} from "../types";

type Props = {
  world: WorldSnapshot;
  models: ModelConfig[];
  selection: SelectionState;
  onSelect: (selection: SelectionState) => void;
  onLocateAgent: (agentId: string) => void;
  onRenameAgent: (agentId: string, name: string) => void;
  onUpdateAgent: (agentId: string, patch: Partial<Omit<AgentProfile, "id">>) => void;
  onCreateAgent: (name: string, role: string, point: Point) => void;
  onRefresh: () => void;
};

type ImageMetric = {
  width: number;
  height: number;
  pixels: number;
};

const BUILT_IN_ACTIONS = ["move_to", "say", "interact", "use", "observe", "wait", "stop", "social", "pick_up", "drop_item", "move_item"];
const DEFAULT_STATUSES = ["idle", "moving", "social", "speaking", "interact", "use", "waiting", "stopped"];

export function AgentPanel({
  world,
  models,
  selection,
  onSelect,
  onLocateAgent,
  onRenameAgent,
  onUpdateAgent,
  onCreateAgent,
  onRefresh
}: Props) {
  const [name, setName] = useState("新 Agent");
  const [role, setRole] = useState("居民");
  const [speech, setSpeech] = useState("");
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(selection.kind === "agent" ? selection.id : null);
  const [menu, setMenu] = useState<{ x: number; y: number; agentId: string } | null>(null);
  const [extensions, setExtensions] = useState<ActionExtension[]>([]);
  const [extensionCode, setExtensionCode] = useState("");
  const [selectedExtensionId, setSelectedExtensionId] = useState<string | null>(null);
  const [extensionCheck, setExtensionCheck] = useState<ActionExtensionCheckResult | null>(null);
  const [extensionStatus, setExtensionStatus] = useState("扩展未检查");
  const selectedAgent = selection.kind === "agent" ? world.agent_profiles[selection.id] : null;

  useEffect(() => {
    void refreshExtensions();
  }, []);

  const extensionActions = useMemo(() => extensions.filter((extension) => extension.action_type), [extensions]);

  async function refreshExtensions() {
    const next = await getActionExtensions();
    setExtensions(next);
  }

  async function sendSpeech() {
    if (!selectedAgent || !speech.trim()) {
      return;
    }
    await postAction(selectedAgent.id, "say", { text: speech.trim() });
    setSpeech("");
    onRefresh();
  }

  async function stopAgent(agentId: string) {
    await postAction(agentId, "stop", {});
    onRefresh();
  }

  function commitDialoguePolicy(agent: AgentProfile, patch: Partial<DialoguePolicy>) {
    onUpdateAgent(agent.id, {
      dialogue_policy: {
        ...agent.dialogue_policy,
        ...patch
      }
    });
  }

  function commitActionSpace(agent: AgentProfile, action: string, enabled: boolean) {
    const current = new Set(agent.action_space);
    if (enabled) {
      current.add(action);
    } else {
      current.delete(action);
    }
    onUpdateAgent(agent.id, { action_space: Array.from(current) });
  }

  function selectExtension(extension: ActionExtension) {
    setSelectedExtensionId(extension.id);
    setExtensionCode(extension.code);
    setExtensionCheck(extension.check ?? null);
    setExtensionStatus(extension.enabled ? "扩展已启用" : "扩展已停用");
  }

  async function runExtensionCheck() {
    const result = await checkActionExtension(extensionCode);
    setExtensionCheck(result);
    setExtensionStatus(result ? (result.ok ? "检查通过" : "检查未通过") : "检查接口不可用");
  }

  async function saveExtension(enabled = true) {
    const selected = selectedExtensionId ? extensions.find((extension) => extension.id === selectedExtensionId) : null;
    const saved = selected
      ? await patchActionExtension(selected.id, { code: extensionCode, enabled })
      : await createActionExtension({ code: extensionCode, enabled });
    if (!saved) {
      setExtensionStatus("保存失败");
      return;
    }
    setSelectedExtensionId(saved.id);
    setExtensionCode(saved.code);
    setExtensionStatus(saved.enabled ? "已保存并启用" : "已保存");
    await refreshExtensions();
  }

  async function toggleExtension(extension: ActionExtension) {
    const saved = await patchActionExtension(extension.id, { enabled: !extension.enabled });
    if (saved) {
      await refreshExtensions();
      setExtensionStatus(saved.enabled ? "扩展已启用" : "扩展已停用");
    }
  }

  async function removeExtension(extension: ActionExtension) {
    const ok = await deleteActionExtension(extension.id);
    if (!ok) {
      setExtensionStatus("删除失败");
      return;
    }
    setExtensions((current) => current.filter((item) => item.id !== extension.id));
    if (selectedExtensionId === extension.id) {
      setSelectedExtensionId(null);
      setExtensionCode("");
      setExtensionCheck(null);
    }
    setExtensionStatus("已删除");
  }

  return (
    <div className="agent-panel" onClick={() => setMenu(null)}>
      <div className="agent-stack">
        {Object.values(world.agent_profiles).map((agent) => {
          const state = world.agent_states[agent.id];
          const expanded = expandedAgentId === agent.id;
          return (
            <div className="agent-entry" key={agent.id}>
              <button
                className={`${selection.kind === "agent" && selection.id === agent.id ? "agent-card active" : "agent-card"}${agent.hidden ? " hidden-object" : ""}`}
                onClick={() => {
                  onSelect({ kind: "agent", id: agent.id });
                  setExpandedAgentId(expanded ? null : agent.id);
                }}
                onDoubleClick={() => onLocateAgent(agent.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onSelect({ kind: "agent", id: agent.id });
                  setExpandedAgentId(agent.id);
                  setMenu({ x: event.clientX, y: event.clientY, agentId: agent.id });
                }}
              >
                <span className="agent-swatch" style={{ background: agent.color }} />
                <span>
                  <strong>{agent.name}</strong>
                  <small>
                    {agent.hidden ? "已隐藏" : state?.pending_model ? "思考中" : stateLabel(state?.status)} / {agent.role}
                  </small>
                </span>
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {expanded ? (
                <AgentDetail
                  agent={agent}
                  extensionActions={extensionActions}
                  models={models}
                  world={world}
                  onUpdateAgent={(patch) => onUpdateAgent(agent.id, patch)}
                  onActionToggle={(action, enabled) => commitActionSpace(agent, action, enabled)}
                  onStop={() => void stopAgent(agent.id)}
                  onUpdatePolicy={(patch) => commitDialoguePolicy(agent, patch)}
                  onUpdateAnimation={(animation) => onUpdateAgent(agent.id, { animation })}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <ActionExtensionEditor
        code={extensionCode}
        extensions={extensions}
        selectedExtensionId={selectedExtensionId}
        status={extensionStatus}
        check={extensionCheck}
        onCode={setExtensionCode}
        onNew={() => {
          setSelectedExtensionId(null);
          setExtensionCode("");
          setExtensionCheck(null);
          setExtensionStatus("新扩展");
        }}
        onSelect={selectExtension}
        onCheck={() => void runExtensionCheck()}
        onSave={() => void saveExtension(true)}
        onSaveDisabled={() => void saveExtension(false)}
        onToggle={(extension) => void toggleExtension(extension)}
        onDelete={(extension) => void removeExtension(extension)}
      />

      <div className="agent-create-row">
        <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Agent 名称" />
        <input value={role} onChange={(event) => setRole(event.target.value)} aria-label="Agent 身份" />
        <button
          aria-label="创建 agent"
          onClick={() => onCreateAgent(name.trim() || "Agent", role.trim() || "居民", world.map.spawn_points[0] ?? { x: 220, y: 220 })}
        >
          <Plus size={17} />
        </button>
      </div>

      <div className="agent-speech-row">
        <input
          value={speech}
          onChange={(event) => setSpeech(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void sendSpeech();
            }
          }}
          placeholder={selectedAgent ? `以 ${selectedAgent.name} 发言` : "先选择一个 agent"}
          aria-label="发言内容"
        />
        <button aria-label="发送发言" onClick={() => void sendSpeech()}>
          <Send size={17} />
        </button>
      </div>
      {menu ? (
        <div
          className="agent-context-menu"
          data-testid="agent-context-menu"
          onClick={(event) => event.stopPropagation()}
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            onClick={() => {
              const agent = world.agent_profiles[menu.agentId];
              const next = window.prompt("重命名 Agent", agent?.name ?? "")?.trim();
              if (agent && next && next !== agent.name) {
                onRenameAgent(agent.id, next);
              }
              setMenu(null);
            }}
          >
            重命名
          </button>
          <button
            onClick={() => {
              onLocateAgent(menu.agentId);
              setMenu(null);
            }}
          >
            定位
          </button>
          <button
            onClick={() => {
              const agent = world.agent_profiles[menu.agentId];
              if (agent) {
                void navigator.clipboard?.writeText(`${agent.name} / ${agent.role}: ${agent.identity}`);
              }
              setMenu(null);
            }}
          >
            复制身份摘要
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AgentDetail({
  agent,
  world,
  models,
  extensionActions,
  onStop,
  onUpdateAgent,
  onUpdatePolicy,
  onUpdateAnimation,
  onActionToggle
}: {
  agent: AgentProfile;
  world: WorldSnapshot;
  models: ModelConfig[];
  extensionActions: ActionExtension[];
  onStop: () => void;
  onUpdateAgent: (patch: Partial<Omit<AgentProfile, "id">>) => void;
  onUpdatePolicy: (patch: Partial<DialoguePolicy>) => void;
  onUpdateAnimation: (animation: AgentAnimation | null) => void;
  onActionToggle: (action: string, enabled: boolean) => void;
}) {
  const [customStatus, setCustomStatus] = useState("");
  const state = world.agent_states[agent.id];
  const nearby = state ? nearbyAgents(world, agent.id) : [];
  const animation = agent.animation;
  const statuses = Array.from(new Set([...DEFAULT_STATUSES, ...Object.keys(animation?.clips ?? {})]));
  const llmModels = llmModelOptions(models, agent.model_provider);

  return (
    <div className="agent-detail-panel" data-testid={`agent-detail-${agent.id}`}>
      <div className="agent-detail-grid">
        <span>实时坐标</span>
        <strong>{state ? `${Math.round(state.position.x)}, ${Math.round(state.position.y)}` : "未知"}</strong>
        <span>目的地</span>
        <strong>{state?.target ? `${Math.round(state.target.x)}, ${Math.round(state.target.y)}` : "无"}</strong>
        <span>手持</span>
        <strong>{state?.held_item_id ?? "无"}</strong>
      </div>
      <button className="agent-inline-action" disabled={!state?.target && state?.status !== "moving"} onClick={onStop} type="button">
        <PauseCircle size={14} />
        停止移动
      </button>

      <label className="agent-model-row">
        <span>Agent LLM</span>
        <select
          aria-label={`${agent.name} LLM`}
          value={agent.model_provider || "mock"}
          onChange={(event) => onUpdateAgent({ model_provider: event.currentTarget.value })}
        >
          {llmModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>

      <div className="agent-nearby-list">
        <span>附近 Agent 距离</span>
        {nearby.length ? nearby.map((item) => <small key={item.id}>{item.name} · {Math.round(item.distance)} px</small>) : <small>附近暂无 agent</small>}
      </div>

      <div className="agent-policy-row">
        <label>
          <input
            type="checkbox"
            checked={agent.dialogue_policy.enabled}
            onChange={(event) => onUpdatePolicy({ enabled: event.currentTarget.checked })}
          />
          自动对话
        </label>
        <label>
          <input
            type="checkbox"
            checked={agent.dialogue_policy.language === "zh-CN"}
            onChange={(event) => onUpdatePolicy({ language: event.currentTarget.checked ? "zh-CN" : "auto" })}
          />
          中文对话
        </label>
        <input
          aria-label="对话距离"
          key={`${agent.id}-dialogue-distance-${agent.dialogue_policy.distance}`}
          defaultValue={agent.dialogue_policy.distance}
          onBlur={(event) => onUpdatePolicy({ distance: Number(event.currentTarget.value) || 240 })}
          type="number"
        />
        <input
          aria-label="对话冷却"
          key={`${agent.id}-dialogue-cooldown-${agent.dialogue_policy.cooldown_ticks}`}
          defaultValue={agent.dialogue_policy.cooldown_ticks}
          onBlur={(event) => onUpdatePolicy({ cooldown_ticks: Number(event.currentTarget.value) || 6 })}
          type="number"
        />
      </div>

      <div className="agent-item-policy">
        <label>
          <span>Item 互动可能性</span>
          <strong>{Math.round((agent.dialogue_policy.item_interaction_chance ?? 0.35) * 100)}%</strong>
          <input
            aria-label="Item 互动可能性"
            max="1"
            min="0"
            step="0.05"
            type="range"
            value={agent.dialogue_policy.item_interaction_chance ?? 0.35}
            onChange={(event) => onUpdatePolicy({ item_interaction_chance: Number(event.currentTarget.value) })}
          />
        </label>
        <label>
          <span>Item 提及可能性</span>
          <strong>{Math.round((agent.dialogue_policy.item_mention_chance ?? 0.12) * 100)}%</strong>
          <input
            aria-label="Item 提及可能性"
            max="1"
            min="0"
            step="0.05"
            type="range"
            value={agent.dialogue_policy.item_mention_chance ?? 0.12}
            onChange={(event) => onUpdatePolicy({ item_mention_chance: Number(event.currentTarget.value) })}
          />
        </label>
      </div>

      <div className="agent-action-space">
        <span>LLM 动作空间</span>
        <div>
          {[...BUILT_IN_ACTIONS.map((type) => ({ type, label: type, enabled: true })), ...extensionActions.map((extension) => ({
            type: extension.action_type,
            label: extension.action_type,
            enabled: extension.enabled
          }))].map((action) => (
            <label key={action.type} className={action.enabled ? "" : "disabled-action"}>
              <input
                type="checkbox"
                checked={agent.action_space.includes(action.type)}
                disabled={!action.enabled}
                onChange={(event) => onActionToggle(action.type, event.currentTarget.checked)}
              />
              {action.label}
            </label>
          ))}
        </div>
      </div>

      <div className="agent-animation-section">
        <div className="agent-section-heading">
          <span>状态动画</span>
          <div className="agent-custom-status">
            <input value={customStatus} onChange={(event) => setCustomStatus(event.target.value)} placeholder="自定义状态" />
            <button
              type="button"
              onClick={() => {
                const next = customStatus.trim();
                if (next) {
                  onUpdateAnimation(upsertClip(animation, next, null));
                  setCustomStatus("");
                }
              }}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        {statuses.map((status) => (
          <AnimationClipRow
            key={status}
            animation={animation}
            status={status}
            onChange={(clip) => onUpdateAnimation(upsertClip(animation, status, clip))}
          />
        ))}
      </div>
    </div>
  );
}

function AnimationClipRow({
  animation,
  status,
  onChange
}: {
  animation: AgentAnimation | null;
  status: string;
  onChange: (clip: AgentAnimationClip | null) => void;
}) {
  const clip = animation?.clips[status] ?? null;

  async function uploadGif(file: File) {
    const metric = await readImageMetric(file);
    const uploaded = await uploadAsset(file);
    onChange({
      kind: "gif",
      url: uploaded.url,
      frames: [],
      fps: clip?.fps ?? 8,
      max_pixels: metric.pixels,
      width: metric.width,
      height: metric.height,
      world_height: clip?.world_height ?? 72,
      scale: clip?.scale ?? 1
    });
  }

  async function uploadPngSequence(files: FileList) {
    const ordered = Array.from(files).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!ordered.length) {
      return;
    }
    const metrics = await Promise.all(ordered.map(readImageMetric));
    const uploaded = await Promise.all(ordered.map((file) => uploadAsset(file)));
    const max = metrics.reduce((current, metric) => (metric.pixels > current.pixels ? metric : current), metrics[0]);
    onChange({
      kind: "png_sequence",
      url: "",
      frames: uploaded.map((item) => item.url),
      fps: clip?.fps ?? 8,
      max_pixels: max.pixels,
      width: max.width,
      height: max.height,
      world_height: clip?.world_height ?? 72,
      scale: clip?.scale ?? 1
    });
  }

  return (
    <div className="agent-animation-row">
      <strong>{status}</strong>
      <label className="agent-file-action">
        <ImageUp size={14} />
        GIF
        <input
          accept="image/gif"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) {
              void uploadGif(file);
            }
            event.currentTarget.value = "";
          }}
          type="file"
        />
      </label>
      <label className="agent-file-action">
        <ImageUp size={14} />
        PNG
        <input
          accept="image/png"
          multiple
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (files?.length) {
              void uploadPngSequence(files);
            }
            event.currentTarget.value = "";
          }}
          type="file"
        />
      </label>
      <button className="agent-inline-action" disabled={!clip} onClick={() => onChange(null)} type="button">
        <RotateCcw size={14} />
        清除
      </button>
      <div className="agent-animation-meta">
        {clip ? (
          <>
            <small>{clip.kind === "gif" ? "GIF" : `PNG ${clip.frames.length} 帧`} · {formatPixels(clip.max_pixels)} · {clip.width} x {clip.height}</small>
            <label>
              FPS
              <input
                aria-label={`${status} FPS`}
                defaultValue={clip.fps}
                onBlur={(event) => onChange({ ...clip, fps: Math.max(1, Number(event.currentTarget.value) || 8) })}
                type="number"
              />
            </label>
            <label>
              高度
              <input
                aria-label={`${status} world height`}
                defaultValue={clip.world_height}
                onBlur={(event) => onChange({ ...clip, world_height: clampWorldHeight(event.currentTarget.value) })}
                type="number"
              />
            </label>
            <label>
              缩放
              <input
                aria-label={`${status} scale`}
                defaultValue={clip.scale}
                max={6}
                min={0.1}
                onBlur={(event) => onChange({ ...clip, scale: clampAnimationScale(event.currentTarget.value) })}
                step={0.1}
                type="number"
              />
            </label>
          </>
        ) : (
          <small>未设置</small>
        )}
      </div>
    </div>
  );
}

function ActionExtensionEditor({
  extensions,
  selectedExtensionId,
  code,
  status,
  check,
  onCode,
  onNew,
  onSelect,
  onCheck,
  onSave,
  onSaveDisabled,
  onToggle,
  onDelete
}: {
  extensions: ActionExtension[];
  selectedExtensionId: string | null;
  code: string;
  status: string;
  check: ActionExtensionCheckResult | null;
  onCode: (code: string) => void;
  onNew: () => void;
  onSelect: (extension: ActionExtension) => void;
  onCheck: () => void;
  onSave: () => void;
  onSaveDisabled: () => void;
  onToggle: (extension: ActionExtension) => void;
  onDelete: (extension: ActionExtension) => void;
}) {
  return (
    <div className="agent-extension-editor">
      <div className="agent-section-heading">
        <span>动作扩展</span>
        <button type="button" onClick={onNew}>
          <Plus size={14} />
        </button>
      </div>
      <div className="agent-extension-list">
        {extensions.length ? (
          extensions.map((extension) => (
            <button
              className={selectedExtensionId === extension.id ? "active" : ""}
              key={extension.id}
              onClick={() => onSelect(extension)}
              type="button"
            >
              <span>{extension.action_type || extension.id}</span>
              <small>{extension.enabled ? "启用" : "停用"}</small>
            </button>
          ))
        ) : (
          <small>暂无扩展动作</small>
        )}
      </div>
      <textarea value={code} onChange={(event) => onCode(event.target.value)} placeholder="粘贴 Python 动作扩展代码" />
      <div className="agent-extension-actions">
        <button type="button" onClick={onCheck} disabled={!code.trim()}>
          <Check size={14} />
          检查
        </button>
        <button type="button" onClick={onSave} disabled={!code.trim()}>
          <Save size={14} />
          保存启用
        </button>
        <button type="button" onClick={onSaveDisabled} disabled={!code.trim()}>
          停用保存
        </button>
      </div>
      <div className="agent-extension-manage">
        {extensions.map((extension) => (
          <div key={extension.id}>
            <span>{extension.action_type || extension.id}</span>
            <button type="button" onClick={() => onToggle(extension)}>
              {extension.enabled ? "停用" : "启用"}
            </button>
            <button type="button" onClick={() => onDelete(extension)}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <small className={check?.ok ? "agent-extension-status ok" : "agent-extension-status"}>{status}</small>
      {check?.issues.length ? (
        <div className="agent-extension-issues">
          {check.issues.slice(0, 4).map((issue, index) => (
            <small key={`${issue.message}-${index}`}>{issue.severity}: {issue.message}</small>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function upsertClip(animation: AgentAnimation | null, status: string, clip: AgentAnimationClip | null): AgentAnimation | null {
  const current = animation?.clips ?? {};
  const nextClips = { ...current };
  if (clip) {
    nextClips[status] = clip;
  } else {
    delete nextClips[status];
  }
  const idle = nextClips.idle ?? Object.values(nextClips)[0];
  return idle ? { ...idle, clips: { ...nextClips, idle } } : null;
}

function nearbyAgents(world: WorldSnapshot, agentId: string) {
  const state = world.agent_states[agentId];
  if (!state) {
    return [];
  }
  return Object.values(world.agent_profiles)
    .filter((agent) => agent.id !== agentId && !agent.hidden && world.agent_states[agent.id])
    .map((agent) => {
      const other = world.agent_states[agent.id];
      return {
        id: agent.id,
        name: agent.name,
        distance: Math.hypot(other.position.x - state.position.x, other.position.y - state.position.y)
      };
    })
    .sort((a, b) => a.distance - b.distance);
}

function readImageMetric(file: File): Promise<ImageMetric> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight, pixels: image.naturalWidth * image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片尺寸"));
    };
    image.src = url;
  });
}

function formatPixels(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}MP`;
  }
  return `${value}px`;
}

function clampAnimationScale(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(0.1, Math.min(6, parsed));
}

function clampWorldHeight(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 72;
  }
  return Math.max(8, Math.min(800, parsed));
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

function stateLabel(status?: string) {
  const labels: Record<string, string> = {
    idle: "待机",
    moving: "移动中",
    social: "社交中",
    speaking: "发言中",
    interact: "互动中",
    use: "使用中",
    waiting: "等待中",
    stopped: "已停止"
  };
  return labels[status ?? "idle"] ?? status ?? "待机";
}
