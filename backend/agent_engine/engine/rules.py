from __future__ import annotations

from dataclasses import dataclass
from math import atan2, cos, pi, sin
from typing import Any

from .action_extensions import ActionExtension, apply_extension_action, validate_extension_action
from .geometry import distance
from .world import AgentAction, GameWorld, Point, Relationship, WorldItem


@dataclass(slots=True)
class ActionResult:
    ok: bool
    message: str
    event: dict[str, Any] | None = None


class RuleEngine:
    """Validates and applies structured agent actions."""

    interaction_range = 120.0
    agent_radius = 24.0
    agent_min_center_distance = agent_radius * 2

    def __init__(self, action_extensions: list[ActionExtension] | None = None):
        self.action_extensions = action_extensions or []

    def set_action_extensions(self, action_extensions: list[ActionExtension]) -> None:
        self.action_extensions = action_extensions

    def enabled_extension_types(self) -> set[str]:
        return {extension.type for extension in self.action_extensions if extension.enabled}

    def _extension_for(self, action_type: str) -> ActionExtension | None:
        return next(
            (
                extension
                for extension in self.action_extensions
                if extension.enabled and extension.type == action_type
            ),
            None,
        )

    def validate(self, world: GameWorld, action: AgentAction) -> ActionResult:
        profile = world.agent_profiles.get(action.agent_id)
        state = world.agent_states.get(action.agent_id)
        if profile is None or state is None:
            return ActionResult(False, f"Unknown agent: {action.agent_id}")
        if profile.hidden:
            return ActionResult(False, f"{profile.name} is hidden")
        extension = self._extension_for(action.type)
        if action.type not in profile.action_space and extension is None:
            return ActionResult(False, f"{profile.name} cannot perform {action.type}")
        if extension is not None:
            ok, message = validate_extension_action(extension, world, action)
            return ActionResult(ok, message)

        if action.type == "stop":
            return ActionResult(True, "stop accepted")

        if action.type == "move_to":
            target = self._point_from_payload(action.payload)
            if target is None:
                return ActionResult(False, "move_to requires a target point")
            if not world.map.is_walkable(target):
                return ActionResult(False, "target is outside walkable space or inside an obstacle")
            if self.collision_free_agent_point(world, action.agent_id, target) is None:
                return ActionResult(False, "target is blocked by nearby agents")
            return ActionResult(True, "move accepted")

        if action.type == "say":
            text = str(action.payload.get("text", "")).strip()
            if not text:
                return ActionResult(False, "say requires non-empty text")
            if len(text) > 500:
                return ActionResult(False, "say text is too long")
            return ActionResult(True, "speech accepted")

        if action.type == "social":
            target_id = self._target_agent_id(action.payload)
            if not target_id:
                return ActionResult(False, "social requires target_agent_id")
            if target_id == action.agent_id:
                return ActionResult(False, "social target must be another agent")
            target_profile = world.agent_profiles.get(target_id)
            target_state = world.agent_states.get(target_id)
            if target_profile is None or target_state is None or target_profile.hidden:
                return ActionResult(False, f"Unknown target agent: {target_id}")
            policy = profile.dialogue_policy
            if not bool(policy.get("enabled", True)):
                return ActionResult(False, "dialogue is disabled for this agent")
            maximum = float(policy.get("distance", 180.0))
            if distance(state.position.to_dict(), target_state.position.to_dict()) > maximum:
                return ActionResult(False, f"{target_profile.name} is out of dialogue range")
            if world.tick < float(state.cooldowns.get("social_until", 0)):
                return ActionResult(False, "social action is cooling down")
            return ActionResult(True, "social accepted")

        if action.type in {"interact", "use"}:
            target_id = str(action.payload.get("target_id", "")).strip()
            if not target_id:
                return ActionResult(False, f"{action.type} requires target_id")
            item = world.map.item_by_id(target_id)
            if item is not None:
                return self._validate_item_interaction(world, state.position, item, action.type)
            target_point = self._target_position(world, target_id)
            if target_point is None:
                return ActionResult(False, f"Unknown target: {target_id}")
            if distance(state.position.to_dict(), target_point.to_dict()) > self.interaction_range:
                return ActionResult(False, f"{target_id} is out of range")
            return ActionResult(True, f"{action.type} accepted")

        if action.type == "pick_up":
            item = self._item_from_payload(world, action.payload)
            if item is None:
                return ActionResult(False, "pick_up requires a valid item_id")
            if state.held_item_id and state.held_item_id != item.id:
                return ActionResult(False, "agent is already holding an item")
            return self._validate_item_interaction(world, state.position, item, "pick_up")

        if action.type == "drop_item":
            if not state.held_item_id:
                return ActionResult(False, "drop_item requires a held item")
            item = world.map.item_by_id(state.held_item_id)
            if item is None or item.hidden or not item.movable:
                return ActionResult(False, "held item is not movable")
            target = self._point_from_payload(action.payload)
            if target is not None and not world.map.is_inside_bounds(target):
                return ActionResult(False, "drop position is outside map bounds")
            return ActionResult(True, "drop_item accepted")

        if action.type == "move_item":
            item = self._item_from_payload(world, action.payload)
            if item is None:
                return ActionResult(False, "move_item requires a valid item_id")
            result = self._validate_item_interaction(world, state.position, item, "move_item")
            if not result.ok:
                return result
            target = self._point_from_payload(action.payload)
            if target is not None and not world.map.is_inside_bounds(target):
                return ActionResult(False, "item target is outside map bounds")
            return ActionResult(True, "move_item accepted")

        if action.type in {"observe", "wait"}:
            return ActionResult(True, f"{action.type} accepted")

        return ActionResult(False, f"Unsupported action type: {action.type}")

    def apply(self, world: GameWorld, action: AgentAction) -> ActionResult:
        result = self.validate(world, action)
        if not result.ok:
            world.add_event("rejected_action", result.message, agent_id=action.agent_id, payload=action.to_dict())
            return result

        extension = self._extension_for(action.type)
        if extension is not None:
            ok, message, event = apply_extension_action(extension, world, action)
            if not ok:
                world.add_event("rejected_action", message, agent_id=action.agent_id, payload=action.to_dict())
                return ActionResult(False, message)
            if event is None:
                event_obj = world.add_event(
                    "extension_action",
                    message,
                    agent_id=action.agent_id,
                    payload={"action": action.to_dict(), "extension_id": extension.id},
                )
                event = event_obj.to_dict()
            return ActionResult(True, message, event)

        profile = world.agent_profiles[action.agent_id]
        state = world.agent_states[action.agent_id]

        if action.type == "stop":
            state.target = None
            state.status = "idle"
            event = world.add_event(
                "action",
                f"{profile.name} stops.",
                agent_id=profile.id,
                payload={"action": action.to_dict()},
            )
            return ActionResult(True, "stop applied", event.to_dict())

        if action.type == "move_to":
            requested_target = self._point_from_payload(action.payload)
            assert requested_target is not None
            target = self.collision_free_agent_point(world, action.agent_id, requested_target) or requested_target
            collision_adjusted = distance(requested_target.to_dict(), target.to_dict()) > 0.01
            state.target = target
            state.status = "moving"
            payload = {
                "action": action.to_dict(),
                "target": target.to_dict(),
                "agent_min_center_distance": self.agent_min_center_distance,
            }
            if collision_adjusted:
                payload["requested_target"] = requested_target.to_dict()
                payload["collision_adjusted"] = True
            event = world.add_event(
                "action",
                f"{profile.name} starts moving.",
                agent_id=profile.id,
                payload=payload,
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

        if action.type == "social":
            target_id = self._target_agent_id(action.payload)
            assert target_id is not None
            target_profile = world.agent_profiles[target_id]
            text = str(action.payload.get("text", "")).strip()
            if not text:
                text = f"{profile.name} starts a conversation with {target_profile.name}."
            state.status = "speaking"
            cooldown = int(profile.dialogue_policy.get("cooldown_ticks", 20))
            state.cooldowns["social_until"] = world.tick + max(1, cooldown)
            target_state = world.agent_states.get(target_id)
            if target_state is not None:
                target_state.cooldowns["social_until"] = world.tick + max(1, cooldown)
            relationship = self._upsert_relationship(world, profile.id, target_id)
            event = world.add_event(
                "dialogue",
                f"{profile.name} → {target_profile.name}: {text}",
                agent_id=profile.id,
                payload={
                    "action": action.to_dict(),
                    "target_agent_id": target_id,
                    "participants": [profile.id, target_id],
                    "relationship": relationship.to_dict(),
                    "text": text,
                },
            )
            return ActionResult(True, "social applied", event.to_dict())

        if action.type == "observe":
            nearby = [agent.name for agent in world.nearby_agents(profile.id, radius=180)]
            item_names = [
                item.name
                for item in world.map.items
                if not item.hidden
                and distance(state.position.to_dict(), item.position.to_dict()) <= 180
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

        if action.type == "pick_up":
            item = self._item_from_payload(world, action.payload)
            assert item is not None
            state.held_item_id = item.id
            item.position = Point(state.position.x, state.position.y)
            state.status = "interact"
            event = world.add_event(
                "interaction",
                f"{profile.name} picks up {item.name}.",
                agent_id=profile.id,
                payload={"action": action.to_dict(), "item_id": item.id},
            )
            return ActionResult(True, "pick_up applied", event.to_dict())

        if action.type == "drop_item":
            item_id = state.held_item_id
            assert item_id is not None
            item = world.map.item_by_id(item_id)
            assert item is not None
            target = self._point_from_payload(action.payload) or state.position
            item.position = target
            state.held_item_id = None
            state.status = "idle"
            event = world.add_event(
                "interaction",
                f"{profile.name} drops {item.name}.",
                agent_id=profile.id,
                payload={"action": action.to_dict(), "item_id": item.id, "position": target.to_dict()},
            )
            return ActionResult(True, "drop_item applied", event.to_dict())

        if action.type == "move_item":
            item = self._item_from_payload(world, action.payload)
            assert item is not None
            target = self._point_from_payload(action.payload)
            if target is not None:
                item.position = target
            if "rotation" in action.payload:
                item.rotation = float(action.payload["rotation"])
            if "scale" in action.payload:
                item.scale = max(0.25, min(5.0, float(action.payload["scale"])))
            state.status = "interact"
            event = world.add_event(
                "interaction",
                f"{profile.name} moves {item.name}.",
                agent_id=profile.id,
                payload={"action": action.to_dict(), "item": item.to_dict()},
            )
            return ActionResult(True, "move_item applied", event.to_dict())

        return ActionResult(False, f"Unsupported action type: {action.type}")

    def _point_from_payload(self, payload: dict[str, Any]) -> Point | None:
        raw = payload.get("target") or payload.get("position")
        if not isinstance(raw, dict):
            return None
        if "x" not in raw or "y" not in raw:
            return None
        return Point(float(raw["x"]), float(raw["y"]))

    def collision_free_agent_point(
        self,
        world: GameWorld,
        agent_id: str,
        point: Point,
        *,
        include_targets: bool = True,
    ) -> Point | None:
        if self._is_agent_point_clear(world, agent_id, point, include_targets=include_targets):
            return point
        candidates = self._agent_collision_candidates(world, agent_id, point, include_targets=include_targets)
        current = world.agent_states.get(agent_id).position if agent_id in world.agent_states else point
        candidates.sort(
            key=lambda candidate: (
                distance(candidate.to_dict(), point.to_dict()),
                distance(candidate.to_dict(), current.to_dict()),
            )
        )
        for candidate in candidates:
            if self._is_agent_point_clear(world, agent_id, candidate, include_targets=include_targets):
                return candidate
        return None

    def _is_agent_point_clear(
        self,
        world: GameWorld,
        agent_id: str,
        point: Point,
        *,
        include_targets: bool = True,
    ) -> bool:
        if not world.map.is_walkable(point):
            return False
        for occupied in self._agent_collision_points(world, agent_id, include_targets=include_targets):
            if distance(point.to_dict(), occupied.to_dict()) < self.agent_min_center_distance:
                return False
        return True

    def _agent_collision_points(
        self,
        world: GameWorld,
        agent_id: str,
        *,
        include_targets: bool = True,
    ) -> list[Point]:
        occupied: list[Point] = []
        for other_id, other_state in world.agent_states.items():
            if other_id == agent_id:
                continue
            other_profile = world.agent_profiles.get(other_id)
            if other_profile is None or other_profile.hidden:
                continue
            occupied.append(other_state.position)
            if include_targets and other_state.target is not None:
                occupied.append(other_state.target)
        return occupied

    def _agent_collision_candidates(
        self,
        world: GameWorld,
        agent_id: str,
        point: Point,
        *,
        include_targets: bool = True,
    ) -> list[Point]:
        current = world.agent_states.get(agent_id).position if agent_id in world.agent_states else point
        candidates: list[Point] = []
        min_distance = self.agent_min_center_distance
        offsets = (0, 45, -45, 90, -90, 135, -135, 180)
        for index, occupied in enumerate(
            sorted(
                self._agent_collision_points(world, agent_id, include_targets=include_targets),
                key=lambda occupied_point: distance(point.to_dict(), occupied_point.to_dict()),
            )
        ):
            dx = point.x - occupied.x
            dy = point.y - occupied.y
            if abs(dx) + abs(dy) <= 0.001:
                dx = current.x - occupied.x
                dy = current.y - occupied.y
            if abs(dx) + abs(dy) <= 0.001:
                angle = ((sum(ord(char) for char in f"{agent_id}:{index}") % 360) / 180) * pi
            else:
                angle = atan2(dy, dx)
            for offset in offsets:
                candidate_angle = angle + (offset / 180) * pi
                candidates.append(
                    Point(
                        occupied.x + cos(candidate_angle) * min_distance,
                        occupied.y + sin(candidate_angle) * min_distance,
                    )
                )
        for ring in (1.0, 1.5, 2.0, 2.5):
            radius = min_distance * ring
            for step in range(16):
                angle = (step / 16) * 2 * pi
                candidates.append(Point(point.x + cos(angle) * radius, point.y + sin(angle) * radius))
        return candidates

    def _target_position(self, world: GameWorld, target_id: str) -> Point | None:
        target_profile = world.agent_profiles.get(target_id)
        if target_id in world.agent_states and target_profile is not None and not target_profile.hidden:
            return world.agent_states[target_id].position
        item = world.map.item_by_id(target_id)
        if item is not None and not item.hidden:
            return item.position
        for zone in world.map.interaction_zones:
            if zone.id == target_id and zone.points:
                return zone.points[0]
        return None

    def _target_agent_id(self, payload: dict[str, Any]) -> str | None:
        raw = payload.get("target_agent_id") or payload.get("target_id") or payload.get("agent_id")
        if not raw:
            return None
        return str(raw).strip()

    def _upsert_relationship(self, world: GameWorld, from_agent: str, to_agent: str) -> Relationship:
        for relationship in world.relationships:
            if (
                relationship.from_agent == from_agent
                and relationship.to_agent == to_agent
                and relationship.label == "knows"
            ):
                relationship.score = min(1.0, relationship.score + 0.08)
                return relationship
        relationship = Relationship(from_agent=from_agent, to_agent=to_agent, label="knows", score=0.08)
        world.relationships.append(relationship)
        return relationship

    def _item_from_payload(self, world: GameWorld, payload: dict[str, Any]) -> WorldItem | None:
        item_id = str(payload.get("item_id") or payload.get("target_id") or "").strip()
        if not item_id:
            return None
        return world.map.item_by_id(item_id)

    def _validate_item_interaction(
        self,
        world: GameWorld,
        agent_position: Point,
        item: WorldItem,
        action_type: str,
    ) -> ActionResult:
        if item.hidden:
            return ActionResult(False, f"{item.id} is hidden")
        if not item.movable:
            return ActionResult(False, f"{item.name} is not movable")
        if distance(agent_position.to_dict(), item.position.to_dict()) > self.interaction_range:
            return ActionResult(False, f"{item.id} is out of range")
        return ActionResult(True, f"{action_type} accepted")
