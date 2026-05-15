from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from .world import Event, GameWorld, Memory, new_id


IMPORTANT_EVENT_TYPES = {
    "dialogue",
    "interaction",
    "speech",
    "environment",
    "hint",
    "narration",
    "rejected_action",
    "model_error",
}
DEFAULT_CONTEXT_BUDGET_CHARS = 6000
DEFAULT_RECENT_EVENT_WINDOW = 8
DEFAULT_SCENE_MEMORY_WINDOW = 5


@dataclass(slots=True)
class CompressionResult:
    should_compress: bool
    summary: str
    memories: list[dict[str, Any]] = field(default_factory=list)
    reason: str = ""
    input_chars: int = 0


class ContextCompressor:
    """Small deterministic scene ledger used before spending LLM tokens."""

    def __init__(
        self,
        *,
        context_budget_chars: int = DEFAULT_CONTEXT_BUDGET_CHARS,
        recent_event_window: int = DEFAULT_RECENT_EVENT_WINDOW,
        scene_memory_window: int = DEFAULT_SCENE_MEMORY_WINDOW,
        event_threshold: int = 12,
    ):
        self.context_budget_chars = max(1000, int(context_budget_chars))
        self.recent_event_window = max(1, int(recent_event_window))
        self.scene_memory_window = max(1, int(scene_memory_window))
        self.event_threshold = max(1, int(event_threshold))

    def compact_observation(self, observation: dict[str, Any]) -> dict[str, Any]:
        compact = dict(observation)
        compact["agent_recent_events"] = _last_items(compact.get("agent_recent_events"), self.recent_event_window)
        compact["recent_events"] = _last_items(compact.get("recent_events"), self.recent_event_window)
        compact["recent_utterances"] = _last_items(compact.get("recent_utterances"), 6)
        compact["scene_memories"] = _last_items(compact.get("scene_memories"), self.scene_memory_window)
        scene_context = compact.get("scene_context")
        if isinstance(scene_context, dict):
            compact["scene_context"] = {
                **scene_context,
                "memories": _last_items(scene_context.get("memories"), self.scene_memory_window),
                "cues": _last_items(scene_context.get("cues"), self.scene_memory_window),
            }
        return self._trim_to_budget(compact)

    def compress_world(self, world: GameWorld, *, force: bool = False) -> CompressionResult:
        recent_events = [
            event
            for event in world.events
            if event.type not in {"model_text", "system"}
        ][-self.event_threshold :]
        payload = {
            "recent_summary": world.narrative.get("recent_summary", ""),
            "events": [event.to_dict() for event in recent_events],
            "agent_states": {
                agent_id: {
                    "status": state.status,
                    "held_item_id": state.held_item_id,
                    "narrative_state": state.narrative_state,
                }
                for agent_id, state in world.agent_states.items()
            },
            "scene_memories": [
                memory.to_dict()
                for memory in world.memories
                if memory.agent_id == "__scene__"
            ][-self.scene_memory_window :],
        }
        input_chars = len(json.dumps(payload, ensure_ascii=False, default=str))
        important = any(event.type in IMPORTANT_EVENT_TYPES for event in recent_events)
        should_compress = force or important or len(recent_events) >= self.event_threshold or input_chars > self.context_budget_chars
        if not should_compress:
            return CompressionResult(
                should_compress=False,
                summary=str(world.narrative.get("recent_summary") or ""),
                reason="below_threshold",
                input_chars=input_chars,
            )
        summary = self._summary_for(recent_events, world)
        memory_text = summary[:500]
        memories = [
            {
                "op": "add_memory",
                "agent_id": "__scene__",
                "kind": "scene",
                "text": memory_text,
                "id": new_id("mem"),
            }
        ] if memory_text else []
        return CompressionResult(
            should_compress=True,
            summary=summary,
            memories=memories,
            reason="important_events" if important else "budget",
            input_chars=input_chars,
        )

    def _summary_for(self, events: list[Event], world: GameWorld) -> str:
        if not events:
            return str(world.narrative.get("recent_summary") or "The scene is quiet.")
        lines: list[str] = []
        for event in events[-self.recent_event_window :]:
            agent_name = ""
            if event.agent_id and event.agent_id in world.agent_profiles:
                agent_name = world.agent_profiles[event.agent_id].name
            prefix = f"{agent_name}: " if agent_name else ""
            message = str(event.message or "").strip()
            if message:
                lines.append(f"{event.type} {prefix}{message}")
        if not lines:
            return str(world.narrative.get("recent_summary") or "The scene continues.")
        return " | ".join(lines)[-500:]

    def _trim_to_budget(self, observation: dict[str, Any]) -> dict[str, Any]:
        payload = json.dumps(observation, ensure_ascii=False, default=str)
        if len(payload) <= self.context_budget_chars:
            observation["context_budget"] = {
                "input_chars": len(payload),
                "budget_chars": self.context_budget_chars,
                "trimmed": False,
            }
            return observation
        trimmed = dict(observation)
        trimmed["agent_recent_events"] = _last_items(trimmed.get("agent_recent_events"), 4)
        trimmed["recent_events"] = _last_items(trimmed.get("recent_events"), 4)
        trimmed["recent_utterances"] = _last_items(trimmed.get("recent_utterances"), 4)
        trimmed["relationships"] = _last_items(trimmed.get("relationships"), 4)
        trimmed["movement_targets"] = _last_items(trimmed.get("movement_targets"), 5)
        trimmed["context_budget"] = {
            "input_chars": len(json.dumps(trimmed, ensure_ascii=False, default=str)),
            "budget_chars": self.context_budget_chars,
            "trimmed": True,
        }
        return trimmed


def _last_items(value: Any, limit: int) -> list[Any]:
    if not isinstance(value, list):
        return []
    return value[-max(0, limit) :]
