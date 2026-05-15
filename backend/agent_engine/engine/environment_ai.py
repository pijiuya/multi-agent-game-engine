from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .world import GameWorld, Memory, new_id, normalize_narrative_config


ALLOWED_EVENT_TYPES = {"environment", "narration", "weather", "hint", "system"}
ALLOWED_ITEM_STATE_KEYS = {"label", "enabled", "mood", "description"}
ALLOWED_NARRATIVE_STATE_KEYS = {"mood", "focus", "urgency"}
ALLOWED_MEMORY_KINDS = {"scene", "short_term", "cue"}
MAX_SHORT_TEXT_LENGTH = 80
MAX_MEMORY_TEXT_LENGTH = 500


@dataclass(slots=True)
class ProposalReview:
    accepted: list[dict[str, Any]] = field(default_factory=list)
    rejected: list[dict[str, Any]] = field(default_factory=list)


class EnvironmentArbiter:
    """Accepts only safe Game Master model proposals and records rejected patches."""

    def apply_proposal(self, world: GameWorld, proposal: dict[str, Any]) -> ProposalReview:
        review = ProposalReview()

        for event in proposal.get("events", []):
            event_type = str(event.get("type", "environment"))
            message = str(event.get("message", "")).strip()
            if event_type in ALLOWED_EVENT_TYPES and message:
                created = world.add_event(
                    event_type,
                    message,
                    agent_id=event.get("agent_id"),
                    payload=dict(event.get("payload", {})),
                )
                review.accepted.append({"kind": "event", "event": created.to_dict()})
            else:
                review.rejected.append({"kind": "event", "reason": "unsafe event", "value": event})

        for patch in proposal.get("state_changes", []):
            accepted = self._apply_safe_patch(world, patch)
            if accepted:
                review.accepted.append(accepted)
            else:
                review.rejected.append({"kind": "state_change", "reason": "unsafe patch", "value": patch})

        for patch in proposal.get("memories", []):
            accepted = self._apply_memory_patch(world, patch)
            if accepted:
                review.accepted.append(accepted)
            else:
                review.rejected.append({"kind": "memory", "reason": "unsafe memory", "value": patch})

        if review.rejected:
            world.add_event(
                "system",
                f"Environment proposal rejected {len(review.rejected)} unsafe change(s).",
                payload={"rejected": review.rejected},
            )
        return review

    def _apply_safe_patch(self, world: GameWorld, patch: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(patch, dict):
            return None
        if patch.get("op") == "set_item_state":
            if self._apply_item_patch(world, patch):
                return {"kind": "state_change", "value": patch}
            return None
        if patch.get("op") == "set_agent_narrative_state":
            value = self._apply_agent_narrative_state_patch(world, patch)
            if value is not None:
                return {"kind": "state_change", "value": value}
            return None
        if patch.get("op") == "add_memory":
            return self._apply_memory_patch(world, patch)
        return None

    def _apply_item_patch(self, world: GameWorld, patch: dict[str, Any]) -> bool:
        item_id = str(patch.get("item_id", ""))
        key = str(patch.get("key", ""))
        if key not in ALLOWED_ITEM_STATE_KEYS:
            return False
        item = world.map.item_by_id(item_id)
        if item is None:
            return False
        item.state[key] = patch.get("value")
        return True

    def _apply_agent_narrative_state_patch(self, world: GameWorld, patch: dict[str, Any]) -> dict[str, Any] | None:
        agent_id = str(patch.get("agent_id", "")).strip()
        state = world.agent_states.get(agent_id)
        if state is None:
            return None
        if isinstance(patch.get("state"), dict):
            updates = patch["state"]
        else:
            updates = {patch.get("key"): patch.get("value")}
        clean_updates: dict[str, str] = {}
        for raw_key, raw_value in updates.items():
            key = str(raw_key)
            value = _short_string(raw_value, max_length=MAX_SHORT_TEXT_LENGTH)
            if key not in ALLOWED_NARRATIVE_STATE_KEYS or value is None:
                return None
            clean_updates[key] = value
        if not clean_updates:
            return None
        state.narrative_state = {**state.narrative_state, **clean_updates}
        return {
            "op": "set_agent_narrative_state",
            "agent_id": agent_id,
            "state": clean_updates,
        }

    def _apply_memory_patch(self, world: GameWorld, patch: dict[str, Any]) -> dict[str, Any] | None:
        if not isinstance(patch, dict):
            return None
        if patch.get("op", "add_memory") != "add_memory":
            return None
        agent_id = str(patch.get("agent_id", "")).strip()
        if agent_id != "__scene__" and agent_id not in world.agent_profiles:
            return None
        kind = str(patch.get("kind", "short_term")).strip()
        if kind not in ALLOWED_MEMORY_KINDS:
            return None
        text = _short_string(patch.get("text"), max_length=MAX_MEMORY_TEXT_LENGTH)
        if text is None:
            return None
        memory = Memory(
            id=str(patch.get("id") or new_id("mem")),
            agent_id=agent_id,
            kind=kind,
            text=text,
        )
        world.memories.append(memory)
        world.memories = world.memories[-500:]
        return {"kind": "memory", "memory": memory.to_dict()}


def _short_string(value: Any, max_length: int, allow_empty: bool = False) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text and not allow_empty:
        return None
    if len(text) > max_length:
        return None
    return text


def _config_string(value: Any, max_length: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_length]


def _positive_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))
