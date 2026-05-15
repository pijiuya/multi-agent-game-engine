import asyncio
from time import perf_counter

from agent_engine.engine.geometry import distance
from agent_engine.engine.simulation import SimulationRuntime
from agent_engine.engine.scene_director import SceneDirectorRequest, SceneDirectorResponse
from agent_engine.engine.world import AgentAction, GameWorld, Memory, Point, Relationship, WorldItem
from agent_engine.models.provider import ModelProvider, ModelRequest, ModelResponse


SLOW_CALL_SECONDS = 0.25
NON_BLOCKING_TICK_SECONDS = 0.15


class SlowProvider(ModelProvider):
    name = "slow"

    async def generate(self, request: ModelRequest) -> ModelResponse:
        await asyncio.sleep(SLOW_CALL_SECONDS)
        return ModelResponse(text="slow thought", actions=[{"type": "wait", "payload": {}}])


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


async def test_slow_model_does_not_block_tick():
    world = GameWorld.default()
    world.agent_profiles["agent_mira"].model_provider = "slow"
    runtime = SimulationRuntime(world, providers={"mock": SlowProvider(), "slow": SlowProvider()})
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


def test_observation_includes_llm_action_context():
    world = GameWorld.default()
    world.map.items.append(
        WorldItem(
            id="item_lamp",
            name="Lamp",
            position=Point(250, 225),
            movable=True,
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
    assert observation["movement_targets"]
    assert all("point" in target for target in observation["movement_targets"])
    assert observation["narrative_state"] == {"focus": "lamp"}
    assert observation["scene_memories"][0]["text"] == "Mira crossed the threshold."
    assert observation["narrative_cues"][0]["message"] == "Notice the lamp."
    assert observation["scene_context"]["mode"] == "weak_background"
    assert observation["scene_context"]["cues"][0]["message"] == "Notice the lamp."
    assert all(event["type"] != "hint" for event in observation["agent_recent_events"])
    assert observation["agent_recent_events"][0]["type"] == "speech"
    assert observation["relationships"][0]["agent_id"] == "agent_tao"
    assert observation["relationships"][0]["score"] == 0.4
    assert observation["recent_utterances"][0]["text"] == "I see Tao."
    assert observation["conversation_focus"]["nearby_agents"]
    assert observation["effective_dialogue_language"] == "en-US"
    assert observation["movement_constraints"]["agent_min_center_distance"] == runtime.rule_engine.agent_min_center_distance


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


async def test_prefilter_defers_social_context_to_model():
    world = GameWorld.default()
    world.agent_profiles["agent_mira"].model_provider = "slow"
    world.agent_profiles["agent_tao"].hidden = False
    world.agent_profiles["agent_ren"].hidden = True
    world.agent_states["agent_mira"].position = Point(240, 220)
    world.agent_states["agent_tao"].position = Point(260, 220)
    runtime = SimulationRuntime(world, providers={"mock": SlowProvider(), "slow": SlowProvider()})
    runtime.start()

    runtime._schedule_agent_decisions()

    assert world.agent_states["agent_mira"].pending_model
    await asyncio.sleep(SLOW_CALL_SECONDS + 0.05)
    await runtime.tick(0.1)


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
