import { BookOpenText, Loader2, Pause, Play, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { NarrativeConfig, WorldEvent, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  onUpdate: (patch: Partial<Pick<NarrativeConfig, "enabled" | "premise" | "tone" | "cadence_ticks">>) => void;
};

export function NarrativePanel({ world, onUpdate }: Props) {
  const [draft, setDraft] = useState(() => draftFromNarrative(world.narrative));
  const latestLine = useMemo(() => latestNarrativeLine(world.events), [world.events]);
  const sceneMemories = world.memories.filter((memory) => memory.agent_id === "__scene__").slice(-12).reverse();
  const agentStates = Object.entries(world.agent_states)
    .map(([agentId, state]) => ({ agent: world.agent_profiles[agentId], state }))
    .filter((entry) => entry.agent && Object.keys(entry.state.narrative_state ?? {}).length > 0);

  useEffect(() => {
    setDraft(draftFromNarrative(world.narrative));
  }, [world.narrative]);

  function saveDraft() {
    onUpdate({
      premise: draft.premise,
      tone: draft.tone,
      cadence_ticks: Number(draft.cadence_ticks) || 50
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

      <label className="narrative-field">
        <span>场景前提</span>
        <textarea
          value={draft.premise}
          rows={4}
          onChange={(event) => setDraft((current) => ({ ...current, premise: event.currentTarget.value }))}
        />
      </label>

      <div className="narrative-grid">
        <label className="narrative-field">
          <span>语气</span>
          <input
            value={draft.tone}
            onChange={(event) => setDraft((current) => ({ ...current, tone: event.currentTarget.value }))}
          />
        </label>
        <label className="narrative-field">
          <span>节奏</span>
          <input
            min={1}
            type="number"
            value={draft.cadence_ticks}
            onChange={(event) => setDraft((current) => ({ ...current, cadence_ticks: event.currentTarget.value }))}
          />
        </label>
      </div>

      <button className="panel-action-button" onClick={saveDraft}>
        <Save size={15} />
        保存叙事设定
      </button>

      <section className="narrative-section">
        <span>字幕</span>
        <p>{latestLine?.message ?? "暂无场景叙事"}</p>
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
  return [...events].reverse().find((event) => ["narration", "hint", "weather", "environment"].includes(event.type)) ?? null;
}

function draftFromNarrative(narrative: NarrativeConfig) {
  return {
    premise: narrative.premise,
    tone: narrative.tone,
    cadence_ticks: String(narrative.cadence_ticks)
  };
}
