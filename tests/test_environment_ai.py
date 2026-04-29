from agent_engine.engine.environment_ai import EnvironmentArbiter
from agent_engine.engine.world import GameWorld, Point, WorldItem


def test_environment_proposal_accepts_safe_events_and_rejects_unsafe_state():
    world = GameWorld.default()
    world.map.items.append(WorldItem(id="item_lamp", name="Lamp", position=Point(200, 200)))
    arbiter = EnvironmentArbiter()

    review = arbiter.apply_proposal(
        world,
        {
            "events": [{"type": "narration", "message": "The lamp hums softly."}],
            "state_changes": [
                {"op": "set_item_state", "item_id": "item_lamp", "key": "mood", "value": "warm"},
                {"op": "teleport_agent", "agent_id": "agent_mira", "position": {"x": 1, "y": 1}},
            ],
        },
    )

    assert len(review.accepted) == 2
    assert len(review.rejected) == 1
    assert world.map.items[0].state["mood"] == "warm"
    assert world.events[-1].type == "system"


def test_world_loads_agent_event_and_item_defaults():
    world = GameWorld.from_dict(GameWorld.default().to_dict())
    item = WorldItem.from_dict({"id": "legacy", "name": "Legacy", "position": {"x": 1, "y": 2}})
    assert item.movable is True
    profile = world.agent_profiles["agent_mira"]
    state = world.agent_states["agent_mira"]
    assert profile.animation is None
    assert profile.dialogue_policy["enabled"] is True
    assert state.held_item_id is None
    assert world.decision_events == []
