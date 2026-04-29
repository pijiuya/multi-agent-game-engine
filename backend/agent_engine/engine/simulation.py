from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass
from time import perf_counter
from typing import Any

from agent_engine.models.provider import MockProvider, ModelProvider, ModelRequest

from .geometry import distance, lerp_point
from .rules import RuleEngine
from .world import AgentAction, GameWorld, Point


@dataclass(slots=True)
class PendingModelTask:
    task: asyncio.Task
    request: ModelRequest
    provider_name: str
    model_name: str


class SimulationRuntime:
    """Realtime-ish simulation loop with non-blocking model decisions."""

    def __init__(
        self,
        world: GameWorld | None = None,
        providers: dict[str, ModelProvider] | None = None,
        tick_rate: float = 10.0,
    ):
        self.world = world or GameWorld.default()
        self.providers = providers or {"mock": MockProvider()}
        self.default_provider_id = "mock"
        self.tick_rate = tick_rate
        self.rule_engine = RuleEngine()
        self._model_tasks: dict[str, PendingModelTask] = {}
        self._loop_task: asyncio.Task | None = None
        self._last_time = perf_counter()

    def start(self) -> None:
        self.world.running = True
        self.world.add_event("system", "Simulation started.")

    def pause(self) -> None:
        self.world.running = False
        self.world.add_event("system", "Simulation paused.")

    async def start_background(self) -> None:
        if self._loop_task and not self._loop_task.done():
            return
        self.start()
        self._loop_task = asyncio.create_task(self._run_loop())

    async def stop_background(self) -> None:
        self.pause()
        if self._loop_task:
            self._loop_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._loop_task

    async def _run_loop(self) -> None:
        interval = 1 / self.tick_rate
        self._last_time = perf_counter()
        while self.world.running:
            now = perf_counter()
            dt = min(now - self._last_time, interval * 3)
            self._last_time = now
            await self.tick(dt or interval)
            await asyncio.sleep(interval)

    async def tick(self, dt: float | None = None) -> dict[str, Any]:
        dt = dt if dt is not None else 1 / self.tick_rate
        self._harvest_model_tasks()
        if self.world.running:
            self._move_agents(dt)
            self._schedule_agent_decisions()
            self.world.tick += 1
        return self.snapshot()

    def submit_action(self, action: AgentAction) -> dict[str, Any]:
        result = self.rule_engine.apply(self.world, action)
        return {"ok": result.ok, "message": result.message, "event": result.event}

    def snapshot(self) -> dict[str, Any]:
        payload = self.world.to_dict()
        payload["model_tasks"] = {
            agent_id: {"done": record.task.done()} for agent_id, record in self._model_tasks.items()
        }
        return payload

    def _move_agents(self, dt: float) -> None:
        for agent_id, state in self.world.agent_states.items():
            profile = self.world.agent_profiles.get(agent_id)
            if profile is None or profile.hidden:
                state.target = None
                state.status = "idle"
                continue
            if state.target is None:
                if state.status == "moving":
                    state.status = "idle"
                continue
            current = state.position.to_dict()
            target = state.target.to_dict()
            remaining = distance(current, target)
            step = state.speed * dt
            if remaining <= step or remaining <= 0.001:
                state.position = state.target
                state.target = None
                state.status = "idle"
                name = profile.name
                self.world.add_event("movement", f"{name} arrived.", agent_id=agent_id)
            else:
                state.position = Point.from_dict(lerp_point(current, target, step / remaining))
                state.status = "moving"
            self._sync_held_item(state.held_item_id, state.position)

    def _schedule_agent_decisions(self) -> None:
        busy_provider_names = {
            record.provider_name for record in self._model_tasks.values() if record.provider_name != "mock"
        }
        for agent_id, profile in self.world.agent_profiles.items():
            if profile.hidden:
                continue
            state = self.world.agent_states[agent_id]
            if state.pending_model or state.status == "moving":
                continue
            if self.world.tick - state.last_model_tick < 5:
                continue
            provider_id = self._provider_id_for(profile.model_provider)
            provider = self.providers.get(provider_id) or self.providers["mock"]
            provider_name = getattr(provider, "name", provider_id)
            if provider_name != "mock" and provider_name in busy_provider_names:
                continue
            request = ModelRequest(
                agent_id=agent_id,
                role=profile.role,
                identity=profile.identity,
                action_space=profile.action_space,
                observation=self._observation_for(agent_id),
            )
            task = asyncio.create_task(provider.generate(request))
            self._model_tasks[agent_id] = PendingModelTask(
                task=task,
                request=request,
                provider_name=provider_name,
                model_name=str(getattr(provider, "model", getattr(provider, "name", profile.model_provider))),
            )
            if provider_name != "mock":
                busy_provider_names.add(provider_name)
            state.pending_model = True
            state.last_model_tick = self.world.tick

    def _harvest_model_tasks(self) -> None:
        finished = [agent_id for agent_id, record in self._model_tasks.items() if record.task.done()]
        for agent_id in finished:
            record = self._model_tasks.pop(agent_id)
            state = self.world.agent_states.get(agent_id)
            if state is not None:
                state.pending_model = False
            try:
                response = record.task.result()
            except Exception as exc:  # pragma: no cover - defensive API runtime path
                self.world.add_event("model_error", str(exc), agent_id=agent_id)
                self.world.add_decision_event(
                    agent_id=agent_id,
                    provider=record.provider_name,
                    model=record.model_name,
                    observation=record.request.observation,
                    text="",
                    actions=[],
                    results=[{"ok": False, "message": str(exc), "event_id": None}],
                )
                continue
            if response.text:
                self.world.add_event("model_text", response.text, agent_id=agent_id)
            actions: list[dict[str, Any]] = []
            results: list[dict[str, Any]] = []
            raw_actions = response.actions[:1]
            if not raw_actions:
                raw_actions = [{"type": "say" if response.text and "say" in record.request.action_space else "wait", "payload": {}}]
            for raw_action in raw_actions:
                if not isinstance(raw_action, dict):
                    results.append({"ok": False, "message": "invalid action payload", "event_id": None})
                    continue
                action = self._coerce_model_action(raw_action, response.text, record.request)
                actions.append(action)
                action_type = str(action.get("type", "wait"))
                payload = dict(action.get("payload", {}))
                result = self.submit_action(AgentAction(agent_id=agent_id, type=action_type, payload=payload))
                event = result.get("event") if isinstance(result.get("event"), dict) else None
                results.append(
                    {
                        "ok": bool(result.get("ok")),
                        "message": str(result.get("message", "")),
                        "event_id": event.get("id") if event else None,
                        "action_type": action_type,
                    }
                )
            self.world.add_decision_event(
                agent_id=agent_id,
                provider=record.provider_name,
                model=record.model_name,
                observation=record.request.observation,
                text=response.text,
            actions=actions,
            results=results,
        )

    def _coerce_model_action(self, raw_action: dict[str, Any], response_text: str, request: ModelRequest) -> dict[str, Any]:
        allowed = set(request.action_space)
        action_type = str(raw_action.get("type") or "wait")
        if action_type not in allowed:
            action_type = "wait"
        payload = raw_action.get("payload") if isinstance(raw_action.get("payload"), dict) else {}
        payload = dict(payload)
        observation = request.observation

        if action_type == "say":
            text = str(payload.get("text") or response_text or "I am thinking.").strip()
            return {"type": "say", "payload": {"text": text}}

        if action_type == "social":
            target_id = str(payload.get("target_agent_id") or payload.get("target_id") or "").strip()
            if not target_id:
                target_id = self._first_observation_id(observation.get("dialogue_candidates"))
            if not target_id:
                return self._fallback_action(response_text, allowed)
            text = str(payload.get("text") or response_text or "Let's talk for a moment.").strip()
            return {"type": "social", "payload": {"target_agent_id": target_id, "text": text}}

        if action_type == "move_to":
            target = payload.get("target") if isinstance(payload.get("target"), dict) else None
            if not self._valid_point_dict(target):
                target = self._first_movement_target(observation)
            if not target:
                return self._fallback_action(response_text, allowed)
            return {"type": "move_to", "payload": {"target": target}}

        if action_type == "stop":
            return {"type": "stop", "payload": {"reason": str(payload.get("reason") or "rest")}}

        if action_type == "pick_up":
            item_id = str(payload.get("item_id") or payload.get("target_id") or "").strip()
            if not item_id:
                item_id = self._first_movable_item_id(observation)
            if not item_id:
                return self._fallback_action(response_text, allowed)
            return {"type": "pick_up", "payload": {"item_id": item_id}}

        if action_type == "drop_item":
            position = payload.get("position") if isinstance(payload.get("position"), dict) else observation.get("position")
            return {"type": "drop_item", "payload": {"position": position} if self._valid_point_dict(position) else {}}

        if action_type == "move_item":
            item_id = str(payload.get("item_id") or payload.get("target_id") or "").strip()
            if not item_id:
                item_id = self._first_movable_item_id(observation)
            if not item_id:
                return self._fallback_action(response_text, allowed)
            next_payload: dict[str, Any] = {"item_id": item_id}
            target = payload.get("target") if isinstance(payload.get("target"), dict) else None
            if self._valid_point_dict(target):
                next_payload["target"] = target
            if "rotation" in payload:
                next_payload["rotation"] = payload["rotation"]
            if "scale" in payload:
                next_payload["scale"] = payload["scale"]
            return {"type": "move_item", "payload": next_payload}

        if action_type in {"interact", "use"}:
            target_id = str(payload.get("target_id") or payload.get("item_id") or "").strip()
            if not target_id:
                target_id = self._first_observation_id(observation.get("nearby_items"))
            if not target_id:
                return self._fallback_action(response_text, allowed)
            return {"type": action_type, "payload": {"target_id": target_id}}

        if action_type == "wait":
            return {"type": "wait", "payload": {"duration": self._positive_int(payload.get("duration"), default=1)}}

        return self._fallback_action(response_text, allowed)

    def _fallback_action(self, response_text: str, allowed: set[str]) -> dict[str, Any]:
        if response_text and "say" in allowed:
            return {"type": "say", "payload": {"text": response_text.strip()}}
        return {"type": "wait", "payload": {"duration": 1}}

    def _first_observation_id(self, items: Any) -> str:
        if not isinstance(items, list):
            return ""
        for item in items:
            if isinstance(item, dict) and item.get("id"):
                return str(item["id"])
        return ""

    def _first_movable_item_id(self, observation: dict[str, Any]) -> str:
        items = observation.get("nearby_items")
        if not isinstance(items, list):
            return ""
        for item in items:
            if isinstance(item, dict) and item.get("id") and item.get("movable"):
                return str(item["id"])
        return ""

    def _first_movement_target(self, observation: dict[str, Any]) -> dict[str, Any] | None:
        targets = observation.get("movement_targets")
        if not isinstance(targets, list):
            return None
        for target in targets:
            if isinstance(target, dict) and self._valid_point_dict(target.get("point")):
                return dict(target["point"])
        return None

    def _valid_point_dict(self, point: Any) -> bool:
        return isinstance(point, dict) and isinstance(point.get("x"), (int, float)) and isinstance(point.get("y"), (int, float))

    def _positive_int(self, value: Any, default: int) -> int:
        try:
            return max(1, int(value))
        except (TypeError, ValueError):
            return default

    def _observation_for(self, agent_id: str) -> dict[str, Any]:
        profile = self.world.agent_profiles[agent_id]
        state = self.world.agent_states[agent_id]
        nearby_agents = self._nearby_agent_observations(agent_id, radius=220)
        nearby_items = self._nearby_item_observations(agent_id, radius=180)
        policy = profile.dialogue_policy
        dialogue_distance = float(policy.get("distance", 180.0))
        can_social = bool(policy.get("enabled", True)) and self.world.tick >= float(state.cooldowns.get("social_until", 0))
        return {
            "tick": self.world.tick,
            "agent_name": profile.name,
            "agent_id": agent_id,
            "position": state.position.to_dict(),
            "map": {
                "id": self.world.map.id,
                "width": self.world.map.width,
                "height": self.world.map.height,
            },
            "status": state.status,
            "held_item_id": state.held_item_id,
            "nearby_agents": nearby_agents,
            "nearby_items": nearby_items,
            "movement_targets": self._movement_targets_for(agent_id),
            "dialogue_candidates": [
                agent for agent in nearby_agents if can_social and agent["distance"] <= dialogue_distance
            ],
            "recent_events": [
                event.to_dict()
                for event in self.world.events
                if event.type not in {"model_error"}
            ][-8:],
        }

    def _provider_id_for(self, profile_provider: str) -> str:
        if profile_provider == "mock" and self.default_provider_id != "mock":
            return self.default_provider_id
        if profile_provider in self.providers:
            return profile_provider
        if self.default_provider_id in self.providers:
            return self.default_provider_id
        return "mock"

    def _nearby_agent_observations(self, agent_id: str, radius: float) -> list[dict[str, Any]]:
        state = self.world.agent_states[agent_id]
        nearby: list[dict[str, Any]] = []
        for other_id, other_state in self.world.agent_states.items():
            if other_id == agent_id:
                continue
            profile = self.world.agent_profiles.get(other_id)
            if profile is None or profile.hidden:
                continue
            current_distance = distance(state.position.to_dict(), other_state.position.to_dict())
            if current_distance > radius:
                continue
            nearby.append(
                {
                    "id": other_id,
                    "name": profile.name,
                    "status": other_state.status,
                    "distance": round(current_distance, 2),
                }
            )
        return sorted(nearby, key=lambda item: item["distance"])

    def _nearby_item_observations(self, agent_id: str, radius: float) -> list[dict[str, Any]]:
        state = self.world.agent_states[agent_id]
        nearby: list[dict[str, Any]] = []
        for item in self.world.map.items:
            if item.hidden:
                continue
            current_distance = distance(state.position.to_dict(), item.position.to_dict())
            if current_distance > radius:
                continue
            nearby.append(
                {
                    "id": item.id,
                    "name": item.name,
                    "position": item.position.to_dict(),
                    "distance": round(current_distance, 2),
                    "movable": item.movable,
                    "tags": item.tags,
                    "state": item.state,
                }
            )
        return sorted(nearby, key=lambda item: item["distance"])

    def _movement_targets_for(self, agent_id: str) -> list[dict[str, Any]]:
        state = self.world.agent_states[agent_id]
        candidates = [
            ("left", Point(state.position.x - 120, state.position.y)),
            ("right", Point(state.position.x + 120, state.position.y)),
            ("up", Point(state.position.x, state.position.y - 120)),
            ("down", Point(state.position.x, state.position.y + 120)),
            ("spawn", self.world.map.nearest_spawn()),
        ]
        targets: list[dict[str, Any]] = []
        seen: set[tuple[int, int]] = set()
        for label, point in candidates:
            snapped = Point(
                max(0, min(self.world.map.width, point.x)),
                max(0, min(self.world.map.height, point.y)),
            )
            key = (round(snapped.x), round(snapped.y))
            if key in seen or not self.world.map.is_walkable(snapped):
                continue
            seen.add(key)
            targets.append({"label": label, "point": snapped.to_dict()})
        return targets

    def _sync_held_item(self, item_id: str | None, position: Point) -> None:
        if not item_id:
            return
        item = self.world.map.item_by_id(item_id)
        if item is None or item.hidden or not item.movable:
            return
        item.position = Point(position.x, position.y)
