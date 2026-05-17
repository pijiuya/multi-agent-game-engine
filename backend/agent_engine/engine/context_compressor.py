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
        trimmed["agent_recent_events"] = _compact_events(trimmed.get("agent_recent_events"), 4)
        trimmed["recent_events"] = _compact_events(trimmed.get("recent_events"), 4)
        trimmed["recent_utterances"] = _compact_utterances(trimmed.get("recent_utterances"), 4)
        trimmed["scene_memories"] = _compact_memories(trimmed.get("scene_memories"), 1)
        trimmed["scene_context"] = _compact_scene_context(trimmed.get("scene_context"), self.scene_memory_window)
        trimmed["region_context"] = _compact_region_context(trimmed.get("region_context"))
        trimmed["conversation_focus"] = _compact_conversation_focus(trimmed.get("conversation_focus"))
        trimmed["item_context"] = _compact_item_context(trimmed.get("item_context"))
        trimmed["movement_targets"] = _compact_movement_targets(trimmed.get("movement_targets"), 5)
        trimmed["context_budget"] = {
            "input_chars": len(json.dumps(trimmed, ensure_ascii=False, default=str)),
            "budget_chars": self.context_budget_chars,
            "trimmed": True,
        }
        if trimmed["context_budget"]["input_chars"] > self.context_budget_chars:
            trimmed["scene_memories"] = []
            scene_context = trimmed.get("scene_context")
            if isinstance(scene_context, dict):
                scene_context.pop("cues", None)
            trimmed["region_context"] = _compact_region_context(trimmed.get("region_context"), nearby_limit=1)
            trimmed["agent_recent_events"] = _compact_events(trimmed.get("agent_recent_events"), 4)
            trimmed["recent_events"] = _compact_events(trimmed.get("recent_events"), 4)
            trimmed["recent_utterances"] = _compact_utterances(trimmed.get("recent_utterances"), 4)
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


def _short_text(value: Any, limit: int = 220) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _compact_events(value: Any, limit: int) -> list[dict[str, Any]]:
    events = _last_items(value, limit)
    compact: list[dict[str, Any]] = []
    for event in events:
        if not isinstance(event, dict):
            continue
        compact.append(
            {
                "type": event.get("type"),
                "agent_id": event.get("agent_id"),
                "tick": event.get("tick"),
                "message": _short_text(event.get("message"), 180),
            }
        )
    return compact


def _compact_utterances(value: Any, limit: int) -> list[dict[str, Any]]:
    utterances = _last_items(value, limit)
    compact: list[dict[str, Any]] = []
    for utterance in utterances:
        if not isinstance(utterance, dict):
            continue
        compact.append(
            {
                "agent_id": utterance.get("agent_id"),
                "target_agent_id": utterance.get("target_agent_id"),
                "tick": utterance.get("tick"),
                "text": _short_text(utterance.get("text"), 140),
            }
        )
    return compact


def _compact_memories(value: Any, limit: int) -> list[dict[str, Any]]:
    memories = _last_items(value, limit)
    compact: list[dict[str, Any]] = []
    for memory in memories:
        if not isinstance(memory, dict):
            continue
        compact.append(
            {
                "agent_id": memory.get("agent_id"),
                "kind": memory.get("kind"),
                "text": _short_text(memory.get("text"), 220),
            }
        )
    return compact


def _compact_scene_context(value: Any, memory_limit: int = 1) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {
        "recent_summary": _short_text(value.get("recent_summary"), 220),
        "agent_narrative_state": value.get("agent_narrative_state", {}),
        "cues": _compact_events(value.get("cues"), 2),
        "memories": _compact_memories(value.get("memories"), memory_limit),
    }


def _compact_region_context(value: Any, nearby_limit: int = 2) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {
        "current": [_compact_region(region) for region in _last_items(value.get("current"), 1)],
        "nearby": [_compact_region(region) for region in _last_items(value.get("nearby"), nearby_limit)],
        "movement_priority": value.get("movement_priority", []),
    }


def _compact_region(region: Any) -> dict[str, Any]:
    if not isinstance(region, dict):
        return {}
    return {
        "id": region.get("id"),
        "name": region.get("name"),
        "function": region.get("function"),
        "distance": region.get("distance"),
        "center": region.get("center"),
    }


def _compact_conversation_focus(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {
        "nearby_agents": [
            {
                "id": agent.get("id"),
                "name": agent.get("name"),
                "status": agent.get("status"),
                "distance": agent.get("distance"),
            }
            for agent in _last_items(value.get("nearby_agents"), 3)
            if isinstance(agent, dict)
        ],
        "nearby_items": [
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "distance": item.get("distance"),
                "interactable": item.get("interactable"),
                "movable": item.get("movable"),
            }
            for item in _last_items(value.get("nearby_items"), 3)
            if isinstance(item, dict)
        ],
        "recent_utterances": _compact_utterances(value.get("recent_utterances"), 3),
    }


def _compact_item_context(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {
        "nearby_named_items": [
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "distance": item.get("distance"),
                "within_interaction_range": item.get("within_interaction_range"),
                "movable": item.get("movable"),
                "interactable": item.get("interactable"),
                "available_affordances": item.get("available_affordances", []),
            }
            for item in _last_items(value.get("nearby_named_items"), 3)
            if isinstance(item, dict)
        ],
        "recent_item_events": _compact_events(value.get("recent_item_events"), 2),
        "item_policy": value.get("item_policy", {}),
    }


def _compact_movement_targets(value: Any, limit: int) -> list[dict[str, Any]]:
    targets = _last_items(value, limit)
    compact: list[dict[str, Any]] = []
    for target in targets:
        if not isinstance(target, dict):
            continue
        compact.append(
            {
                "label": target.get("label"),
                "function": target.get("function"),
                "point": target.get("point"),
            }
        )
    return compact
