import { Plus, Send } from "lucide-react";
import { useState } from "react";
import { postAction } from "../lib/api";
import type { Point, SelectionState, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  selection: SelectionState;
  onSelect: (selection: SelectionState) => void;
  onLocateAgent: (agentId: string) => void;
  onRenameAgent: (agentId: string, name: string) => void;
  onCreateAgent: (name: string, role: string, point: Point) => void;
  onRefresh: () => void;
};

export function AgentPanel({ world, selection, onSelect, onLocateAgent, onRenameAgent, onCreateAgent, onRefresh }: Props) {
  const [name, setName] = useState("新 Agent");
  const [role, setRole] = useState("居民");
  const [speech, setSpeech] = useState("");
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

  return (
    <div className="agent-panel" onClick={() => setMenu(null)}>
      <div className="agent-stack">
        {Object.values(world.agent_profiles).map((agent) => {
          const state = world.agent_states[agent.id];
          return (
            <button
              className={selection.kind === "agent" && selection.id === agent.id ? "agent-card active" : "agent-card"}
              key={agent.id}
              onClick={() => onSelect({ kind: "agent", id: agent.id })}
              onDoubleClick={() => onLocateAgent(agent.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                onSelect({ kind: "agent", id: agent.id });
                setMenu({ x: event.clientX, y: event.clientY, agentId: agent.id });
              }}
            >
              <span className="agent-swatch" style={{ background: agent.color }} />
              <span>
                <strong>{agent.name}</strong>
                <small>
                  {state?.pending_model ? "思考中" : stateLabel(state?.status)} / {agent.role}
                </small>
              </span>
            </button>
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
