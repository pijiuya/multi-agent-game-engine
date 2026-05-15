from __future__ import annotations

import os
from pathlib import Path

import uvicorn


def main() -> None:
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("AGENT_ENGINE_PROJECT_DIR", str(Path.cwd() / "runtime_project"))

    host = os.environ.get("AGENT_ENGINE_HOST", "127.0.0.1")
    port = int(os.environ.get("AGENT_ENGINE_PORT", "8000"))
    log_level = os.environ.get("AGENT_ENGINE_LOG_LEVEL", "info")

    uvicorn.run(
        "agent_engine.api.main:app",
        host=host,
        port=port,
        log_level=log_level,
    )


if __name__ == "__main__":
    main()
