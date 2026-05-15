from agent_engine.engine.geometry import distance
from agent_engine.engine.rules import RuleEngine
from agent_engine.engine.world import AgentAction, GameWorld, MapRegion, Point, PolygonArea, WorldItem


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


def test_drawn_walkable_region_can_extend_beyond_map_frame():
    world = GameWorld.default()
    world.map.width = 100
    world.map.height = 100
    world.map.regions = [
        MapRegion(
            id="region_off_frame",
            name="Off-frame road",
            function="walkable",
            points=[Point(20, 120), Point(90, 120), Point(90, 190), Point(20, 190)],
        )
    ]
    world.map.sync_functional_regions()
    rules = RuleEngine()

    assert world.map.is_walkable(Point(50, 150))
    assert not world.map.is_walkable(Point(500, 500))
    move = rules.apply(
        world,
        AgentAction(agent_id="agent_mira", type="move_to", payload={"target": {"x": 50, "y": 150}}),
    )
    assert move.ok


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


def test_rule_engine_adjusts_move_target_away_from_other_agents():
    world = GameWorld.default()
    rules = RuleEngine()
    world.agent_states["agent_tao"].position = Point(360, 220)

    result = rules.apply(
        world,
        AgentAction(
            agent_id="agent_mira",
            type="move_to",
            payload={"target": {"x": 360, "y": 220}},
        ),
    )

    assert result.ok
    target = world.agent_states["agent_mira"].target
    assert target is not None
    assert distance(target.to_dict(), world.agent_states["agent_tao"].position.to_dict()) >= rules.agent_min_center_distance
    assert world.events[-1].payload["collision_adjusted"] is True
    assert world.events[-1].payload["requested_target"] == {"x": 360.0, "y": 220.0}


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
