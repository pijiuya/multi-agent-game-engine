import json

from agent_engine.engine.world import GameWorld, MapRegion, Point
from agent_engine.persistence.sqlite_store import ProjectStore


def test_project_store_round_trips_world(tmp_path):
    store = ProjectStore(tmp_path / "project")
    world = GameWorld.default()
    world.narrative.update(
        {
            "enabled": True,
            "premise": "A quiet market prepares for rain.",
            "tone": "tense",
            "cadence_ticks": 12,
            "last_tick": 48,
            "recent_summary": "Mira noticed the clouds.",
        }
    )
    world.agent_states["agent_mira"].narrative_state = {"arc": "hesitating", "beats": 2}
    world.add_event("narration", "A saved moment.")

    store.save_world(world)
    loaded = store.load_world()

    assert loaded.name == world.name
    assert loaded.narrative == world.narrative
    assert loaded.agent_states["agent_mira"].narrative_state == {"arc": "hesitating", "beats": 2}
    assert loaded.events[-1].message == "A saved moment."
    assert (tmp_path / "project" / "project.json").exists()
    assert (tmp_path / "project" / "world.sqlite").exists()


def test_project_store_loads_legacy_snapshots_without_narrative_state(tmp_path):
    store = ProjectStore(tmp_path / "project")
    world = GameWorld.default()
    snapshot = world.to_dict()
    del snapshot["narrative"]
    for state in snapshot["agent_states"].values():
        del state["narrative_state"]
    store.initialize()
    with store.connect() as conn:
        conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", ("world", json.dumps(snapshot)))
        conn.commit()

    loaded = store.load_world()
    assert loaded.narrative == {
        "enabled": False,
        "premise": "",
        "tone": "grounded",
        "cadence_ticks": 50,
        "last_tick": -999,
        "recent_summary": "",
    }
    assert all(state.narrative_state == {} for state in loaded.agent_states.values())


def test_project_store_loads_legacy_items(tmp_path):
    store = ProjectStore(tmp_path / "project")
    world = GameWorld.default()
    snapshot = world.to_dict()
    snapshot["map"]["items"].append(
        {
            "id": "legacy_item",
            "name": "Legacy Item",
            "position": {"x": 42, "y": 64},
            "radius": 24,
            "tags": [],
            "state": {},
        }
    )
    store.initialize()
    with store.connect() as conn:
        conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", ("world", json.dumps(snapshot)))
        conn.commit()

    loaded = store.load_world()
    item = loaded.map.item_by_id("legacy_item")
    assert item is not None
    assert item.scale == 1
    assert item.rotation == 0
    assert item.image is None
    assert item.description == ""


def test_project_store_loads_legacy_maps_without_regions(tmp_path):
    store = ProjectStore(tmp_path / "project")
    world = GameWorld.default()
    snapshot = world.to_dict()
    snapshot["map"]["walkable_areas"] = [
        {
            "id": "legacy_walkable",
            "name": "Legacy Walkable",
            "kind": "walkable",
            "points": [
                {"x": 0, "y": 0},
                {"x": 80, "y": 0},
                {"x": 80, "y": 80},
                {"x": 0, "y": 80},
            ],
        }
    ]
    del snapshot["map"]["regions"]
    store.initialize()
    with store.connect() as conn:
        conn.execute("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", ("world", json.dumps(snapshot)))
        conn.commit()

    loaded = store.load_world()
    assert len(loaded.map.regions) == 1
    assert loaded.map.regions[0].source == "manual"
    assert loaded.map.regions[0].name == "Legacy Walkable"
    assert loaded.map.walkable_areas[0].metadata["region_id"] == loaded.map.regions[0].id


def test_region_function_mirroring_and_model_configs(tmp_path):
    store = ProjectStore(tmp_path / "project")
    world = GameWorld.default()
    world.map.regions = [
        MapRegion(
            id="region_walk",
            name="道路区域",
            function="walkable",
            points=[Point(0, 0), Point(20, 0), Point(20, 20), Point(0, 20)],
        ),
        MapRegion(
            id="region_social",
            name="社交区域",
            function="social",
            points=[Point(30, 30), Point(60, 30), Point(60, 60), Point(30, 60)],
        ),
    ]
    world.map.sync_functional_regions()
    store.save_world(world)

    loaded = store.load_world()
    assert len(loaded.map.regions) == 2
    assert any(area.metadata.get("region_id") == "region_walk" for area in loaded.map.walkable_areas)
    assert any(area.metadata.get("region_id") == "region_social" for area in loaded.map.interaction_zones)

    configs = store.load_model_configs()
    assert any("segmentation" in config["capabilities"] for config in configs)
    store.save_model_configs([{**configs[0], "id": "model_custom"}])
    assert store.load_model_configs()[0]["id"] == "model_custom"
