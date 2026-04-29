from agent_engine.engine.rules import RuleEngine
from agent_engine.engine.world import AgentAction, GameWorld, Point, PolygonArea, WorldItem


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


def test_rule_engine_stop_social_and_movable_item_actions():
    world = GameWorld.default()
    rules = RuleEngine()
    mira = world.agent_states["agent_mira"]
    mira.target = Point(300, 220)
    mira.status = "moving"

    stopped = rules.apply(world, AgentAction(agent_id="agent_mira", type="stop"))
    assert stopped.ok
    assert mira.target is None
    assert mira.status == "idle"

    social = rules.apply(
        world,
        AgentAction(
            agent_id="agent_mira",
            type="social",
            payload={"target_agent_id": "agent_tao", "text": "hello"},
        ),
    )
    assert social.ok
    assert world.events[-1].type == "dialogue"

    cooldown_social = rules.apply(
        world,
        AgentAction(agent_id="agent_mira", type="social", payload={"target_agent_id": "agent_tao"}),
    )
    assert not cooldown_social.ok

    world.map.items.append(WorldItem(id="item_crate", name="Crate", position=Point(242, 220)))
    pickup = rules.apply(
        world,
        AgentAction(agent_id="agent_mira", type="pick_up", payload={"item_id": "item_crate"}),
    )
    assert pickup.ok
    assert mira.held_item_id == "item_crate"

    dropped = rules.apply(world, AgentAction(agent_id="agent_mira", type="drop_item"))
    assert dropped.ok
    assert mira.held_item_id is None

    world.map.items[-1].movable = False
    rejected = rules.apply(
        world,
        AgentAction(agent_id="agent_mira", type="pick_up", payload={"item_id": "item_crate"}),
    )
    assert not rejected.ok
