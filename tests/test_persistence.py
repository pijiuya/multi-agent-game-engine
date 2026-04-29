import json

from agent_engine.engine.world import GameWorld
from agent_engine.persistence.sqlite_store import ProjectStore


def test_project_store_round_trips_world(tmp_path):
    store = ProjectStore(tmp_path / "project")
    world = GameWorld.default()
    world.add_event("narration", "A saved moment.")

    store.save_world(world)
    loaded = store.load_world()

    assert loaded.name == world.name
    assert loaded.events[-1].message == "A saved moment."
    assert (tmp_path / "project" / "project.json").exists()
    assert (tmp_path / "project" / "world.sqlite").exists()


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
