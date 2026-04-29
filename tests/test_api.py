from fastapi.testclient import TestClient

from agent_engine.api import main as api_main
from agent_engine.api.main import app


def test_api_health_world_action_and_websocket():
    client = TestClient(app)

    health = client.get("/healthz")
    assert health.status_code == 200
    assert health.json()["ok"] is True

    world = client.get("/api/world")
    assert world.status_code == 200
    assert "agent_mira" in world.json()["agent_profiles"]

    action = client.post(
        "/api/actions",
        json={
            "agent_id": "agent_mira",
            "type": "say",
            "payload": {"text": "API smoke test."},
        },
    )
    assert action.status_code == 200
    assert action.json()["ok"] is True

    with client.websocket_connect("/ws") as websocket:
        snapshot = websocket.receive_json()
        assert "agent_states" in snapshot
        assert "events" in snapshot


def test_api_patch_editor_entities():
    client = TestClient(app)

    map_patch = client.patch("/api/map", json={"name": "Patch Test Map"})
    assert map_patch.status_code == 200
    assert map_patch.json()["map"]["name"] == "Patch Test Map"

    agent_patch = client.patch("/api/agents/agent_mira", json={"name": "Mira Renamed"})
    assert agent_patch.status_code == 200
    assert agent_patch.json()["agent_profiles"]["agent_mira"]["name"] == "Mira Renamed"
    assert "agent_mira" in agent_patch.json()["agent_states"]

    world = client.get("/api/world").json()
    world["map"]["items"].append(
        {
            "id": "item_patch_test",
            "name": "Patch Item",
            "position": {"x": 10, "y": 12},
            "radius": 30,
            "tags": [],
            "state": {},
        }
    )
    assert client.put("/api/world", json=world).status_code == 200

    item_patch = client.patch(
        "/api/map/items/item_patch_test",
        json={
            "position": {"x": 120, "y": 140},
            "rotation": 32,
            "scale": 1.8,
            "image": "/api/assets/test.png",
            "description": "patched",
        },
    )
    item = next(item for item in item_patch.json()["map"]["items"] if item["id"] == "item_patch_test")
    assert item["position"] == {"x": 120.0, "y": 140.0}
    assert item["rotation"] == 32
    assert item["scale"] == 1.8
    assert item["image"] == "/api/assets/test.png"
    assert item["description"] == "patched"


def test_api_models_generation_and_region_semantics():
    client = TestClient(app)

    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200
    models = client.get("/api/models")
    assert models.status_code == 200
    assert any("image_generation" in model["capabilities"] for model in models.json()["models"])

    created = client.post(
        "/api/models",
        json={
            "id": "model_test_generation",
            "name": "测试图片模型",
            "kind": "remote",
            "provider": "openai-compatible",
            "base_url": "http://localhost:9999/v1",
            "model": "image-test",
            "enabled": True,
            "capabilities": ["image_generation"],
        },
    )
    assert created.status_code == 200
    assert created.json()["model"]["id"] == "model_test_generation"

    patched_model = client.patch("/api/models/model_test_generation", json={"enabled": False})
    assert patched_model.status_code == 200
    assert patched_model.json()["model"]["enabled"] is False

    generation = client.post(
        "/api/map/generation",
        json={
            "prompt": "俯视小镇地图",
            "width": 1920,
            "height": 1080,
            "ratio": "16:9",
            "count": 2,
        },
    )
    assert generation.status_code == 200
    generation_data = generation.json()
    assert len(generation_data["candidates"]) == 2
    assert generation_data["candidates"][0]["url"].startswith("/api/assets/")

    selected = client.post(
        f"/api/map/generation/{generation_data['id']}/select",
        json={"candidate_id": generation_data["candidates"][0]["id"]},
    )
    assert selected.status_code == 200
    assert selected.json()["world"]["map"]["background_image"] == generation_data["candidates"][0]["url"]

    models_without_sam = client.patch(
        "/api/models",
        json={
            "models": [
                {
                    "id": "model_mock_image",
                    "name": "Mock 图片生成",
                    "kind": "local",
                    "provider": "mock",
                    "base_url": "",
                    "model": "mock-map-generator",
                    "enabled": True,
                    "capabilities": ["image_generation"],
                }
            ]
        },
    )
    assert models_without_sam.status_code == 200

    segmented = client.post("/api/map/segment")
    assert segmented.status_code == 400
    assert segmented.json()["detail"] == "未配置 SAM 分层模型"

    models_with_mock_sam = client.patch(
        "/api/models",
        json={
            "models": [
                {
                    "id": "model_mock_image",
                    "name": "Mock 图片生成",
                    "kind": "local",
                    "provider": "mock",
                    "base_url": "",
                    "model": "mock-map-generator",
                    "enabled": True,
                    "capabilities": ["image_generation"],
                },
                {
                    "id": "model_mock_sam",
                    "name": "Mock SAM 分层（测试）",
                    "kind": "local",
                    "provider": "mock",
                    "base_url": "",
                    "model": "mock-sam",
                    "enabled": True,
                    "capabilities": ["segmentation", "vision_labeling"],
                },
            ]
        },
    )
    assert models_with_mock_sam.status_code == 200

    segmented = client.post("/api/map/segment")
    assert segmented.status_code == 200
    payload = segmented.json()
    assert payload["segmentation"]["mode"] == "mock"
    assert payload["segmentation"]["stage"] == "done"
    assert payload["segmentation"]["progress"] == 100
    world = payload["world"]
    assert len(world["map"]["regions"]) >= 4
    assert all(3 <= len(region["points"]) <= 160 for region in world["map"]["regions"])
    assert any(area["metadata"].get("generated") for area in world["map"]["walkable_areas"])
    assert any(area["metadata"].get("generated") for area in world["map"]["obstacles"])
    assert any(area["metadata"].get("generated") for area in world["map"]["interaction_zones"])

    region_id = world["map"]["regions"][0]["id"]
    patched_region = client.patch(
        f"/api/map/regions/{region_id}",
        json={"function": "obstacle", "name": "测试不可穿过区", "notes": "手动备注"},
    )
    assert patched_region.status_code == 200
    next_world = patched_region.json()
    region = next(region for region in next_world["map"]["regions"] if region["id"] == region_id)
    assert region["function"] == "obstacle"
    assert region["name"] == "测试不可穿过区"
    assert any(area["metadata"].get("region_id") == region_id for area in next_world["map"]["obstacles"])

    regenerated = client.post(f"/api/map/regions/{region_id}/regenerate", json={"prompt": "重绘为花园入口"})
    assert regenerated.status_code == 200
    region = next(region for region in regenerated.json()["map"]["regions"] if region["id"] == region_id)
    assert region["image_prompt"] == "重绘为花园入口"


def test_api_model_capability_status_and_one_click_config(monkeypatch):
    client = TestClient(app)

    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200
    monkeypatch.setattr(api_main, "_detect_ollama_models", lambda: ["qwen2.5:7b", "qwen2.5vl:3b"])
    monkeypatch.setattr(api_main, "_embedded_mobile_sam_ready", lambda: False)
    monkeypatch.setattr(
        api_main,
        "_detect_local_model_services",
        lambda: {
            "image_generation": {
                "available": False,
                "base_url": "http://127.0.0.1:8188",
                "provider": "local-http-image",
                "model": "local-image",
            },
            "segmentation": {
                "available": False,
                "base_url": "http://127.0.0.1:8001/segment",
                "provider": "sam-http",
                "model": "sam-local",
            },
        },
    )

    status = client.get("/api/model-capabilities/status")
    assert status.status_code == 200
    llm = next(item for item in status.json()["capabilities"] if item["id"] == "llm")
    sam = next(item for item in status.json()["capabilities"] if item["id"] == "segmentation")
    assert llm["status"] == "local_available"
    assert llm["recommended_local"]["model"] == "qwen2.5:7b"
    assert sam["status"] == "installable"
    assert sam["installable"] is True

    configured = client.post("/api/model-capabilities/llm/configure-local")
    assert configured.status_code == 200
    models = configured.json()["models"]
    assert any(model["id"] == "model_local_llm" and model["model"] == "qwen2.5:7b" for model in models)
    assert any(model["id"] == "model_local_vision" and "vision_labeling" in model["capabilities"] for model in models)
    assert configured.json()["capability"]["status"] == "ready"

    missing_sam = client.post("/api/model-capabilities/segmentation/configure-local")
    assert missing_sam.status_code == 400
    assert "SAM" in missing_sam.json()["detail"]

    remote_sam = client.post(
        "/api/model-capabilities/segmentation/configure-remote",
        json={
            "base_url": "http://localhost:8001/segment",
            "api_key": "local-dev-key",
            "model": "sam2-tiny",
        },
    )
    assert remote_sam.status_code == 200
    sam_model = next(model for model in remote_sam.json()["models"] if model["id"] == "model_remote_sam")
    assert sam_model["api_key"] == "local-dev-key"
    assert sam_model["base_url"] == "http://localhost:8001/segment"


def test_api_embedded_sam_install_task(monkeypatch):
    client = TestClient(app)

    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200
    monkeypatch.setattr(api_main, "_embedded_mobile_sam_ready", lambda: False)

    def fake_start(task_id):
        configs = api_main._upsert_model_config(
            api_main.store.load_model_configs(),
            api_main._embedded_mobile_sam_config(),
        )
        api_main.store.save_model_configs(configs)
        api_main._set_capability_task(
            task_id,
            status="done",
            stage="done",
            progress=100,
            message="内置 MobileSAM 已启用",
            error="",
        )

    monkeypatch.setattr(api_main, "_start_embedded_sam_install_task", fake_start)
    task_response = client.post("/api/model-capabilities/segmentation/install-local")

    assert task_response.status_code == 200
    task = task_response.json()["task"]
    assert task["status"] == "running"

    task_status = client.get(f"/api/model-capabilities/tasks/{task['id']}")
    assert task_status.status_code == 200
    assert task_status.json()["task"]["status"] == "done"

    models = client.get("/api/models").json()["models"]
    embedded = next(model for model in models if model["id"] == "model_local_sam_embedded")
    assert embedded["provider"] == "embedded-mobile-sam"
    assert embedded["base_url"] == ""


def test_api_embedded_sam_provider(monkeypatch):
    client = TestClient(app)

    client.patch(
        "/api/map",
        json={
            "width": 640,
            "height": 360,
            "background_image": "/api/assets/test-map.png",
        },
    )
    client.patch(
        "/api/models",
        json={
            "models": [
                {
                    "id": "model_local_sam_embedded",
                    "name": "内置 MobileSAM",
                    "kind": "local",
                    "provider": "embedded-mobile-sam",
                    "base_url": "",
                    "model": "vit_t",
                    "enabled": True,
                    "capabilities": ["segmentation"],
                }
            ]
        },
    )

    def fake_embedded_provider(config, world_map):
        assert config["provider"] == "embedded-mobile-sam"
        assert world_map.width == 640
        return [
            api_main.MapRegion(
                id="region_embedded_test",
                name="内置区域",
                function="social",
                source="model_local_sam_embedded",
                points=[
                    api_main.Point(20, 20),
                    api_main.Point(180, 20),
                    api_main.Point(180, 120),
                    api_main.Point(20, 120),
                ],
                confidence=0.91,
                notes="内置 MobileSAM 返回",
                tags=["MobileSAM"],
            )
        ]

    monkeypatch.setattr(api_main, "_call_embedded_mobile_sam_provider", fake_embedded_provider)
    segmented = client.post("/api/map/segment")

    assert segmented.status_code == 200
    payload = segmented.json()
    assert payload["segmentation"]["mode"] == "embedded"
    assert payload["segmentation"]["provider_name"] == "内置 MobileSAM"
    assert payload["world"]["map"]["regions"][0]["name"] == "内置区域"
    assert any(area["metadata"].get("region_id") == "region_embedded_test" for area in payload["world"]["map"]["interaction_zones"])


def test_api_http_sam_provider(monkeypatch):
    client = TestClient(app)

    client.patch(
        "/api/map",
        json={
            "width": 640,
            "height": 360,
            "background_image": "/api/assets/test-map.png",
        },
    )
    client.patch(
        "/api/models",
        json={
            "models": [
                {
                    "id": "model_http_sam",
                    "name": "HTTP SAM",
                    "kind": "remote",
                    "provider": "sam-http",
                    "base_url": "http://sam.test/segment",
                    "model": "sam2",
                    "enabled": True,
                    "capabilities": ["segmentation"],
                }
            ]
        },
    )

    def fake_sam_provider(config, world_map):
        assert config["id"] == "model_http_sam"
        assert world_map.width == 640
        return [
            api_main.MapRegion(
                id="region_http_test",
                name="HTTP 区域",
                function="walkable",
                source="model_http_sam",
                points=[
                    api_main.Point(0, 0),
                    api_main.Point(100, 0),
                    api_main.Point(100, 100),
                    api_main.Point(0, 100),
                ],
                confidence=0.93,
                notes="HTTP SAM 返回",
                tags=["道路"],
            )
        ]

    monkeypatch.setattr(api_main, "_call_http_sam_provider", fake_sam_provider)
    segmented = client.post("/api/map/segment")

    assert segmented.status_code == 200
    payload = segmented.json()
    assert payload["segmentation"]["mode"] == "http"
    assert payload["segmentation"]["provider_id"] == "model_http_sam"
    assert payload["segmentation"]["provider_name"] == "HTTP SAM"
    assert payload["segmentation"]["stage"] == "done"
    assert payload["segmentation"]["progress"] == 100
    assert payload["world"]["map"]["regions"][0]["name"] == "HTTP 区域"
    assert len(payload["world"]["map"]["regions"][0]["points"]) > 4


def test_api_prefers_embedded_sam_over_http(monkeypatch):
    client = TestClient(app)

    client.patch(
        "/api/map",
        json={
            "width": 640,
            "height": 360,
            "background_image": "/api/assets/test-map.png",
        },
    )
    client.patch(
        "/api/models",
        json={
            "models": [
                {
                    "id": "model_http_sam",
                    "name": "HTTP SAM",
                    "kind": "remote",
                    "provider": "sam-http",
                    "base_url": "http://sam.test/segment",
                    "model": "sam2",
                    "enabled": True,
                    "capabilities": ["segmentation"],
                },
                {
                    "id": "model_local_sam_embedded",
                    "name": "内置 MobileSAM",
                    "kind": "local",
                    "provider": "embedded-mobile-sam",
                    "base_url": "",
                    "model": "vit_t",
                    "enabled": True,
                    "capabilities": ["segmentation"],
                },
            ]
        },
    )

    def fail_http_provider(config, world_map):
        raise AssertionError("HTTP SAM should not be used when embedded MobileSAM is enabled")

    def fake_embedded_provider(config, world_map):
        assert config["id"] == "model_local_sam_embedded"
        return [
            api_main.MapRegion(
                id="region_preferred_embedded",
                name="内置优先区域",
                function="social",
                source="model_local_sam_embedded",
                points=[
                    api_main.Point(0, 0),
                    api_main.Point(120, 0),
                    api_main.Point(120, 80),
                    api_main.Point(0, 80),
                ],
                confidence=0.95,
                notes="优先使用内置 MobileSAM",
                tags=["优先"],
            )
        ]

    monkeypatch.setattr(api_main, "_call_http_sam_provider", fail_http_provider)
    monkeypatch.setattr(api_main, "_call_embedded_mobile_sam_provider", fake_embedded_provider)

    segmented = client.post("/api/map/segment")

    assert segmented.status_code == 200
    payload = segmented.json()
    assert payload["segmentation"]["mode"] == "embedded"
    assert payload["segmentation"]["provider_id"] == "model_local_sam_embedded"
    assert payload["world"]["map"]["regions"][0]["name"] == "内置优先区域"


def default_model_configs():
    return [
        {
            "id": "model_mock_llm",
            "name": "Mock LLM",
            "kind": "local",
            "provider": "mock",
            "base_url": "",
            "api_key": "",
            "model": "mock-agent",
            "enabled": True,
            "capabilities": ["llm"],
        },
        {
            "id": "model_mock_image",
            "name": "Mock 图片生成",
            "kind": "local",
            "provider": "mock",
            "base_url": "",
            "api_key": "",
            "model": "mock-map-generator",
            "enabled": True,
            "capabilities": ["image_generation"],
        },
        {
            "id": "model_mock_sam",
            "name": "Mock SAM 分层（测试）",
            "kind": "local",
            "provider": "mock",
            "base_url": "",
            "api_key": "",
            "model": "mock-sam",
            "enabled": False,
            "capabilities": ["segmentation", "vision_labeling"],
        },
    ]
