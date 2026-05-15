from __future__ import annotations

import asyncio
import json
import os
import re
from contextlib import suppress
from dataclasses import dataclass
from math import ceil
from time import perf_counter
from typing import Any

from agent_engine.models.provider import (
    MockProvider,
    ModelProvider,
    ModelRequest,
    _effective_dialogue_language,
    _enrich_identity,
)

from .action_extensions import ActionExtension
from .context_compressor import ContextCompressor
from .environment_ai import EnvironmentArbiter
from .geometry import distance, lerp_point, point_in_polygon
from .rules import RuleEngine
from .scene_director import LLMSceneDirector, MockSceneDirector, SceneDirector, SceneDirectorRequest
from .world import AgentAction, GameWorld, Point


REGION_MOVEMENT_PRIORITY = {
    "walkable": 100,
    "action": 80,
    "social": 64,
    "residential": 52,
    "custom": 28,
    "unassigned": 12,
}
REGION_INFLUENCE = {
    "walkable": "preferred travel corridor; choose this before generic movement areas",
    "action": "open movement/action area; valid for movement but lower priority than road",
    "social": "encourages social or say actions with nearby agents; also valid as a meeting destination",
    "residential": "encourages calmer local behavior, waiting, short moves, and resident-like routines",
    "custom": "custom point of interest; inspect notes/tags before interacting",
    "unassigned": "unknown region; use cautiously",
}
LOW_INFORMATION_ITEM_NAMES = {"item", "object", "element", "thing", "物体", "元素", "道具", "未命名"}


@dataclass(slots=True)
class PendingModelTask:
    task: asyncio.Task
    request: ModelRequest
    provider_name: str
    model_name: str
    started_tick: int
    started_at: float
    input_chars: int


class SimulationRuntime:
    """Realtime-ish simulation loop with non-blocking model decisions."""

    def __init__(
        self,
        world: GameWorld | None = None,
        providers: dict[str, ModelProvider] | None = None,
        scene_director: SceneDirector | None = None,
        environment_arbiter: EnvironmentArbiter | None = None,
        tick_rate: float = 10.0,
        director_interval_ticks: int = 50,
    ):
        self.world = world or GameWorld.default()
        self.providers = providers or {"mock": MockProvider()}
        self.default_provider_id = "mock"
        self.scene_director = scene_director or MockSceneDirector()
        self.scene_directors: dict[str, SceneDirector] = {}
        self.environment_arbiter = environment_arbiter or EnvironmentArbiter()
        self.context_compressor = ContextCompressor(
            context_budget_chars=_env_int("AGENT_ENGINE_CONTEXT_BUDGET_CHARS", 6000),
            recent_event_window=_env_int("AGENT_ENGINE_CONTEXT_RECENT_EVENTS", 8),
            scene_memory_window=_env_int("AGENT_ENGINE_CONTEXT_SCENE_MEMORIES", 5),
            event_threshold=_env_int("AGENT_ENGINE_CONTEXT_EVENT_THRESHOLD", 12),
        )
        self.tick_rate = tick_rate
        self.director_interval_ticks = max(1, int(director_interval_ticks))
        self.model_timeout_seconds = _env_float("AGENT_ENGINE_LLM_TIMEOUT_SECONDS", 45.0)
        self.model_concurrency = max(1, _env_int("AGENT_ENGINE_LLM_CONCURRENCY", 2))
        self.action_prefilter_enabled = _env_bool("AGENT_ENGINE_ACTION_PREFILTER", True)
        self.agent_decision_interval_ticks = max(
            1,
            int(ceil(_env_float("AGENT_ENGINE_AGENT_DECISION_SECONDS", 2.0) * self.tick_rate)),
        )
        self.model_watchdog_ticks = max(
            1,
            int(ceil(_env_float("AGENT_ENGINE_MODEL_WATCHDOG_SECONDS", 18.0) * self.tick_rate)),
        )
        self.scene_director_watchdog_ticks = max(
            1,
            int(ceil(_env_float("AGENT_ENGINE_SCENE_WATCHDOG_SECONDS", 20.0) * self.tick_rate)),
        )
        self.provider_recovery_ticks = max(
            1,
            int(ceil(_env_float("AGENT_ENGINE_PROVIDER_RECOVERY_SECONDS", 30.0) * self.tick_rate)),
        )
        self.rule_engine = RuleEngine()
        self._model_tasks: dict[str, PendingModelTask] = {}
        self._director_task: asyncio.Task | None = None
        self._director_started_tick = -999
        self._provider_recovery_until: dict[str, int] = {}
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
        if self.world.running:
            self.world.add_event("system", "Simulation loop resumed.")
        else:
            self.start()
        self._loop_task = asyncio.create_task(self._run_loop())

    async def stop_background(self) -> None:
        self.world.running = False
        self.world.add_event("system", "Simulation paused.")
        if self._loop_task:
            self._loop_task.cancel()
            with suppress(asyncio.CancelledError, TimeoutError):
                await asyncio.wait_for(self._loop_task, timeout=1.0)
            if self._loop_task.done():
                self._loop_task = None

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
        self._recover_stalled_tasks()
        self._harvest_director_task()
        self._harvest_model_tasks()
        if self.world.running:
            self._move_agents(dt)
            self._schedule_agent_decisions()
            self._schedule_scene_director()
            self.world.tick += 1
        return self.snapshot()

    def submit_action(self, action: AgentAction) -> dict[str, Any]:
        result = self.rule_engine.apply(self.world, action)
        return {"ok": result.ok, "message": result.message, "event": result.event}

    def set_action_extensions(self, action_extensions: list[ActionExtension]) -> None:
        self.rule_engine.set_action_extensions(action_extensions)

    def snapshot(self) -> dict[str, Any]:
        payload = self.world.to_dict()
        payload["model_tasks"] = {
            agent_id: {
                "done": record.task.done(),
                "provider": record.provider_name,
                "model": record.model_name,
                "started_tick": record.started_tick,
                "age_ticks": max(0, self.world.tick - record.started_tick),
                "watchdog_age_ticks": self.model_watchdog_ticks,
            }
            for agent_id, record in self._model_tasks.items()
        }
        payload["scene_director"] = {
            "pending": bool(self._director_task and not self._director_task.done()),
            "last_tick": self.world.narrative.get("last_tick", -999),
            "model_provider": self._scene_director_provider_id(),
            "started_tick": self._director_started_tick,
            "age_ticks": max(0, self.world.tick - self._director_started_tick)
            if self._director_task and not self._director_task.done()
            else 0,
            "watchdog_age_ticks": self.scene_director_watchdog_ticks,
        }
        payload["recovery"] = {
            "provider_recovery": {
                provider: {
                    "until_tick": until_tick,
                    "remaining_ticks": max(0, until_tick - self.world.tick),
                }
                for provider, until_tick in self._provider_recovery_until.items()
                if until_tick > self.world.tick
            }
        }
        return payload

    def _move_agents(self, dt: float) -> None:
        touched_agents: set[str] = set()
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
            if not self.world.map.is_walkable(state.target):
                invalid_target = state.target
                state.target = None
                state.status = "idle"
                self.world.add_event(
                    "movement",
                    f"{profile.name} cancels an invalid movement target.",
                    agent_id=agent_id,
                    payload={"target": invalid_target.to_dict(), "reason": "target is no longer walkable"},
                )
                self._sync_held_item(state.held_item_id, state.position)
                continue
            current = state.position.to_dict()
            target = state.target.to_dict()
            remaining = distance(current, target)
            step = state.speed * dt
            if remaining <= step or remaining <= 0.001:
                proposed = state.target
                state.position = self.rule_engine.collision_free_agent_point(
                    self.world,
                    agent_id,
                    proposed,
                    include_targets=False,
                ) or proposed
                state.target = None
                state.status = "idle"
                name = profile.name
                self.world.add_event("movement", f"{name} arrived.", agent_id=agent_id)
                self.rule_engine.drop_held_item_at_agent(self.world, agent_id, reason="arrived")
            else:
                proposed = Point.from_dict(lerp_point(current, target, step / remaining))
                state.position = self.rule_engine.collision_free_agent_point(
                    self.world,
                    agent_id,
                    proposed,
                    include_targets=False,
                ) or state.position
                state.status = "moving"
            touched_agents.add(agent_id)
            self._sync_held_item(state.held_item_id, state.position)
        self._separate_agent_overlaps(touched_agents)

    def _separate_agent_overlaps(self, touched_agents: set[str] | None = None) -> None:
        changed_agents: set[str] = set()
        for _ in range(2):
            moved_this_pass = False
            for agent_id in sorted(self.world.agent_states):
                profile = self.world.agent_profiles.get(agent_id)
                state = self.world.agent_states[agent_id]
                if profile is None or profile.hidden:
                    continue
                resolved = self.rule_engine.collision_free_agent_point(
                    self.world,
                    agent_id,
                    state.position,
                    include_targets=False,
                )
                if resolved is None or distance(state.position.to_dict(), resolved.to_dict()) <= 0.01:
                    continue
                state.position = resolved
                changed_agents.add(agent_id)
                moved_this_pass = True
            if not moved_this_pass:
                break
        for agent_id in changed_agents | (touched_agents or set()):
            state = self.world.agent_states.get(agent_id)
            if state is not None:
                self._sync_held_item(state.held_item_id, state.position)

    def _schedule_agent_decisions(self) -> None:
        self._clear_orphaned_pending_model_flags()
        busy_provider_counts: dict[str, int] = {}
        for record in self._model_tasks.values():
            if record.provider_name != "mock":
                busy_provider_counts[record.provider_name] = busy_provider_counts.get(record.provider_name, 0) + 1
        candidates = sorted(
            self.world.agent_profiles.items(),
            key=lambda item: self.world.agent_states[item[0]].last_model_tick,
        )
        for agent_id, profile in candidates:
            if profile.hidden:
                continue
            state = self.world.agent_states[agent_id]
            if state.pending_model or state.status == "moving":
                continue
            if self.world.tick - state.last_model_tick < self.agent_decision_interval_ticks:
                continue
            provider_id = self._provider_id_for(profile.model_provider)
            provider = self.providers.get(provider_id) or self.providers["mock"]
            provider_name = getattr(provider, "name", provider_id)
            if provider_name != "mock" and busy_provider_counts.get(provider_name, 0) >= self.model_concurrency:
                continue
            action_space = self._effective_action_space(profile.action_space)
            identity = self._identity_for(profile)
            language = self._dialogue_language(profile.dialogue_policy, identity)
            observation = self.context_compressor.compact_observation(self._observation_for(agent_id))
            cheap_action = self._prefilter_action(agent_id, action_space, observation, provider_name)
            if cheap_action is not None:
                self._apply_local_action_decision(
                    agent_id=agent_id,
                    provider="rule-prefilter",
                    model="context-budget-v1",
                    observation=observation,
                    text="local low-cost action",
                    action=cheap_action,
                )
                state.last_model_tick = self.world.tick
                continue
            if self._provider_recovery_active(provider_name):
                recovery_action = self._recovery_fallback_action(agent_id, action_space, observation, provider_name)
                self._apply_local_action_decision(
                    agent_id=agent_id,
                    provider="recovery-prefilter",
                    model=f"{provider_name}-cooldown",
                    observation=observation,
                    text="local recovery action while model provider is congested",
                    action=recovery_action,
                )
                state.last_model_tick = self.world.tick
                continue
            request = ModelRequest(
                agent_id=agent_id,
                role=profile.role,
                identity=identity,
                action_space=action_space,
                action_definitions=self._action_definitions(action_space),
                language=language,
                observation=observation,
            )
            task = asyncio.create_task(self._generate_with_timeout(provider, request))
            self._model_tasks[agent_id] = PendingModelTask(
                task=task,
                request=request,
                provider_name=provider_name,
                model_name=str(getattr(provider, "model", getattr(provider, "name", profile.model_provider))),
                started_tick=self.world.tick,
                started_at=perf_counter(),
                input_chars=self._json_chars(request.observation),
            )
            if provider_name != "mock":
                busy_provider_counts[provider_name] = busy_provider_counts.get(provider_name, 0) + 1
            state.pending_model = True
            state.last_model_tick = self.world.tick

    async def _generate_with_timeout(self, provider: ModelProvider, request: ModelRequest):
        try:
            return await asyncio.wait_for(provider.generate(request), timeout=self.model_timeout_seconds)
        except asyncio.TimeoutError as exc:
            raise TimeoutError(f"model request timed out after {self.model_timeout_seconds:g}s") from exc

    def _clear_orphaned_pending_model_flags(self) -> None:
        for agent_id, state in self.world.agent_states.items():
            if state.pending_model and agent_id not in self._model_tasks:
                state.pending_model = False

    def _recover_stalled_tasks(self) -> None:
        self._recover_stalled_model_tasks()
        self._recover_stalled_scene_director()

    def _recover_stalled_model_tasks(self) -> None:
        stalled = [
            (agent_id, record)
            for agent_id, record in self._model_tasks.items()
            if not record.task.done() and self.world.tick - record.started_tick >= self.model_watchdog_ticks
        ]
        for agent_id, record in stalled:
            self._model_tasks.pop(agent_id, None)
            state = self.world.agent_states.get(agent_id)
            if state is not None:
                state.pending_model = False
            elapsed_ms = round((perf_counter() - record.started_at) * 1000, 2)
            age_ticks = max(0, self.world.tick - record.started_tick)
            message = (
                f"Model task watchdog recovered after {round(elapsed_ms / 1000, 1)}s; "
                "using local rules temporarily."
            )
            event = self.world.add_event(
                "model_recovery",
                message,
                agent_id=agent_id,
                payload={
                    "provider": record.provider_name,
                    "model": record.model_name,
                    "age_ticks": age_ticks,
                    "watchdog_age_ticks": self.model_watchdog_ticks,
                },
            )
            self.world.add_decision_event(
                agent_id=agent_id,
                provider=record.provider_name,
                model=record.model_name,
                observation=record.request.observation,
                text="",
                actions=[],
                results=[
                    {
                        "ok": False,
                        "message": message,
                        "event_id": event.id,
                        "elapsed_ms": elapsed_ms,
                        "input_chars": record.input_chars,
                        "recovery": "watchdog",
                    }
                ],
            )
            self._trip_provider_recovery(record.provider_name)
            self._cancel_background_task(record.task)

    def _recover_stalled_scene_director(self) -> None:
        if not self._director_task or self._director_task.done():
            return
        age_ticks = max(0, self.world.tick - self._director_started_tick)
        if age_ticks < self.scene_director_watchdog_ticks:
            return
        self._cancel_background_task(self._director_task)
        self._director_task = None
        self._director_started_tick = -999
        self.world.narrative["last_tick"] = self.world.tick
        self.world.add_event(
            "scene_director_recovery",
            "Scene director watchdog recovered a stalled narration task.",
            payload={
                "age_ticks": age_ticks,
                "watchdog_age_ticks": self.scene_director_watchdog_ticks,
            },
        )

    def _cancel_background_task(self, task: asyncio.Task) -> None:
        task.cancel()

        def consume_cancelled_result(done: asyncio.Task) -> None:
            try:
                done.exception()
            except (asyncio.CancelledError, Exception):
                pass

        task.add_done_callback(consume_cancelled_result)

    def _provider_recovery_active(self, provider_name: str) -> bool:
        if provider_name == "mock":
            return False
        return self._provider_recovery_until.get(provider_name, 0) > self.world.tick

    def _trip_provider_recovery(self, provider_name: str) -> None:
        if provider_name == "mock":
            return
        self._provider_recovery_until[provider_name] = max(
            self._provider_recovery_until.get(provider_name, 0),
            self.world.tick + self.provider_recovery_ticks,
        )

    def _apply_local_action_decision(
        self,
        agent_id: str,
        provider: str,
        model: str,
        observation: dict[str, Any],
        text: str,
        action: dict[str, Any],
    ) -> dict[str, Any]:
        result = self.submit_action(
            AgentAction(
                agent_id=agent_id,
                type=str(action.get("type", "wait")),
                payload=dict(action.get("payload", {})),
            )
        )
        self._mark_item_dialogue_reference_if_needed(agent_id, action, observation)
        event = result.get("event") if isinstance(result.get("event"), dict) else None
        input_chars = self._json_chars(observation)
        self.world.add_decision_event(
            agent_id=agent_id,
            provider=provider,
            model=model,
            observation=observation,
            text=text,
            actions=[action],
            results=[
                {
                    "ok": bool(result.get("ok")),
                    "message": str(result.get("message", "")),
                    "event_id": event.get("id") if event else None,
                    "action_type": action.get("type"),
                    "elapsed_ms": 0,
                    "input_chars": input_chars,
                }
            ],
        )
        return result

    def _recovery_fallback_action(
        self,
        agent_id: str,
        action_space: list[str],
        observation: dict[str, Any],
        provider_name: str,
    ) -> dict[str, Any]:
        allowed = set(action_space)
        action = self._prefilter_action(agent_id, action_space, observation, provider_name)
        if action is not None:
            return action
        if observation.get("movement_intent") and "move_to" in allowed:
            target = self._first_movement_target(observation)
            if target:
                return {"type": "move_to", "payload": {"target": target}}
        if "observe" in allowed:
            return {"type": "observe", "payload": {}}
        if "wait" in allowed:
            return {"type": "wait", "payload": {"duration": 1}}
        return {"type": "wait", "payload": {"duration": 1}}

    def _schedule_scene_director(self) -> None:
        if self._director_task and not self._director_task.done():
            return
        if not bool(self.world.narrative.get("enabled", False)):
            return
        interval = max(1, int(self.world.narrative.get("cadence_ticks") or self.director_interval_ticks))
        last_tick = int(self.world.narrative.get("last_tick", -999))
        if self.world.tick - last_tick < interval:
            return
        if self._scene_director_should_wait_for_agent_models():
            return
        compressed = self.context_compressor.compress_world(self.world)
        if compressed.should_compress and compressed.summary:
            if not str(self.world.narrative.get("recent_summary") or "").strip():
                self.world.narrative["recent_summary"] = compressed.summary[:500]
            self.environment_arbiter.apply_proposal(
                self.world,
                {"memories": compressed.memories},
            )
        request = SceneDirectorRequest(
            tick=self.world.tick,
            map={
                "id": self.world.map.id,
                "name": self.world.map.name,
                "width": self.world.map.width,
                "height": self.world.map.height,
            },
            agents=self._director_agent_summaries(),
            recent_events=[
                event.to_dict()
                for event in self.world.events
                if event.type not in {"model_error"}
            ][-12:],
            items=self._director_item_summaries(),
            narrative=dict(self.world.narrative),
            scene_memories=[memory.to_dict() for memory in self.world.memories if memory.agent_id == "__scene__"][-8:],
            narrative_cues=[
                event.to_dict()
                for event in self.world.events
                if event.type in {"hint", "narration"} and (event.agent_id is None or event.agent_id in self.world.agent_profiles)
            ][-8:],
        )
        self._director_task = asyncio.create_task(self._scene_director_for_current_narrative().generate(request))
        self._director_started_tick = self.world.tick
        self.world.narrative["last_tick"] = self.world.tick

    def _scene_director_provider_id(self) -> str:
        if self._uses_dedicated_narrative_service():
            return "local_narrative_service"
        requested = str(self.world.narrative.get("model_provider") or "").strip()
        return requested or self.default_provider_id or "mock"

    def _scene_director_provider_name(self) -> str:
        provider_id = self._scene_director_provider_id()
        provider = self.providers.get(provider_id)
        if provider is not None:
            return str(getattr(provider, "name", provider_id))
        return provider_id

    def _scene_director_should_wait_for_agent_models(self) -> bool:
        if self._uses_dedicated_narrative_service():
            return False
        provider_name = self._scene_director_provider_name()
        if provider_name == "mock":
            return False
        same_provider_tasks = [
            record for record in self._model_tasks.values() if record.provider_name == provider_name and not record.task.done()
        ]
        return len(same_provider_tasks) >= self.model_concurrency

    def _scene_director_for_current_narrative(self) -> SceneDirector:
        if not self.scene_directors:
            return self.scene_director
        if self._uses_dedicated_narrative_service():
            return self.scene_directors["local_narrative_service"]
        provider_id = self._scene_director_provider_id()
        if provider_id in self.scene_directors:
            return self.scene_directors[provider_id]
        provider = self.providers.get(provider_id)
        if provider is not None:
            return LLMSceneDirector(provider)
        if self.default_provider_id in self.scene_directors:
            return self.scene_directors[self.default_provider_id]
        return self.scene_directors.get("mock") or self.scene_director

    def _uses_dedicated_narrative_service(self) -> bool:
        return bool(self.world.narrative.get("dedicated_service_enabled", True)) and "local_narrative_service" in self.scene_directors

    def _harvest_director_task(self) -> None:
        if not self._director_task or not self._director_task.done():
            return
        task = self._director_task
        self._director_task = None
        self._director_started_tick = -999
        try:
            response = task.result()
        except Exception as exc:  # pragma: no cover - defensive API runtime path
            self._record_scene_director_failure(exc)
            return
        review = self.environment_arbiter.apply_proposal(self.world, response.proposal)
        has_visible_caption = any(
            accepted.get("kind") == "event"
            and accepted.get("event", {}).get("type") in {"narration", "hint", "weather", "environment"}
            for accepted in review.accepted
        )
        director_text = self._item_grounded_scene_text(response.text)
        if director_text:
            self.world.narrative["recent_summary"] = director_text[:500]
            if not any(
                accepted.get("kind") == "state_change"
                and accepted.get("value", {}).get("op") == "set_agent_narrative_state"
                for accepted in review.accepted
            ):
                self._apply_caption_guidance_to_visible_agents(director_text)
        if director_text:
            self.world.add_event(
                "system" if has_visible_caption else "narration",
                director_text,
                payload={
                    "source": "scene_director",
                    "guidance": "Use this as scene pressure for the next agent choices; do not quote it as dialogue.",
                    "accepted": len(review.accepted),
                    "rejected": len(review.rejected),
                },
            )

    def _apply_caption_guidance_to_visible_agents(self, director_text: str) -> None:
        tone = str(self.world.narrative.get("tone") or "charged").strip()[:80]
        focus = director_text[:80]
        for agent_id, profile in self.world.agent_profiles.items():
            if profile.hidden:
                continue
            state = self.world.agent_states.get(agent_id)
            if state is None:
                continue
            state.narrative_state["mood"] = tone or "charged"
            state.narrative_state["focus"] = focus
            state.narrative_state["urgency"] = "rising"

    def _record_scene_director_failure(self, exc: Exception) -> None:
        raw_message = str(exc) or exc.__class__.__name__
        dedicated = self._uses_dedicated_narrative_service()
        if dedicated and _looks_like_connection_failure(raw_message):
            message = "独立叙事服务暂未连接，场景叙事已临时关闭；Agent 对话会继续运行。"
            self.world.narrative["enabled"] = False
            self.world.narrative["dedicated_service_enabled"] = False
            self.world.narrative["recent_summary"] = ""
            self.world.narrative["last_tick"] = -999
        else:
            message = raw_message
        recent_duplicate = next(
            (
                event
                for event in reversed(self.world.events[-8:])
                if event.type == "scene_director_error" and event.message == message
            ),
            None,
        )
        if recent_duplicate is None:
            self.world.add_event(
                "scene_director_error",
                message,
                payload={
                    "source": "scene_director",
                    "raw_error": raw_message,
                    "dedicated_service": dedicated,
                    "narrative_disabled": bool(dedicated and _looks_like_connection_failure(raw_message)),
                },
            )

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
                elapsed_ms = round((perf_counter() - record.started_at) * 1000, 2)
                self.world.add_event("model_error", str(exc), agent_id=agent_id)
                self._trip_provider_recovery(record.provider_name)
                self.world.add_decision_event(
                    agent_id=agent_id,
                    provider=record.provider_name,
                    model=record.model_name,
                    observation=record.request.observation,
                    text="",
                    actions=[],
                    results=[
                        {
                            "ok": False,
                            "message": str(exc),
                            "event_id": None,
                            "elapsed_ms": elapsed_ms,
                            "input_chars": record.input_chars,
                        }
                    ],
                )
                continue
            elapsed_ms = round((perf_counter() - record.started_at) * 1000, 2)
            if response.text:
                self.world.add_event("model_text", response.text, agent_id=agent_id)
            actions: list[dict[str, Any]] = []
            results: list[dict[str, Any]] = []
            raw_actions = response.actions[:1]
            if not raw_actions:
                raw_actions = [{"type": self._fallback_action_type(record.request, response.text), "payload": {}}]
            for raw_action in raw_actions:
                if not isinstance(raw_action, dict):
                    results.append({"ok": False, "message": "invalid action payload", "event_id": None})
                    continue
                action = self._coerce_model_action(raw_action, response.text, record.request)
                actions.append(action)
                action_type = str(action.get("type", "wait"))
                payload = dict(action.get("payload", {}))
                result = self.submit_action(AgentAction(agent_id=agent_id, type=action_type, payload=payload))
                self._mark_item_dialogue_reference_if_needed(agent_id, action, record.request.observation)
                event = result.get("event") if isinstance(result.get("event"), dict) else None
                results.append(
                    {
                        "ok": bool(result.get("ok")),
                        "message": str(result.get("message", "")),
                        "event_id": event.get("id") if event else None,
                        "action_type": action_type,
                        "elapsed_ms": elapsed_ms,
                        "input_chars": record.input_chars,
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

    def _prefilter_action(
        self,
        agent_id: str,
        action_space: list[str],
        observation: dict[str, Any],
        provider_name: str,
    ) -> dict[str, Any] | None:
        if not self.action_prefilter_enabled:
            return None
        allowed = set(action_space)
        if provider_name == "mock":
            if observation.get("movement_intent") and "move_to" in allowed:
                target = self._first_movement_target(observation)
                if target:
                    return {"type": "move_to", "payload": {"target": target}}
            return self._local_item_opportunity_action(agent_id, observation, allowed)
        if observation.get("held_item_id") and "move_to" in allowed:
            target = self._first_movement_target(observation)
            if target:
                return {"type": "move_to", "payload": {"target": target}}
        if observation.get("movement_intent") and "move_to" in allowed:
            target = self._first_movement_target(observation)
            if target:
                return {"type": "move_to", "payload": {"target": target}}
        local_social_action = self._local_social_opportunity_action(agent_id, observation, allowed)
        if local_social_action is not None:
            return local_social_action
        local_item_action = self._local_item_opportunity_action(agent_id, observation, allowed)
        if local_item_action is not None:
            return local_item_action
        if self._item_interaction_cooldown_active(agent_id) and not observation.get("held_item_id"):
            if "observe" in allowed:
                return {"type": "observe", "payload": {}}
            if "wait" in allowed:
                return {"type": "wait", "payload": {"duration": 1}}
        if self._needs_llm_decision(observation, allowed):
            return None
        if "observe" in allowed:
            return {"type": "observe", "payload": {}}
        if "wait" in allowed:
            return {"type": "wait", "payload": {"duration": 1}}
        return None

    def _needs_llm_decision(self, observation: dict[str, Any], allowed: set[str]) -> bool:
        if observation.get("dialogue_candidates") and ({"social", "say"} & allowed):
            return True
        if observation.get("held_item_id") and ({"drop_item", "move_item", "use"} & allowed):
            return True
        nearby_items = observation.get("nearby_items")
        if isinstance(nearby_items, list) and any(
            isinstance(item, dict)
            and (
                item.get("movable")
                or item.get("interactable")
                or bool(item.get("available_affordances"))
            )
            for item in nearby_items
        ) and ({"pick_up", "move_item", "interact", "use"} & allowed):
            return True
        recent_events = observation.get("agent_recent_events")
        if isinstance(recent_events, list) and any(
            isinstance(event, dict) and event.get("type") in {"dialogue", "interaction", "rejected_action"}
            for event in recent_events[-4:]
        ):
            return True
        return False

    def _local_social_opportunity_action(
        self,
        agent_id: str,
        observation: dict[str, Any],
        allowed: set[str],
    ) -> dict[str, Any] | None:
        target = self._first_dialogue_candidate(observation)
        if target and "social" in allowed:
            target_id = str(target.get("id") or "")
            if target_id:
                return {
                    "type": "social",
                    "payload": {
                        "target_agent_id": target_id,
                        "text": self._local_social_text(agent_id, observation, target),
                    },
                }
        item_name = self._preferred_observation_item_name(observation)
        if item_name and "say" in allowed and self._should_reference_item_in_dialogue(agent_id, observation):
            return {
                "type": "say",
                "payload": {
                    "text": (
                        f"我刚才注意到{item_name}。"
                        if self._observation_language(observation) == "zh-CN"
                        else f"I just noticed {item_name}."
                    )
                },
            }
        return None

    def _first_dialogue_candidate(self, observation: dict[str, Any]) -> dict[str, Any] | None:
        candidates = observation.get("dialogue_candidates")
        if not isinstance(candidates, list):
            return None
        for candidate in candidates:
            if isinstance(candidate, dict) and candidate.get("id"):
                return candidate
        return None

    def _local_social_text(self, agent_id: str, observation: dict[str, Any], target: dict[str, Any]) -> str:
        zh = self._observation_language(observation) == "zh-CN"
        target_name = str(target.get("name") or target.get("id") or "there")
        item_name = (
            self._preferred_observation_item_name(observation)
            if self._should_reference_item_in_dialogue(agent_id, observation)
            else ""
        )
        if item_name:
            return (
                f"{target_name}，你也注意到{item_name}了吗？"
                if zh
                else f"{target_name}, did you notice {item_name} too?"
            )
        return (
            f"{target_name}，你刚才那一步让我想再确认一下。"
            if zh
            else f"{target_name}, your last move made me want to check something."
        )

    def _observation_language(self, observation: dict[str, Any]) -> str:
        return str(observation.get("effective_dialogue_language") or observation.get("dialogue_language") or "auto")

    def _item_interaction_cooldown_active(self, agent_id: str) -> bool:
        state = self.world.agent_states.get(agent_id)
        return state is not None and self.world.tick < float(state.cooldowns.get("item_interaction_until", 0))

    def _local_item_opportunity_action(
        self,
        agent_id: str,
        observation: dict[str, Any],
        allowed: set[str],
    ) -> dict[str, Any] | None:
        if self._item_interaction_cooldown_active(agent_id):
            return None
        interaction_chance = self._item_interaction_chance(agent_id)
        if interaction_chance <= 0 or not self._chance_gate(agent_id, "item_interaction", interaction_chance):
            return None
        if "use" in allowed:
            item_id = self._first_affordance_item_id(observation, "use")
            if item_id and not self._recent_item_action(observation, item_id, {"use", "interact"}):
                return {"type": "use", "payload": {"target_id": item_id}}
        if "interact" in allowed:
            item_id = self._first_affordance_item_id(observation, "interact")
            if item_id and not self._recent_item_action(observation, item_id, {"use", "interact"}):
                return {"type": "interact", "payload": {"target_id": item_id}}
            item_id = self._first_interactable_item_id(observation, "interact")
            if item_id and not self._recent_item_action(observation, item_id, {"use", "interact"}):
                return {"type": "interact", "payload": {"target_id": item_id}}
        if observation.get("movement_intent") and "move_to" in allowed:
            target = self._first_item_approach_target(observation)
            if target is not None:
                return {"type": "move_to", "payload": {"target": target}}
        if (
            observation.get("movement_intent")
            and not observation.get("held_item_id")
            and "pick_up" in allowed
        ):
            item_id = self._first_movable_item_id(observation)
            if item_id and not self._recent_item_action(observation, item_id, {"pick_up", "drop_item"}):
                return {"type": "pick_up", "payload": {"item_id": item_id}}
        return None

    def _recent_item_action(self, observation: dict[str, Any], item_id: str, action_types: set[str]) -> bool:
        events = observation.get("agent_recent_events")
        if not item_id or not isinstance(events, list):
            return False
        for event in events[-4:]:
            if not isinstance(event, dict):
                continue
            payload = event.get("payload")
            if not isinstance(payload, dict):
                continue
            event_item_id = str(payload.get("item_id") or payload.get("target_id") or "")
            action = payload.get("action")
            action_type = str(action.get("type") or "") if isinstance(action, dict) else ""
            if event_item_id == item_id and (not action_types or action_type in action_types):
                return True
        return False

    def _coerce_model_action(self, raw_action: dict[str, Any], response_text: str, request: ModelRequest) -> dict[str, Any]:
        allowed = set(request.action_space)
        action_type = str(raw_action.get("type") or "wait")
        if action_type not in allowed:
            action_type = "wait"
        payload = raw_action.get("payload") if isinstance(raw_action.get("payload"), dict) else {}
        payload = dict(payload)
        observation = request.observation

        if action_type == "say":
            if observation.get("movement_intent") and "move_to" in allowed:
                target = self._first_movement_target(observation)
                if target:
                    return {"type": "move_to", "payload": {"target": target}}
            text = self._clean_utterance_text(payload.get("text") or response_text, request)
            if not text:
                return self._fallback_action("", allowed, request)
            text = self._item_grounded_utterance_text(text, request)
            return {"type": "say", "payload": {"text": text}}

        if action_type == "social":
            target_id = str(payload.get("target_agent_id") or payload.get("target_id") or "").strip()
            if not self._observation_id_exists(observation.get("dialogue_candidates"), target_id):
                target_id = self._first_observation_id(observation.get("dialogue_candidates"))
            if not target_id:
                return self._fallback_action(response_text, allowed, request)
            text = self._clean_utterance_text(payload.get("text") or response_text, request, target_agent_id=target_id)
            if not text:
                return self._fallback_action("", allowed, request)
            text = self._item_grounded_utterance_text(text, request)
            return {"type": "social", "payload": {"target_agent_id": target_id, "text": text}}

        if action_type == "move_to":
            target = self._movement_target_from_payload(payload, observation)
            if not target:
                return self._fallback_action(response_text, allowed, request)
            return {"type": "move_to", "payload": {"target": target}}

        if action_type == "stop":
            return {"type": "stop", "payload": {"reason": str(payload.get("reason") or "rest")}}

        if action_type == "pick_up":
            item_id = str(payload.get("item_id") or payload.get("target_id") or "").strip()
            if not item_id:
                item_id = self._first_movable_item_id(observation)
            if not item_id:
                return self._fallback_action(response_text, allowed, request)
            return {"type": "pick_up", "payload": {"item_id": item_id}}

        if action_type == "drop_item":
            position = payload.get("position") if isinstance(payload.get("position"), dict) else observation.get("position")
            return {"type": "drop_item", "payload": {"position": position} if self._valid_point_dict(position) else {}}

        if action_type == "move_item":
            item_id = str(payload.get("item_id") or payload.get("target_id") or "").strip()
            if not item_id:
                item_id = self._first_movable_item_id(observation)
            if not item_id:
                return self._fallback_action(response_text, allowed, request)
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
                target_id = self._first_affordance_item_id(observation, action_type)
            if not target_id:
                target_id = self._first_interactable_item_id(observation, action_type)
            if not target_id:
                return self._fallback_action(response_text, allowed, request)
            return {"type": action_type, "payload": {"target_id": target_id}}

        if action_type == "wait":
            if observation.get("movement_intent") and "move_to" in allowed:
                target = self._first_movement_target(observation)
                if target:
                    return {"type": "move_to", "payload": {"target": target}}
            return {"type": "wait", "payload": {"duration": self._positive_int(payload.get("duration"), default=1)}}

        if action_type in {definition["type"] for definition in request.action_definitions}:
            return {"type": action_type, "payload": payload}

        return self._fallback_action(response_text, allowed, request)

    def _fallback_action(
        self,
        response_text: str,
        allowed: set[str],
        request: ModelRequest | None = None,
    ) -> dict[str, Any]:
        if request is not None and request.observation.get("movement_intent") and "move_to" in allowed:
            target = self._first_movement_target(request.observation)
            if target:
                return {"type": "move_to", "payload": {"target": target}}
        if request is not None and response_text and "say" in allowed:
            text = self._clean_utterance_text(response_text, request)
            if text:
                return {"type": "say", "payload": {"text": text}}
        if "observe" in allowed:
            return {"type": "observe", "payload": {}}
        return {"type": "wait", "payload": {"duration": 1}}

    def _fallback_action_type(self, request: ModelRequest, response_text: str) -> str:
        if request.observation.get("movement_intent") and "move_to" in request.action_space:
            return "move_to"
        if response_text and "say" in request.action_space and self._clean_utterance_text(response_text, request):
            return "say"
        if "observe" in request.action_space:
            return "observe"
        return "wait"

    def _fallback_text(self, request: ModelRequest) -> str:
        item_name = self._preferred_observation_item_name(request.observation)
        if item_name:
            return f"我先看看{item_name}。" if request.language == "zh-CN" else f"I will take a closer look at {item_name}."
        return "我先观察一下。" if request.language == "zh-CN" else "I am thinking."

    def _first_observation_item_name(self, observation: dict[str, Any]) -> str:
        return self._preferred_observation_item_name(observation)

    def _preferred_observation_item_name(self, observation: dict[str, Any]) -> str:
        names = self._observation_item_names(observation)
        return names[0] if names else ""

    def _observation_item_names(self, observation: dict[str, Any]) -> list[str]:
        item_context = observation.get("item_context")
        candidates = item_context.get("nearby_named_items") if isinstance(item_context, dict) else observation.get("nearby_items")
        if not isinstance(candidates, list):
            return []
        recent_item_ids = set()
        if isinstance(item_context, dict) and isinstance(item_context.get("recent_item_events"), list):
            recent_item_ids = {
                str(event.get("item_id"))
                for event in item_context["recent_item_events"]
                if isinstance(event, dict) and event.get("item_id")
            }
        names: list[str] = []
        for item in candidates:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            item_id = str(item.get("id") or "")
            if name and name not in names and self._is_quality_dialogue_item_anchor(item, recent_item_ids, item_id):
                names.append(name)
        return names

    def _item_grounded_utterance_text(self, text: str, request: ModelRequest) -> str:
        cleaned = str(text or "").strip()
        if not cleaned:
            return ""
        names = self._observation_item_names(request.observation)
        if not names or any(name and name in cleaned for name in names):
            return cleaned
        if not self._should_reference_item_in_dialogue(request.agent_id, request.observation):
            return cleaned
        item_name = self._preferred_observation_item_name(request.observation)
        if not item_name:
            return cleaned
        if self._contains_cjk(cleaned) or request.language == "zh-CN":
            return f"{cleaned} 我刚才注意到{item_name}。"
        return f"{cleaned} I just noticed {item_name}."

    def _item_grounded_scene_text(self, text: str) -> str:
        return str(text or "").strip()

    def _should_reference_item_in_dialogue(self, agent_id: str, observation: dict[str, Any]) -> bool:
        names = self._observation_item_names(observation)
        if not names:
            return False
        state = self.world.agent_states.get(agent_id)
        if state is not None and self.world.tick < float(state.cooldowns.get("item_dialogue_reference_until", 0)):
            return False
        mention_chance = self._item_mention_chance(agent_id)
        if mention_chance <= 0 or not self._chance_gate(agent_id, "item_mention", mention_chance):
            return False
        visible_dialogue = [event for event in self.world.events if event.type in {"speech", "dialogue"}]
        return not any(self._text_mentions_any_item(event.message, names) for event in visible_dialogue[-16:])

    def _item_interaction_chance(self, agent_id: str) -> float:
        profile = self.world.agent_profiles.get(agent_id)
        if profile is None:
            return 0.0
        return _clamp_probability(profile.dialogue_policy.get("item_interaction_chance", 0.35))

    def _item_mention_chance(self, agent_id: str) -> float:
        profile = self.world.agent_profiles.get(agent_id)
        if profile is None:
            return 0.0
        return _clamp_probability(profile.dialogue_policy.get("item_mention_chance", 0.12))

    def _chance_gate(self, agent_id: str, salt: str, chance: float) -> bool:
        chance = _clamp_probability(chance)
        if chance >= 1:
            return True
        if chance <= 0:
            return False
        bucket = self.world.tick // max(1, self.agent_decision_interval_ticks)
        sample = _stable_probability(f"{agent_id}:{salt}:{bucket}")
        return sample < chance

    def _mark_item_dialogue_reference_if_needed(
        self,
        agent_id: str,
        action: dict[str, Any],
        observation: dict[str, Any],
    ) -> None:
        if str(action.get("type") or "") not in {"say", "social"}:
            return
        payload = action.get("payload")
        text = str(payload.get("text") or "") if isinstance(payload, dict) else ""
        if not text or not self._text_mentions_any_item(text, self._observation_item_names(observation)):
            return
        state = self.world.agent_states.get(agent_id)
        if state is not None:
            state.cooldowns["item_dialogue_reference_until"] = self.world.tick + 180

    def _text_mentions_any_item(self, text: str, names: list[str]) -> bool:
        return any(name and not self._is_low_information_item_name(name) and name in text for name in names)

    def _visible_item_names_for_language(self) -> list[str]:
        names: list[str] = []
        for item in self.world.map.items:
            if item.hidden:
                continue
            name = str(item.name or item.id).strip()
            if name and not self._is_low_information_item_name(name) and name not in names:
                names.append(name)
        return sorted(names)

    def _is_low_information_item_name(self, name: str) -> bool:
        normalized = str(name or "").strip().lower()
        if not normalized:
            return True
        if normalized in LOW_INFORMATION_ITEM_NAMES:
            return True
        return re.fullmatch(r"(item|object|element|thing)[\s_-]*\d*", normalized) is not None

    def _is_quality_dialogue_item_anchor(self, item: dict[str, Any], recent_item_ids: set[str], item_id: str) -> bool:
        name = str(item.get("name") or "").strip()
        if self._is_low_information_item_name(name):
            return False
        has_recent_event = bool(item_id and item_id in recent_item_ids)
        return bool(
            has_recent_event
            or item.get("description")
            or item.get("tags")
            or item.get("available_affordances")
            or item.get("configured_affordances")
            or item.get("affordances")
            or item.get("state")
        )

    def _clean_utterance_text(
        self,
        value: Any,
        request: ModelRequest,
        target_agent_id: str | None = None,
    ) -> str:
        if isinstance(value, dict):
            value = value.get("text") or value.get("utterance") or value.get("message") or ""
        text = str(value or "").strip()
        if not text:
            return ""
        text = self._strip_utterance_prefix(text, request, target_agent_id).strip()
        text = text.strip("\"'“”‘’` \n\t")
        if self._is_low_quality_utterance(text, request):
            return ""
        return text

    def _strip_utterance_prefix(
        self,
        text: str,
        request: ModelRequest,
        target_agent_id: str | None = None,
    ) -> str:
        agent_name = str(request.observation.get("agent_name") or request.agent_id)
        names = [agent_name, request.agent_id]
        if target_agent_id:
            target_profile = self.world.agent_profiles.get(target_agent_id)
            if target_profile is not None:
                names.extend([target_profile.name, target_profile.id])
        stripped = text.strip()
        for name in [item for item in names if item]:
            stripped = re.sub(rf"^\s*{re.escape(str(name))}\s*[:：]\s*", "", stripped, flags=re.IGNORECASE)
        stripped = re.sub(r"^\s*[^:：]{1,40}\s*(?:->|→)\s*[^:：]{1,40}\s*[:：]\s*", "", stripped)
        return stripped

    def _is_low_quality_utterance(self, text: str, request: ModelRequest) -> bool:
        normalized = self._normalize_utterance(text)
        if not normalized:
            return True
        if len(text) > 180 or len(text.split()) > 36:
            return True
        agent_name = str(request.observation.get("agent_name") or request.agent_id)
        lower_name = agent_name.lower()
        if normalized.startswith(f"{lower_name} ") or normalized.startswith("the agent "):
            return True
        if lower_name and (
            normalized.startswith(f"{lower_name} is ")
            or normalized.startswith(f"{lower_name} decides ")
            or normalized.startswith(f"{lower_name} notices ")
            or normalized.startswith(f"{lower_name} chooses ")
        ):
            return True
        identity = self._normalize_utterance(request.identity)
        if identity and len(identity) > 24 and (normalized == identity or normalized in identity or identity in normalized):
            return True
        role = str(request.role or "").lower()
        if lower_name and role and f"{lower_name} is a {role}" in normalized:
            return True
        if any(phrase in normalized for phrase in self._bad_utterance_phrases()):
            return True
        if self._contains_cjk(text) and any(phrase in text for phrase in self._bad_utterance_phrases_zh()):
            return True
        recent = request.observation.get("recent_utterances")
        if isinstance(recent, list):
            for item in recent[-8:]:
                recent_text = item.get("text") if isinstance(item, dict) else item
                if normalized == self._normalize_utterance(str(recent_text or "")):
                    return True
        return False

    def _normalize_utterance(self, text: str) -> str:
        lowered = str(text or "").strip().lower()
        lowered = re.sub(r"[\s\u3000]+", " ", lowered)
        return re.sub(r"[\"'“”‘’`.,!?;:，。！？；：、()\[\]{}<>]+", "", lowered).strip()

    def _contains_cjk(self, text: str) -> bool:
        return any("\u4e00" <= char <= "\u9fff" for char in str(text or ""))

    def _bad_utterance_phrases(self) -> tuple[str, ...]:
        return (
            "how is your day going",
            "nice weather",
            "weather is",
            "beautiful day",
            "greetings",
            "i am a ",
            "i'm a ",
            "i decided",
            "i choose",
            "i will move",
            "i am going to move",
            "i'm going to move",
            "i should choose",
            "action plan",
            "return json",
            "payload",
            "action_space",
            "move_to",
            "valid region target",
            "nearby destination",
            "observing the environment",
            "as an ai",
            "this agent",
            "with a distinct social point of view",
        )

    def _bad_utterance_phrases_zh(self) -> tuple[str, ...]:
        return (
            "天气真好",
            "今天天气",
            "阳光明媚",
            "你今天过得怎么样",
            "今天过得怎么样",
            "作为一个",
            "我决定",
            "我会移动",
            "我将移动",
            "选择一个适当",
            "选择了一个附近",
            "工作计划",
            "计划是否",
            "行动计划",
            "解释",
            "观察周围环境",
            "等待并观察",
            "正在观察第",
            "payload",
            "move_to",
            "json",
        )

    def _first_observation_id(self, items: Any) -> str:
        if not isinstance(items, list):
            return ""
        for item in items:
            if isinstance(item, dict) and item.get("id"):
                return str(item["id"])
        return ""

    def _observation_id_exists(self, items: Any, item_id: str) -> bool:
        if not item_id or not isinstance(items, list):
            return False
        return any(isinstance(item, dict) and str(item.get("id") or "") == item_id for item in items)

    def _first_movable_item_id(self, observation: dict[str, Any]) -> str:
        items = observation.get("nearby_items")
        if not isinstance(items, list):
            return ""
        for item in items:
            if (
                isinstance(item, dict)
                and item.get("id")
                and item.get("movable")
                and self._item_within_interaction_range(item)
            ):
                return str(item["id"])
        return ""

    def _first_interactable_item_id(self, observation: dict[str, Any], action_type: str = "interact") -> str:
        items = observation.get("nearby_items")
        if not isinstance(items, list):
            return ""
        for item in items:
            if not isinstance(item, dict) or not item.get("id") or not item.get("interactable", True):
                continue
            if not self._item_within_interaction_range(item):
                continue
            configured_actions = {
                str(affordance.get("action") or "")
                for affordance in item.get("configured_affordances") or []
                if isinstance(affordance, dict)
            }
            if action_type in configured_actions and not item.get("available_affordances"):
                continue
            return str(item["id"])
        return ""

    def _item_within_interaction_range(self, item: dict[str, Any]) -> bool:
        raw_distance = item.get("distance")
        if not isinstance(raw_distance, (int, float)):
            return True
        return float(raw_distance) <= self.rule_engine.interaction_range

    def _first_affordance_item_id(self, observation: dict[str, Any], action_type: str) -> str:
        items = observation.get("nearby_items")
        if not isinstance(items, list):
            return ""
        for item in items:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            affordances = item.get("available_affordances")
            if not isinstance(affordances, list):
                continue
            if any(isinstance(affordance, dict) and affordance.get("action") == action_type for affordance in affordances):
                return str(item["id"])
        return ""

    def _first_item_approach_target(self, observation: dict[str, Any]) -> dict[str, Any] | None:
        items = observation.get("nearby_items")
        if not isinstance(items, list):
            return None
        for item in items:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            if self._item_within_interaction_range(item):
                continue
            if not (item.get("interactable", True) or item.get("movable")):
                continue
            point = item.get("approach_point")
            if self._valid_point_dict(point):
                return {"x": float(point["x"]), "y": float(point["y"])}
        return None

    def _first_movement_target(self, observation: dict[str, Any]) -> dict[str, Any] | None:
        targets = observation.get("movement_targets")
        if not isinstance(targets, list):
            return None
        for target in targets:
            if isinstance(target, dict) and self._valid_point_dict(target.get("point")):
                return dict(target["point"])
        return None

    def _movement_target_from_payload(self, payload: dict[str, Any], observation: dict[str, Any]) -> dict[str, Any] | None:
        targets = observation.get("movement_targets")
        if not isinstance(targets, list):
            targets = []
        target_points = [
            dict(target["point"])
            for target in targets
            if isinstance(target, dict) and self._valid_point_dict(target.get("point"))
        ]
        raw_target = payload.get("target") if isinstance(payload.get("target"), dict) else None
        if not self._valid_point_dict(raw_target):
            return target_points[0] if target_points else None
        raw = {"x": float(raw_target["x"]), "y": float(raw_target["y"])}
        if not target_points:
            return raw
        nearest = min(target_points, key=lambda point: distance(raw, point))
        if distance(raw, nearest) <= 40:
            return nearest
        return target_points[0]

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
        identity = self._identity_for(profile)
        effective_language = self._dialogue_language(policy, identity)
        base_dialogue_distance = float(policy.get("distance", 180.0))
        social_range_bonus = self.rule_engine.social_range_bonus(self.world, state.position)
        dialogue_distance = self.rule_engine.social_dialogue_range(self.world, state.position, policy)
        can_social = bool(policy.get("enabled", True)) and self.world.tick >= float(state.cooldowns.get("social_until", 0))
        movement_targets = self._movement_targets_for(agent_id)
        agent_recent_events = [
            event.to_dict()
            for event in self.world.events
            if self._is_agent_context_event(event.to_dict(), agent_id)
        ][-8:]
        recent_agent_move = any(
            event.get("agent_id") == agent_id
            and self.world.tick - int(event.get("tick", self.world.tick)) <= self.agent_decision_interval_ticks
            and (
                event.get("type") == "movement"
                or (
                    event.get("type") == "action"
                    and isinstance(event.get("payload"), dict)
                    and isinstance(event["payload"].get("action"), dict)
                    and event["payload"]["action"].get("type") == "move_to"
                )
            )
            for event in agent_recent_events
        )
        scene_context = self._scene_context_for(agent_id)
        relationships = self._relationship_context_for(agent_id, nearby_agents)
        recent_utterances = self._recent_utterances_for(agent_id)
        conversation_focus = self._conversation_focus_for(nearby_agents, nearby_items, relationships, recent_utterances)
        item_context = self._item_context_for(agent_id, nearby_items)
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
            "movement_targets": movement_targets,
            "movement_intent": bool("move_to" in profile.action_space and movement_targets and not recent_agent_move),
            "movement_constraints": {
                "agent_min_center_distance": self.rule_engine.agent_min_center_distance,
                "note": "Move targets are pre-adjusted so agent centers keep this distance from other agents.",
            },
            "region_context": self._region_context_for(state.position, movement_targets, base_dialogue_distance),
            "dialogue_range": {
                "base": base_dialogue_distance,
                "social_region_bonus": social_range_bonus,
                "effective": dialogue_distance,
            },
            "dialogue_candidates": [
                agent for agent in nearby_agents if can_social and agent["distance"] <= dialogue_distance
            ],
            "agent_recent_events": agent_recent_events,
            "recent_events": agent_recent_events,
            "relationships": relationships,
            "recent_utterances": recent_utterances,
            "conversation_focus": conversation_focus,
            "item_context": item_context,
            "scene_context": scene_context,
            "effective_dialogue_language": effective_language,
            "dialogue_language": effective_language,
            "narrative_state": dict(state.narrative_state),
            "scene_memories": scene_context["memories"],
            "narrative_cues": scene_context["cues"],
        }

    def _is_agent_context_event(self, event: dict[str, Any], agent_id: str) -> bool:
        event_type = str(event.get("type") or "")
        if event_type not in {
            "speech",
            "dialogue",
            "action",
            "movement",
            "interaction",
            "observation",
            "extension_action",
            "rejected_action",
        }:
            return False
        if event.get("agent_id") == agent_id:
            return True
        payload = event.get("payload")
        if isinstance(payload, dict):
            participants = payload.get("participants")
            if isinstance(participants, list) and agent_id in {str(item) for item in participants}:
                return True
            target_agent_id = payload.get("target_agent_id")
            if target_agent_id and str(target_agent_id) == agent_id:
                return True
        return False

    def _scene_context_for(self, agent_id: str) -> dict[str, Any]:
        cues = [
            event.to_dict()
            for event in self.world.events
            if event.type in {"hint", "narration", "weather", "environment"}
            and (event.agent_id is None or event.agent_id == agent_id)
        ][-5:]
        return {
            "mode": "directional_scene_pressure",
            "instruction": (
                "Use cues as pressure for the next choice, topic, or hesitation; do not quote narration "
                "as the agent's own speech."
            ),
            "recent_summary": str(self.world.narrative.get("recent_summary") or ""),
            "agent_narrative_state": dict(self.world.agent_states[agent_id].narrative_state),
            "memories": [memory.to_dict() for memory in self.world.memories if memory.agent_id == "__scene__"][-5:],
            "cues": cues,
        }

    def _item_context_for(self, agent_id: str, nearby_items: list[dict[str, Any]]) -> dict[str, Any]:
        recent_item_events: list[dict[str, Any]] = []
        for event in self.world.events[-24:]:
            event_dict = event.to_dict()
            if event.type not in {"interaction", "rejected_action", "observation"}:
                continue
            payload = event_dict.get("payload")
            item_id = ""
            if isinstance(payload, dict):
                nested_payload = payload.get("payload")
                nested_target_id = nested_payload.get("target_id") if isinstance(nested_payload, dict) else ""
                item_id = str(payload.get("item_id") or payload.get("target_id") or nested_target_id or "")
            if item_id or event.type == "interaction":
                recent_item_events.append(
                    {
                        "tick": event.tick,
                        "type": event.type,
                        "agent_id": event.agent_id,
                        "item_id": item_id,
                        "message": event.message,
                    }
                )
        nearby_named_items = [
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "distance": item.get("distance"),
                "within_interaction_range": item.get("within_interaction_range"),
                "approach_point": item.get("approach_point"),
                "movable": item.get("movable"),
                "interactable": item.get("interactable"),
                "description": item.get("description") or "",
                "tags": item.get("tags") or [],
                "available_affordances": item.get("available_affordances") or [],
                "configured_affordances": item.get("configured_affordances") or [],
                "state": item.get("state") or {},
            }
            for item in nearby_items[:5]
            if not self._is_low_information_item_name(str(item.get("name") or ""))
        ]
        return {
            "instruction": (
                "Treat nearby_named_items as optional scene anchors. "
                "Mention a relevant item by name only when item_policy allows it and it has a specific name plus a recent interaction, useful affordance, tag, or description."
            ),
            "agent_id": agent_id,
            "nearby_named_items": nearby_named_items,
            "recent_item_events": recent_item_events[-6:],
            "item_policy": {
                "interaction_chance": self._item_interaction_chance(agent_id),
                "mention_chance": self._item_mention_chance(agent_id),
                "instruction": "Higher interaction_chance means this agent is more willing to use/interact/pick up nearby items; higher mention_chance means item names can enter speech more often.",
            },
        }

    def _relationship_context_for(self, agent_id: str, nearby_agents: list[dict[str, Any]]) -> list[dict[str, Any]]:
        nearby_ids = {str(agent.get("id")) for agent in nearby_agents if agent.get("id")}
        relationships: list[dict[str, Any]] = []
        for relationship in self.world.relationships:
            if relationship.from_agent == agent_id and relationship.to_agent in nearby_ids:
                relationships.append(
                    {
                        "agent_id": relationship.to_agent,
                        "direction": "outgoing",
                        "label": relationship.label,
                        "score": round(relationship.score, 3),
                    }
                )
            elif relationship.to_agent == agent_id and relationship.from_agent in nearby_ids:
                relationships.append(
                    {
                        "agent_id": relationship.from_agent,
                        "direction": "incoming",
                        "label": relationship.label,
                        "score": round(relationship.score, 3),
                    }
                )
        relationships.sort(key=lambda item: (-float(item.get("score", 0)), item.get("agent_id", "")))
        return relationships[:8]

    def _recent_utterances_for(self, agent_id: str) -> list[dict[str, Any]]:
        utterances: list[dict[str, Any]] = []
        for event in self.world.events:
            event_dict = event.to_dict()
            if event.type not in {"speech", "dialogue"} or not self._is_agent_context_event(event_dict, agent_id):
                continue
            text = str(event.payload.get("text") or event.message or "").strip()
            if not text:
                continue
            source_profile = self.world.agent_profiles.get(str(event.agent_id or ""))
            source_name = source_profile.name if source_profile is not None else str(event.agent_id or "")
            text = self._strip_event_utterance_text(text, source_name)
            if not text:
                continue
            utterances.append(
                {
                    "agent_id": event.agent_id,
                    "type": event.type,
                    "text": text,
                    "tick": event.tick,
                    "target_agent_id": event.payload.get("target_agent_id"),
                }
            )
        return utterances[-8:]

    def _strip_event_utterance_text(self, text: str, source_name: str) -> str:
        stripped = str(text or "").strip()
        if source_name:
            stripped = re.sub(rf"^\s*{re.escape(source_name)}\s*[:：]\s*", "", stripped, flags=re.IGNORECASE)
            stripped = re.sub(rf"^\s*{re.escape(source_name)}\s*(?:->|→)\s*[^:：]{{1,40}}\s*[:：]\s*", "", stripped, flags=re.IGNORECASE)
        stripped = re.sub(r"^\s*[^:：]{1,40}\s*(?:->|→)\s*[^:：]{1,40}\s*[:：]\s*", "", stripped)
        return stripped.strip()

    def _conversation_focus_for(
        self,
        nearby_agents: list[dict[str, Any]],
        nearby_items: list[dict[str, Any]],
        relationships: list[dict[str, Any]],
        recent_utterances: list[dict[str, Any]],
    ) -> dict[str, Any]:
        relationship_by_agent = {
            str(item.get("agent_id")): {
                "label": item.get("label"),
                "score": item.get("score"),
                "direction": item.get("direction"),
            }
            for item in relationships
            if item.get("agent_id")
        }
        return {
            "nearby_agents": [
                {
                    "id": agent.get("id"),
                    "name": agent.get("name"),
                    "status": agent.get("status"),
                    "distance": agent.get("distance"),
                    "relationship": relationship_by_agent.get(str(agent.get("id")), {"label": "unknown", "score": 0}),
                }
                for agent in nearby_agents[:4]
            ],
            "nearby_items": [
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "movable": item.get("movable"),
                    "interactable": item.get("interactable"),
                    "within_interaction_range": item.get("within_interaction_range"),
                    "configured_affordances": item.get("configured_affordances") or [],
                    "available_affordances": item.get("available_affordances") or [],
                    "distance": item.get("distance"),
                }
                for item in nearby_items[:4]
            ],
            "recent_utterances": [
                {
                    "agent_id": item.get("agent_id"),
                    "text": item.get("text"),
                    "tick": item.get("tick"),
                    "target_agent_id": item.get("target_agent_id"),
                }
                for item in recent_utterances[-4:]
            ],
        }

    def _director_agent_summaries(self) -> list[dict[str, Any]]:
        agents: list[dict[str, Any]] = []
        for agent_id, profile in self.world.agent_profiles.items():
            state = self.world.agent_states.get(agent_id)
            if state is None:
                continue
            agents.append(
                {
                    "id": agent_id,
                    "name": profile.name,
                    "role": profile.role,
                    "hidden": profile.hidden,
                    "status": "hidden" if profile.hidden else state.status,
                    "position": state.position.to_dict(),
                    "held_item_id": state.held_item_id,
                    "narrative_state": dict(state.narrative_state),
                }
            )
        return agents

    def _director_item_summaries(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for item in self.world.map.items:
            if item.hidden or self._is_low_information_item_name(item.name):
                continue
            items.append(
                {
                    "id": item.id,
                    "name": item.name,
                    "position": item.position.to_dict(),
                    "movable": item.movable,
                    "interactable": item.interactable,
                    "state": dict(item.state),
                    "tags": list(item.tags),
                    "configured_affordances": self._configured_item_affordance_summaries(item),
                }
            )
        return items[:12]

    def _effective_action_space(self, action_space: list[str]) -> list[str]:
        merged = list(action_space)
        for action_type in self.rule_engine.enabled_extension_types():
            if action_type not in merged:
                merged.append(action_type)
        return merged

    def _action_definitions(self, action_space: list[str] | None = None) -> list[dict[str, Any]]:
        allowed = set(action_space) if action_space is not None else None
        return [
            extension.action_definition()
            for extension in self.rule_engine.action_extensions
            if extension.enabled and (allowed is None or extension.type in allowed)
        ]

    def _identity_for(self, profile: Any) -> str:
        return _enrich_identity(profile.id, profile.name, profile.role, profile.identity)

    def _dialogue_language(self, policy: dict[str, Any], identity: str = "") -> str:
        language = str(policy.get("language") or "auto")
        if language not in {"auto", "zh-CN", "en-US"}:
            language = "auto"
        return _effective_dialogue_language(language, identity)

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
            approach_point = None
            if self.world.map.is_walkable(item.position):
                candidate = self.rule_engine.collision_free_agent_point(self.world, agent_id, item.position) or item.position
                approach_point = candidate.to_dict()
            nearby.append(
                {
                    "id": item.id,
                    "name": item.name,
                    "position": item.position.to_dict(),
                    "distance": round(current_distance, 2),
                    "movable": item.movable,
                    "interactable": item.interactable,
                    "within_interaction_range": current_distance <= self.rule_engine.interaction_range,
                    "approach_point": approach_point,
                    "configured_affordances": self._configured_item_affordance_summaries(item),
                    "available_affordances": self.rule_engine.available_item_affordances(
                        self.world,
                        state.position,
                        item,
                    ),
                    "tags": item.tags,
                    "state": item.state,
                }
            )
        return sorted(nearby, key=lambda item: item["distance"])

    def _configured_item_affordance_summaries(self, item: Any) -> list[dict[str, Any]]:
        summaries: list[dict[str, Any]] = []
        for affordance in getattr(item, "affordances", []) or []:
            if not isinstance(affordance, dict):
                continue
            action = str(affordance.get("action") or "").strip()
            if action not in {"interact", "use"}:
                continue
            summaries.append(
                {
                    "action": action,
                    "label": affordance.get("label"),
                    "range": affordance.get("range"),
                    "enabled": bool(affordance.get("enabled", True)),
                    "status": affordance.get("status"),
                }
            )
        return summaries

    def _movement_targets_for(self, agent_id: str) -> list[dict[str, Any]]:
        state = self.world.agent_states[agent_id]
        recent_targets = self._recent_move_targets(agent_id)
        candidates: list[tuple[str, Point, str, str | None, int]] = [
            ("left", Point(state.position.x - 120, state.position.y), "local", None, 40),
            ("right", Point(state.position.x + 120, state.position.y), "local", None, 40),
            ("up", Point(state.position.x, state.position.y - 120), "local", None, 40),
            ("down", Point(state.position.x, state.position.y + 120), "local", None, 40),
            ("spawn", self.world.map.nearest_spawn(), "spawn", None, 35),
        ]
        for region in self.world.map.regions:
            if region.hidden or len(region.points) < 3:
                continue
            if region.function not in REGION_MOVEMENT_PRIORITY:
                continue
            point = self._region_candidate_point(region)
            if point is None:
                continue
            candidates.append(
                (
                    f"{region.function}:{region.name}",
                    point,
                    region.function,
                    region.id,
                    REGION_MOVEMENT_PRIORITY.get(region.function, 0),
                )
            )
        targets: list[dict[str, Any]] = []
        seen: set[tuple[int, int]] = set()
        for label, point, region_function, region_id, priority in candidates:
            snapped = point
            key = (round(snapped.x), round(snapped.y))
            if key in seen or not self.world.map.is_walkable(snapped):
                continue
            requested = snapped
            snapped = self.rule_engine.collision_free_agent_point(self.world, agent_id, snapped)
            if snapped is None:
                continue
            key = (round(snapped.x), round(snapped.y))
            if key in seen:
                continue
            current_distance = distance(state.position.to_dict(), snapped.to_dict())
            if current_distance <= 8:
                continue
            if any(distance(snapped.to_dict(), recent.to_dict()) <= 8 for recent in recent_targets):
                continue
            seen.add(key)
            targets.append(
                {
                    "label": label,
                    "point": snapped.to_dict(),
                    "region_function": region_function,
                    "region_id": region_id,
                    "priority": priority,
                    "distance": round(current_distance, 2),
                    "influence": REGION_INFLUENCE.get(region_function, ""),
                    "collision_adjusted": distance(requested.to_dict(), snapped.to_dict()) > 0.01,
                    "agent_min_center_distance": self.rule_engine.agent_min_center_distance,
                }
            )
        targets.sort(key=lambda item: (-int(item.get("priority", 0)), float(item.get("distance", 0))))
        return targets[:10]

    def _region_context_for(
        self,
        position: Point,
        movement_targets: list[dict[str, Any]],
        base_dialogue_distance: float = 180.0,
    ) -> dict[str, Any]:
        current = [self._region_summary(region, position) for region in self._regions_at_point(position)]
        nearby = [
            self._region_summary(region, position)
            for region in self.world.map.regions
            if not region.hidden and len(region.points) >= 3
        ]
        nearby.sort(key=lambda item: (float(item.get("distance", 0)), -int(item.get("priority", 0))))
        social_bonus = self.rule_engine.social_range_bonus(self.world, position)
        return {
            "current": current,
            "nearby": nearby[:8],
            "movement_priority": ["walkable", "action", "social", "residential", "custom", "unassigned"],
            "movement_rules": "Road/walkable regions and action regions are valid for movement; prefer road/walkable targets when available.",
            "social_rules": "Social regions increase the value and range of social/say actions with nearby agents.",
            "social_range_bonus": social_bonus,
            "effective_dialogue_distance": base_dialogue_distance + social_bonus,
            "residential_rules": "Residential regions bias agents toward calmer local routines, short moves, waiting, and resident-like behavior.",
            "recommended_target": movement_targets[0] if movement_targets else None,
        }

    def _regions_at_point(self, point: Point) -> list[Any]:
        payload = point.to_dict()
        return [
            region
            for region in self.world.map.regions
            if not region.hidden
            and len(region.points) >= 3
            and point_in_polygon(payload, [candidate.to_dict() for candidate in region.points])
            and not any(point_in_polygon(payload, [candidate.to_dict() for candidate in hole]) for hole in region.holes)
        ]

    def _region_summary(self, region: Any, position: Point) -> dict[str, Any]:
        center = self._region_center(region)
        return {
            "id": region.id,
            "name": region.name,
            "function": region.function,
            "priority": REGION_MOVEMENT_PRIORITY.get(region.function, 0),
            "influence": REGION_INFLUENCE.get(region.function, ""),
            "distance": round(distance(position.to_dict(), center.to_dict()), 2),
            "center": center.to_dict(),
            "tags": list(region.tags),
            "notes": region.notes,
        }

    def _region_candidate_point(self, region: Any) -> Point | None:
        candidates = [self._region_center(region), *region.points[:6]]
        for point in candidates:
            if self.world.map.is_walkable(point):
                return point
        return None

    def _region_center(self, region: Any) -> Point:
        points = region.points
        if not points:
            return Point(self.world.map.width / 2, self.world.map.height / 2)
        return Point(
            sum(point.x for point in points) / len(points),
            sum(point.y for point in points) / len(points),
        )

    def _recent_move_targets(self, agent_id: str) -> list[Point]:
        targets: list[Point] = []
        for event in reversed(self.world.events):
            if event.agent_id != agent_id or event.type != "action":
                continue
            action = event.payload.get("action") if isinstance(event.payload, dict) else None
            if not isinstance(action, dict) or action.get("type") != "move_to":
                continue
            target = event.payload.get("target") or action.get("payload", {}).get("target")
            if self._valid_point_dict(target):
                targets.append(Point(float(target["x"]), float(target["y"])))
            if len(targets) >= 4:
                break
        return targets

    def _sync_held_item(self, item_id: str | None, position: Point) -> None:
        if not item_id:
            return
        item = self.world.map.item_by_id(item_id)
        if item is None or item.hidden or not item.movable:
            return
        item.position = Point(position.x, position.y)

    def _json_chars(self, value: Any) -> int:
        return len(json.dumps(value, ensure_ascii=False, default=str))


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _clamp_probability(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, number))


def _stable_probability(seed: str) -> float:
    value = 0
    for char in seed:
        value = (value * 131 + ord(char)) % 10000
    return value / 10000.0


def _looks_like_connection_failure(message: str) -> bool:
    lowered = str(message or "").lower()
    return any(
        marker in lowered
        for marker in (
            "all connection attempts failed",
            "connection refused",
            "connecterror",
            "connection failed",
            "failed to establish",
            "errno 61",
        )
    )
