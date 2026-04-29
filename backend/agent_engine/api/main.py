from __future__ import annotations

import os
import shutil
import asyncio
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from agent_engine.engine.environment_ai import EnvironmentArbiter
from agent_engine.engine.simulation import SimulationRuntime
from agent_engine.engine.world import (
    AgentAction,
    AgentProfile,
    GameWorld,
    Point,
    PolygonArea,
    WorldItem,
    WorldMap,
    new_id,
)
from agent_engine.persistence.sqlite_store import ProjectStore


PROJECT_DIR = Path(os.getenv("AGENT_ENGINE_PROJECT_DIR", "runtime_project"))
store = ProjectStore(PROJECT_DIR)
runtime = SimulationRuntime(store.load_world())
arbiter = EnvironmentArbiter()

app = FastAPI(title="Multi-Agent AI Game Engine", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AgentCreate(BaseModel):
    name: str
    role: str = "resident"
    identity: str = "A resident in the scene."
    color: str = "#3b82f6"
    model_provider: str = "mock"
    position: dict[str, float] | None = None
    action_space: list[str] | None = None


class WorldMapUpdate(BaseModel):
    id: str = "map_default"
    name: str = "Untitled Map"
    width: int = 1200
    height: int = 800
    background_image: str | None = None
    walkable_areas: list[dict[str, Any]] = Field(default_factory=list)
    obstacles: list[dict[str, Any]] = Field(default_factory=list)
    interaction_zones: list[dict[str, Any]] = Field(default_factory=list)
    items: list[dict[str, Any]] = Field(default_factory=list)
    triggers: list[dict[str, Any]] = Field(default_factory=list)
    spawn_points: list[dict[str, float]] = Field(default_factory=list)


class ActionSubmit(BaseModel):
    agent_id: str
    type: str
    payload: dict[str, Any] = Field(default_factory=dict)


class ProposalSubmit(BaseModel):
    proposal: dict[str, Any]


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {
        "ok": True,
        "tick": runtime.world.tick,
        "running": runtime.world.running,
        "project_dir": str(store.project_dir),
    }


@app.get("/api/project")
def project() -> dict[str, Any]:
    return store.load_project_metadata()


@app.get("/api/world")
def get_world() -> dict[str, Any]:
    return runtime.snapshot()


@app.put("/api/world")
def replace_world(payload: dict[str, Any]) -> dict[str, Any]:
    runtime.world = GameWorld.from_dict(payload)
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.put("/api/map")
def update_map(payload: WorldMapUpdate) -> dict[str, Any]:
    runtime.world.map = WorldMap(
        id=payload.id,
        name=payload.name,
        width=payload.width,
        height=payload.height,
        background_image=payload.background_image,
        walkable_areas=[PolygonArea.from_dict(area) for area in payload.walkable_areas],
        obstacles=[PolygonArea.from_dict(area) for area in payload.obstacles],
        interaction_zones=[PolygonArea.from_dict(area) for area in payload.interaction_zones],
        items=[WorldItem.from_dict(item) for item in payload.items],
        triggers=[PolygonArea.from_dict(area) for area in payload.triggers],
        spawn_points=[Point.from_dict(point) for point in payload.spawn_points],
    )
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.post("/api/maps/image")
async def upload_map_image(file: UploadFile = File(...)) -> dict[str, Any]:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg"}:
        raise HTTPException(status_code=400, detail="Only PNG and JPG map images are supported.")
    asset_name = f"{new_id('map')}{suffix}"
    destination = store.assets_dir / asset_name
    store.initialize()
    with destination.open("wb") as output:
        shutil.copyfileobj(file.file, output)
    runtime.world.map.background_image = f"/api/assets/{asset_name}"
    store.save_world(runtime.world)
    return {"asset": asset_name, "url": runtime.world.map.background_image}


@app.get("/api/assets/{asset_name}")
def asset(asset_name: str) -> FileResponse:
    path = (store.assets_dir / asset_name).resolve()
    if not str(path).startswith(str(store.assets_dir.resolve())) or not path.exists():
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(path)


@app.post("/api/agents")
def create_agent(payload: AgentCreate) -> dict[str, Any]:
    agent_id = new_id("agent")
    profile = AgentProfile(
        id=agent_id,
        name=payload.name,
        role=payload.role,
        identity=payload.identity,
        color=payload.color,
        model_provider=payload.model_provider,
        action_space=payload.action_space or [
            "move_to",
            "say",
            "interact",
            "use",
            "observe",
            "wait",
        ],
    )
    position = Point.from_dict(payload.position) if payload.position else runtime.world.map.nearest_spawn()
    runtime.world.add_agent(profile, position=position)
    runtime.world.add_event("system", f"Agent {profile.name} created.", agent_id=profile.id)
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.post("/api/actions")
def submit_action(payload: ActionSubmit) -> dict[str, Any]:
    result = runtime.submit_action(
        AgentAction(agent_id=payload.agent_id, type=payload.type, payload=payload.payload)
    )
    store.save_world(runtime.world)
    return result


@app.post("/api/environment/proposal")
def submit_environment_proposal(payload: ProposalSubmit) -> dict[str, Any]:
    review = arbiter.apply_proposal(runtime.world, payload.proposal)
    store.save_world(runtime.world)
    return {"accepted": review.accepted, "rejected": review.rejected}


@app.post("/api/simulation/start")
async def start_simulation() -> dict[str, Any]:
    await runtime.start_background()
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.post("/api/simulation/pause")
async def pause_simulation() -> dict[str, Any]:
    await runtime.stop_background()
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.post("/api/simulation/tick")
async def simulation_tick() -> dict[str, Any]:
    snapshot = await runtime.tick()
    store.save_world(runtime.world)
    return snapshot


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive_json(), timeout=0.1)
            except TimeoutError:
                message = {}
            except RuntimeError:
                message = {}
            if message:
                await _handle_ws_message(message)
            await websocket.send_json(runtime.snapshot())
    except WebSocketDisconnect:
        return


async def _handle_ws_message(message: dict[str, Any]) -> None:
    kind = message.get("type")
    if kind == "start":
        await runtime.start_background()
    elif kind == "pause":
        await runtime.stop_background()
    elif kind == "action":
        payload = message.get("payload", {})
        runtime.submit_action(
            AgentAction(
                agent_id=str(payload.get("agent_id", "")),
                type=str(payload.get("type", "")),
                payload=dict(payload.get("payload", {})),
            )
        )
