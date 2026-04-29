import asyncio
from time import perf_counter

from agent_engine.engine.simulation import SimulationRuntime
from agent_engine.engine.world import GameWorld
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
    await runtime.tick(0.1)

    assert not world.agent_states["agent_mira"].pending_model
    assert any(event.message == "slow thought" for event in world.events)

