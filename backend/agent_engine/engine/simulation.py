from __future__ import annotations

import asyncio
from contextlib import suppress
from time import perf_counter
from typing import Any

from agent_engine.models.provider import MockProvider, ModelProvider, ModelRequest

from .geometry import distance, lerp_point
from .rules import RuleEngine
from .world import AgentAction, GameWorld, Point


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
        self.tick_rate = tick_rate
        self.rule_engine = RuleEngine()
        self._model_tasks: dict[str, asyncio.Task] = {}
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
            agent_id: {"done": task.done()} for agent_id, task in self._model_tasks.items()
        }
        return payload

    def _move_agents(self, dt: float) -> None:
        for agent_id, state in self.world.agent_states.items():
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
                name = self.world.agent_profiles[agent_id].name
                self.world.add_event("movement", f"{name} arrived.", agent_id=agent_id)
            else:
                state.position = Point.from_dict(lerp_point(current, target, step / remaining))
                state.status = "moving"

    def _schedule_agent_decisions(self) -> None:
        for agent_id, profile in self.world.agent_profiles.items():
            state = self.world.agent_states[agent_id]
            if state.pending_model or state.status == "moving":
                continue
            if self.world.tick - state.last_model_tick < 5:
                continue
            provider = self.providers.get(profile.model_provider) or self.providers["mock"]
            request = ModelRequest(
                agent_id=agent_id,
                role=profile.role,
                identity=profile.identity,
                action_space=profile.action_space,
                observation=self._observation_for(agent_id),
            )
            task = asyncio.create_task(provider.generate(request))
            self._model_tasks[agent_id] = task
            state.pending_model = True
            state.last_model_tick = self.world.tick

    def _harvest_model_tasks(self) -> None:
        finished = [agent_id for agent_id, task in self._model_tasks.items() if task.done()]
        for agent_id in finished:
            task = self._model_tasks.pop(agent_id)
            state = self.world.agent_states.get(agent_id)
            if state is not None:
                state.pending_model = False
            try:
                response = task.result()
            except Exception as exc:  # pragma: no cover - defensive API runtime path
                self.world.add_event("model_error", str(exc), agent_id=agent_id)
                continue
            if response.text:
                self.world.add_event("model_text", response.text, agent_id=agent_id)
            for raw_action in response.actions[:1]:
                if not isinstance(raw_action, dict):
                    continue
                action_type = str(raw_action.get("type", "wait"))
                payload = dict(raw_action.get("payload", {}))
                self.submit_action(AgentAction(agent_id=agent_id, type=action_type, payload=payload))

    def _observation_for(self, agent_id: str) -> dict[str, Any]:
        profile = self.world.agent_profiles[agent_id]
        state = self.world.agent_states[agent_id]
        return {
            "tick": self.world.tick,
            "agent_name": profile.name,
            "position": state.position.to_dict(),
            "status": state.status,
            "nearby_agents": [agent.name for agent in self.world.nearby_agents(agent_id, 220)],
            "recent_events": [event.to_dict() for event in self.world.events[-8:]],
        }

