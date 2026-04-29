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
    assert "api_key" not in models.text.lower()

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


def default_model_configs():
    return [
        {
            "id": "model_mock_llm",
            "name": "Mock LLM",
            "kind": "local",
            "provider": "mock",
            "base_url": "",
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
            "enabled": False,
            "capabilities": ["segmentation", "vision_labeling"],
        },
    ]
