from __future__ import annotations

import os
import shutil
import asyncio
import json
import math
import subprocess
from pathlib import Path
from typing import Any
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

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
    MapRegion,
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
    regions: list[dict[str, Any]] = Field(default_factory=list)


class ActionSubmit(BaseModel):
    agent_id: str
    type: str
    payload: dict[str, Any] = Field(default_factory=dict)


class ProposalSubmit(BaseModel):
    proposal: dict[str, Any]


class WorldMapPatch(BaseModel):
    name: str | None = None
    width: int | None = None
    height: int | None = None
    background_image: str | None = None
    regions: list[dict[str, Any]] | None = None


class AgentPatch(BaseModel):
    name: str | None = None
    role: str | None = None
    identity: str | None = None
    color: str | None = None
    model_provider: str | None = None
    action_space: list[str] | None = None


class WorldItemPatch(BaseModel):
    name: str | None = None
    position: dict[str, float] | None = None
    radius: float | None = None
    scale: float | None = None
    rotation: float | None = None
    image: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    state: dict[str, Any] | None = None


class ModelConfigPayload(BaseModel):
    id: str | None = None
    name: str
    kind: str = "local"
    provider: str = "mock"
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    enabled: bool = True
    capabilities: list[str] = Field(default_factory=list)


class ModelConfigPatch(BaseModel):
    name: str | None = None
    kind: str | None = None
    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    enabled: bool | None = None
    capabilities: list[str] | None = None


class ModelsPatch(BaseModel):
    models: list[ModelConfigPayload]


class CapabilityConfigurePayload(BaseModel):
    base_url: str = ""
    api_key: str = ""
    model: str = ""


class MapGenerationRequest(BaseModel):
    prompt: str
    width: int = 1920
    height: int = 1080
    ratio: str = "16:9"
    count: int = 3
    provider_id: str | None = None


class RegionPatch(BaseModel):
    name: str | None = None
    function: str | None = None
    image_prompt: str | None = None
    notes: str | None = None
    tags: list[str] | None = None
    confidence: float | None = None


generation_tasks: dict[str, dict[str, Any]] = {}


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
        regions=[MapRegion.from_dict(region) for region in payload.regions],
    )
    runtime.world.map.sync_functional_regions()
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.patch("/api/map")
def patch_map(payload: WorldMapPatch) -> dict[str, Any]:
    data = _payload_data(payload)
    if "regions" in data:
        runtime.world.map.regions = [MapRegion.from_dict(region) for region in data.pop("regions")]
    for field_name, value in data.items():
        setattr(runtime.world.map, field_name, value)
    runtime.world.map.sync_functional_regions()
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.get("/api/models")
def get_models() -> dict[str, Any]:
    return {"models": [_public_model_config(config) for config in store.load_model_configs()]}


@app.patch("/api/models")
def replace_models(payload: ModelsPatch) -> dict[str, Any]:
    configs = [_model_config_dict(config) for config in payload.models]
    store.save_model_configs(configs)
    return {"models": [_public_model_config(config) for config in configs]}


@app.post("/api/models")
def create_model(payload: ModelConfigPayload) -> dict[str, Any]:
    configs = store.load_model_configs()
    config = _model_config_dict(payload)
    if not config["id"]:
        config["id"] = new_id("model")
    configs = [item for item in configs if item["id"] != config["id"]]
    configs.append(config)
    store.save_model_configs(configs)
    return {"models": [_public_model_config(item) for item in configs], "model": _public_model_config(config)}


@app.patch("/api/models/{model_id}")
def patch_model(model_id: str, payload: ModelConfigPatch) -> dict[str, Any]:
    configs = store.load_model_configs()
    for index, config in enumerate(configs):
        if config["id"] == model_id:
            next_config = {**config, **_payload_data(payload), "id": model_id}
            configs[index] = next_config
            store.save_model_configs(configs)
            return {"models": [_public_model_config(item) for item in configs], "model": _public_model_config(next_config)}
    raise HTTPException(status_code=404, detail="Model config not found")


@app.delete("/api/models/{model_id}")
def delete_model(model_id: str) -> dict[str, Any]:
    configs = store.load_model_configs()
    next_configs = [config for config in configs if config["id"] != model_id]
    if len(next_configs) == len(configs):
        raise HTTPException(status_code=404, detail="Model config not found")
    store.save_model_configs(next_configs)
    return {"models": [_public_model_config(config) for config in next_configs]}


@app.get("/api/model-capabilities/status")
def model_capabilities_status() -> dict[str, Any]:
    configs = store.load_model_configs()
    ollama_models = _detect_ollama_models()
    local_services = _detect_local_model_services()
    return {
        "capabilities": [
            _capability_status("llm", configs, ollama_models, local_services),
            _capability_status("image_generation", configs, ollama_models, local_services),
            _capability_status("segmentation", configs, ollama_models, local_services),
        ],
        "environment": {
            "ollama": {
                "available": bool(ollama_models),
                "models": ollama_models,
            },
            "local_services": local_services,
            "docker": shutil.which("docker") is not None,
            "nvidia": shutil.which("nvidia-smi") is not None,
        },
    }


@app.post("/api/model-capabilities/{capability}/configure-local")
def configure_local_capability(capability: str) -> dict[str, Any]:
    configs = store.load_model_configs()
    ollama_models = _detect_ollama_models()
    local_services = _detect_local_model_services()
    recommendation = _recommended_local_config(capability, ollama_models, local_services)
    if recommendation is None:
        raise HTTPException(status_code=400, detail=_missing_capability_message(capability))
    next_configs = _upsert_model_config(configs, recommendation)
    if capability == "llm":
        vision_config = _recommended_vision_config(ollama_models)
        if vision_config:
            next_configs = _upsert_model_config(next_configs, vision_config)
    store.save_model_configs(next_configs)
    return {
        "models": [_public_model_config(config) for config in next_configs],
        "capability": _capability_status(capability, next_configs, ollama_models, local_services),
    }


@app.post("/api/model-capabilities/{capability}/configure-remote")
def configure_remote_capability(capability: str, payload: CapabilityConfigurePayload) -> dict[str, Any]:
    config = _remote_capability_config(capability, payload)
    configs = _upsert_model_config(store.load_model_configs(), config)
    store.save_model_configs(configs)
    return {
        "models": [_public_model_config(item) for item in configs],
        "capability": _capability_status(capability, configs, _detect_ollama_models(), _detect_local_model_services()),
    }


@app.post("/api/models/{model_id}/test")
def test_model(model_id: str) -> dict[str, Any]:
    config = next((item for item in store.load_model_configs() if item["id"] == model_id), None)
    if config is None:
        raise HTTPException(status_code=404, detail="Model config not found")
    provider = config.get("provider", "mock")
    if provider != "mock" and not config.get("base_url"):
        return {"ok": False, "provider": provider, "message": "缺少 HTTP 地址"}
    return {
        "ok": bool(config.get("enabled", True)),
        "provider": provider,
        "message": "Mock provider 可用" if provider == "mock" else "HTTP provider 已配置",
    }


@app.post("/api/map/generation")
def create_map_generation(payload: MapGenerationRequest) -> dict[str, Any]:
    width = max(128, min(payload.width, 4096))
    height = max(128, min(payload.height, 4096))
    generation_id = new_id("gen")
    candidates = [
        _mock_generated_candidate(generation_id, index, payload.prompt, width, height)
        for index in range(max(1, min(payload.count, 4)))
    ]
    task = {
        "id": generation_id,
        "status": "done",
        "prompt": payload.prompt,
        "ratio": payload.ratio,
        "width": width,
        "height": height,
        "provider_id": payload.provider_id or "model_mock_image",
        "candidates": candidates,
        "selected_candidate_id": None,
    }
    generation_tasks[generation_id] = task
    return task


@app.post("/api/map/generation/{generation_id}/select")
def select_map_generation(generation_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    task = generation_tasks.get(generation_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Generation task not found")
    candidate_id = str(payload.get("candidate_id", ""))
    candidate = next((item for item in task["candidates"] if item["id"] == candidate_id), None)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    task["selected_candidate_id"] = candidate_id
    runtime.world.map.width = int(task["width"])
    runtime.world.map.height = int(task["height"])
    runtime.world.map.background_image = candidate["url"]
    store.save_world(runtime.world)
    return {"generation": task, "world": runtime.snapshot()}


@app.post("/api/map/segment")
def segment_map() -> dict[str, Any]:
    config = _find_enabled_model("segmentation")
    if config is None:
        raise HTTPException(status_code=400, detail="未配置 SAM 分层模型")
    if not runtime.world.map.background_image:
        raise HTTPException(status_code=400, detail="请先选择或导入地图背景图")

    provider = config.get("provider", "mock")
    if provider == "mock":
        regions = _mock_regions(runtime.world.map.width, runtime.world.map.height, source="mock_sam")
        mode = "mock"
    else:
        regions = _call_http_sam_provider(config, runtime.world.map)
        mode = "http"
    if not regions:
        raise HTTPException(status_code=502, detail="SAM 分层没有返回可用区域")
    regions = _postprocess_regions(regions)
    runtime.world.map.regions = regions
    runtime.world.map.sync_functional_regions()
    store.save_world(runtime.world)
    segmentation = _segmentation_state(config, mode=mode, region_count=len(regions), stage="done", progress=100)
    return {"world": runtime.snapshot(), "segmentation": segmentation}


@app.patch("/api/map/regions/{region_id}")
def patch_region(region_id: str, payload: RegionPatch) -> dict[str, Any]:
    region = runtime.world.map.region_by_id(region_id)
    if region is None:
        raise HTTPException(status_code=404, detail="Region not found")
    data = _payload_data(payload)
    for field_name, value in data.items():
        setattr(region, field_name, value)
    runtime.world.map.sync_functional_regions()
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.post("/api/map/regions/{region_id}/regenerate")
def regenerate_region(region_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    region = runtime.world.map.region_by_id(region_id)
    if region is None:
        raise HTTPException(status_code=404, detail="Region not found")
    prompt = str((payload or {}).get("prompt") or region.image_prompt or region.name)
    region.image_prompt = prompt
    region.notes = f"已为区域“{region.name}”创建局部重绘提示：{prompt}"
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.post("/api/maps/image")
async def upload_map_image(file: UploadFile = File(...)) -> dict[str, Any]:
    asset_name = _save_uploaded_asset(file, "map")
    runtime.world.map.background_image = f"/api/assets/{asset_name}"
    store.save_world(runtime.world)
    return {"asset": asset_name, "url": runtime.world.map.background_image}


@app.post("/api/assets")
async def upload_asset(file: UploadFile = File(...)) -> dict[str, Any]:
    asset_name = _save_uploaded_asset(file, "asset")
    return {"asset": asset_name, "url": f"/api/assets/{asset_name}"}


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


@app.patch("/api/agents/{agent_id}")
def patch_agent(agent_id: str, payload: AgentPatch) -> dict[str, Any]:
    profile = runtime.world.agent_profiles.get(agent_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    data = _payload_data(payload)
    for field_name, value in data.items():
        setattr(profile, field_name, value)
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.patch("/api/map/items/{item_id}")
def patch_item(item_id: str, payload: WorldItemPatch) -> dict[str, Any]:
    item = runtime.world.map.item_by_id(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    data = _payload_data(payload)
    if "position" in data:
        item.position = Point.from_dict(data.pop("position"))
    for field_name, value in data.items():
        setattr(item, field_name, value)
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


def _model_config_dict(payload: ModelConfigPayload) -> dict[str, Any]:
    return {
        "id": payload.id or "",
        "name": payload.name,
        "kind": payload.kind,
        "provider": payload.provider,
        "base_url": payload.base_url,
        "api_key": payload.api_key,
        "model": payload.model,
        "enabled": payload.enabled,
        "capabilities": payload.capabilities,
    }


def _public_model_config(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": config.get("id", ""),
        "name": config.get("name", ""),
        "kind": config.get("kind", "local"),
        "provider": config.get("provider", "mock"),
        "base_url": config.get("base_url", ""),
        "api_key": config.get("api_key", ""),
        "model": config.get("model", ""),
        "enabled": bool(config.get("enabled", True)),
        "capabilities": list(config.get("capabilities", [])),
    }


def _capability_status(
    capability: str,
    configs: list[dict[str, Any]],
    ollama_models: list[str],
    local_services: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    configured = _configured_model_for_capability(configs, capability)
    mock_config = _mock_model_for_capability(configs, capability)
    recommendation = _recommended_local_config(capability, ollama_models, local_services)
    label = {
        "llm": "语言模型 LLM",
        "image_generation": "图片生成",
        "segmentation": "SAM 分层",
    }.get(capability, capability)
    if configured:
        status = "ready"
        summary = f"已配置：{configured.get('name', '')}"
    elif recommendation:
        status = "local_available"
        summary = f"检测到可用本地方案：{recommendation['name']}"
    elif mock_config:
        status = "mock_only"
        summary = "当前只有测试 Mock，不能当作真实模型能力"
    else:
        status = "missing"
        summary = _missing_capability_message(capability)
    return {
        "id": capability,
        "label": label,
        "status": status,
        "summary": summary,
        "configured": configured is not None,
        "configured_model_id": configured.get("id") if configured else None,
        "configured_model_name": configured.get("name") if configured else None,
        "local_available": recommendation is not None,
        "recommended_local": _public_model_config(recommendation) if recommendation else None,
        "suggestions": _capability_suggestions(capability, ollama_models, local_services),
    }


def _configured_model_for_capability(configs: list[dict[str, Any]], capability: str) -> dict[str, Any] | None:
    return next(
        (
            config
            for config in configs
            if config.get("enabled", True)
            and config.get("provider") != "mock"
            and capability in set(config.get("capabilities", []))
        ),
        None,
    )


def _mock_model_for_capability(configs: list[dict[str, Any]], capability: str) -> dict[str, Any] | None:
    return next(
        (
            config
            for config in configs
            if config.get("enabled", True)
            and config.get("provider") == "mock"
            and capability in set(config.get("capabilities", []))
        ),
        None,
    )


def _recommended_local_config(
    capability: str,
    ollama_models: list[str],
    local_services: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    if capability == "llm":
        model = _preferred_model(ollama_models, ["qwen2.5:7b", "qwen2.5:1.5b", "gemma3:1b"])
        if not model:
            return None
        return {
            "id": "model_local_llm",
            "name": f"本地 LLM - {model}",
            "kind": "local",
            "provider": "ollama",
            "base_url": "http://127.0.0.1:11434",
            "api_key": "",
            "model": model,
            "enabled": True,
            "capabilities": ["llm"],
        }
    if capability == "image_generation":
        service = local_services.get("image_generation")
        if not service or not service.get("available"):
            return None
        return {
            "id": "model_local_image",
            "name": "本地图片生成",
            "kind": "local",
            "provider": service.get("provider", "local-http-image"),
            "base_url": service.get("base_url", ""),
            "api_key": "",
            "model": service.get("model", "local-image"),
            "enabled": True,
            "capabilities": ["image_generation"],
        }
    if capability == "segmentation":
        service = local_services.get("segmentation")
        if not service or not service.get("available"):
            return None
        return {
            "id": "model_local_sam",
            "name": "本地 SAM 分层",
            "kind": "local",
            "provider": "sam-http",
            "base_url": service.get("base_url", ""),
            "api_key": "",
            "model": service.get("model", "sam-local"),
            "enabled": True,
            "capabilities": ["segmentation"],
        }
    return None


def _recommended_vision_config(ollama_models: list[str]) -> dict[str, Any] | None:
    model = _preferred_model(ollama_models, ["qwen2.5vl:3b", "llava:7b"])
    if not model:
        return None
    return {
        "id": "model_local_vision",
        "name": f"本地图像识别 - {model}",
        "kind": "local",
        "provider": "ollama",
        "base_url": "http://127.0.0.1:11434",
        "api_key": "",
        "model": model,
        "enabled": True,
        "capabilities": ["vision_labeling"],
    }


def _remote_capability_config(capability: str, payload: CapabilityConfigurePayload) -> dict[str, Any]:
    labels = {
        "llm": ("model_remote_llm", "远程 LLM", "openai-compatible", ["llm"]),
        "image_generation": ("model_remote_image", "远程图片生成", "image-http", ["image_generation"]),
        "segmentation": ("model_remote_sam", "远程 SAM 分层", "sam-http", ["segmentation"]),
    }
    if capability not in labels:
        raise HTTPException(status_code=404, detail="Unknown capability")
    model_id, name, provider, capabilities = labels[capability]
    return {
        "id": model_id,
        "name": name,
        "kind": "remote",
        "provider": provider,
        "base_url": payload.base_url,
        "api_key": payload.api_key,
        "model": payload.model,
        "enabled": True,
        "capabilities": capabilities,
    }


def _upsert_model_config(configs: list[dict[str, Any]], config: dict[str, Any]) -> list[dict[str, Any]]:
    return [item for item in configs if item.get("id") != config.get("id")] + [config]


def _detect_ollama_models() -> list[str]:
    executable = shutil.which("ollama")
    if not executable:
        return []
    try:
        result = subprocess.run(
            [executable, "list"],
            capture_output=True,
            check=False,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if result.returncode != 0:
        return []
    models: list[str] = []
    for line in result.stdout.splitlines()[1:]:
        parts = line.split()
        if parts:
            models.append(parts[0])
    return models


def _detect_local_model_services() -> dict[str, dict[str, Any]]:
    image_url = os.getenv("AGENT_ENGINE_IMAGE_URL", "http://127.0.0.1:8188")
    sam_url = os.getenv("AGENT_ENGINE_SAM_URL", "http://127.0.0.1:8001/segment")
    return {
        "image_generation": {
            "available": _http_endpoint_reachable(image_url),
            "base_url": image_url,
            "provider": "local-http-image",
            "model": "local-image",
        },
        "segmentation": {
            "available": _http_endpoint_reachable(sam_url),
            "base_url": sam_url,
            "provider": "sam-http",
            "model": "sam-local",
        },
    }


def _http_endpoint_reachable(url: str) -> bool:
    try:
        request = urlrequest.Request(url, method="GET")
        with urlrequest.urlopen(request, timeout=0.6):
            return True
    except HTTPError:
        return True
    except (URLError, TimeoutError, ValueError, OSError):
        return False


def _preferred_model(models: list[str], candidates: list[str]) -> str | None:
    available = set(models)
    for candidate in candidates:
        if candidate in available:
            return candidate
    return models[0] if models else None


def _capability_suggestions(
    capability: str,
    ollama_models: list[str],
    local_services: dict[str, dict[str, Any]],
) -> list[str]:
    if capability == "llm":
        if ollama_models:
            return ["可以直接使用已安装的 Ollama 模型。"]
        return ["安装 Ollama 后拉取 qwen2.5:1.5b 或 gemma3:1b。"]
    if capability == "image_generation":
        if local_services.get("image_generation", {}).get("available"):
            return ["检测到本地图片生成服务，可以一键配置。"]
        return ["推荐后续接入本地 ComfyUI 或其他轻量图片生成 HTTP 服务。"]
    if capability == "segmentation":
        if local_services.get("segmentation", {}).get("available"):
            return ["检测到本地 SAM HTTP 服务，可以一键配置。"]
        return ["推荐启动一个本地 SAM HTTP 服务，并通过 AGENT_ENGINE_SAM_URL 或高级配置填写地址。"]
    return []


def _missing_capability_message(capability: str) -> str:
    messages = {
        "llm": "未检测到可用本地 LLM；建议安装 Ollama 并准备 qwen2.5:1.5b。",
        "image_generation": "未检测到本地图片生成服务；可先使用高级配置接入本地/远程 HTTP 服务。",
        "segmentation": "未检测到本地 SAM 服务；请启动 SAM HTTP 服务或填写高级 API 地址。",
    }
    return messages.get(capability, "未检测到可用本地能力")


def _find_enabled_model(capability: str) -> dict[str, Any] | None:
    return next(
        (
            config
            for config in store.load_model_configs()
            if config.get("enabled", True) and capability in set(config.get("capabilities", []))
        ),
        None,
    )


def _segmentation_state(
    config: dict[str, Any],
    *,
    mode: str,
    region_count: int,
    stage: str,
    progress: int,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "status": "error" if error else "done",
        "progress": max(0, min(100, progress)),
        "stage": "error" if error else stage,
        "provider_id": config.get("id", ""),
        "provider_name": config.get("name", ""),
        "error": error,
        "region_count": region_count,
        "mode": mode,
    }


def _call_http_sam_provider(config: dict[str, Any], world_map: WorldMap) -> list[MapRegion]:
    base_url = str(config.get("base_url", "")).strip()
    if not base_url:
        raise HTTPException(status_code=400, detail="SAM 分层模型缺少 HTTP 地址")
    body = {
        "image": world_map.background_image,
        "image_path": _asset_path_for_url(world_map.background_image),
        "width": world_map.width,
        "height": world_map.height,
        "model": config.get("model", ""),
        "map_id": world_map.id,
    }
    payload = json.dumps(body).encode("utf-8")
    http_request = urlrequest.Request(
        base_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(http_request, timeout=float(os.getenv("AGENT_ENGINE_SAM_TIMEOUT", "60"))) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"SAM HTTP 服务错误：{exc.code}") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail=f"SAM HTTP 服务不可用：{exc}") from exc
    return _regions_from_provider_response(data, config)


def _asset_path_for_url(url: str | None) -> str | None:
    if not url or not url.startswith("/api/assets/"):
        return None
    asset_name = url.rsplit("/", 1)[-1]
    path = (store.assets_dir / asset_name).resolve()
    if str(path).startswith(str(store.assets_dir.resolve())) and path.exists():
        return str(path)
    return None


def _regions_from_provider_response(data: Any, config: dict[str, Any]) -> list[MapRegion]:
    raw_regions = data.get("regions") if isinstance(data, dict) else data
    if raw_regions is None and isinstance(data, dict):
        raw_regions = data.get("masks")
    if not isinstance(raw_regions, list):
        return []
    regions: list[MapRegion] = []
    for index, raw in enumerate(raw_regions):
        if not isinstance(raw, dict):
            continue
        points = _points_from_region_payload(raw)
        if len(points) < 3:
            continue
        regions.append(
            MapRegion(
                id=str(raw.get("id") or new_id("region")),
                name=str(raw.get("name") or raw.get("label") or f"SAM 分区 {index + 1}"),
                function=str(raw.get("function") or "unassigned"),
                source=str(raw.get("source") or config.get("id") or "sam_http"),
                points=points,
                image_prompt=str(raw.get("image_prompt") or raw.get("imagePrompt") or ""),
                notes=str(raw.get("notes") or raw.get("description") or ""),
                confidence=float(raw.get("confidence") or 0),
                tags=list(raw.get("tags") or []),
            )
        )
    return regions


def _points_from_region_payload(raw: dict[str, Any]) -> list[Point]:
    point_payload = raw.get("points") or raw.get("polygon")
    if point_payload is None and isinstance(raw.get("polygons"), list) and raw["polygons"]:
        point_payload = raw["polygons"][0]
    if not isinstance(point_payload, list):
        return []
    points: list[Point] = []
    for point in point_payload:
        if isinstance(point, dict) and "x" in point and "y" in point:
            points.append(Point.from_dict(point))
        elif isinstance(point, (list, tuple)) and len(point) >= 2:
            points.append(Point(float(point[0]), float(point[1])))
    return points


def _postprocess_regions(regions: list[MapRegion]) -> list[MapRegion]:
    next_regions: list[MapRegion] = []
    for region in regions:
        smoothed = _smooth_polygon_points(region.points)
        if len(smoothed) >= 3:
            region.points = smoothed
            next_regions.append(region)
    return next_regions


def _smooth_polygon_points(points: list[Point], iterations: int = 2) -> list[Point]:
    clean = _remove_near_duplicate_points(points)
    clean = _remove_nearly_collinear_points(clean)
    if len(clean) < 4:
        return clean
    smoothed = clean
    for _ in range(iterations):
        smoothed = _chaikin_closed_polygon(smoothed)
    if len(smoothed) > 160:
        step = math.ceil(len(smoothed) / 160)
        smoothed = smoothed[::step]
    return _remove_near_duplicate_points(smoothed)


def _remove_near_duplicate_points(points: list[Point], min_distance: float = 2.0) -> list[Point]:
    clean: list[Point] = []
    for point in points:
        if not clean or _distance(clean[-1], point) >= min_distance:
            clean.append(point)
    if len(clean) > 1 and _distance(clean[0], clean[-1]) < min_distance:
        clean.pop()
    return clean


def _remove_nearly_collinear_points(points: list[Point], epsilon: float = 0.015) -> list[Point]:
    if len(points) < 4:
        return points
    kept: list[Point] = []
    for index, current in enumerate(points):
        previous = points[index - 1]
        following = points[(index + 1) % len(points)]
        area = abs(
            (current.x - previous.x) * (following.y - previous.y)
            - (current.y - previous.y) * (following.x - previous.x)
        )
        base = max(1.0, _distance(previous, following))
        if area / base > epsilon:
            kept.append(current)
    return kept if len(kept) >= 3 else points


def _chaikin_closed_polygon(points: list[Point]) -> list[Point]:
    next_points: list[Point] = []
    for index, point in enumerate(points):
        following = points[(index + 1) % len(points)]
        next_points.append(Point(point.x * 0.75 + following.x * 0.25, point.y * 0.75 + following.y * 0.25))
        next_points.append(Point(point.x * 0.25 + following.x * 0.75, point.y * 0.25 + following.y * 0.75))
    return next_points


def _distance(a: Point, b: Point) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def _mock_generated_candidate(
    generation_id: str, index: int, prompt: str, width: int, height: int
) -> dict[str, Any]:
    import html

    asset_name = f"{generation_id}_{index + 1}.svg"
    destination = store.assets_dir / asset_name
    store.initialize()
    hue = (index * 62 + len(prompt) * 7) % 360
    title = html.escape(prompt[:80] or "生成式游戏地图")
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl({hue}, 36%, 78%)"/>
      <stop offset="1" stop-color="hsl({(hue + 84) % 360}, 34%, 64%)"/>
    </linearGradient>
    <pattern id="tiles" width="96" height="96" patternUnits="userSpaceOnUse">
      <path d="M0 0H96V96H0Z" fill="none" stroke="rgba(20,20,20,.12)" stroke-width="2"/>
      <path d="M0 48H96M48 0V96" stroke="rgba(255,255,255,.22)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#tiles)" opacity=".72"/>
  <path d="M{width*.08:.0f} {height*.62:.0f} C {width*.28:.0f} {height*.44:.0f}, {width*.52:.0f} {height*.7:.0f}, {width*.9:.0f} {height*.42:.0f}" fill="none" stroke="rgba(36,36,36,.42)" stroke-width="{max(18, width*.018):.0f}" stroke-linecap="round"/>
  <rect x="{width*.1:.0f}" y="{height*.12:.0f}" width="{width*.24:.0f}" height="{height*.24:.0f}" rx="18" fill="rgba(255,255,255,.24)" stroke="rgba(20,20,20,.22)" stroke-width="4"/>
  <rect x="{width*.62:.0f}" y="{height*.16:.0f}" width="{width*.25:.0f}" height="{height*.28:.0f}" rx="22" fill="rgba(255,255,255,.2)" stroke="rgba(20,20,20,.2)" stroke-width="4"/>
  <circle cx="{width*.46:.0f}" cy="{height*.36:.0f}" r="{min(width,height)*.09:.0f}" fill="rgba(255,255,255,.18)" stroke="rgba(20,20,20,.18)" stroke-width="4"/>
  <text x="32" y="{height - 32}" fill="rgba(20,20,20,.36)" font-family="Arial" font-size="28">{title}</text>
</svg>"""
    destination.write_text(svg, encoding="utf-8")
    return {
        "id": f"{generation_id}_candidate_{index + 1}",
        "url": f"/api/assets/{asset_name}",
        "prompt": prompt,
        "width": width,
        "height": height,
        "provider_id": "model_mock_image",
    }


def _mock_regions(width: int, height: int, source: str = "mock_sam") -> list[MapRegion]:
    return [
        MapRegion(
            id=new_id("region"),
            name="主道路",
            function="walkable",
            source=source,
            points=[
                Point(width * 0.06, height * 0.58),
                Point(width * 0.28, height * 0.47),
                Point(width * 0.54, height * 0.62),
                Point(width * 0.9, height * 0.38),
                Point(width * 0.93, height * 0.48),
                Point(width * 0.55, height * 0.74),
                Point(width * 0.28, height * 0.58),
                Point(width * 0.08, height * 0.69),
            ],
            notes="SAM mock 识别为主要移动路径。",
            confidence=0.86,
            tags=["道路", "移动"],
        ),
        MapRegion(
            id=new_id("region"),
            name="左上居住区",
            function="residential",
            source=source,
            points=[
                Point(width * 0.1, height * 0.12),
                Point(width * 0.34, height * 0.12),
                Point(width * 0.34, height * 0.36),
                Point(width * 0.1, height * 0.36),
            ],
            notes="适合放置 agent 起居和身份相关物件。",
            confidence=0.78,
            tags=["居住"],
        ),
        MapRegion(
            id=new_id("region"),
            name="右侧社交广场",
            function="social",
            source=source,
            points=[
                Point(width * 0.62, height * 0.16),
                Point(width * 0.87, height * 0.16),
                Point(width * 0.87, height * 0.44),
                Point(width * 0.62, height * 0.44),
            ],
            notes="开放区域，适合社交、对话和公共事件。",
            confidence=0.82,
            tags=["社交", "公共"],
        ),
        MapRegion(
            id=new_id("region"),
            name="中心景观障碍",
            function="obstacle",
            source=source,
            points=[
                Point(width * 0.41, height * 0.28),
                Point(width * 0.51, height * 0.28),
                Point(width * 0.56, height * 0.37),
                Point(width * 0.5, height * 0.47),
                Point(width * 0.4, height * 0.45),
                Point(width * 0.36, height * 0.36),
            ],
            notes="中心实体结构，默认不可穿过。",
            confidence=0.8,
            tags=["障碍"],
        ),
    ]


def _payload_data(payload: BaseModel) -> dict[str, Any]:
    if hasattr(payload, "model_dump"):
        return payload.model_dump(exclude_unset=True)
    return payload.dict(exclude_unset=True)


def _save_uploaded_asset(file: UploadFile, prefix: str) -> str:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg"}:
        raise HTTPException(status_code=400, detail="Only PNG and JPG assets are supported.")
    asset_name = f"{new_id(prefix)}{suffix}"
    destination = store.assets_dir / asset_name
    store.initialize()
    with destination.open("wb") as output:
        shutil.copyfileobj(file.file, output)
    return asset_name
