from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from agent_engine.engine.world import GameWorld


class ProjectStore:
    def __init__(self, project_dir: str | Path):
        self.project_dir = Path(project_dir)
        self.assets_dir = self.project_dir / "assets"
        self.db_path = self.project_dir / "world.sqlite"
        self.project_json = self.project_dir / "project.json"

    def initialize(self) -> None:
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        if not self.project_json.exists():
            self.project_json.write_text(
                json.dumps(
                    {
                        "name": "New Sandbox",
                        "backend": "FastAPI",
                        "renderers": ["2d", "3d"],
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        with self.connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS events (
                  id TEXT PRIMARY KEY,
                  tick INTEGER NOT NULL,
                  type TEXT NOT NULL,
                  agent_id TEXT,
                  message TEXT NOT NULL,
                  payload TEXT NOT NULL,
                  timestamp REAL NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS memories (
                  id TEXT PRIMARY KEY,
                  agent_id TEXT NOT NULL,
                  kind TEXT NOT NULL,
                  text TEXT NOT NULL,
                  timestamp REAL NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS relationships (
                  from_agent TEXT NOT NULL,
                  to_agent TEXT NOT NULL,
                  label TEXT NOT NULL,
                  score REAL NOT NULL,
                  PRIMARY KEY (from_agent, to_agent, label)
                )
                """
            )

    def connect(self) -> sqlite3.Connection:
        self.project_dir.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def save_world(self, world: GameWorld) -> None:
        self.initialize()
        snapshot = world.to_dict()
        with self.connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)",
                ("world", json.dumps(snapshot)),
            )
            conn.executemany(
                """
                INSERT OR REPLACE INTO events
                (id, tick, type, agent_id, message, payload, timestamp)
                VALUES (:id, :tick, :type, :agent_id, :message, :payload, :timestamp)
                """,
                [
                    {
                        "id": event["id"],
                        "tick": event["tick"],
                        "type": event["type"],
                        "agent_id": event.get("agent_id"),
                        "message": event["message"],
                        "payload": json.dumps(event.get("payload", {})),
                        "timestamp": event["timestamp"],
                    }
                    for event in snapshot["events"]
                ],
            )
            conn.commit()

    def load_world(self) -> GameWorld:
        self.initialize()
        with self.connect() as conn:
            row = conn.execute("SELECT value FROM kv WHERE key = ?", ("world",)).fetchone()
        if row is None:
            world = GameWorld.default()
            self.save_world(world)
            return world
        return GameWorld.from_dict(json.loads(row["value"]))

    def load_project_metadata(self) -> dict[str, Any]:
        self.initialize()
        return json.loads(self.project_json.read_text(encoding="utf-8"))

