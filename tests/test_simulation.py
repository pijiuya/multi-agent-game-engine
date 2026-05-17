import asyncio
from time import perf_counter

from agent_engine.engine.geometry import distance
from agent_engine.engine.simulation import SimulationRuntime
from agent_engine.engine.scene_director import SceneDirectorRequest, SceneDirectorResponse
from agent_engine.engine.world import AgentAction, GameWorld, MapRegion, Memory, Point, Relationship, WorldItem
from agent_engine.models.provider import MockProvider, ModelProvider, ModelRequest, ModelResponse


SLOW_CALL_SECONDS = 0.25
NON_BLOCKING_TICK_SECONDS = 0.15


class SlowProvider(ModelProvider):
    name = "slow"

    async def generate(self, request: ModelRequest) -> ModelResponse:
        await asyncio.sleep(SLOW_CALL_SECONDS)
        return ModelResponse(text="slow thought", actions=[{"type": "wait", "payload": {}}])


class HangingProvider(ModelProvider):
    name = "hanging"

    async def generate(self, request: ModelRequest) -> ModelResponse:
        await asyncio.sleep(999)
        return ModelResponse(text="late thought", actions=[{"type": "wait", "payload": {}}])


class SlowSceneDirector:
    name = "slow-scene-director"

    async def generate(self, request: SceneDirectorRequest) -> SceneDirectorResponse:
        await asyncio.sleep(SLOW_CALL_SECONDS)
        return SceneDirectorResponse(
            text="scene direction ready",
            proposal={
                "events": [
                    {
                        "type": "hint",
                        "message": "Lean into quiet tension.",
                        "payload": {"source": "scene_director"},
                    }
                ],
                "state_changes": [
                    {
                        "op": "set_agent_narrative_state",
                        "agent_id": "agent_mira",
                        "key": "focus",
                        "value": "arrival",
                    },
                    {
                        "op": "add_memory",
                        "agent_id": "__scene__",
                        "kind": "scene",
                        "text": "The room noticed a pause.",
                    },
                ],
            },
        )


class NamedSceneDirector:
    def __init__(self, name: str):
        self.name = name

    async def generate(self, request: SceneDirectorRequest) -> SceneDirectorResponse:
        return SceneDirectorResponse(
            text=f"{self.name} ready",
            proposal={
                "events": [
                    {
                        "type": "narration",
                        "message": f"{self.name} narration",
                        "payload": {"source": "scene_director"},
                    }
                ]
            },
        )


class TextOnlySceneDirector:
    name = "text-only-scene-director"

    async def generate(self, request: SceneDirectorRequest) -> SceneDirectorResponse:
        return SceneDirectorResponse(text="The room settles into a watchful quiet.", proposal={})


class FailingSceneDirector:
    name = "failing-scene-director"

    async def generate(self, request: SceneDirectorRequest) -> SceneDirectorResponse:
        raise RuntimeError("All connection attempts failed")


class CountingProvider(ModelProvider):
    name = "counting"

    def __init__(self):
        self.calls = 0

    async def generate(self, request: ModelRequest) -> ModelResponse:
        self.calls += 1
        return ModelResponse(text="should not be used", actions=[{"type": "wait", "payload": {}}])


async def test_slow_model_does_not_block_tick():
    world = GameWorld.default()
    world.agent_profiles["agent_mira"].model_provider = "slow"
    runtime = SimulationRuntime(world, providers={"mock": SlowProvider(), "slow": SlowProvider()})
    runtime.action_prefilter_enabled = False
    runtime.start()

    started = perf_counter()
    await runtime.tick(0.1)
    elapsed = perf_counter() - started

    assert elapsed < NON_BLOCKING_TICK_SECONDS
    assert world.agent_states["agent_mira"].pending_model

    await asyncio.sleep(SLOW_CALL_SECONDS + 0.05)
    world.running = False
    await runtime.tick(0.1)

    assert not world.agent_states["agent_mira"].pending_model
    assert any(event.message == "slow thought" for event in world.events)


async def test_start_background_resumes_persisted_running_world():
    world = GameWorld.default()
    world.running = True
    runtime = SimulationRuntime(world)

    await runtime.start_background()

    assert runtime._loop_task is not None
    assert not runtime._loop_task.done()
    assert world.running is True
    assert world.events[-1].message == "Simulation loop resumed."

    await runtime.stop_background()


async def test_non_mock_provider_schedules_two_requests_by_default():
    world = GameWorld.default()
    for profile in world.agent_profiles.values():
        profile.model_provider = "slow"
    runtime = SimulationRuntime(world, providers={"mock": SlowProvider(), "slow": SlowProvider()})
    runtime.action_prefilter_enabled = False
    runtime.start()

    await runtime.tick(0.1)

    pending = [state for state in world.agent_states.values() if state.pending_model]
    assert len(pending) == 2

    await asyncio.sleep(SLOW_CALL_SECONDS + 0.05)
    await runtime.tick(0.1)


async def test_slow_model_timeout_clears_pending_state_and_records_error():
    world = GameWorld.default()
    for agent_id, profile in world.agent_profiles.items():
        profile.model_provider = "slow"
        profile.hidden = agent_id != "agent_mira"
    runtime = SimulationRuntime(world, providers={"mock": SlowProvider(), "slow": SlowProvider()})
    runtime.action_prefilter_enabled = False
    runtime.model_timeout_seconds = 0.05
    runtime.start()

    await runtime.tick(0.1)
    assert world.agent_states["agent_mira"].pending_model

    await asyncio.sleep(0.08)
    await runtime.tick(0.1)

    assert not world.agent_states["agent_mira"].pending_model
    assert any(event.type == "model_error" and "timed out" in event.message for event in world.events)
    assert any(
        decision.agent_id == "agent_mira"
        and decision.results
        and decision.results[0]["ok"] is False
        and "timed out" in decision.results[0]["message"]
        for decision in world.decision_events
    )


async def test_model_watchdog_recovers_stalled_task_and_uses_local_recovery():
    world = GameWorld.default()
    for agent_id, profile in world.agent_profiles.items():
        profile.model_provider = "hanging"
        profile.hidden = agent_id != "agent_mira"
    runtime = SimulationRuntime(world, providers={"mock": SlowProvider(), "hanging": HangingProvider()})
    runtime.action_prefilter_enabled = False
    runtime.model_watchdog_ticks = 1
    runtime.provider_recovery_ticks = 5
    runtime.agent_decision_interval_ticks = 1
    runtime.start()

    await runtime.tick(0.1)
    assert world.agent_states["agent_mira"].pending_model

    await runtime.tick(0.1)

    assert not world.agent_states["agent_mira"].pending_model
    assert not runtime.snapshot()["model_tasks"]
    assert runtime.snapshot()["recovery"]["provider_recovery"]["hanging"]["remaining_ticks"] > 0
    assert any(event.type == "model_recovery" and event.agent_id == "agent_mira" for event in world.events)
    assert any(decision.provider == "recovery-prefilter" for decision in world.decision_events)


async def test_slow_scene_director_does_not_block_tick_or_touch_agent_model_state():
    world = GameWorld.default()
    for profile in world.agent_profiles.values():
        profile.hidden = True
    world.narrative["enabled"] = True
    world.narrative["cadence_ticks"] = 1
    runtime = SimulationRuntime(
        world,
        scene_director=SlowSceneDirector(),
        director_interval_ticks=1,
    )
    runtime.start()

    started = perf_counter()
    snapshot = await runtime.tick(0.1)
    elapsed = perf_counter() - started

    assert elapsed < NON_BLOCKING_TICK_SECONDS
    assert snapshot["scene_director"]["pending"] is True
    assert all(not state.pending_model for state in world.agent_states.values())
    assert all(state.last_model_tick == -999 for state in world.agent_states.values())

    await asyncio.sleep(SLOW_CALL_SECONDS + 0.05)
    await runtime.tick(0.1)

    assert world.agent_states["agent_mira"].narrative_state["focus"] == "arrival"
    assert world.memories[0].text == "The room noticed a pause."
    assert any(event.message == "Lean into quiet tension." for event in world.events)
    assert world.narrative["recent_summary"] == "scene direction ready"


async def test_scene_director_uses_narrative_model_provider():
    world = GameWorld.default()
    for profile in world.agent_profiles.values():
        profile.hidden = True
    world.narrative["enabled"] = True
    world.narrative["cadence_ticks"] = 1
    world.narrative["model_provider"] = "scene_b"
    runtime = SimulationRuntime(world, director_interval_ticks=1)
    runtime.scene_directors = {
        "scene_a": NamedSceneDirector("scene_a"),
        "scene_b": NamedSceneDirector("scene_b"),
    }
    runtime.default_provider_id = "scene_a"
    runtime.start()

    await runtime.tick(0.1)
    await asyncio.sleep(0.01)
    await runtime.tick(0.1)

    assert any(event.message == "scene_b narration" for event in world.events)
    assert not any(event.type == "narration" and event.message == "scene_b ready" for event in world.events)
    assert world.narrative["recent_summary"] == "scene_b ready"


async def test_scene_director_text_only_response_becomes_visible_narration():
    world = GameWorld.default()
    for agent_id, profile in world.agent_profiles.items():
        profile.hidden = agent_id != "agent_mira"
    world.narrative["enabled"] = True
    world.narrative["cadence_ticks"] = 1
    world.narrative["tone"] = "紧张而克制"
    runtime = SimulationRuntime(world, scene_director=TextOnlySceneDirector(), director_interval_ticks=1)
    runtime.start()

    await runtime.tick(0.1)
    await asyncio.sleep(0)
    await runtime.tick(0.1)

    assert any(
        event.type == "narration"
        and event.message == "The room settles into a watchful quiet."
        and event.payload.get("source") == "scene_director"
        for event in world.events
    )
    assert world.narrative["recent_summary"] == "The room settles into a watchful quiet."
    assert world.agent_states["agent_mira"].narrative_state["mood"] == "紧张而克制"
    assert world.agent_states["agent_mira"].narrative_state["urgency"] == "rising"


async def test_dedicated_narrative_service_failure_does_not_fallback_to_agent_provider():
    world = GameWorld.default()
    for profile in world.agent_profiles.values():
        profile.hidden = True
    provider = CountingProvider()
    world.narrative["enabled"] = True
    world.narrative["cadence_ticks"] = 1
    world.narrative["dedicated_service_enabled"] = True
    world.narrative["model_provider"] = "agent_llm"
    runtime = SimulationRuntime(world, providers={"mock": MockProvider(), "agent_llm": provider}, director_interval_ticks=1)
    runtime.scene_directors = {"local_narrative_service": FailingSceneDirector()}
    runtime.start()

    await runtime.tick(0.1)
    await asyncio.sleep(0)
    await runtime.tick(0.1)

    assert provider.calls == 0
    assert world.narrative["enabled"] is False
    assert world.narrative["dedicated_service_enabled"] is False
    assert any(event.type == "scene_director_error" and "场景叙事已临时关闭" in event.message for event in world.events)
    assert not any(event.type == "narration" and event.payload.get("source") == "scene_director" for event in world.events)


async def test_scene_director_can_run_alongside_agent_when_provider_has_capacity():
    world = GameWorld.default()
    for agent_id, profile in world.agent_profiles.items():
        profile.hidden = agent_id != "agent_mira"
        profile.model_provider = "slow"
    world.narrative["enabled"] = True
    world.narrative["cadence_ticks"] = 1
    world.narrative["model_provider"] = "slow"
    runtime = SimulationRuntime(
        world,
        providers={"mock": MockProvider(), "slow": SlowProvider()},
        director_interval_ticks=1,
    )
    runtime.scene_directors = {"mock": TextOnlySceneDirector(), "slow": SlowSceneDirector()}
    runtime.action_prefilter_enabled = False
    runtime.start()

    await runtime.tick(0.1)

    assert world.agent_states["agent_mira"].pending_model is True
    assert runtime.snapshot()["scene_director"]["pending"] is True
    assert world.narrative["last_tick"] == 0

    await asyncio.sleep(SLOW_CALL_SECONDS + 0.05)
    await runtime.tick(0.1)


async def test_scene_director_waits_when_same_provider_lane_is_full():
    world = GameWorld.default()
    for agent_id, profile in world.agent_profiles.items():
        profile.model_provider = "slow"
        profile.hidden = agent_id != "agent_mira"
    world.narrative["enabled"] = True
    world.narrative["cadence_ticks"] = 1
    world.narrative["model_provider"] = "slow"
    runtime = SimulationRuntime(
        world,
        providers={"mock": MockProvider(), "slow": SlowProvider()},
        director_interval_ticks=1,
    )
    runtime.scene_directors = {"mock": TextOnlySceneDirector(), "slow": SlowSceneDirector()}
    runtime.action_prefilter_enabled = False
    runtime.model_concurrency = 1
    runtime.start()

    await runtime.tick(0.1)

    assert any(state.pending_model for state in world.agent_states.values())
    assert runtime.snapshot()["scene_director"]["pending"] is False
    assert world.narrative["last_tick"] == -999

    await asyncio.sleep(SLOW_CALL_SECONDS + 0.05)
    await runtime.tick(0.1)

    assert all(not state.pending_model for state in world.agent_states.values())
    assert runtime.snapshot()["scene_director"]["pending"] is True


async def test_scene_director_watchdog_recovers_stalled_task():
    world = GameWorld.default()
    for profile in world.agent_profiles.values():
        profile.hidden = True
    world.narrative["enabled"] = True
    world.narrative["cadence_ticks"] = 1
    runtime = SimulationRuntime(world, scene_director=SlowSceneDirector(), director_interval_ticks=1)
    runtime.scene_director_watchdog_ticks = 1
    runtime.start()

    await runtime.tick(0.1)
    assert runtime.snapshot()["scene_director"]["pending"] is True

    await runtime.tick(0.1)

    snapshot = runtime.snapshot()
    assert snapshot["scene_director"]["pending"] is False
    assert any(event.type == "scene_director_recovery" for event in world.events)


def test_observation_includes_llm_action_context():
    world = GameWorld.default()
    world.map.items.append(
        WorldItem(
            id="item_lamp",
            name="Lamp",
            position=Point(250, 225),
            movable=True,
            interactable=True,
            affordances=[{"action": "use", "label": "Light", "range": 120}],
        )
    )
    runtime = SimulationRuntime(world)
    world.agent_states["agent_mira"].narrative_state = {"focus": "lamp"}
    world.memories.append(
        Memory(
            id="mem_scene_test",
            agent_id="__scene__",
            kind="scene",
            text="Mira crossed the threshold.",
        )
    )
    world.add_event("hint", "Notice the lamp.", agent_id="agent_mira")
    world.add_event("speech", "Mira: I see Tao.", agent_id="agent_mira")
    world.relationships.append(Relationship("agent_mira", "agent_tao", "knows", 0.4))

    observation = runtime._observation_for("agent_mira")

    assert observation["agent_id"] == "agent_mira"
    assert observation["map"]["width"] == world.map.width
    assert observation["nearby_items"][0]["id"] == "item_lamp"
    assert observation["nearby_items"][0]["movable"] is True
    assert observation["nearby_items"][0]["interactable"] is True
    assert observation["nearby_items"][0]["within_interaction_range"] is True
    assert observation["nearby_items"][0]["configured_affordances"][0]["action"] == "use"
    assert observation["nearby_items"][0]["available_affordances"][0]["action"] == "use"
    assert observation["item_context"]["nearby_named_items"][0]["name"] == "Lamp"
    assert observation["item_context"]["instruction"]
    assert observation["movement_targets"]
    assert all("point" in target for target in observation["movement_targets"])
    assert observation["narrative_state"] == {"focus": "lamp"}
    assert observation["scene_memories"][0]["text"] == "Mira crossed the threshold."
    assert observation["narrative_cues"][0]["message"] == "Notice the lamp."
    assert observation["scene_context"]["mode"] == "directional_scene_pressure"
    assert observation["scene_context"]["cues"][0]["message"] == "Notice the lamp."
    assert all(event["type"] != "hint" for event in observation["agent_recent_events"])
    assert observation["agent_recent_events"][0]["type"] == "speech"
    assert observation["relationships"][0]["agent_id"] == "agent_tao"
    assert observation["relationships"][0]["score"] == 0.4
    assert observation["recent_utterances"][0]["text"] == "I see Tao."
    assert observation["conversation_focus"]["nearby_agents"]
    assert observation["effective_dialogue_language"] == "en-US"
    assert observation["movement_constraints"]["agent_min_center_distance"] == runtime.rule_engine.agent_min_center_distance


def test_social_region_dialogue_range_matches_observation_and_rules():
    world = GameWorld.default()
    world.agent_states["agent_mira"].position = Point(240, 220)
    world.agent_states["agent_tao"].position = Point(450, 220)
    world.agent_profiles["agent_ren"].hidden = True
    world.map.regions = [
        MapRegion(
            id="region_social",
            name="Long Table",
            function="social",
            points=[Point(200, 180), Point(280, 180), Point(280, 260), Point(200, 260)],
        )
    ]
    world.map.sync_functional_regions()
    runtime = SimulationRuntime(world)

    observation = runtime._observation_for("agent_mira")
    result = runtime.submit_action(
        AgentAction(
            agent_id="agent_mira",
            type="social",
            payload={"target_agent_id": "agent_tao", "text": "Can you hear me from there?"},
        )
    )

    assert observation["dialogue_range"]["base"] == 240.0
    assert observation["dialogue_range"]["social_region_bonus"] == runtime.rule_engine.social_region_dialogue_bonus
    assert observation["dialogue_range"]["effective"] == 320.0
    assert observation["dialogue_candidates"][0]["id"] == "agent_tao"
    assert result["ok"] is True


def test_movement_targets_and_motion_keep_agent_centers_apart():
    world = GameWorld.default()
    runtime = SimulationRuntime(world)
    world.agent_states["agent_mira"].position = Point(240, 220)
    world.agent_states["agent_tao"].position = Point(360, 220)

    targets = runtime._movement_targets_for("agent_mira")
    right = next(target for target in targets if target["label"] == "right")

    assert right["collision_adjusted"] is True
    assert distance(right["point"], world.agent_states["agent_tao"].position.to_dict()) >= runtime.rule_engine.agent_min_center_distance

    world.agent_states["agent_mira"].target = Point(360, 220)
    world.agent_states["agent_mira"].status = "moving"
    runtime._move_agents(1.0)

    assert distance(
        world.agent_states["agent_mira"].position.to_dict(),
        world.agent_states["agent_tao"].position.to_dict(),
    ) >= runtime.rule_engine.agent_min_center_distance


def test_invalid_persisted_move_target_is_cleared():
    world = GameWorld.default()
    runtime = SimulationRuntime(world)
    state = world.agent_states["agent_mira"]
    state.target = Point(10_000, 10_000)
    state.status = "moving"

    runtime._move_agents(0.1)

    assert state.target is None
    assert state.status == "idle"
    assert world.events[-1].type == "movement"
    assert world.events[-1].payload["reason"] == "target is no longer walkable"


def test_model_actions_are_coerced_from_observation_context():
    runtime = SimulationRuntime(GameWorld.default())
    request = ModelRequest(
        agent_id="agent_mira",
        role="mediator",
        identity="test identity",
        action_space=["say", "move_to", "pick_up", "wait"],
        observation={
            "movement_targets": [{"label": "right", "point": {"x": 360, "y": 220}}],
            "nearby_items": [{"id": "item_lamp", "movable": True}],
        },
    )

    say = runtime._coerce_model_action({"type": "say", "payload": {}}, "hello", request)
    move = runtime._coerce_model_action({"type": "move_to", "payload": {}}, "", request)
    pickup = runtime._coerce_model_action({"type": "pick_up", "payload": {}}, "", request)
    wait_as_move = runtime._coerce_model_action(
        {"type": "wait", "payload": {}},
        "",
        ModelRequest(
            agent_id="agent_mira",
            role="mediator",
            identity="test identity",
            action_space=["say", "move_to", "wait"],
            observation={
                "movement_intent": True,
                "movement_targets": [{"label": "right", "point": {"x": 360, "y": 220}}],
            },
        ),
    )

    assert say == {"type": "say", "payload": {"text": "hello"}}
    assert move == {"type": "move_to", "payload": {"target": {"x": 360, "y": 220}}}
    assert pickup == {"type": "pick_up", "payload": {"item_id": "item_lamp"}}
    assert wait_as_move == {"type": "move_to", "payload": {"target": {"x": 360, "y": 220}}}


def test_model_interact_and_use_prefer_available_affordance_items():
    runtime = SimulationRuntime(GameWorld.default())
    request = ModelRequest(
        agent_id="agent_mira",
        role="mediator",
        identity="test identity",
        action_space=["interact", "use", "wait"],
        observation={
            "nearby_items": [
                {"id": "item_plain", "interactable": True, "available_affordances": []},
                {"id": "item_switch", "interactable": True, "available_affordances": [{"action": "use", "label": "Switch"}]},
            ],
        },
    )

    use_action = runtime._coerce_model_action({"type": "use", "payload": {}}, "", request)
    interact_action = runtime._coerce_model_action({"type": "interact", "payload": {}}, "", request)

    assert use_action == {"type": "use", "payload": {"target_id": "item_switch"}}
    assert interact_action == {"type": "interact", "payload": {"target_id": "item_plain"}}


def test_prefilter_uses_item_affordance_without_model_call():
    runtime = SimulationRuntime(GameWorld.default())
    runtime.world.agent_profiles["agent_mira"].dialogue_policy["item_interaction_chance"] = 1
    observation = {
        "nearby_items": [
            {
                "id": "item_switch",
                "interactable": True,
                "available_affordances": [{"action": "use", "label": "Switch"}],
            }
        ],
        "agent_recent_events": [],
    }

    action = runtime._prefilter_action("agent_mira", ["use", "wait"], observation, provider_name="slow")

    assert action == {"type": "use", "payload": {"target_id": "item_switch"}}


def test_prefilter_keeps_social_and_movement_above_item_opportunities():
    runtime = SimulationRuntime(GameWorld.default())
    runtime.world.agent_profiles["agent_mira"].dialogue_policy["item_interaction_chance"] = 1
    observation = {
        "dialogue_candidates": [{"id": "agent_tao", "name": "Tao"}],
        "movement_intent": True,
        "movement_targets": [{"label": "road", "point": {"x": 360, "y": 220}}],
        "nearby_items": [
            {
                "id": "item_switch",
                "interactable": True,
                "available_affordances": [{"action": "use", "label": "Switch"}],
            }
        ],
        "agent_recent_events": [],
    }

    movement_first_action = runtime._prefilter_action("agent_mira", ["social", "use", "move_to", "wait"], observation, provider_name="slow")
    movement_observation = {**observation, "dialogue_candidates": []}
    movement_action = runtime._prefilter_action("agent_mira", ["use", "move_to", "wait"], movement_observation, provider_name="slow")
    social_observation = {**observation, "movement_intent": False, "movement_targets": []}
    social_action = runtime._prefilter_action("agent_mira", ["social", "use", "move_to", "wait"], social_observation, provider_name="slow")

    assert movement_first_action == {"type": "move_to", "payload": {"target": {"x": 360, "y": 220}}}
    assert movement_action == {"type": "move_to", "payload": {"target": {"x": 360, "y": 220}}}
    assert social_action is None


def test_prefilter_interacts_with_plain_interactable_item_without_model_call():
    runtime = SimulationRuntime(GameWorld.default())
    runtime.world.agent_profiles["agent_mira"].dialogue_policy["item_interaction_chance"] = 1
    observation = {
        "nearby_items": [
            {"id": "item_marker", "interactable": True, "available_affordances": []}
        ],
        "agent_recent_events": [],
    }

    action = runtime._prefilter_action("agent_mira", ["interact", "wait"], observation, provider_name="slow")

    assert action == {"type": "interact", "payload": {"target_id": "item_marker"}}


def test_item_interaction_sets_prefilter_cooldown():
    world = GameWorld.default()
    world.map.items.append(
        WorldItem(
            id="item_button",
            name="Button",
            position=Point(242, 220),
            movable=False,
            affordances=[{"action": "use", "label": "Press", "event_message": "按钮亮了一下。"}],
        )
    )
    runtime = SimulationRuntime(world)
    runtime.world.agent_profiles["agent_mira"].dialogue_policy["item_interaction_chance"] = 1

    result = runtime.submit_action(AgentAction(agent_id="agent_mira", type="use", payload={"target_id": "item_button"}))
    observation = {
        "nearby_items": [
            {
                "id": "item_button",
                "interactable": True,
                "available_affordances": [{"action": "use", "label": "Press"}],
            }
        ],
        "agent_recent_events": [],
    }
    action = runtime._prefilter_action("agent_mira", ["use", "wait"], observation, provider_name="slow")

    assert result["ok"] is True
    assert world.agent_states["agent_mira"].cooldowns["item_interaction_until"] == world.tick + 45
    assert action == {"type": "wait", "payload": {"duration": 1}}


def test_prefilter_item_opportunity_applies_to_mock_provider():
    runtime = SimulationRuntime(GameWorld.default())
    runtime.world.agent_profiles["agent_mira"].dialogue_policy["item_interaction_chance"] = 1
    observation = {
        "nearby_items": [
            {
                "id": "item_button",
                "interactable": True,
                "available_affordances": [{"action": "use", "label": "Button"}],
            }
        ],
        "agent_recent_events": [],
    }

    action = runtime._prefilter_action("agent_mira", ["use", "wait"], observation, provider_name="mock")

    assert action == {"type": "use", "payload": {"target_id": "item_button"}}


def test_prefilter_skips_unreachable_or_unavailable_item_interactions():
    runtime = SimulationRuntime(GameWorld.default())
    runtime.world.agent_profiles["agent_mira"].dialogue_policy["item_interaction_chance"] = 1
    observation = {
        "nearby_items": [
            {
                "id": "item_far",
                "interactable": True,
                "distance": 150,
                "available_affordances": [],
                "configured_affordances": [],
            },
            {
                "id": "item_locked",
                "interactable": True,
                "distance": 80,
                "available_affordances": [],
                "configured_affordances": [{"action": "interact", "label": "Locked"}],
            },
        ],
        "agent_recent_events": [],
    }

    action = runtime._prefilter_action("agent_mira", ["interact", "wait"], observation, provider_name="mock")

    assert action is None


def test_prefilter_moves_toward_visible_item_before_interaction_range():
    runtime = SimulationRuntime(GameWorld.default())
    runtime.world.agent_profiles["agent_mira"].dialogue_policy["item_interaction_chance"] = 1
    observation = {
        "movement_intent": True,
        "nearby_items": [
            {
                "id": "item_console",
                "name": "Console",
                "interactable": True,
                "movable": False,
                "distance": 150,
                "approach_point": {"x": 260, "y": 220},
                "available_affordances": [],
                "configured_affordances": [{"action": "interact", "label": "Read"}],
            }
        ],
        "agent_recent_events": [],
    }

    action = runtime._prefilter_action("agent_mira", ["move_to", "interact", "wait"], observation, provider_name="mock")

    assert action == {"type": "move_to", "payload": {"target": {"x": 260.0, "y": 220.0}}}


def test_prefilter_picks_up_movable_item_then_arrival_drops_it():
    world = GameWorld.default()
    world.map.items.append(WorldItem(id="item_box", name="Box", position=Point(242, 220), movable=True))
    runtime = SimulationRuntime(world)
    runtime.world.agent_profiles["agent_mira"].dialogue_policy["item_interaction_chance"] = 1
    observation = runtime._observation_for("agent_mira")
    observation["movement_intent"] = True
    observation["movement_targets"] = []

    pickup_action = runtime._prefilter_action("agent_mira", ["pick_up", "move_to", "drop_item"], observation, provider_name="slow")
    pickup = runtime.submit_action(AgentAction(agent_id="agent_mira", type=pickup_action["type"], payload=pickup_action["payload"]))
    next_observation = runtime._observation_for("agent_mira")
    move_action = runtime._prefilter_action("agent_mira", ["pick_up", "move_to", "drop_item"], next_observation, provider_name="slow")
    runtime.submit_action(AgentAction(agent_id="agent_mira", type=move_action["type"], payload=move_action["payload"]))
    runtime._move_agents(10.0)

    assert pickup["ok"] is True
    assert pickup_action == {"type": "pick_up", "payload": {"item_id": "item_box"}}
    assert move_action["type"] == "move_to"
    assert world.agent_states["agent_mira"].held_item_id is None
    assert world.map.item_by_id("item_box").position == world.agent_states["agent_mira"].position


def test_social_action_updates_relationship():
    world = GameWorld.default()
    runtime = SimulationRuntime(world)
    world.agent_states["agent_mira"].position = Point(240, 220)
    world.agent_states["agent_tao"].position = Point(260, 220)

    result = runtime.submit_action(
        AgentAction(
            agent_id="agent_mira",
            type="social",
            payload={"target_agent_id": "agent_tao", "text": "hello"},
        )
    )

    assert result["ok"] is True
    assert world.relationships[0].from_agent == "agent_mira"
    assert world.relationships[0].to_agent == "agent_tao"
    assert world.relationships[0].label == "knows"
    assert world.relationships[0].score == 0.08


def test_empty_model_say_does_not_emit_fallback_speech():
    runtime = SimulationRuntime(GameWorld.default())
    request = ModelRequest(
        agent_id="agent_mira",
        role="mediator",
        identity="test identity",
        action_space=["say", "wait"],
        language="zh-CN",
        observation={},
    )

    say = runtime._coerce_model_action({"type": "say", "payload": {}}, "", request)

    assert say == {"type": "wait", "payload": {"duration": 1}}


def test_low_value_non_mock_decision_uses_rule_prefilter_without_model_call():
    world = GameWorld.default()
    for agent_id, profile in world.agent_profiles.items():
        profile.model_provider = "slow"
        profile.hidden = agent_id != "agent_mira"
    runtime = SimulationRuntime(world, providers={"mock": SlowProvider(), "slow": SlowProvider()})
    runtime.start()

    runtime._schedule_agent_decisions()

    assert not world.agent_states["agent_mira"].pending_model
    assert world.decision_events[-1].provider == "rule-prefilter"
    assert world.decision_events[-1].model == "context-budget-v1"
    assert world.decision_events[-1].results[0]["input_chars"] > 0
    assert world.decision_events[-1].results[0]["elapsed_ms"] == 0


async def test_non_mock_social_context_uses_model_instead_of_rule_template():
    world = GameWorld.default()
    world.agent_profiles["agent_mira"].model_provider = "slow"
    world.agent_profiles["agent_mira"].action_space = ["social", "say", "wait"]
    world.agent_profiles["agent_tao"].hidden = False
    world.agent_profiles["agent_ren"].hidden = True
    world.agent_states["agent_mira"].position = Point(240, 220)
    world.agent_states["agent_mira"].status = "idle"
    world.agent_states["agent_mira"].target = None
    world.agent_states["agent_tao"].position = Point(260, 220)
    world.agent_states["agent_tao"].status = "idle"
    world.agent_states["agent_tao"].target = None
    runtime = SimulationRuntime(world, providers={"mock": SlowProvider(), "slow": SlowProvider()})
    runtime.start()

    runtime._schedule_agent_decisions()

    assert world.agent_states["agent_mira"].pending_model
    assert "agent_mira" in runtime._model_tasks


def test_bad_model_utterances_are_not_shown_as_bubbles():
    runtime = SimulationRuntime(GameWorld.default())
    request = ModelRequest(
        agent_id="agent_mira",
        role="mediator",
        identity="Mira is a mediator with a distinct social point of view.",
        action_space=["say", "social", "observe", "wait"],
        observation={
            "agent_name": "Mira",
            "dialogue_candidates": [{"id": "agent_tao", "name": "Tao"}],
            "recent_utterances": [{"text": "I'm listening for the part of the room no one has named yet."}],
        },
    )

    identity_recap = runtime._coerce_model_action(
        {"type": "say", "payload": {"text": "Mira is a mediator with a distinct social point of view."}},
        "",
        request,
    )
    generic_social = runtime._coerce_model_action(
        {"type": "social", "payload": {"target_agent_id": "agent_tao", "text": "Greetings, Tao. How is your day going?"}},
        "",
        request,
    )
    repeated = runtime._coerce_model_action(
        {
            "type": "say",
            "payload": {"text": "I'm listening for the part of the room no one has named yet."},
        },
        "",
        request,
    )
    cn_plan = runtime._coerce_model_action(
        {"type": "say", "payload": {"text": "我在确认我的工作计划是否完整。"}},
        "",
        request,
    )

    assert identity_recap == {"type": "observe", "payload": {}}
    assert generic_social == {"type": "observe", "payload": {}}
    assert repeated == {"type": "observe", "payload": {}}
    assert cn_plan == {"type": "observe", "payload": {}}


def test_good_model_utterance_survives_quality_filter():
    runtime = SimulationRuntime(GameWorld.default())
    request = ModelRequest(
        agent_id="agent_tao",
        role="builder",
        identity="Tao is a builder with a distinct social point of view.",
        action_space=["say", "observe", "wait"],
        observation={"agent_name": "Tao", "recent_utterances": []},
    )

    action = runtime._coerce_model_action(
        {"type": "say", "payload": {"text": "I'm checking which piece would carry weight before I touch anything."}},
        "",
        request,
    )

    assert action == {
        "type": "say",
        "payload": {"text": "I'm checking which piece would carry weight before I touch anything."},
    }


def test_model_dict_utterance_is_unwrapped():
    runtime = SimulationRuntime(GameWorld.default())
    request = ModelRequest(
        agent_id="agent_ren",
        role="observer",
        identity="Ren notices patterns before speaking.",
        action_space=["say", "observe", "wait"],
        observation={"agent_name": "Ren", "recent_utterances": []},
    )

    action = runtime._coerce_model_action(
        {"type": "say", "payload": {"text": {"utterance": "That archive changed where Mira is standing."}}},
        "",
        request,
    )

    assert action == {"type": "say", "payload": {"text": "That archive changed where Mira is standing."}}


def test_say_and_social_can_be_grounded_in_preferred_named_item_at_low_frequency():
    runtime = SimulationRuntime(GameWorld.default())
    runtime.world.agent_profiles["agent_ren"].dialogue_policy["item_mention_chance"] = 1
    for index in range(16):
        runtime.world.add_event("speech", f"普通对话 {index}", agent_id="agent_mira")
    request = ModelRequest(
        agent_id="agent_ren",
        role="observer",
        identity="Ren notices patterns before speaking.",
        action_space=["say", "social", "observe", "wait"],
        language="zh-CN",
        observation={
            "agent_name": "Ren",
            "recent_utterances": [],
            "dialogue_candidates": [{"id": "agent_tao", "name": "Tao"}],
            "item_context": {
                "nearby_named_items": [
                    {"id": "item_generic", "name": "Item"},
                    {"id": "item_archive", "name": "绝密档案3", "available_affordances": [{"action": "use"}]},
                ],
                "recent_item_events": [{"item_id": "item_archive", "type": "interaction"}],
            },
        },
    )

    say_action = runtime._coerce_model_action({"type": "say", "payload": {"text": "这里刚才有点变化。"}}, "", request)
    social_action = runtime._coerce_model_action(
        {"type": "social", "payload": {"target_agent_id": "agent_tao", "text": "你也看到刚才的变化了吗？"}},
        "",
        request,
    )

    assert "绝密档案3" in say_action["payload"]["text"]
    assert "绝密档案3" in social_action["payload"]["text"]


def test_say_and_social_do_not_force_item_name_on_every_utterance():
    runtime = SimulationRuntime(GameWorld.default())
    request = ModelRequest(
        agent_id="agent_ren",
        role="observer",
        identity="Ren notices patterns before speaking.",
        action_space=["say", "social", "observe", "wait"],
        language="zh-CN",
        observation={
            "agent_name": "Ren",
            "recent_utterances": [],
            "dialogue_candidates": [{"id": "agent_tao", "name": "Tao"}],
            "item_context": {
                "nearby_named_items": [
                    {"id": "item_generic", "name": "Item"},
                    {"id": "item_archive", "name": "绝密档案3"},
                ]
            },
        },
    )

    say_action = runtime._coerce_model_action({"type": "say", "payload": {"text": "这里刚才有点变化。"}}, "", request)
    social_action = runtime._coerce_model_action(
        {"type": "social", "payload": {"target_agent_id": "agent_tao", "text": "你也看到刚才的变化了吗？"}},
        "",
        request,
    )

    assert "绝密档案3" not in say_action["payload"]["text"]
    assert "绝密档案3" not in social_action["payload"]["text"]


def test_runtime_defaults_favor_more_frequent_dialogue():
    runtime = SimulationRuntime(GameWorld.default())

    assert runtime.agent_decision_interval_ticks == 20
    assert runtime.world.agent_profiles["agent_mira"].dialogue_policy["distance"] == 240.0
    assert runtime.world.agent_profiles["agent_mira"].dialogue_policy["cooldown_ticks"] == 6
    assert runtime.world.agent_profiles["agent_mira"].dialogue_policy["item_interaction_chance"] == 0.35
    assert runtime.world.agent_profiles["agent_mira"].dialogue_policy["item_mention_chance"] == 0.12


def test_agent_item_interaction_chance_gates_local_item_actions():
    world = GameWorld.default()
    mira_position = world.agent_states["agent_mira"].position
    world.map.items.append(
        WorldItem(
            id="item_lamp",
            name="Signal Lamp",
            position=Point(mira_position.x + 10, mira_position.y),
            tags=["signal"],
            affordances=[{"action": "interact", "enabled": True}],
        )
    )
    runtime = SimulationRuntime(world)
    observation = runtime._observation_for("agent_mira")

    world.agent_profiles["agent_mira"].dialogue_policy["item_interaction_chance"] = 0
    assert runtime._local_item_opportunity_action("agent_mira", observation, {"interact"}) is None

    world.agent_profiles["agent_mira"].dialogue_policy["item_interaction_chance"] = 1
    action = runtime._local_item_opportunity_action("agent_mira", observation, {"interact"})
    assert action == {"type": "interact", "payload": {"target_id": "item_lamp"}}


def test_agent_item_mention_chance_gates_dialogue_references():
    world = GameWorld.default()
    mira_position = world.agent_states["agent_mira"].position
    world.map.items.append(
        WorldItem(
            id="item_lamp",
            name="Signal Lamp",
            position=Point(mira_position.x + 10, mira_position.y),
            description="A coded lamp.",
            tags=["signal"],
        )
    )
    runtime = SimulationRuntime(world)
    observation = runtime._observation_for("agent_mira")

    world.agent_profiles["agent_mira"].dialogue_policy["item_mention_chance"] = 0
    assert runtime._should_reference_item_in_dialogue("agent_mira", observation) is False

    world.agent_profiles["agent_mira"].dialogue_policy["item_mention_chance"] = 1
    assert runtime._should_reference_item_in_dialogue("agent_mira", observation) is True


def test_scene_director_text_is_not_forced_into_item_exposition():
    world = GameWorld.default()
    world.map.items.append(WorldItem(id="item_archive", name="绝密档案3", position=Point(242, 220)))
    runtime = SimulationRuntime(world)

    text = runtime._item_grounded_scene_text("三个杀手组成的故事")

    assert text == "三个杀手组成的故事"
    assert "可见物体如" not in text


def test_default_item_names_are_not_scene_or_dialogue_anchors():
    world = GameWorld.default()
    world.map.items.append(WorldItem(id="item_generic", name="Item", position=Point(242, 220)))
    runtime = SimulationRuntime(world)

    assert runtime._visible_item_names_for_language() == []
    assert runtime._director_item_summaries() == []
    assert runtime._observation_item_names(
        {
            "item_context": {
                "nearby_named_items": [
                    {"id": "item_generic", "name": "Item", "available_affordances": [{"action": "use"}]},
                    {"id": "item_object", "name": "Object", "state": {"mood": "ominous"}},
                ],
                "recent_item_events": [{"item_id": "item_generic", "type": "interaction"}],
            }
        }
    ) == []
