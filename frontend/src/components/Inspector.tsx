import { Brain, Eye, MessageSquare, MousePointer2, Plus, Send, Timer } from "lucide-react";
import { useState } from "react";
import { postAction } from "../lib/api";
import type { AgentProfile, AgentState, Point, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onCreateAgent: (name: string, role: string, point: Point) => void;
  onRefresh: () => void;
};

export function Inspector({ world, selectedAgentId, onSelectAgent, onCreateAgent, onRefresh }: Props) {
  const [speech, setSpeech] = useState("");
  const [name, setName] = useState("New Agent");
  const [role, setRole] = useState("resident");
  const selected = selectedAgentId ? world.agent_profiles[selectedAgentId] : null;
  const selectedState = selectedAgentId ? world.agent_states[selectedAgentId] : null;

  async function submitSpeech() {
    if (!selected || !speech.trim()) {
      return;
    }
    await postAction(selected.id, "say", { text: speech.trim() });
    setSpeech("");
    onRefresh();
  }

  async function submitSimpleAction(type: string) {
    if (!selected) {
      return;
    }
    await postAction(selected.id, type, {});
    onRefresh();
  }

  return (
    <aside className="inspector">
      <section className="panel">
        <h2>Agents</h2>
        <div className="agent-list">
          {Object.values(world.agent_profiles).map((agent) => (
            <button
              className={agent.id === selectedAgentId ? "agent-pill active" : "agent-pill"}
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              style={{ borderColor: agent.color }}
            >
              <span style={{ background: agent.color }} />
              {agent.name}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Create</h2>
        <div className="field-grid">
          <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Agent name" />
          <input value={role} onChange={(event) => setRole(event.target.value)} aria-label="Agent role" />
        </div>
        <button
          className="primary wide"
          onClick={() => onCreateAgent(name.trim() || "Agent", role.trim() || "resident", world.map.spawn_points[0] ?? { x: 220, y: 220 })}
        >
          <Plus size={18} />
          Agent
        </button>
      </section>

      {selected && selectedState ? (
        <AgentDetails
          profile={selected}
          state={selectedState}
          speech={speech}
          setSpeech={setSpeech}
          submitSpeech={submitSpeech}
          submitSimpleAction={submitSimpleAction}
        />
      ) : null}
    </aside>
  );
}

function AgentDetails({
  profile,
  state,
  speech,
  setSpeech,
  submitSpeech,
  submitSimpleAction
}: {
  profile: AgentProfile;
  state: AgentState;
  speech: string;
  setSpeech: (value: string) => void;
  submitSpeech: () => void;
  submitSimpleAction: (type: string) => void;
}) {
  return (
    <section className="panel details">
      <div className="identity-row">
        <div className="avatar" style={{ background: profile.color }}>
          {profile.name.slice(0, 1)}
        </div>
        <div>
          <h2>{profile.name}</h2>
          <p>{profile.role}</p>
        </div>
      </div>
      <p className="identity">{profile.identity}</p>
      <dl className="state-grid">
        <div>
          <dt>Status</dt>
          <dd>{state.pending_model ? "thinking" : state.status}</dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>{profile.model_provider}</dd>
        </div>
        <div>
          <dt>X</dt>
          <dd>{Math.round(state.position.x)}</dd>
        </div>
        <div>
          <dt>Y</dt>
          <dd>{Math.round(state.position.y)}</dd>
        </div>
      </dl>
      <div className="action-grid">
        <button onClick={() => submitSimpleAction("observe")}>
          <Eye size={17} />
          Observe
        </button>
        <button onClick={() => submitSimpleAction("wait")}>
          <Timer size={17} />
          Wait
        </button>
      </div>
      <div className="speech-box">
        <MessageSquare size={18} />
        <input
          value={speech}
          onChange={(event) => setSpeech(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void submitSpeech();
            }
          }}
          aria-label="Speech text"
        />
        <button aria-label="Send speech" onClick={() => void submitSpeech()}>
          <Send size={17} />
        </button>
      </div>
      <div className="action-space">
        <Brain size={18} />
        <div>
          {profile.action_space.map((action) => (
            <span key={action}>{action}</span>
          ))}
        </div>
      </div>
      <div className="move-note">
        <MousePointer2 size={17} />
        <span>Move</span>
      </div>
    </section>
  );
}

