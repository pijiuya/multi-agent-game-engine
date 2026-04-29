from __future__ import annotations

import os
import shutil
import asyncio
import base64
import hashlib
import importlib.util
import json
import math
import subprocess
import sys
import threading
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
    DEFAULT_ACTION_SPACE,
    GameWorld,
    MapRegion,
    Point,
    PolygonArea,
    WorldItem,
    WorldMap,
    new_id,
    normalize_action_space,
    normalize_agent_animation,
    normalize_dialogue_policy,
)
from agent_engine.models.provider import MockProvider, OllamaProvider, OpenAICompatibleProvider
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
    hidden: bool | None = None
    animation: dict[str, Any] | None = None
    dialogue_policy: dict[str, Any] | None = None


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
    hidden: bool | None = None
    movable: bool | None = None


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
    hidden: bool | None = None


class RegionCreate(BaseModel):
    name: str = "手绘区域"
    points: list[dict[str, float]]
    holes: list[list[dict[str, float]]] = Field(default_factory=list)
    function: str = "unassigned"
    image_prompt: str = ""
    notes: str = ""
    tags: list[str] = Field(default_factory=list)


class RegionBooleanPayload(BaseModel):
    target_ids: list[str] = Field(default_factory=list)
    target_function: str | None = None
    operation: str = "union"
    points: list[dict[str, float]]
    holes: list[list[dict[str, float]]] = Field(default_factory=list)


REGION_FUNCTION_LABELS = {
    "walkable": "道路",
    "obstacle": "不可通过",
    "action": "行动区",
    "residential": "居住区",
    "social": "社交区",
    "custom": "自定义",
    "unassigned": "未设定",
}
REGION_FUNCTIONS = set(REGION_FUNCTION_LABELS)


generation_tasks: dict[str, dict[str, Any]] = {}
capability_tasks: dict[str, dict[str, Any]] = {}
capability_tasks_lock = threading.Lock()
embedded_sam_cache: dict[str, Any] = {}

MOBILE_SAM_PROVIDER = "embedded-mobile-sam"
MOBILE_SAM_MODEL_ID = "model_local_sam_embedded"
MOBILE_SAM_WEIGHT_NAME = "mobile_sam.pt"
MOBILE_SAM_WEIGHT_SHA256 = "6dbb90523a35330fedd7f1d3dfc66f995213d81b29a5ca8108dbcdd4e37d6c2f"
MOBILE_SAM_WEIGHT_URLS = [
    "https://github.com/ChaoningZhang/MobileSAM/raw/master/weights/mobile_sam.pt",
    "https://huggingface.co/dhkim2810/MobileSAM/resolve/main/mobile_sam.pt",
    "https://huggingface.co/RogerQi/MobileSAMV2/resolve/main/mobile_sam.pt",
]


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
    _sync_runtime_model_providers()
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
    _sync_runtime_model_providers()
    return {"models": [_public_model_config(item) for item in configs], "model": _public_model_config(config)}


@app.patch("/api/models/{model_id}")
def patch_model(model_id: str, payload: ModelConfigPatch) -> dict[str, Any]:
    configs = store.load_model_configs()
    for index, config in enumerate(configs):
        if config["id"] == model_id:
            next_config = {**config, **_payload_data(payload), "id": model_id}
            configs[index] = next_config
            store.save_model_configs(configs)
            _sync_runtime_model_providers()
            return {"models": [_public_model_config(item) for item in configs], "model": _public_model_config(next_config)}
    raise HTTPException(status_code=404, detail="Model config not found")


@app.delete("/api/models/{model_id}")
def delete_model(model_id: str) -> dict[str, Any]:
    configs = store.load_model_configs()
    next_configs = [config for config in configs if config["id"] != model_id]
    if len(next_configs) == len(configs):
        raise HTTPException(status_code=404, detail="Model config not found")
    store.save_model_configs(next_configs)
    _sync_runtime_model_providers()
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
    next_configs = _prefer_model_for_capability(next_configs, capability, recommendation.get("id", ""))
    if capability == "llm":
        vision_config = _recommended_vision_config(ollama_models)
        if vision_config:
            next_configs = _upsert_model_config(next_configs, vision_config)
    store.save_model_configs(next_configs)
    _sync_runtime_model_providers()
    return {
        "models": [_public_model_config(config) for config in next_configs],
        "capability": _capability_status(capability, next_configs, ollama_models, local_services),
    }


@app.post("/api/model-capabilities/{capability}/install-local")
def install_local_capability(capability: str) -> dict[str, Any]:
    if capability != "segmentation":
        raise HTTPException(status_code=400, detail="当前只有 SAM 分层支持内置安装")
    if _embedded_mobile_sam_ready():
        configs = _upsert_model_config(store.load_model_configs(), _embedded_mobile_sam_config())
        configs = _prefer_model_for_capability(configs, capability, MOBILE_SAM_MODEL_ID)
        store.save_model_configs(configs)
        task = _create_capability_task(capability, title="内置 MobileSAM 已可用")
        _set_capability_task(
            task["id"],
            status="done",
            stage="done",
            progress=100,
            message="内置 MobileSAM 已启用",
        )
        task = _get_capability_task(task["id"])
        return {"task": task, "models": [_public_model_config(config) for config in configs]}

    task = _create_capability_task(capability, title="安装并启用内置 MobileSAM")
    _start_embedded_sam_install_task(task["id"])
    return {"task": task}


@app.get("/api/model-capabilities/tasks/{task_id}")
def get_model_capability_task(task_id: str) -> dict[str, Any]:
    task = _get_capability_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Model capability task not found")
    return {"task": task}


@app.post("/api/model-capabilities/{capability}/configure-remote")
def configure_remote_capability(capability: str, payload: CapabilityConfigurePayload) -> dict[str, Any]:
    config = _remote_capability_config(capability, payload)
    configs = _upsert_model_config(store.load_model_configs(), config)
    store.save_model_configs(configs)
    _sync_runtime_model_providers()
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
    if provider == MOBILE_SAM_PROVIDER:
        return {
            "ok": _embedded_mobile_sam_ready(),
            "provider": provider,
            "message": "内置 MobileSAM 可用" if _embedded_mobile_sam_ready() else "内置 MobileSAM 尚未安装",
        }
    if provider != "mock" and not config.get("base_url"):
        return {"ok": False, "provider": provider, "message": "缺少服务地址"}
    return {
        "ok": bool(config.get("enabled", True)),
        "provider": provider,
        "message": "测试 Mock 可用" if provider == "mock" else "模型服务已配置",
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
    elif provider == MOBILE_SAM_PROVIDER:
        regions = _call_embedded_mobile_sam_provider(config, runtime.world.map)
        mode = "embedded"
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


@app.post("/api/map/regions")
def create_region(payload: RegionCreate) -> dict[str, Any]:
    points = [Point.from_dict(point) for point in payload.points]
    holes = [
        [Point.from_dict(point) for point in hole]
        for hole in payload.holes
    ]
    if len(points) < 3:
        raise HTTPException(status_code=400, detail="区域至少需要 3 个点")
    if payload.function not in REGION_FUNCTIONS:
        raise HTTPException(status_code=400, detail="未知区域功能")
    region = MapRegion(
        id=new_id("region"),
        name=payload.name,
        points=points,
        holes=holes,
        source="manual",
        function=payload.function,
        image_prompt=payload.image_prompt,
        notes=payload.notes or "手绘区域。",
        confidence=1.0,
        tags=payload.tags or ["手绘"],
    )
    runtime.world.map.regions = _normalize_region_overlaps(
        [region, *runtime.world.map.regions],
        priority_functions=[region.function],
        priority_ids=[region.id],
    )
    runtime.world.map.sync_functional_regions()
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.post("/api/map/regions/boolean")
def boolean_regions(payload: RegionBooleanPayload) -> dict[str, Any]:
    if payload.operation not in {"union", "subtract"}:
        raise HTTPException(status_code=400, detail="区域布尔操作只支持 union/subtract")
    brush = _polygon_from_points(
        [Point.from_dict(point) for point in payload.points],
        [
            [Point.from_dict(point) for point in hole]
            for hole in payload.holes
        ],
    )
    if brush.is_empty:
        raise HTTPException(status_code=400, detail="绘制区域无效")
    if payload.target_function:
        if payload.target_function not in REGION_FUNCTIONS:
            raise HTTPException(status_code=400, detail="未知区域功能")
        if payload.operation == "union":
            label = REGION_FUNCTION_LABELS[payload.target_function]
            region = MapRegion(
                id=new_id("region"),
                name=f"{label}手绘区域",
                points=[Point.from_dict(point) for point in payload.points],
                holes=[
                    [Point.from_dict(point) for point in hole]
                    for hole in payload.holes
                ],
                source="manual",
                function=payload.target_function,
                notes=f"手绘增加到{label}。",
                confidence=1.0,
                tags=["手绘", label],
            )
            runtime.world.map.regions = _normalize_region_overlaps(
                [region, *runtime.world.map.regions],
                priority_functions=[payload.target_function],
                priority_ids=[region.id],
            )
        else:
            target_ids = [region.id for region in runtime.world.map.regions if region.function == payload.target_function and not region.hidden]
            if not target_ids:
                raise HTTPException(status_code=404, detail="目标功能层没有可扣减区域")
            runtime.world.map.regions = _apply_region_boolean(
                runtime.world.map.regions,
                target_ids=target_ids,
                brush=brush,
                operation="subtract",
                priority_functions=[payload.target_function],
            )
        runtime.world.map.sync_functional_regions()
        store.save_world(runtime.world)
        return runtime.snapshot()
    target_ids = [region_id for region_id in payload.target_ids if runtime.world.map.region_by_id(region_id)]
    if not target_ids:
        raise HTTPException(status_code=404, detail="没有找到可编辑区域")
    target_region = runtime.world.map.region_by_id(target_ids[0])
    runtime.world.map.regions = _apply_region_boolean(
        runtime.world.map.regions,
        target_ids=target_ids,
        brush=brush,
        operation=payload.operation,
        priority_functions=[target_region.function] if target_region else None,
    )
    runtime.world.map.sync_functional_regions()
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.patch("/api/map/regions/{region_id}")
def patch_region(region_id: str, payload: RegionPatch) -> dict[str, Any]:
    region = runtime.world.map.region_by_id(region_id)
    if region is None:
        raise HTTPException(status_code=404, detail="Region not found")
    data = _payload_data(payload)
    if "function" in data and data["function"] not in REGION_FUNCTIONS:
        raise HTTPException(status_code=400, detail="未知区域功能")
    for field_name, value in data.items():
        setattr(region, field_name, value)
    if "function" in data:
        runtime.world.map.regions = _normalize_region_overlaps(
            runtime.world.map.regions,
            priority_functions=[region.function],
            priority_ids=[region.id],
        )
    runtime.world.map.sync_functional_regions()
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.delete("/api/map/regions/{region_id}")
def delete_region(region_id: str) -> dict[str, Any]:
    region = runtime.world.map.region_by_id(region_id)
    if region is None:
        raise HTTPException(status_code=404, detail="Region not found")
    runtime.world.map.regions = [candidate for candidate in runtime.world.map.regions if candidate.id != region_id]
    runtime.world.map.sync_functional_regions()
    runtime.world.add_event("system", f"区域 {region.name} 已删除。")
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


@app.post("/api/map/regions/{region_id}/auto-label")
def auto_label_region(region_id: str) -> dict[str, Any]:
    region = runtime.world.map.region_by_id(region_id)
    if region is None:
        raise HTTPException(status_code=404, detail="Region not found")
    config = _find_enabled_model("vision_labeling")
    if config is None:
        raise HTTPException(status_code=400, detail="未配置图像识别模型")
    label = _label_region_with_model(config, runtime.world.map, region)
    region.name = label["name"]
    region.notes = label["notes"]
    region.tags = label["tags"]
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
        action_space=payload.action_space or list(DEFAULT_ACTION_SPACE),
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
        if field_name == "animation":
            value = normalize_agent_animation(value)
        if field_name == "dialogue_policy":
            value = normalize_dialogue_policy(value)
        if field_name == "action_space":
            value = normalize_action_space(value)
        setattr(profile, field_name, value)
    store.save_world(runtime.world)
    return runtime.snapshot()


@app.delete("/api/agents/{agent_id}")
def delete_agent(agent_id: str) -> dict[str, Any]:
    profile = runtime.world.agent_profiles.get(agent_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    runtime.world.agent_profiles.pop(agent_id, None)
    runtime.world.agent_states.pop(agent_id, None)
    runtime.world.relationships = [
        relationship
        for relationship in runtime.world.relationships
        if relationship.from_agent != agent_id and relationship.to_agent != agent_id
    ]
    runtime.world.memories = [memory for memory in runtime.world.memories if memory.agent_id != agent_id]
    runtime.world.add_event("system", f"Agent {profile.name} 已删除。", agent_id=agent_id)
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


@app.delete("/api/map/items/{item_id}")
def delete_item(item_id: str) -> dict[str, Any]:
    item = runtime.world.map.item_by_id(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    runtime.world.map.items = [candidate for candidate in runtime.world.map.items if candidate.id != item_id]
    runtime.world.add_event("system", f"元素 {item.name} 已删除。")
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


def _sync_runtime_model_providers() -> None:
    providers = {"mock": MockProvider()}
    default_provider_id = "mock"
    for config in store.load_model_configs():
        if not config.get("enabled", True) or "llm" not in set(config.get("capabilities", [])):
            continue
        provider = _runtime_provider_from_model_config(config, providers["mock"])
        if provider is None:
            continue
        provider_id = str(config.get("id") or config.get("provider") or "mock")
        providers[provider_id] = provider
        provider_name = str(config.get("provider") or "mock")
        providers.setdefault(provider_name, provider)
        if provider_name != "mock" and default_provider_id == "mock":
            default_provider_id = provider_id
    runtime.providers = providers
    runtime.default_provider_id = default_provider_id


def _runtime_provider_from_model_config(config: dict[str, Any], mock_provider: MockProvider):
    provider = str(config.get("provider") or "mock")
    if provider == "mock":
        return mock_provider
    if provider == "ollama":
        return OllamaProvider(
            base_url=str(config.get("base_url") or "http://127.0.0.1:11434"),
            model=str(config.get("model") or "llama3.1"),
        )
    if provider == "openai-compatible":
        base_url = str(config.get("base_url") or "").strip()
        model = str(config.get("model") or "").strip()
        if not base_url or not model:
            return None
        return OpenAICompatibleProvider(
            base_url=base_url,
            api_key=str(config.get("api_key") or ""),
            model=model,
        )
    return None


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
    non_embedded_sam = (
        capability == "segmentation"
        and configured is not None
        and configured.get("provider") != MOBILE_SAM_PROVIDER
    )
    embedded_unavailable = (
        capability == "segmentation"
        and configured is not None
        and configured.get("provider") == MOBILE_SAM_PROVIDER
        and not _embedded_mobile_sam_ready()
    )
    if configured and not embedded_unavailable and not non_embedded_sam:
        status = "ready"
        summary = f"已配置：{configured.get('name', '')}"
    elif recommendation:
        status = "local_available"
        summary = f"检测到可用本地方案：{recommendation['name']}"
    elif mock_config:
        status = "mock_only"
        summary = "当前只有测试 Mock，不能当作真实模型能力"
    elif capability == "segmentation":
        status = "installable"
        summary = "可安装内置 MobileSAM，本机完成分层，无需服务地址"
        if embedded_unavailable:
            summary = "内置 MobileSAM 配置存在但依赖不完整；请重新安装"
        elif non_embedded_sam:
            summary = "当前使用外部 SAM 备用配置；建议安装内置 MobileSAM"
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
        "installable": (
            capability == "segmentation"
            and recommendation is None
            and (configured is None or embedded_unavailable or non_embedded_sam)
        ),
        "suggestions": _capability_suggestions(capability, ollama_models, local_services),
    }


def _configured_model_for_capability(configs: list[dict[str, Any]], capability: str) -> dict[str, Any] | None:
    matching = [
        config
        for config in configs
        if config.get("enabled", True)
        and config.get("provider") != "mock"
        and capability in set(config.get("capabilities", []))
    ]
    if capability == "segmentation":
        embedded = next((config for config in matching if config.get("provider") == MOBILE_SAM_PROVIDER), None)
        if embedded:
            return embedded
    return matching[0] if matching else None


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
        if _embedded_mobile_sam_ready():
            return _embedded_mobile_sam_config()
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


def _prefer_model_for_capability(
    configs: list[dict[str, Any]],
    capability: str,
    preferred_id: str,
) -> list[dict[str, Any]]:
    next_configs: list[dict[str, Any]] = []
    for config in configs:
        updated = dict(config)
        if capability in set(updated.get("capabilities", [])):
            updated["enabled"] = updated.get("id") == preferred_id
        next_configs.append(updated)
    return next_configs


def _create_capability_task(capability: str, title: str) -> dict[str, Any]:
    task = {
        "id": new_id("model_task"),
        "capability": capability,
        "title": title,
        "status": "running",
        "stage": "checking",
        "progress": 1,
        "message": "准备检查本机环境",
        "error": None,
    }
    with capability_tasks_lock:
        capability_tasks[task["id"]] = task
    return dict(task)


def _get_capability_task(task_id: str) -> dict[str, Any] | None:
    with capability_tasks_lock:
        task = capability_tasks.get(task_id)
        return dict(task) if task else None


def _set_capability_task(
    task_id: str,
    *,
    status: str | None = None,
    stage: str | None = None,
    progress: int | None = None,
    message: str | None = None,
    error: str | None = None,
) -> None:
    with capability_tasks_lock:
        task = capability_tasks.get(task_id)
        if not task:
            return
        if status is not None:
            task["status"] = status
        if stage is not None:
            task["stage"] = stage
        if progress is not None:
            task["progress"] = max(0, min(100, int(progress)))
        if message is not None:
            task["message"] = message
        if error is not None:
            task["error"] = error


def _start_embedded_sam_install_task(task_id: str) -> None:
    thread = threading.Thread(target=_run_embedded_sam_install_task, args=(task_id,), daemon=True)
    thread.start()


def _run_embedded_sam_install_task(task_id: str) -> None:
    try:
        _set_capability_task(task_id, stage="checking", progress=8, message="检查 Python 和本地模型目录")
        _embedded_mobile_sam_model_dir().mkdir(parents=True, exist_ok=True)

        if not _python_module_available("torch"):
            _set_capability_task(task_id, stage="install_torch", progress=18, message="安装 Torch CUDA 版")
            if not _pip_install(["torch", "torchvision", "--index-url", "https://download.pytorch.org/whl/cu121"]):
                _set_capability_task(task_id, stage="install_torch", progress=28, message="CUDA 版失败，回退安装 CPU 版")
                if not _pip_install(["torch", "torchvision", "--index-url", "https://download.pytorch.org/whl/cpu"]):
                    raise RuntimeError("Torch 安装失败，请检查网络或 Python 环境。")

        if not _python_module_available("mobile_sam"):
            _set_capability_task(task_id, stage="install_mobile_sam", progress=45, message="安装 MobileSAM 代码")
            if not _pip_install(["git+https://github.com/ChaoningZhang/MobileSAM.git"]):
                if not _pip_install(["https://github.com/ChaoningZhang/MobileSAM/archive/refs/heads/master.zip"]):
                    raise RuntimeError("MobileSAM 安装失败，请检查网络或 GitHub 访问。")
        if not _python_module_available("timm"):
            _set_capability_task(task_id, stage="install_mobile_sam", progress=56, message="安装 MobileSAM 依赖 timm")
            if not _pip_install(["timm"]):
                raise RuntimeError("timm 安装失败，请检查网络或 Python 环境。")

        _set_capability_task(task_id, stage="download_weights", progress=68, message="下载 MobileSAM 权重")
        _download_mobile_sam_weights()

        _set_capability_task(task_id, stage="verify", progress=88, message="验证内置 MobileSAM")
        if not _embedded_mobile_sam_ready():
            raise RuntimeError("MobileSAM 验证失败，请重试安装。")

        configs = _upsert_model_config(store.load_model_configs(), _embedded_mobile_sam_config())
        configs = _prefer_model_for_capability(configs, "segmentation", MOBILE_SAM_MODEL_ID)
        store.save_model_configs(configs)
        _set_capability_task(
            task_id,
            status="done",
            stage="done",
            progress=100,
            message="内置 MobileSAM 已启用",
            error="",
        )
    except Exception as exc:  # pragma: no cover - failures are surfaced through the task API.
        _set_capability_task(
            task_id,
            status="error",
            stage="error",
            progress=100,
            message="内置 MobileSAM 安装失败",
            error=str(exc),
        )


def _pip_install(args: list[str]) -> bool:
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", *args],
            capture_output=True,
            check=False,
            encoding="utf-8",
            errors="replace",
            timeout=1800,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    if result.returncode == 0:
        importlib.invalidate_caches()
        return True
    return False


def _python_module_available(module: str) -> bool:
    importlib.invalidate_caches()
    return importlib.util.find_spec(module) is not None


def _embedded_mobile_sam_model_dir() -> Path:
    return store.project_dir / "models" / "mobile_sam"


def _embedded_mobile_sam_weight_path() -> Path:
    return _embedded_mobile_sam_model_dir() / MOBILE_SAM_WEIGHT_NAME


def _embedded_mobile_sam_ready() -> bool:
    return (
        _python_module_available("torch")
        and _python_module_available("mobile_sam")
        and _python_module_available("timm")
        and _valid_mobile_sam_weight(_embedded_mobile_sam_weight_path())
    )


def _embedded_mobile_sam_config() -> dict[str, Any]:
    return {
        "id": MOBILE_SAM_MODEL_ID,
        "name": "内置 MobileSAM",
        "kind": "local",
        "provider": MOBILE_SAM_PROVIDER,
        "base_url": "",
        "api_key": "",
        "model": "vit_t",
        "enabled": True,
        "capabilities": ["segmentation"],
    }


def _download_mobile_sam_weights() -> Path:
    destination = _embedded_mobile_sam_weight_path()
    if _valid_mobile_sam_weight(destination):
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    for url in MOBILE_SAM_WEIGHT_URLS:
        try:
            temporary = destination.with_suffix(".pt.part")
            if temporary.exists():
                temporary.unlink()
            with urlrequest.urlopen(url, timeout=120) as response, temporary.open("wb") as output:
                shutil.copyfileobj(response, output)
            if _valid_mobile_sam_weight(temporary):
                temporary.replace(destination)
                return destination
            temporary.unlink(missing_ok=True)
            errors.append(f"{url} 校验失败")
        except (OSError, URLError, HTTPError, TimeoutError) as exc:
            errors.append(f"{url} 下载失败：{exc}")
    raise RuntimeError("MobileSAM 权重下载失败：" + "；".join(errors[:2]))


def _valid_mobile_sam_weight(path: Path) -> bool:
    if not path.exists() or path.stat().st_size < 10_000_000:
        return False
    if not MOBILE_SAM_WEIGHT_SHA256:
        return True
    return _sha256_file(path) == MOBILE_SAM_WEIGHT_SHA256


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as input_file:
        for chunk in iter(lambda: input_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
        return ["可先导入图片或使用测试候选；需要真生成时，推荐接入本地 ComfyUI 等图片生成器。"]
    if capability == "segmentation":
        if _embedded_mobile_sam_ready():
            return ["内置 MobileSAM 已安装，可以一键启用。"]
        if local_services.get("segmentation", {}).get("available"):
            return ["检测到本地 SAM 分层服务，可以一键配置。"]
        return ["推荐直接点击安装内置 MobileSAM；完成后无需配置服务地址。"]
    return []


def _missing_capability_message(capability: str) -> str:
    messages = {
        "llm": "未检测到可用本地 LLM；建议安装 Ollama 并准备 qwen2.5:1.5b。",
        "image_generation": "未检测到本地图片生成器；可先导入图片，或在高级配置接入图片生成服务。",
        "segmentation": "未检测到可直接启用的 SAM；可以安装内置 MobileSAM。",
    }
    return messages.get(capability, "未检测到可用本地能力")


def _find_enabled_model(capability: str) -> dict[str, Any] | None:
    matching = [
        config
        for config in store.load_model_configs()
        if config.get("enabled", True) and capability in set(config.get("capabilities", []))
    ]
    if capability == "segmentation":
        embedded = next((config for config in matching if config.get("provider") == MOBILE_SAM_PROVIDER), None)
        if embedded:
            return embedded
    return matching[0] if matching else None


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


def _call_embedded_mobile_sam_provider(config: dict[str, Any], world_map: WorldMap) -> list[MapRegion]:
    image_path = _asset_path_for_url(world_map.background_image)
    if not image_path:
        raise HTTPException(status_code=400, detail="内置 MobileSAM 需要本地地图图片文件")
    if Path(image_path).suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        raise HTTPException(status_code=400, detail="内置 MobileSAM 暂只支持 PNG/JPG 地图背景")
    if not _embedded_mobile_sam_ready():
        raise HTTPException(status_code=400, detail="内置 MobileSAM 尚未安装，请先在模型管理中安装")

    try:
        import cv2
        import numpy as np
        import torch
        from mobile_sam import SamAutomaticMaskGenerator, sam_model_registry
    except ImportError as exc:
        raise HTTPException(status_code=400, detail=f"内置 MobileSAM 缺少依赖：{exc}") from exc

    image_bgr = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise HTTPException(status_code=400, detail="无法读取地图背景图片")
    original_height, original_width = image_bgr.shape[:2]
    max_side = max(original_width, original_height)
    scale = min(1.0, 1280 / max(1, max_side))
    if scale < 1.0:
        image_bgr = cv2.resize(
            image_bgr,
            (max(1, int(original_width * scale)), max(1, int(original_height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

    cache_key = str(_embedded_mobile_sam_weight_path())
    model = embedded_sam_cache.get(cache_key)
    if model is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = sam_model_registry["vit_t"](checkpoint=cache_key)
        model.to(device=device)
        model.eval()
        embedded_sam_cache[cache_key] = model

    generator = SamAutomaticMaskGenerator(
        model,
        points_per_side=24,
        pred_iou_thresh=0.86,
        stability_score_thresh=0.88,
        crop_n_layers=0,
        min_mask_region_area=96,
    )
    raw_masks = generator.generate(image_rgb)
    raw_masks = sorted(raw_masks, key=lambda item: float(item.get("area", 0)), reverse=True)
    regions: list[MapRegion] = []
    occupied = np.zeros(raw_masks[0]["segmentation"].shape, dtype=np.uint8) if raw_masks else None
    map_area = max(1, original_width * original_height)
    for raw in raw_masks:
        if len(regions) >= 120:
            break
        mask = raw.get("segmentation")
        if mask is None:
            continue
        residual = mask.astype(np.uint8)
        if occupied is not None:
            residual = cv2.bitwise_and(residual, cv2.bitwise_not(occupied))
        area = float(residual.sum()) / max(scale * scale, 0.0001)
        area_ratio = area / map_area
        if area_ratio < 0.0006 or area_ratio > 0.9:
            continue
        contours, _ = cv2.findContours(residual, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        for contour in sorted(contours, key=cv2.contourArea, reverse=True):
            if len(regions) >= 120:
                break
            contour_area = cv2.contourArea(contour) / max(scale * scale, 0.0001)
            contour_ratio = contour_area / map_area
            if contour_ratio < 0.0006:
                continue
            perimeter = cv2.arcLength(contour, True)
            if perimeter <= 0:
                continue
            approximated = cv2.approxPolyDP(contour, max(1.0, perimeter * 0.0025), True)
            points = [
                Point(float(point[0][0]) / scale, float(point[0][1]) / scale)
                for point in approximated
            ]
            if len(points) < 3:
                continue
            regions.append(
                MapRegion(
                    id=new_id("region"),
                    name=f"SAM 分区 {len(regions) + 1}",
                    function="unassigned",
                    source=config.get("id", MOBILE_SAM_MODEL_ID),
                    points=points,
                    notes="内置 MobileSAM 自动分层，等待命名和功能设定。",
                    confidence=float(raw.get("predicted_iou") or raw.get("stability_score") or 0),
                    tags=["MobileSAM"],
                )
            )
        if occupied is not None:
            occupied = cv2.bitwise_or(occupied, residual)
    return regions


def _call_http_sam_provider(config: dict[str, Any], world_map: WorldMap) -> list[MapRegion]:
    base_url = str(config.get("base_url", "")).strip()
    if not base_url:
        raise HTTPException(status_code=400, detail="SAM 分层模型缺少服务地址")
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
        raise HTTPException(status_code=502, detail=f"SAM 分层服务错误：{exc.code}") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail=f"SAM 分层服务不可用：{exc}") from exc
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
                holes=[
                    [Point.from_dict(point) for point in hole]
                    for hole in raw.get("holes", [])
                    if isinstance(hole, list)
                ],
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
        region.points = _remove_near_duplicate_points(region.points, min_distance=1.0)
        if len(region.points) >= 3 and _polygon_area(region.points) >= 64:
            next_regions.append(region)
    return _normalize_region_overlaps(next_regions)


def _apply_region_boolean(
    regions: list[MapRegion],
    target_ids: list[str],
    brush: Any,
    operation: str,
    priority_functions: list[str] | None = None,
) -> list[MapRegion]:
    targets = [region for region in regions if region.id in set(target_ids)]
    if not targets:
        return regions
    untouched = [region for region in regions if region.id not in set(target_ids)]
    if operation == "union":
        base = _unary_union([_region_to_geometry(region) for region in targets])
        result_geometry = base.union(brush)
        replacement = _regions_from_geometry(targets[0], result_geometry)
        if not replacement:
            raise HTTPException(status_code=400, detail="区域合并后没有可保存的有效范围")
        return _normalize_region_overlaps(
            [*replacement, *untouched],
            priority_functions=priority_functions,
            priority_ids=[region.id for region in replacement],
        )
    replacements: list[MapRegion] = []
    for target in targets:
        replacements.extend(_regions_from_geometry(target, _region_to_geometry(target).difference(brush)))
    if not replacements:
        return _normalize_region_overlaps(
            untouched,
            priority_functions=priority_functions,
        )
    return _normalize_region_overlaps(
        [*replacements, *untouched],
        priority_functions=priority_functions,
        priority_ids=[region.id for region in replacements],
    )


def _normalize_region_overlaps(
    regions: list[MapRegion],
    priority_functions: list[str] | None = None,
    priority_ids: list[str] | None = None,
) -> list[MapRegion]:
    priority_functions = priority_functions or []
    priority_ids = priority_ids or []
    seen: set[str] = set()
    ordered = [
        *[
            region
            for function in priority_functions
            for region in regions
            if region.function == function and not region.hidden and not (region.id in seen or seen.add(region.id))
        ],
        *[
            region
            for region_id in priority_ids
            for region in regions
            if region.id == region_id and not region.hidden and not (region.id in seen or seen.add(region.id))
        ],
        *[region for region in regions if not region.hidden and not (region.id in seen or seen.add(region.id))],
        *[region for region in regions if region.hidden and not (region.id in seen or seen.add(region.id))],
    ]
    occupied_by_function: dict[str, Any] = {}
    normalized: list[MapRegion] = []
    for region in ordered:
        if region.hidden:
            normalized.append(region)
            continue
        geometry = _region_to_geometry(region)
        if geometry.is_empty:
            continue
        blockers = [
            occupied
            for function, occupied in occupied_by_function.items()
            if function != region.function and not occupied.is_empty
        ]
        residual = geometry if not blockers else geometry.difference(_unary_union(blockers))
        pieces = _regions_from_geometry(region, residual)
        if not pieces:
            continue
        normalized.extend(pieces)
        piece_geometry = _unary_union([_region_to_geometry(piece) for piece in pieces])
        existing = occupied_by_function.get(region.function)
        occupied_by_function[region.function] = piece_geometry if existing is None else existing.union(piece_geometry)
    return normalized


def _polygon_from_points(points: list[Point], holes: list[list[Point]] | None = None) -> Any:
    try:
        from shapely.geometry import Polygon
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="区域布尔需要安装 shapely") from exc
    if len(points) < 3:
        return Polygon()
    polygon = Polygon(
        [(point.x, point.y) for point in points],
        [[(point.x, point.y) for point in hole] for hole in holes or [] if len(hole) >= 3],
    )
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    return polygon


def _region_to_geometry(region: MapRegion) -> Any:
    return _polygon_from_points(region.points, region.holes)


def _unary_union(geometries: list[Any]) -> Any:
    try:
        from shapely.ops import unary_union
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="区域布尔需要安装 shapely") from exc
    valid = [geometry for geometry in geometries if not geometry.is_empty]
    return unary_union(valid) if valid else unary_union([])


def _regions_from_geometry(template: MapRegion, geometry: Any) -> list[MapRegion]:
    polygons = _geometry_polygons(geometry)
    next_regions: list[MapRegion] = []
    for index, polygon in enumerate(polygons):
        if polygon.area < 64:
            continue
        exterior = [Point(float(x), float(y)) for x, y in list(polygon.exterior.coords)[:-1]]
        holes = [
            [Point(float(x), float(y)) for x, y in list(interior.coords)[:-1]]
            for interior in polygon.interiors
            if len(interior.coords) >= 4
        ]
        if len(exterior) < 3:
            continue
        region_id = template.id if index == 0 else new_id("region")
        suffix = "" if index == 0 else f" {index + 1}"
        next_regions.append(
            MapRegion(
                id=region_id,
                name=template.name if index == 0 else f"{template.name}{suffix}",
                points=exterior,
                holes=holes,
                source=template.source,
                function=template.function,
                image_prompt=template.image_prompt,
                notes=template.notes,
                confidence=template.confidence,
                tags=list(template.tags),
                hidden=template.hidden,
            )
        )
    return next_regions


def _geometry_polygons(geometry: Any) -> list[Any]:
    if geometry.is_empty:
        return []
    geometry_type = getattr(geometry, "geom_type", "")
    if geometry_type == "Polygon":
        return [geometry]
    if geometry_type in {"MultiPolygon", "GeometryCollection"}:
        polygons = [item for item in geometry.geoms if getattr(item, "geom_type", "") == "Polygon"]
        return sorted(polygons, key=lambda item: item.area, reverse=True)
    return []


def _remove_near_duplicate_points(points: list[Point], min_distance: float = 2.0) -> list[Point]:
    clean: list[Point] = []
    for point in points:
        if not clean or _distance(clean[-1], point) >= min_distance:
            clean.append(point)
    if len(clean) > 1 and _distance(clean[0], clean[-1]) < min_distance:
        clean.pop()
    return clean


def _distance(a: Point, b: Point) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def _polygon_area(points: list[Point]) -> float:
    if len(points) < 3:
        return 0.0
    area = 0.0
    for index, point in enumerate(points):
        following = points[(index + 1) % len(points)]
        area += point.x * following.y - following.x * point.y
    return abs(area) * 0.5


def _label_region_with_model(config: dict[str, Any], world_map: WorldMap, region: MapRegion) -> dict[str, Any]:
    provider = str(config.get("provider", ""))
    if provider == "ollama":
        return _label_region_with_ollama(config, world_map, region)
    raise HTTPException(status_code=400, detail="当前图像识别模型不支持自动命名")


def _label_region_with_ollama(config: dict[str, Any], world_map: WorldMap, region: MapRegion) -> dict[str, Any]:
    image_b64 = _region_crop_png_base64(world_map, region)
    prompt = (
        "请观察这张 2D 地图局部图，只返回 JSON。"
        "{\"name\":\"...\",\"notes\":\"...\",\"tags\":[\"...\",\"...\"]}"
        "name 用 2 到 8 个中文，不能包含 SAM、MobileSAM、分区、区域。"
        "notes 一句中文。tags 给 1 到 3 个中文短词。"
    )
    body = {
        "model": config.get("model", ""),
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "images": [image_b64],
        "options": {"temperature": 0.1, "num_predict": 120},
    }
    payload = json.dumps(body).encode("utf-8")
    request = urlrequest.Request(
        f"{str(config.get('base_url', '')).rstrip('/')}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(request, timeout=120) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"图像识别模型服务错误：{exc.code}") from exc
    except (URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=502, detail=f"图像识别模型不可用：{exc}") from exc
    raw_text = str(data.get("response", "")).strip()
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        parsed = {}
    name = str(parsed.get("name") or "").strip() if isinstance(parsed, dict) else ""
    notes = str(parsed.get("notes") or "").strip() if isinstance(parsed, dict) else ""
    tags = list(parsed.get("tags") or []) if isinstance(parsed, dict) else []
    if not name:
        name = region.name
    if not notes:
        notes = f"已由 {config.get('name', '本地图像识别模型')} 自动识别并命名。"
    clean_name = name.replace("SAM", "").replace("MobileSAM", "").replace("分区", "").replace("区域", "").strip()[:8] or region.name
    clean_tags = [str(tag).strip() for tag in tags if str(tag).strip()][:3]
    if not clean_tags:
        clean_tags = ["视觉识别"]
    return {"name": clean_name, "notes": notes, "tags": clean_tags}


def _region_crop_png_base64(world_map: WorldMap, region: MapRegion) -> str:
    image_path = _asset_path_for_url(world_map.background_image)
    if not image_path:
        raise HTTPException(status_code=400, detail="当前地图缺少可裁剪的背景图")
    import cv2
    import numpy as np

    image = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="背景图读取失败，无法做图像识别")
    height, width = image.shape[:2]
    polygon = np.array([[[int(round(point.x)), int(round(point.y))]] for point in region.points], dtype=np.int32)
    x, y, w, h = cv2.boundingRect(polygon)
    margin = 18
    left = max(0, x - margin)
    top = max(0, y - margin)
    right = min(width, x + w + margin)
    bottom = min(height, y + h + margin)
    cropped = image[top:bottom, left:right].copy()
    shifted = polygon.copy()
    shifted[:, 0, 0] -= left
    shifted[:, 0, 1] -= top
    mask = np.zeros(cropped.shape[:2], dtype=np.uint8)
    cv2.fillPoly(mask, [shifted], 255)
    background = np.full_like(cropped, 245)
    composed = np.where(mask[:, :, None] > 0, cropped, background)
    max_side = max(composed.shape[0], composed.shape[1])
    if max_side > 512:
        scale = 512 / max_side
        composed = cv2.resize(
            composed,
            (max(32, int(composed.shape[1] * scale)), max(32, int(composed.shape[0] * scale))),
            interpolation=cv2.INTER_AREA,
        )
    ok, encoded = cv2.imencode(".png", composed)
    if not ok:
        raise HTTPException(status_code=500, detail="区域裁剪编码失败")
    return base64.b64encode(encoded.tobytes()).decode("ascii")


def _mock_generated_candidate(
    generation_id: str, index: int, prompt: str, width: int, height: int
) -> dict[str, Any]:
    from PIL import Image, ImageDraw

    asset_name = f"{generation_id}_{index + 1}.png"
    destination = store.assets_dir / asset_name
    store.initialize()
    hue = (index * 62 + len(prompt) * 7) % 360
    image = Image.new("RGB", (width, height), _hsl_to_rgb(hue, 0.34, 0.78))
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rectangle((0, 0, width, height), fill=_hsl_to_rgb((hue + 84) % 360, 0.26, 0.68) + (86,))
    grid_step = max(72, width // 20)
    for x in range(0, width + 1, grid_step):
        draw.line((x, 0, x, height), fill=(32, 32, 32, 24), width=1)
    for y in range(0, height + 1, grid_step):
        draw.line((0, y, width, y), fill=(245, 245, 245, 30), width=1)
    road_width = max(18, width // 48)
    draw.line(
        (
            int(width * 0.08),
            int(height * 0.62),
            int(width * 0.28),
            int(height * 0.44),
            int(width * 0.52),
            int(height * 0.7),
            int(width * 0.9),
            int(height * 0.42),
        ),
        fill=(36, 36, 36, 120),
        width=road_width,
    )
    draw.rounded_rectangle(
        (int(width * 0.1), int(height * 0.12), int(width * 0.34), int(height * 0.36)),
        radius=18,
        fill=(245, 245, 245, 64),
        outline=(20, 20, 20, 52),
        width=4,
    )
    draw.rounded_rectangle(
        (int(width * 0.62), int(height * 0.16), int(width * 0.87), int(height * 0.44)),
        radius=22,
        fill=(245, 245, 245, 56),
        outline=(20, 20, 20, 48),
        width=4,
    )
    draw.ellipse(
        (int(width * 0.37), int(height * 0.27), int(width * 0.55), int(height * 0.45)),
        fill=(245, 245, 245, 46),
        outline=(20, 20, 20, 40),
        width=4,
    )
    image.save(destination, format="PNG")
    return {
        "id": f"{generation_id}_candidate_{index + 1}",
        "url": f"/api/assets/{asset_name}",
        "prompt": prompt,
        "width": width,
        "height": height,
        "provider_id": "model_mock_image",
    }


def _hsl_to_rgb(h: int, s: float, l: float) -> tuple[int, int, int]:
    import colorsys

    r, g, b = colorsys.hls_to_rgb((h % 360) / 360.0, l, s)
    return (int(r * 255), int(g * 255), int(b * 255))


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
    if suffix not in {".png", ".jpg", ".jpeg", ".gif"}:
        raise HTTPException(status_code=400, detail="Only PNG, JPG and GIF assets are supported.")
    asset_name = f"{new_id(prefix)}{suffix}"
    destination = store.assets_dir / asset_name
    store.initialize()
    with destination.open("wb") as output:
        shutil.copyfileobj(file.file, output)
    return asset_name


_sync_runtime_model_providers()
