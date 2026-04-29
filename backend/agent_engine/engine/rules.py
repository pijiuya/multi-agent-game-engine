from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .geometry import distance
from .world import AgentAction, GameWorld, Point


@dataclass(slots=True)
class ActionResult:
    ok: bool
    message: str
    event: dict[str, Any] | None = None


class RuleEngine:
    """Validates and applies structured agent actions."""

    interaction_range = 120.0

    def validate(self, world: GameWorld, action: AgentAction) -> ActionResult:
        profile = world.agent_profiles.get(action.agent_id)
        state = world.agent_states.get(action.agent_id)
        if profile is None or state is None:
            return ActionResult(False, f"Unknown agent: {action.agent_id}")
        if action.type not in profile.action_space:
            return ActionResult(False, f"{profile.name} cannot perform {action.type}")

        if action.type == "move_to":
            target = self._point_from_payload(action.payload)
            if target is None:
                return ActionResult(False, "move_to requires a target point")
            if not world.map.is_walkable(target):
                return ActionResult(False, "target is outside walkable space or inside an obstacle")
            return ActionResult(True, "move accepted")

        if action.type == "say":
            text = str(action.payload.get("text", "")).strip()
            if not text:
                return ActionResult(False, "say requires non-empty text")
            if len(text) > 500:
                return ActionResult(False, "say text is too long")
            return ActionResult(True, "speech accepted")

        if action.type in {"interact", "use"}:
            target_id = str(action.payload.get("target_id", "")).strip()
            if not target_id:
                return ActionResult(False, f"{action.type} requires target_id")
            target_point = self._target_position(world, target_id)
            if target_point is None:
                return ActionResult(False, f"Unknown target: {target_id}")
            if distance(state.position.to_dict(), target_point.to_dict()) > self.interaction_range:
                return ActionResult(False, f"{target_id} is out of range")
            return ActionResult(True, f"{action.type} accepted")

        if action.type in {"observe", "wait"}:
            return ActionResult(True, f"{action.type} accepted")

        return ActionResult(False, f"Unsupported action type: {action.type}")

    def apply(self, world: GameWorld, action: AgentAction) -> ActionResult:
        result = self.validate(world, action)
        if not result.ok:
            world.add_event("rejected_action", result.message, agent_id=action.agent_id, payload=action.to_dict())
            return result

        profile = world.agent_profiles[action.agent_id]
        state = world.agent_states[action.agent_id]

        if action.type == "move_to":
            target = self._point_from_payload(action.payload)
            assert target is not None
            state.target = target
            state.status = "moving"
            event = world.add_event(
                "action",
                f"{profile.name} starts moving.",
                agent_id=profile.id,
                payload={"action": action.to_dict(), "target": target.to_dict()},
            )
            return ActionResult(True, "move_to applied", event.to_dict())

        if action.type == "say":
            text = str(action.payload["text"]).strip()
            state.status = "speaking"
            event = world.add_event(
                "speech",
                f"{profile.name}: {text}",
                agent_id=profile.id,
                payload={"text": text},
            )
            return ActionResult(True, "say applied", event.to_dict())

        if action.type == "observe":
            nearby = [agent.name for agent in world.nearby_agents(profile.id, radius=180)]
            item_names = [
                item.name
                for item in world.map.items
                if distance(state.position.to_dict(), item.position.to_dict()) <= 180
            ]
            message = f"{profile.name} observes nearby agents={nearby} items={item_names}."
            event = world.add_event(
                "observation",
                message,
                agent_id=profile.id,
                payload={"nearby_agents": nearby, "nearby_items": item_names},
            )
            return ActionResult(True, "observe applied", event.to_dict())

        if action.type == "wait":
            state.status = "idle"
            event = world.add_event(
                "action",
                f"{profile.name} waits.",
                agent_id=profile.id,
                payload={"action": action.to_dict()},
            )
            return ActionResult(True, "wait applied", event.to_dict())

        if action.type in {"interact", "use"}:
            target_id = str(action.payload["target_id"])
            state.status = action.type
            event = world.add_event(
                "interaction",
                f"{profile.name} {action.type}s {target_id}.",
                agent_id=profile.id,
                payload={"action": action.to_dict()},
            )
            return ActionResult(True, f"{action.type} applied", event.to_dict())

        return ActionResult(False, f"Unsupported action type: {action.type}")

    def _point_from_payload(self, payload: dict[str, Any]) -> Point | None:
        raw = payload.get("target") or payload.get("position")
        if not isinstance(raw, dict):
            return None
        if "x" not in raw or "y" not in raw:
            return None
        return Point(float(raw["x"]), float(raw["y"]))

    def _target_position(self, world: GameWorld, target_id: str) -> Point | None:
        if target_id in world.agent_states:
            return world.agent_states[target_id].position
        item = world.map.item_by_id(target_id)
        if item is not None:
            return item.position
        for zone in world.map.interaction_zones:
            if zone.id == target_id and zone.points:
                return zone.points[0]
        return None

