# Multi-Agent AI Game Engine

A local-first v1 engine for building AI social simulation sandboxes.

- Python simulation is the authority for world state and rules.
- Web editor imports hand-drawn maps, marks walkable/blocked/interactive geometry, and runs 2D or 3D views.
- Local model providers can act as environment game masters that propose events.
- Online model providers can drive agent language, social identity, and high-level intent.

## Quick Start

```powershell
python -m pip install -e ".[dev]"
pytest

cd frontend
npm install
npm run build
```

Run the backend:

```powershell
uvicorn agent_engine.api.main:app --app-dir backend --reload --port 8000
```

Run the frontend:

```powershell
cd frontend
npm run dev
```

Open the Vite URL and point it at the backend default `http://127.0.0.1:8000`.

## Project Data

By default the backend creates a local project folder at `runtime_project/`:

- `project.json`: project metadata and UI-facing settings.
- `assets/`: uploaded map backgrounds and visual assets.
- `world.sqlite`: saved world snapshots, memories, relationships, and events.

