from agent_engine.engine.context_compressor import ContextCompressor
from agent_engine.engine.world import GameWorld, Memory, Point, WorldItem


def test_context_compressor_summarizes_important_events_and_adds_scene_memory():
    world = GameWorld.default()
    world.add_event("speech", "Mira: The lamp changed.", agent_id="agent_mira")
    world.add_event("interaction", "Tao moves the crate.", agent_id="agent_tao")

    result = ContextCompressor(event_threshold=10).compress_world(world)

    assert result.should_compress is True
    assert "lamp changed" in result.summary
    assert result.memories[0]["agent_id"] == "__scene__"
    assert result.memories[0]["kind"] == "scene"
    assert result.input_chars > 0


def test_context_compressor_trims_observation_to_context_budget():
    compressor = ContextCompressor(context_budget_chars=1000, recent_event_window=8, scene_memory_window=5)
    observation = {
        "agent_recent_events": [{"id": str(index), "message": "x" * 200} for index in range(20)],
        "recent_events": [{"id": str(index), "message": "y" * 200} for index in range(20)],
        "recent_utterances": [{"text": "hello"} for _ in range(20)],
        "relationships": [{"agent_id": str(index)} for index in range(20)],
        "movement_targets": [{"point": {"x": index, "y": index}} for index in range(20)],
        "scene_context": {
            "memories": [{"text": "m"} for _ in range(20)],
            "cues": [{"text": "c"} for _ in range(20)],
        },
    }

    compact = compressor.compact_observation(observation)

    assert compact["context_budget"]["trimmed"] is True
    assert len(compact["agent_recent_events"]) == 4
    assert len(compact["movement_targets"]) == 5
    assert len(compact["scene_context"]["memories"]) == 5


def test_context_compressor_preserves_relevant_scene_memory_window():
    world = GameWorld.default()
    world.memories = [
        Memory(id=f"mem_{index}", agent_id="__scene__", kind="scene", text=f"memory {index}")
        for index in range(10)
    ]
    world.map.items.append(WorldItem(id="item_lamp", name="Lamp", position=Point(250, 225)))

    compressor = ContextCompressor(scene_memory_window=3)
    compact = compressor.compact_observation(
        {
            "scene_memories": [memory.to_dict() for memory in world.memories],
            "scene_context": {"memories": [memory.to_dict() for memory in world.memories], "cues": []},
        }
    )

    assert [memory["text"] for memory in compact["scene_memories"]] == ["memory 7", "memory 8", "memory 9"]
    assert [memory["text"] for memory in compact["scene_context"]["memories"]] == ["memory 7", "memory 8", "memory 9"]
