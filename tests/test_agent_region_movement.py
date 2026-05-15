from agent_engine.engine.simulation import SimulationRuntime
from agent_engine.engine.world import GameWorld, MapRegion, Point
from agent_engine.models.provider import ModelRequest


def test_invalid_llm_move_target_is_snapped_to_recommended_candidate():
    runtime = SimulationRuntime(GameWorld.default())
    request = ModelRequest(
        agent_id="agent_mira",
        role="mediator",
        identity="test",
        action_space=["move_to", "wait"],
        observation={
            "movement_targets": [
                {"label": "walkable:Road", "point": {"x": 360, "y": 220}, "priority": 100},
                {"label": "action:Plaza", "point": {"x": 260, "y": 260}, "priority": 80},
            ]
        },
    )

    action = runtime._coerce_model_action(
        {"type": "move_to", "payload": {"target": {"x": 9999, "y": -1900}}},
        "",
        request,
    )

    assert action == {"type": "move_to", "payload": {"target": {"x": 360, "y": 220}}}


def test_movement_intent_converts_text_only_fallback_to_move():
    runtime = SimulationRuntime(GameWorld.default())
    request = ModelRequest(
        agent_id="agent_mira",
        role="mediator",
        identity="test",
        action_space=["say", "move_to", "wait"],
        observation={
            "movement_intent": True,
            "movement_targets": [{"label": "walkable:Road", "point": {"x": 360, "y": 220}, "priority": 100}],
        },
    )

    assert runtime._fallback_action_type(request, "long model text") == "move_to"
    action = runtime._coerce_model_action({"type": "say", "payload": {}}, "long model text", request)

    assert action == {"type": "move_to", "payload": {"target": {"x": 360, "y": 220}}}


def test_unknown_llm_social_target_is_snapped_to_dialogue_candidate():
    runtime = SimulationRuntime(GameWorld.default())
    request = ModelRequest(
        agent_id="agent_mira",
        role="mediator",
        identity="test",
        action_space=["social", "wait"],
        observation={"dialogue_candidates": [{"id": "agent_tao", "name": "Tao"}]},
    )

    action = runtime._coerce_model_action(
        {"type": "social", "payload": {"target_agent_id": "agent_bob", "text": "hello"}},
        "",
        request,
    )

    assert action == {"type": "social", "payload": {"target_agent_id": "agent_tao", "text": "hello"}}


def test_region_context_prioritizes_roads_and_boosts_social_range():
    world = GameWorld.default()
    world.agent_states["agent_tao"].position = Point(450, 220)
    world.map.regions = [
        MapRegion(
            id="region_action",
            name="Movement Plaza",
            function="action",
            points=[Point(280, 180), Point(340, 180), Point(340, 260), Point(280, 260)],
        ),
        MapRegion(
            id="region_road",
            name="Main Road",
            function="walkable",
            points=[Point(460, 180), Point(540, 180), Point(540, 260), Point(460, 260)],
        ),
        MapRegion(
            id="region_social",
            name="Meeting Spot",
            function="social",
            points=[Point(200, 180), Point(280, 180), Point(280, 260), Point(200, 260)],
        ),
        MapRegion(
            id="region_home",
            name="Homes",
            function="residential",
            points=[Point(80, 80), Point(140, 80), Point(140, 160), Point(80, 160)],
        ),
    ]
    world.map.sync_functional_regions()
    runtime = SimulationRuntime(world)

    observation = runtime._observation_for("agent_mira")

    assert observation["movement_targets"][0]["region_function"] == "walkable"
    assert observation["movement_targets"][0]["region_id"] == "region_road"
    assert "region_context" in observation
    assert any(region["function"] == "social" for region in observation["region_context"]["current"])
    assert observation["dialogue_candidates"][0]["id"] == "agent_tao"
    assert world.map.is_walkable(Point(110, 120))


def test_movement_targets_use_drawn_region_extent_instead_of_map_frame():
    world = GameWorld.default()
    world.map.width = 100
    world.map.height = 100
    world.map.regions = [
        MapRegion(
            id="region_tall_road",
            name="Tall Road",
            function="walkable",
            points=[Point(20, 120), Point(90, 120), Point(90, 220), Point(20, 220)],
        )
    ]
    world.map.sync_functional_regions()
    world.agent_states["agent_mira"].position = Point(50, 150)
    runtime = SimulationRuntime(world)

    targets = runtime._movement_targets_for("agent_mira")

    assert targets
    assert targets[0]["region_id"] == "region_tall_road"
    assert targets[0]["point"]["y"] > world.map.height
