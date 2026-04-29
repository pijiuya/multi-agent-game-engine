import { ChevronDown, ChevronRight, ImageUp, PauseCircle, Plus, RotateCcw, Send } from "lucide-react";
import { useState } from "react";
import { postAction, uploadAsset } from "../lib/api";
import type { AgentAnimation, AgentProfile, DialoguePolicy, Point, SelectionState, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
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

export function AgentPanel({
  world,
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
  const selectedAgent = selection.kind === "agent" ? world.agent_profiles[selection.id] : null;

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

  async function uploadGif(agent: AgentProfile, file: File) {
    const metric = await readImageMetric(file);
    const uploaded = await uploadAsset(file);
    onUpdateAgent(agent.id, {
      animation: {
        kind: "gif",
        url: uploaded.url,
        frames: [],
        fps: agent.animation?.fps ?? 8,
        max_pixels: metric.pixels,
        width: metric.width,
        height: metric.height,
        scale: agent.animation?.scale ?? 1.6
      }
    });
  }

  async function uploadPngSequence(agent: AgentProfile, files: FileList) {
    const ordered = Array.from(files).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!ordered.length) {
      return;
    }
    const metrics = await Promise.all(ordered.map(readImageMetric));
    const uploaded = await Promise.all(ordered.map((file) => uploadAsset(file)));
    const max = metrics.reduce(
      (current, metric) => (metric.pixels > current.pixels ? metric : current),
      metrics[0]
    );
    onUpdateAgent(agent.id, {
      animation: {
        kind: "png_sequence",
        url: "",
        frames: uploaded.map((item) => item.url),
        fps: agent.animation?.fps ?? 8,
        max_pixels: max.pixels,
        width: max.width,
        height: max.height,
        scale: agent.animation?.scale ?? 1.6
      }
    });
  }

  function commitDialoguePolicy(agent: AgentProfile, patch: Partial<DialoguePolicy>) {
    onUpdateAgent(agent.id, {
      dialogue_policy: {
        ...agent.dialogue_policy,
        ...patch
      }
    });
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
                  world={world}
                  onStop={() => void stopAgent(agent.id)}
                  onUpdatePolicy={(patch) => commitDialoguePolicy(agent, patch)}
                  onUpdateAnimation={(animation) => onUpdateAgent(agent.id, { animation })}
                  onGif={(file) => void uploadGif(agent, file)}
                  onPngs={(files) => void uploadPngSequence(agent, files)}
                />
              ) : null}
            </div>
          );
        })}
      </div>

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
  onStop,
  onUpdatePolicy,
  onUpdateAnimation,
  onGif,
  onPngs
}: {
  agent: AgentProfile;
  world: WorldSnapshot;
  onStop: () => void;
  onUpdatePolicy: (patch: Partial<DialoguePolicy>) => void;
  onUpdateAnimation: (animation: AgentAnimation | null) => void;
  onGif: (file: File) => void;
  onPngs: (files: FileList) => void;
}) {
  const state = world.agent_states[agent.id];
  const nearby = state ? nearbyAgents(world, agent.id) : [];
  const animation = agent.animation;
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
        <input
          aria-label="对话距离"
          defaultValue={agent.dialogue_policy.distance}
          onBlur={(event) => onUpdatePolicy({ distance: Number(event.currentTarget.value) || 180 })}
          type="number"
        />
        <input
          aria-label="对话冷却"
          defaultValue={agent.dialogue_policy.cooldown_ticks}
          onBlur={(event) => onUpdatePolicy({ cooldown_ticks: Number(event.currentTarget.value) || 20 })}
          type="number"
        />
      </div>

      <div className="agent-animation-tools">
        <label className="agent-file-action">
          <ImageUp size={14} />
          GIF
          <input
            accept="image/gif"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                onGif(file);
              }
              event.currentTarget.value = "";
            }}
            type="file"
          />
        </label>
        <label className="agent-file-action">
          <ImageUp size={14} />
          PNG序列
          <input
            accept="image/png"
            multiple
            onChange={(event) => {
              const files = event.currentTarget.files;
              if (files?.length) {
                onPngs(files);
              }
              event.currentTarget.value = "";
            }}
            type="file"
          />
        </label>
        <button className="agent-inline-action" disabled={!animation} onClick={() => onUpdateAnimation(null)} type="button">
          <RotateCcw size={14} />
          清除
        </button>
      </div>
      <div className="agent-animation-meta" data-testid={`agent-animation-meta-${agent.id}`}>
        {animation ? (
          <>
            <span>{animation.kind === "gif" ? "GIF" : `PNG序列 ${animation.frames.length} 帧`}</span>
            <small>最大像素 {formatPixels(animation.max_pixels)} / {animation.width} x {animation.height}</small>
            {animation.kind === "png_sequence" ? (
              <label>
                FPS
                <input
                  aria-label="PNG序列 FPS"
                  defaultValue={animation.fps}
                  onBlur={(event) => onUpdateAnimation({ ...animation, fps: Math.max(1, Number(event.currentTarget.value) || 8) })}
                  type="number"
                />
              </label>
            ) : null}
            <label>
              缩放
              <input
                aria-label="动画缩放"
                defaultValue={animation.scale}
                max={6}
                min={0.1}
                onBlur={(event) => onUpdateAnimation({ ...animation, scale: clampAnimationScale(event.currentTarget.value) })}
                step={0.1}
                type="number"
              />
            </label>
          </>
        ) : (
          <small>未设置动画资产</small>
        )}
      </div>
    </div>
  );
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
    return 1.6;
  }
  return Math.max(0.1, Math.min(6, parsed));
}

function stateLabel(status?: string) {
  const labels: Record<string, string> = {
    idle: "待机",
    moving: "移动中",
    speaking: "发言中",
    interact: "互动中",
    use: "使用中"
  };
  return labels[status ?? "idle"] ?? status ?? "待机";
}
