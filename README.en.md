# Multi-Agent AI Game Engine

**Language / 语言:** [中文](README.md) | **English**

[![Release](https://img.shields.io/github/v/release/pijiuya/multi-agent-game-engine?label=release)](https://github.com/pijiuya/multi-agent-game-engine/releases/tag/v0.1.0)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11-black)](pyproject.toml)
[![Frontend](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-black)](frontend/package.json)

A local-first multi-agent simulation engine and visual editor. It combines a Python/FastAPI simulation backend, a React/Vite transparent workbench, an Electron desktop shell, and local model workflows for building maps, regions, items, agent actions, LLM decision events, and desktop release packages.

![Multi-Agent Engine workbench](frontend/src/assets/agent-engine-electron-workbench.png)

## Downloads

Current public version: [`v0.1.0`](https://github.com/pijiuya/multi-agent-game-engine/releases/tag/v0.1.0)

- [Mac install kit](https://github.com/pijiuya/multi-agent-game-engine/releases/download/v0.1.0/Multi-Agent-Engine-0.1.0-mac-install-kit.zip): DMG, install helper scripts, Ollama helper script, user manual, and SHA256 checks.
- [Mac arm64 DMG](https://github.com/pijiuya/multi-agent-game-engine/releases/download/v0.1.0/Multi-Agent.Engine-0.1.0-mac-arm64.dmg): standalone application image.
- [Windows x64 installer](https://github.com/pijiuya/multi-agent-game-engine/releases/download/v0.1.0/Multi-Agent.Engine-0.1.0-win-installer-x64.exe): Windows installer.

Release packages are distributed through GitHub Releases and are not committed to the source repository.

## Features

- **Transparent 2D workbench**: import or generate maps, then draw roads, obstacles, action areas, residential areas, and social zones.
- **Multi-agent simulation**: manage agents, items, regions, movement, stops, speech, social behavior, and item interactions.
- **LLM decision events**: record world events and `decision_events` so each model-driven action can be inspected.
- **Assets and animation**: bind GIF or PNG sequence animations to agents with FPS, max-pixel, and display-scale controls.
- **Local model capabilities**: manage Ollama LLMs, vision labeling, image generation configuration, and embedded MobileSAM segmentation.
- **Desktop delivery**: run the same frontend in the browser or Electron, with Mac and Windows packaging workflows.

## Who It Is For

- **Indie game and simulation developers** building observable NPC / agent prototypes.
- **AI agent prototypers** testing multi-agent actions, dialogue, item interactions, and LLM decision chains.
- **Local model experimenters** connecting Ollama, local vision models, and map segmentation in one workflow.
- **Desktop delivery testers** exploring Electron + Python backend + local runtime packaging.

## User Data and Local-First Storage

Runtime data is stored in `runtime_project/` at the repository root. This directory is ignored by Git.

It usually contains:

- `world.sqlite`: maps, agents, items, events, decision events, and model configuration.
- `project.json`: project metadata.
- `assets/`: uploaded map backgrounds, item images, agent GIFs, and PNG sequences.
- `models/`: local caches such as embedded MobileSAM weights.

To migrate to another machine, either clone only the source code for a blank project or copy `runtime_project/` as well to keep the current scene.

## Tech Stack

- Backend: Python 3.11, FastAPI, Uvicorn, Pydantic, Shapely, SQLite
- Frontend: React 18, TypeScript, Vite, Three.js, Pixi.js, Lucide icons
- Desktop: Electron
- Tests: Pytest, Playwright
- Local models: Ollama, embedded MobileSAM

## Quick Start

### Backend

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
AGENT_ENGINE_PROJECT_DIR=runtime_project python -m uvicorn agent_engine.api.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Windows PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
$env:AGENT_ENGINE_PROJECT_DIR = "runtime_project"
py -3.11 -m uvicorn agent_engine.api.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev -- --port 5173
```

Open `http://127.0.0.1:5173/`.

### Electron Desktop App

```bash
cd frontend
npm run electron:dev
```

## Common Commands

```bash
# Backend tests
.venv/bin/python -m pytest -q

# Frontend type check and production build
npm --prefix frontend run build

# Frontend Playwright regression suite
npm --prefix frontend run test:e2e
```

## Versioning

- Current version: `v0.1.0`
- Python package version is defined in [`pyproject.toml`](pyproject.toml).
- Frontend / Electron version is defined in [`frontend/package.json`](frontend/package.json).
- Release tags use `vX.Y.Z`.
- See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## Documentation

- [User Manual](docs/user-manual.zh-CN.md)
- [Development Manual](docs/development-manual.zh-CN.md)
- [Mac Installation](docs/mac-installation.zh-CN.md)
- [Windows Installation](docs/windows-installation.zh-CN.md)
- [Windows Packaging](docs/windows-packaging.zh-CN.md)
- [Action Extension Design](docs/action-extension-manual.zh-CN.md)

## Project Layout

```text
.
├─ backend/agent_engine/        # Backend API, rules, simulation, providers, persistence
├─ frontend/src/                # React workbench UI and official static pages
├─ frontend/electron/           # Electron main process and preload
├─ frontend/tests/              # Playwright frontend regression tests
├─ tests/                       # Pytest backend tests
├─ docs/                        # User, development, installation, and packaging docs
├─ packaging/                   # Mac / Windows packaging scripts
├─ runtime_project/             # Local runtime data, ignored by Git
├─ pyproject.toml               # Python package and test configuration
└─ README.md
```

## Contributing

Issues and pull requests are welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and include the tests you ran in each PR.

## License

This project is licensed under the [MIT License](LICENSE).
