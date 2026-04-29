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

