from __future__ import annotations

import shutil
import sys
from pathlib import Path


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    backend_dir = repo_root / "backend"
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    from agent_engine.engine.world import GameWorld, WorldMap, default_narrative_config
    from agent_engine.persistence.sqlite_store import ProjectStore

    output_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else repo_root / "packaging" / "windows-blank-runtime"
    if not output_dir.is_absolute():
      output_dir = repo_root / output_dir

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    world = GameWorld(
        id="world_default",
        name="New Sandbox",
        map=WorldMap.default(),
        narrative=default_narrative_config(),
    )
    world.add_event("system", "Blank Windows project initialized.")

    store = ProjectStore(output_dir)
    store.save_world(world)
    store.load_model_configs()
    print(f"Created blank Windows runtime at {output_dir}")


if __name__ == "__main__":
    main()
