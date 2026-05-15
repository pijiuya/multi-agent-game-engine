from agent_engine.engine.environment_ai import EnvironmentArbiter
from agent_engine.engine.world import AgentProfile, GameWorld, Point, WorldItem, normalize_action_space


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


def test_environment_proposal_accepts_narrative_state_and_memory_safely():
    world = GameWorld.default()
    arbiter = EnvironmentArbiter()

    review = arbiter.apply_proposal(
        world,
        {
            "state_changes": [
                {
                    "op": "set_agent_narrative_state",
                    "agent_id": "agent_mira",
                    "state": {"mood": "uneasy", "focus": "watching the gate", "urgency": "rising"},
                },
                {
                    "op": "add_memory",
                    "agent_id": "__scene__",
                    "kind": "scene",
                    "text": "A bell rings beyond the market.",
                },
                {
                    "op": "set_agent_narrative_state",
                    "agent_id": "agent_mira",
                    "key": "inventory",
                    "value": "knife",
                },
                {
                    "op": "add_memory",
                    "agent_id": "missing_agent",
                    "kind": "short_term",
                    "text": "Should be rejected.",
                },
            ],
            "memories": [
                {
                    "agent_id": "agent_tao",
                    "kind": "cue",
                    "text": "Tao notices Mira watching the gate.",
                },
                {
                    "agent_id": "agent_tao",
                    "kind": "private",
                    "text": "Invalid kind.",
                },
            ],
        },
    )

    assert len(review.accepted) == 3
    assert len(review.rejected) == 3
    assert world.agent_states["agent_mira"].narrative_state == {
        "mood": "uneasy",
        "focus": "watching the gate",
        "urgency": "rising",
    }
    assert [memory.kind for memory in world.memories] == ["scene", "cue"]
    assert world.memories[0].agent_id == "__scene__"
    assert world.memories[1].agent_id == "agent_tao"
    assert world.events[-1].type == "system"


def test_world_loads_agent_event_and_item_defaults():
    world = GameWorld.from_dict(GameWorld.default().to_dict())
    item = WorldItem.from_dict({"id": "legacy", "name": "Legacy", "position": {"x": 1, "y": 2}})
    assert item.movable is True
    profile = world.agent_profiles["agent_mira"]
    state = world.agent_states["agent_mira"]
    assert profile.animation is None
    assert profile.dialogue_policy["enabled"] is True
    assert profile.dialogue_policy["language"] == "auto"
    assert state.held_item_id is None
    assert state.narrative_state == {}
    assert world.narrative["enabled"] is False
    assert world.decision_events == []


def test_legacy_animation_migrates_to_idle_clip_and_explicit_action_space_disables_builtins():
    profile = AgentProfile.from_dict(
        {
            "id": "agent_anim",
            "name": "Animated",
            "action_space": ["wait"],
            "animation": {
                "kind": "gif",
                "url": "/api/assets/agent.gif",
                "fps": 8,
                "width": 64,
                "height": 64,
            },
        }
    )

    assert profile.action_space == ["wait"]
    assert normalize_action_space(["wait"]) == ["wait"]
    assert profile.animation["kind"] == "gif"
    assert profile.animation["clips"]["idle"]["url"] == "/api/assets/agent.gif"
