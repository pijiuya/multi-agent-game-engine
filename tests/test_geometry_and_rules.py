from agent_engine.engine.rules import RuleEngine
from agent_engine.engine.world import AgentAction, GameWorld, Point, PolygonArea


def test_polygon_walkable_and_obstacle_rules():
    world = GameWorld.default()
    world.map.obstacles = [
        PolygonArea(
            id="obs_table",
            name="Table",
            kind="obstacle",
            points=[Point(300, 300), Point(420, 300), Point(420, 420), Point(300, 420)],
        )
    ]

    assert world.map.is_walkable(Point(200, 200))
    assert not world.map.is_walkable(Point(350, 350))
    assert not world.map.is_walkable(Point(10_000, 10_000))


def test_rule_engine_rejects_invalid_move_and_applies_speech():
    world = GameWorld.default()
    rules = RuleEngine()

    invalid = rules.apply(
        world,
        AgentAction(
            agent_id="agent_mira",
            type="move_to",
            payload={"target": {"x": 10_000, "y": 10_000}},
        ),
    )
    assert not invalid.ok
    assert world.events[-1].type == "rejected_action"

    spoken = rules.apply(
        world,
        AgentAction(
            agent_id="agent_mira",
            type="say",
            payload={"text": "The room feels ready."},
        ),
    )
    assert spoken.ok
    assert world.events[-1].type == "speech"
    assert "The room feels ready" in world.events[-1].message

