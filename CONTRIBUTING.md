# Contributing

Thanks for helping improve Multi-Agent AI Game Engine.

## Development Setup

Install backend dependencies:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

Run the backend:

```bash
AGENT_ENGINE_PROJECT_DIR=runtime_project python -m uvicorn agent_engine.api.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Run the frontend:

```bash
npm run dev -- --port 5173
```

## Tests

Before opening a pull request, run the checks that match your change:

```bash
.venv/bin/python -m pytest -q
npm --prefix frontend run build
npm --prefix frontend run test:e2e
```

If you cannot run a check, mention that in the PR.

## Branches and Commits

- Use short topic branches, for example `feature/model-panel` or `fix/agent-movement`.
- Keep unrelated changes out of the same PR.
- Do not commit `runtime_project/`, `frontend/release/`, build artifacts, local caches, or machine-specific files.
- Release binaries should be uploaded to GitHub Releases.

## Pull Requests

Each PR should include:

- What changed.
- Why it changed.
- Screenshots for visible UI changes.
- Tests run.
- Any migration or packaging notes.
