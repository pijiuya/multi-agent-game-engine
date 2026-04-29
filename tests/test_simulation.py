import asyncio
from time import perf_counter

from agent_engine.engine.simulation import SimulationRuntime
from agent_engine.engine.world import GameWorld, Point, WorldItem
from agent_engine.models.provider import ModelProvider, ModelRequest, ModelResponse


class SlowProvider(ModelProvider):
    name = "slow"

    async def generate(self, request: ModelRequest) -> ModelResponse:
        await asyncio.sleep(0.15)
        return ModelResponse(text="slow thought", actions=[{"type": "wait", "payload": {}}])


async def test_slow_model_does_not_block_tick():
    world = GameWorld.default()
    world.agent_profiles["agent_mira"].model_provider = "slow"
    runtime = SimulationRuntime(world, providers={"mock": SlowProvider(), "slow": SlowProvider()})
    runtime.start()

    started = perf_counter()
    await runtime.tick(0.1)
    elapsed = perf_counter() - started

    assert elapsed < 0.05
    assert world.agent_states["agent_mira"].pending_model

    await asyncio.sleep(0.2)
    world.running = False
    await runtime.tick(0.1)

    assert not world.agent_states["agent_mira"].pending_model
    assert any(event.message == "slow thought" for event in world.events)


async def test_non_mock_provider_schedules_one_request_at_a_time():
    world = GameWorld.default()
    for profile in world.agent_profiles.values():
        profile.model_provider = "slow"
    runtime = SimulationRuntime(world, providers={"mock": SlowProvider(), "slow": SlowProvider()})
    runtime.start()

    await runtime.tick(0.1)

    pending = [state for state in world.agent_states.values() if state.pending_model]
    assert len(pending) == 1

    await asyncio.sleep(0.2)
    await runtime.tick(0.1)


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

    observation = runtime._observation_for("agent_mira")

    assert observation["agent_id"] == "agent_mira"
    assert observation["map"]["width"] == world.map.width
    assert observation["nearby_items"][0]["id"] == "item_lamp"
    assert observation["nearby_items"][0]["movable"] is True
    assert observation["movement_targets"]
    assert all("point" in target for target in observation["movement_targets"])


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

    assert say == {"type": "say", "payload": {"text": "hello"}}
    assert move == {"type": "move_to", "payload": {"target": {"x": 360, "y": 220}}}
    assert pickup == {"type": "pick_up", "payload": {"item_id": "item_lamp"}}
