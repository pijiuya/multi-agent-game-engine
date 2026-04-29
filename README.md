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

Run the desktop workstation:

```powershell
cd frontend
npm run electron:dev
```

The Electron desktop app checks the local engine on startup and starts the FastAPI backend automatically when it is not already running. Browser-only development still expects the backend command above to be running in a second terminal.

## Local Model Setup

The Model Manager is organized as three capability cards:

- `语言模型 LLM`: Install/open Ollama, prepare `qwen2.5:1.5b`, `qwen2.5:7b`, or `gemma3:1b`, then click `重新检测` and `一键使用本地 LLM`.
- `图片生成`: For now you can import an image or use test candidates. To use a real local image model, start ComfyUI or another local image generator and paste its service address in `高级配置`.
- `SAM 分层`: Start a local SAM segmentation service, then click `重新检测` and `一键使用本地 SAM`. If using another machine or cloud endpoint, paste its service address and API key in `高级配置`.

## Project Data

By default the backend creates a local project folder at `runtime_project/`:

- `project.json`: project metadata and UI-facing settings.
- `assets/`: uploaded map backgrounds and visual assets.
- `world.sqlite`: saved world snapshots, memories, relationships, and events.
