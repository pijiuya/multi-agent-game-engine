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


def test_api_patch_narrative_updates_saved_snapshot():
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()

    response = client.patch(
        "/api/narrative",
        json={
            "enabled": True,
            "premise": "A storm is turning every quiet errand into a clue.",
            "tone": "tense but grounded",
            "cadence_ticks": 12,
        },
    )

    assert response.status_code == 200
    narrative = response.json()["narrative"]
    assert narrative == {
        "enabled": True,
        "premise": "A storm is turning every quiet errand into a clue.",
        "tone": "tense but grounded",
        "cadence_ticks": 12,
        "last_tick": -999,
        "recent_summary": "",
    }
    assert client.get("/api/world").json()["narrative"] == narrative


def test_create_agent_defaults_to_runtime_provider():
    client = TestClient(app)
    old_provider = api_main.runtime.default_provider_id
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.default_provider_id = "model_local_llm"
    try:
        response = client.post(
            "/api/agents",
            json={"name": "Local First", "role": "test", "position": {"x": 240, "y": 220}},
        )
    finally:
        api_main.runtime.default_provider_id = old_provider

    assert response.status_code == 200
    profile = next(
        profile for profile in response.json()["agent_profiles"].values() if profile["name"] == "Local First"
    )
    assert profile["model_provider"] == "model_local_llm"


def test_api_runtime_status_is_read_only(monkeypatch):
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.running = True
    api_main.runtime.world.tick = 42
    api_main.runtime.world.add_decision_event(
        agent_id="agent_mira",
        provider="ollama",
        model="qwen2.5:7b",
        observation={},
        text="ok",
        actions=[],
        results=[{"ok": True, "elapsed_ms": 12}],
    )
    configs = [
        {
            "id": "model_local_llm",
            "name": "本地 LLM",
            "kind": "local",
            "provider": "ollama",
            "base_url": "http://127.0.0.1:11434",
            "api_key": "",
            "model": "qwen2.5:7b",
            "enabled": True,
            "capabilities": ["llm"],
        },
        {
            "id": "model_remote_llm",
            "name": "线上 LLM",
            "kind": "remote",
            "provider": "openai-compatible",
            "base_url": "https://example.test/v1",
            "api_key": "secret",
            "model": "remote-model",
            "enabled": False,
            "capabilities": ["llm"],
        },
    ]
    monkeypatch.setattr(api_main.store, "load_model_configs", lambda: configs)
    before_world = api_main.runtime.world.to_dict()

    response = client.get("/api/runtime/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["simulation"]["running"] is True
    assert payload["simulation"]["tick"] == 42
    assert payload["simulation"]["pending_model_task_count"] == 0
    assert payload["models"][0]["name"] == "本地 LLM"
    assert payload["models"][0]["recent_event_count"] == 1
    assert payload["models"][0]["recent_error_count"] == 0
    assert payload["models"][1]["kind"] == "remote"
    assert "cpu_count" in payload["hardware"]
    assert "gpu_pressure_reason" in payload["hardware"]
    assert api_main.runtime.world.to_dict() == before_world


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
            "movable": False,
        },
    )
    item = next(item for item in item_patch.json()["map"]["items"] if item["id"] == "item_patch_test")
    assert item["position"] == {"x": 120.0, "y": 140.0}
    assert item["rotation"] == 32
    assert item["scale"] == 1.8
    assert item["image"] == "/api/assets/test.png"
    assert item["description"] == "patched"
    assert item["movable"] is False

    hidden_item = client.patch("/api/map/items/item_patch_test", json={"hidden": True})
    assert hidden_item.status_code == 200
    item = next(item for item in hidden_item.json()["map"]["items"] if item["id"] == "item_patch_test")
    assert item["hidden"] is True
    deleted_item = client.delete("/api/map/items/item_patch_test")
    assert deleted_item.status_code == 200
    assert all(item["id"] != "item_patch_test" for item in deleted_item.json()["map"]["items"])

    created_agent = client.post(
        "/api/agents",
        json={"name": "Delete Me", "role": "test", "position": {"x": 200, "y": 200}},
    )
    agent_id = created_agent.json()["agent_profiles"]
    agent_id = next(key for key, profile in agent_id.items() if profile["name"] == "Delete Me")
    hidden_agent = client.patch(f"/api/agents/{agent_id}", json={"hidden": True})
    assert hidden_agent.status_code == 200
    assert hidden_agent.json()["agent_profiles"][agent_id]["hidden"] is True
    deleted_agent = client.delete(f"/api/agents/{agent_id}")
    assert deleted_agent.status_code == 200
    assert agent_id not in deleted_agent.json()["agent_profiles"]
    assert agent_id not in deleted_agent.json()["agent_states"]

    animation_agent = client.post(
        "/api/agents",
        json={"name": "Animated", "role": "test", "position": {"x": 240, "y": 220}},
    )
    animation_id = next(
        key for key, profile in animation_agent.json()["agent_profiles"].items() if profile["name"] == "Animated"
    )
    patched_animation = client.patch(
        f"/api/agents/{animation_id}",
        json={
            "animation": {
                "kind": "gif",
                "url": "/api/assets/agent.gif",
                "fps": 8,
                "max_pixels": 4096,
                "width": 64,
                "height": 64,
            },
            "dialogue_policy": {"enabled": True, "distance": 140, "cooldown_ticks": 7},
        },
    )
    animated = patched_animation.json()["agent_profiles"][animation_id]
    assert animated["animation"]["clips"]["idle"]["kind"] == "gif"
    assert animated["dialogue_policy"]["distance"] == 140

    created_region = client.post(
        "/api/map/regions",
        json={
            "name": "可删除区域",
            "function": "walkable",
            "points": [{"x": 10, "y": 10}, {"x": 80, "y": 10}, {"x": 80, "y": 80}, {"x": 10, "y": 80}],
        },
    )
    region_id = next(region["id"] for region in created_region.json()["map"]["regions"] if region["name"] == "可删除区域")
    hidden_region = client.patch(f"/api/map/regions/{region_id}", json={"hidden": True})
    assert hidden_region.status_code == 200
    region = next(region for region in hidden_region.json()["map"]["regions"] if region["id"] == region_id)
    assert region["hidden"] is True
    assert region_id not in next(layer for layer in hidden_region.json()["map"]["region_layers"] if layer["function"] == "walkable")["region_ids"]
    deleted_region = client.delete(f"/api/map/regions/{region_id}")
    assert deleted_region.status_code == 200
    assert all(region["id"] != region_id for region in deleted_region.json()["map"]["regions"])


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
            "provider_id": "model_mock_image",
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
    assert regenerated.status_code == 400
    assert "未配置真实图片生成模型" in regenerated.json()["detail"]


def test_api_manual_region_create_and_boolean_operations():
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.map.regions = []
    api_main.runtime.world.map.walkable_areas = []
    api_main.runtime.world.map.obstacles = []
    api_main.runtime.world.map.interaction_zones = []

    created = client.post(
        "/api/map/regions",
        json={
            "name": "手绘道路",
            "function": "walkable",
            "points": [
                {"x": 0, "y": 0},
                {"x": 120, "y": 0},
                {"x": 120, "y": 120},
                {"x": 0, "y": 120},
            ],
        },
    )
    assert created.status_code == 200
    region = created.json()["map"]["regions"][0]
    assert region["source"] == "manual"
    assert any(area["metadata"].get("region_id") == region["id"] for area in created.json()["map"]["walkable_areas"])
    walkable_layer = next(layer for layer in created.json()["map"]["region_layers"] if layer["function"] == "walkable")
    assert region["id"] in walkable_layer["region_ids"]
    assert len(walkable_layer["polygons"]) == 1

    subtracted = client.post(
        "/api/map/regions/boolean",
        json={
            "target_ids": [region["id"]],
            "operation": "subtract",
            "points": [
                {"x": 40, "y": 40},
                {"x": 80, "y": 40},
                {"x": 80, "y": 80},
                {"x": 40, "y": 80},
            ],
        },
    )
    assert subtracted.status_code == 200
    region = next(item for item in subtracted.json()["map"]["regions"] if item["id"] == region["id"])
    assert len(region["holes"]) == 1
    assert subtracted.json()["map"]["walkable_areas"][0]["holes"] == region["holes"]

    expanded = client.post(
        "/api/map/regions/boolean",
        json={
            "target_ids": [region["id"]],
            "operation": "union",
            "points": [
                {"x": 120, "y": 20},
                {"x": 180, "y": 20},
                {"x": 180, "y": 100},
                {"x": 120, "y": 100},
            ],
        },
    )
    assert expanded.status_code == 200
    region = next(item for item in expanded.json()["map"]["regions"] if item["id"] == region["id"])
    assert max(point["x"] for point in region["points"]) == 180

    action = client.post(
        "/api/map/regions/boolean",
        json={
            "target_function": "action",
            "operation": "union",
            "points": [
                {"x": 220, "y": 20},
                {"x": 280, "y": 20},
                {"x": 280, "y": 100},
                {"x": 220, "y": 100},
            ],
        },
    )
    assert action.status_code == 200
    action_world = action.json()["map"]
    action_layer = next(layer for layer in action_world["region_layers"] if layer["function"] == "action")
    assert len(action_layer["polygons"]) == 1
    assert any(area["metadata"].get("function") == "action" for area in action_world["walkable_areas"])

    action_subtract = client.post(
        "/api/map/regions/boolean",
        json={
            "target_function": "action",
            "operation": "subtract",
            "points": [
                {"x": 240, "y": 40},
                {"x": 260, "y": 40},
                {"x": 260, "y": 80},
                {"x": 240, "y": 80},
            ],
        },
    )
    assert action_subtract.status_code == 200
    action_region = next(region for region in action_subtract.json()["map"]["regions"] if region["function"] == "action")
    assert len(action_region["holes"]) == 1


def test_api_region_boolean_target_wins_over_overlaps():
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.map.walkable_areas = []
    api_main.runtime.world.map.obstacles = []
    api_main.runtime.world.map.interaction_zones = []
    api_main.runtime.world.map.regions = [
        api_main.MapRegion(
            id="region_target",
            name="目标区域",
            source="manual",
            function="walkable",
            points=[
                api_main.Point(0, 0),
                api_main.Point(100, 0),
                api_main.Point(100, 100),
                api_main.Point(0, 100),
            ],
        ),
        api_main.MapRegion(
            id="region_other",
            name="相邻区域",
            source="manual",
            function="custom",
            points=[
                api_main.Point(80, 0),
                api_main.Point(180, 0),
                api_main.Point(180, 100),
                api_main.Point(80, 100),
            ],
        ),
    ]
    api_main.runtime.world.map.sync_functional_regions()

    response = client.post(
        "/api/map/regions/boolean",
        json={
            "target_ids": ["region_target"],
            "operation": "union",
            "points": [
                {"x": 100, "y": 0},
                {"x": 140, "y": 0},
                {"x": 140, "y": 100},
                {"x": 100, "y": 100},
            ],
        },
    )

    assert response.status_code == 200
    regions = response.json()["map"]["regions"]
    target = next(region for region in regions if region["id"] == "region_target")
    other = next(region for region in regions if region["id"] == "region_other")
    assert max(point["x"] for point in target["points"]) == 140
    assert min(point["x"] for point in other["points"]) >= 140


def test_api_region_boolean_subtract_can_remove_target_region():
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.map.walkable_areas = []
    api_main.runtime.world.map.obstacles = []
    api_main.runtime.world.map.interaction_zones = []
    api_main.runtime.world.map.regions = [
        api_main.MapRegion(
            id="region_target",
            name="目标区域",
            source="manual",
            function="walkable",
            points=[
                api_main.Point(0, 0),
                api_main.Point(40, 0),
                api_main.Point(40, 40),
                api_main.Point(0, 40),
            ],
        )
    ]
    api_main.runtime.world.map.sync_functional_regions()

    response = client.post(
        "/api/map/regions/boolean",
        json={
            "target_ids": ["region_target"],
            "operation": "subtract",
            "points": [
                {"x": -10, "y": -10},
                {"x": 50, "y": -10},
                {"x": 50, "y": 50},
                {"x": -10, "y": 50},
            ],
        },
    )

    assert response.status_code == 200
    world_map = response.json()["map"]
    assert all(region["id"] != "region_target" for region in world_map["regions"])
    walkable_layer = next(layer for layer in world_map["region_layers"] if layer["function"] == "walkable")
    assert "region_target" not in walkable_layer["region_ids"]


def test_api_records_decision_events_from_model_actions():
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.providers = {"mock": api_main.MockProvider()}
    api_main.runtime.default_provider_id = "mock"
    api_main.runtime.action_prefilter_enabled = False
    api_main.runtime.world.running = True
    api_main.runtime.world.tick = 7

    response = client.post("/api/simulation/tick")
    assert response.status_code == 200

    response = client.post("/api/simulation/tick")
    assert response.status_code == 200
    payload = response.json()
    assert payload["decision_events"]
    decision = payload["decision_events"][-1]
    assert decision["agent_id"] in payload["agent_profiles"]
    assert decision["provider"] == "mock"
    api_main.runtime.action_prefilter_enabled = True
    assert decision["results"]
    assert any(event["id"] == decision["results"][0]["event_id"] for event in payload["events"])


def test_api_syncs_enabled_llm_model_to_runtime_provider():
    client = TestClient(app)

    response = client.patch(
        "/api/models",
        json={
            "models": [
                {
                    "id": "model_test_llm",
                    "name": "测试 LLM",
                    "kind": "local",
                    "provider": "ollama",
                    "base_url": "http://127.0.0.1:11434",
                    "api_key": "",
                    "model": "qwen2.5:7b",
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
            ]
        },
    )

    assert response.status_code == 200
    assert api_main.runtime.default_provider_id == "model_test_llm"
    assert api_main.runtime.providers["model_test_llm"].name == "ollama"
    assert api_main.runtime.providers["model_test_llm"].model == "qwen2.5:7b"

    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200
    assert api_main.runtime.default_provider_id == "mock"


def test_api_model_capability_status_and_one_click_config(monkeypatch):
    client = TestClient(app)

    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200
    monkeypatch.setattr(api_main, "_detect_ollama_models", lambda: ["qwen2.5:1.5b", "qwen2.5:7b", "qwen2.5vl:3b"])
    monkeypatch.setattr(api_main, "_recommended_llm_model_for_device", lambda local_environment=None: "qwen2.5:7b")
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
    assert [option["model"] for option in llm["local_options"]]
    assert next(option for option in llm["local_options"] if option["model"] == "qwen2.5:7b")["recommended"] is True
    assert llm["device_recommendation"]["python_required"] is False
    assert sam["status"] == "installable"
    assert sam["installable"] is True

    configured = client.post("/api/model-capabilities/llm/configure-local", json={"model": "qwen2.5:1.5b"})
    assert configured.status_code == 200
    models = configured.json()["models"]
    assert any(model["id"] == "model_local_llm" and model["model"] == "qwen2.5:1.5b" for model in models)
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
    assert sam_model["api_key"] == ""
    assert sam_model["api_key_set"] is True
    assert sam_model["base_url"] == "http://localhost:8001/segment"
    stored_sam = next(model for model in api_main.store.load_model_configs() if model["id"] == "model_remote_sam")
    assert stored_sam["api_key"] == "local-dev-key"


def test_api_llm_capability_is_installable_without_pulled_model(monkeypatch):
    client = TestClient(app)

    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200
    monkeypatch.setattr(api_main, "_detect_ollama_models", lambda: [])
    monkeypatch.setattr(api_main, "_detect_local_model_services", lambda: {})
    monkeypatch.setattr(api_main, "_recommended_llm_model_for_device", lambda local_environment=None: "qwen2.5:3b")

    status = client.get("/api/model-capabilities/status")
    assert status.status_code == 200
    llm = next(item for item in status.json()["capabilities"] if item["id"] == "llm")
    assert llm["status"] == "installable"
    assert llm["installable"] is True
    assert llm["recommended_local"] is None
    assert llm["device_recommendation"]["model"] == "qwen2.5:3b"
    assert next(option for option in llm["local_options"] if option["model"] == "qwen2.5:3b")["selected_by_default"] is True


def test_api_remote_models_filters_by_capability(monkeypatch):
    client = TestClient(app)

    def fake_openai_json_request(config, method, path, body=None, timeout=30):
        assert method == "GET"
        assert path == "models"
        return {
            "data": [
                {"id": "gpt-5.4-mini"},
                {"id": "claude-opus-4-7"},
                {"id": "gpt-image-2"},
                {"id": "text-embedding-3-small"},
            ]
        }

    monkeypatch.setattr(api_main, "_openai_json_request", fake_openai_json_request)

    llm = client.post(
        "/api/model-capabilities/llm/remote-models",
        json={"base_url": "https://api.example.test/v1", "api_key": "secret", "model": ""},
    )
    image = client.post(
        "/api/model-capabilities/image_generation/remote-models",
        json={"base_url": "https://api.example.test/v1", "api_key": "secret", "model": ""},
    )

    assert llm.status_code == 200
    assert [model["id"] for model in llm.json()["models"]] == ["claude-opus-4-7", "gpt-5.4-mini"]
    assert image.status_code == 200
    assert [model["id"] for model in image.json()["models"]] == ["gpt-image-2"]


def test_api_remote_llm_test_reports_success_and_provider_errors(monkeypatch):
    client = TestClient(app)
    failure = {"enabled": False}

    def fake_openai_json_request(config, method, path, body=None, timeout=30):
        assert path == "chat/completions"
        assert body["response_format"] == {"type": "json_object"}
        if failure["enabled"]:
            raise api_main.RemoteProviderError("HTTP 400: bad request")
        return {
            "model": "gpt-5.4-mini-test",
            "choices": [{"message": {"content": "{\"text\":\"ok\",\"actions\":[]}"}}],
        }

    monkeypatch.setattr(api_main, "_openai_json_request", fake_openai_json_request)

    ok = client.post(
        "/api/model-capabilities/llm/test-remote",
        json={"base_url": "https://api.example.test/v1", "api_key": "secret", "model": "gpt-5.4-mini"},
    )
    assert ok.status_code == 200
    assert ok.json()["ok"] is True
    assert ok.json()["sample"] == "{\"text\":\"ok\",\"actions\":[]}"

    failure["enabled"] = True
    bad = client.post(
        "/api/model-capabilities/llm/test-remote",
        json={"base_url": "https://api.example.test/v1", "api_key": "secret", "model": "claude-opus-4-7"},
    )
    assert bad.status_code == 200
    assert bad.json()["ok"] is False
    assert "HTTP 400" in bad.json()["message"]


def test_api_remote_config_hides_and_preserves_api_key():
    client = TestClient(app)

    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200
    first = client.post(
        "/api/model-capabilities/llm/configure-remote",
        json={"base_url": "https://api.example.test/v1", "api_key": "first-secret", "model": "gpt-5.4-mini"},
    )
    assert first.status_code == 200
    public = next(model for model in first.json()["models"] if model["id"] == "model_remote_llm")
    assert public["api_key"] == ""
    assert public["api_key_set"] is True

    second = client.post(
        "/api/model-capabilities/llm/configure-remote",
        json={"base_url": "https://api.example.test/v1", "api_key": "", "model": "gpt-5.4"},
    )
    assert second.status_code == 200
    stored = next(model for model in api_main.store.load_model_configs() if model["id"] == "model_remote_llm")
    assert stored["api_key"] == "first-secret"
    assert stored["model"] == "gpt-5.4"


def test_api_map_generation_uses_remote_openai_images_b64(monkeypatch):
    client = TestClient(app)

    assert client.patch(
        "/api/models",
        json={
            "models": [
                *default_model_configs(),
                {
                    "id": "model_remote_image",
                    "name": "Remote image",
                    "kind": "remote",
                    "provider": "openai-compatible",
                    "base_url": "https://api.example.test/v1",
                    "api_key": "image-secret",
                    "model": "gpt-image-2",
                    "enabled": True,
                    "capabilities": ["image_generation"],
                },
            ]
        },
    ).status_code == 200

    def fake_openai_json_request(config, method, path, body=None, timeout=30):
        assert method == "POST"
        assert path == "images/generations"
        assert body["model"] == "gpt-image-2"
        return {"data": [{"b64_json": api_main.base64.b64encode(b"fake-png").decode("ascii")}]}

    monkeypatch.setattr(api_main, "_openai_json_request", fake_openai_json_request)

    response = client.post(
        "/api/map/generation",
        json={"prompt": "city map", "width": 1280, "height": 720, "ratio": "16:9", "count": 1, "provider_id": "model_remote_image"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider_id"] == "model_remote_image"
    assert payload["candidates"][0]["provider_id"] == "model_remote_image"
    assert payload["candidates"][0]["url"].startswith("/api/assets/")
    asset_name = payload["candidates"][0]["url"].rsplit("/", 1)[-1]
    assert (api_main.store.assets_dir / asset_name).read_bytes() == b"fake-png"


def test_openai_image_provider_accepts_url_candidates(monkeypatch):
    downloaded = {"url": ""}

    def fake_openai_json_request(config, method, path, body=None, timeout=30):
        return {"data": [{"url": "https://cdn.example.test/image.png"}]}

    def fake_download(url, api_key="", base_url=""):
        downloaded["url"] = url
        assert api_key == "image-secret"
        return b"remote-image", ".png"

    monkeypatch.setattr(api_main, "_openai_json_request", fake_openai_json_request)
    monkeypatch.setattr(api_main, "_download_generated_image", fake_download)

    candidates = api_main._call_openai_image_provider(
        {
            "id": "model_remote_image",
            "provider": "image-http",
            "base_url": "https://api.example.test/v1",
            "api_key": "image-secret",
            "model": "gpt-image-2",
        },
        "gen_url_test",
        "map",
        1024,
        1024,
        1,
    )

    assert downloaded["url"] == "https://cdn.example.test/image.png"
    assert candidates[0]["url"].startswith("/api/assets/")


def test_openai_compatible_request_prefers_v1_for_relay_root(monkeypatch):
    calls = []

    class FakeResponse:
        def __init__(self, body: str):
            self.body = body.encode("utf-8")

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return self.body

    def fake_urlopen(request, timeout=30):
        calls.append(request.full_url)
        if request.full_url == "https://relay.example.test/v1/models":
            return FakeResponse('{"data":[{"id":"gpt-image-2"}]}')
        return FakeResponse("<html>relay home</html>")

    monkeypatch.setattr(api_main.urlrequest, "urlopen", fake_urlopen)

    data = api_main._openai_json_request(
        {
            "base_url": "https://relay.example.test",
            "api_key": "secret",
            "model": "gpt-image-2",
        },
        "GET",
        "models",
    )

    assert calls == ["https://relay.example.test/v1/models"]
    assert data["data"][0]["id"] == "gpt-image-2"


def test_api_image_layer_generation_without_real_provider_returns_error():
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.map.background_image = None
    api_main.runtime.world.map.image_layers = []
    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200

    response = client.post(
        "/api/map/image-layers/generate",
        json={
            "prompt": "透明区域花园",
            "selection": {
                "type": "polygon",
                "points": [{"x": 20, "y": 30}, {"x": 180, "y": 30}, {"x": 180, "y": 140}, {"x": 20, "y": 140}],
            },
            "mode": "region",
            "reference_background": False,
        },
    )

    assert response.status_code == 400
    assert "未配置真实图片生成模型" in response.json()["detail"]
    assert api_main.runtime.world.map.image_layers == []


def test_api_image_layer_generation_explicit_mock_without_background_creates_alpha_layer():
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.map.background_image = None
    api_main.runtime.world.map.image_layers = []
    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200

    response = client.post(
        "/api/map/image-layers/generate",
        json={
            "prompt": "透明区域花园",
            "selection": {
                "type": "polygon",
                "points": [{"x": 20, "y": 30}, {"x": 180, "y": 30}, {"x": 180, "y": 140}, {"x": 20, "y": 140}],
            },
            "mode": "region",
            "reference_background": False,
            "provider_id": "model_mock_image",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    layer = payload["layer"]
    assert layer["kind"] == "region"
    assert layer["image"].startswith("/api/assets/")
    assert payload["world"]["map"]["image_layers"][0]["id"] == layer["id"]
    asset_name = layer["image"].rsplit("/", 1)[-1]
    assert (api_main.store.assets_dir / asset_name).exists()


def test_api_polygon_image_layer_generation_prompt_is_shape_aware(monkeypatch):
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.map.background_image = None
    api_main.runtime.world.map.image_layers = []
    client.patch(
        "/api/models",
        json={
            "models": [
                {
                    "id": "model_remote_image",
                    "name": "Remote image",
                    "kind": "remote",
                    "provider": "image-http",
                    "base_url": "https://api.example.test/v1",
                    "api_key": "image-secret",
                    "model": "gpt-image-2",
                    "enabled": True,
                    "capabilities": ["image_generation"],
                }
            ]
        },
    )
    generated_prompt = ""

    def fake_openai_json_request(config, method, path, body=None, timeout=30):
        nonlocal generated_prompt
        assert path == "images/generations"
        assert body["background"] == "transparent"
        assert body["output_format"] == "png"
        generated_prompt = body["prompt"]
        import io
        from PIL import Image

        output = io.BytesIO()
        Image.new("RGBA", (128, 128), (80, 180, 220, 255)).save(output, format="PNG")
        return {"data": [{"b64_json": api_main.base64.b64encode(output.getvalue()).decode("ascii")}]}

    monkeypatch.setattr(api_main, "_openai_json_request", fake_openai_json_request)

    response = client.post(
        "/api/map/image-layers/generate",
        json={
            "prompt": "一个三角形飞船",
            "selection": {
                "type": "polygon",
                "points": [{"x": 20, "y": 20}, {"x": 160, "y": 60}, {"x": 60, "y": 180}],
            },
            "mode": "region",
            "reference_background": False,
            "provider_id": "model_remote_image",
        },
    )

    assert response.status_code == 200
    assert "Create a native transparent PNG layer asset for the selected shape" in generated_prompt
    assert "not a rectangular scene" in generated_prompt
    assert "custom hand-drawn polygon" in generated_prompt
    assert "Normalized polygon vertices" in generated_prompt


def test_api_image_layer_generation_preserves_native_provider_alpha(monkeypatch):
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.map.background_image = None
    api_main.runtime.world.map.image_layers = []
    client.patch(
        "/api/models",
        json={
            "models": [
                {
                    "id": "model_remote_image",
                    "name": "Remote image",
                    "kind": "remote",
                    "provider": "image-http",
                    "base_url": "https://api.example.test/v1",
                    "api_key": "image-secret",
                    "model": "gpt-image-2",
                    "enabled": True,
                    "capabilities": ["image_generation"],
                }
            ]
        },
    )

    def fake_openai_json_request(config, method, path, body=None, timeout=30):
        assert body["background"] == "transparent"
        import io
        from PIL import Image, ImageDraw

        output = io.BytesIO()
        image = Image.new("RGBA", (128, 128), (255, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.ellipse((48, 48, 80, 80), fill=(30, 160, 240, 255))
        image.save(output, format="PNG")
        return {"data": [{"b64_json": api_main.base64.b64encode(output.getvalue()).decode("ascii")}]}

    monkeypatch.setattr(api_main, "_openai_json_request", fake_openai_json_request)

    response = client.post(
        "/api/map/image-layers/generate",
        json={
            "prompt": "一个原生态透明圆形能量核心",
            "selection": {
                "type": "polygon",
                "points": [{"x": 0, "y": 0}, {"x": 128, "y": 0}, {"x": 128, "y": 128}, {"x": 0, "y": 128}],
            },
            "mode": "region",
            "reference_background": False,
            "provider_id": "model_remote_image",
        },
    )

    assert response.status_code == 200
    from PIL import Image

    asset_name = response.json()["layer"]["image"].rsplit("/", 1)[-1]
    saved = Image.open(api_main.store.assets_dir / asset_name).convert("RGBA")
    assert saved.getpixel((8, 8))[3] == 0
    assert saved.getpixel((64, 64))[3] == 255


def test_api_image_layer_generation_retries_without_transparency_options_for_older_relays(monkeypatch):
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.map.background_image = None
    api_main.runtime.world.map.image_layers = []
    client.patch(
        "/api/models",
        json={
            "models": [
                {
                    "id": "model_remote_image",
                    "name": "Remote image",
                    "kind": "remote",
                    "provider": "image-http",
                    "base_url": "https://api.example.test/v1",
                    "api_key": "image-secret",
                    "model": "gpt-image-2",
                    "enabled": True,
                    "capabilities": ["image_generation"],
                }
            ]
        },
    )
    bodies: list[dict[str, object]] = []

    def fake_openai_json_request(config, method, path, body=None, timeout=30):
        bodies.append(dict(body or {}))
        if body and "background" in body:
            raise api_main.RemoteProviderError("unknown parameter: background")
        import io
        from PIL import Image

        output = io.BytesIO()
        Image.new("RGBA", (64, 64), (40, 180, 90, 255)).save(output, format="PNG")
        return {"data": [{"b64_json": api_main.base64.b64encode(output.getvalue()).decode("ascii")}]}

    monkeypatch.setattr(api_main, "_openai_json_request", fake_openai_json_request)

    response = client.post(
        "/api/map/image-layers/generate",
        json={
            "prompt": "兼容旧中转站的透明图层",
            "selection": {"type": "rect", "x": 10, "y": 10, "width": 64, "height": 64},
            "mode": "region",
            "reference_background": False,
            "provider_id": "model_remote_image",
        },
    )

    assert response.status_code == 200
    assert bodies[0]["background"] == "transparent"
    assert "background" not in bodies[1]


def test_api_image_layer_generation_with_background_uses_edit_path(monkeypatch):
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.map.image_layers = []
    background = api_main.store.assets_dir / "test-layer-bg.png"
    background.parent.mkdir(parents=True, exist_ok=True)
    from PIL import Image

    Image.new("RGBA", (256, 256), (80, 120, 160, 255)).save(background)
    api_main.runtime.world.map.background_image = "/api/assets/test-layer-bg.png"
    client.patch(
        "/api/models",
        json={
            "models": [
                {
                    "id": "model_remote_image",
                    "name": "Remote image",
                    "kind": "remote",
                    "provider": "image-http",
                    "base_url": "https://api.example.test/v1",
                    "api_key": "image-secret",
                    "model": "gpt-image-2",
                    "enabled": True,
                    "capabilities": ["image_generation"],
                }
            ]
        },
    )
    called = {"path": ""}

    def fake_openai_json_request(config, method, path, body=None, timeout=30):
        called["path"] = path
        assert method == "POST"
        assert body["image"]
        assert body["mask"]
        import io

        output = io.BytesIO()
        Image.new("RGBA", (90, 80), (200, 120, 80, 255)).save(output, format="PNG")
        return {"data": [{"b64_json": api_main.base64.b64encode(output.getvalue()).decode("ascii")}]}

    monkeypatch.setattr(api_main, "_openai_json_request", fake_openai_json_request)

    response = client.post(
        "/api/map/image-layers/generate",
        json={
            "prompt": "参考背景生成小屋",
            "selection": {"type": "rect", "x": 10, "y": 12, "width": 90, "height": 80},
            "mode": "region",
            "reference_background": True,
            "provider_id": "model_remote_image",
        },
    )

    assert response.status_code == 200
    assert called["path"] == "images/edits"
    assert response.json()["layer"]["kind"] == "region"


def test_api_image_layer_generation_edit_failure_falls_back_to_real_generation(monkeypatch):
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.map.image_layers = []
    background = api_main.store.assets_dir / "test-layer-bg-fallback.png"
    background.parent.mkdir(parents=True, exist_ok=True)
    from PIL import Image

    Image.new("RGBA", (256, 256), (80, 120, 160, 255)).save(background)
    api_main.runtime.world.map.background_image = "/api/assets/test-layer-bg-fallback.png"
    client.patch(
        "/api/models",
        json={
            "models": [
                {
                    "id": "model_remote_image",
                    "name": "Remote image",
                    "kind": "remote",
                    "provider": "image-http",
                    "base_url": "https://api.example.test/v1",
                    "api_key": "image-secret",
                    "model": "gpt-image-2",
                    "enabled": True,
                    "capabilities": ["image_generation"],
                }
            ]
        },
    )
    called: list[str] = []

    def fake_openai_json_request(config, method, path, body=None, timeout=30):
        called.append(path)
        if path == "images/edits":
            raise api_main.RemoteProviderError("edit endpoint unsupported")
        assert path == "images/generations"
        assert "stripe pattern" in body["prompt"]
        import io

        output = io.BytesIO()
        Image.new("RGBA", (90, 80), (60, 160, 220, 255)).save(output, format="PNG")
        return {"data": [{"b64_json": api_main.base64.b64encode(output.getvalue()).decode("ascii")}]}

    monkeypatch.setattr(api_main, "_openai_json_request", fake_openai_json_request)

    response = client.post(
        "/api/map/image-layers/generate",
        json={
            "prompt": "参考背景生成飞船",
            "selection": {"type": "rect", "x": 10, "y": 12, "width": 90, "height": 80},
            "mode": "region",
            "reference_background": True,
            "provider_id": "model_remote_image",
        },
    )

    assert response.status_code == 200
    assert called == ["images/edits", "images/generations"]
    layer = response.json()["layer"]
    assert layer["kind"] == "region"
    assert "mock" not in layer["image"]
    assert len(api_main.runtime.world.map.image_layers) == 1


def test_api_extension_fallback_prompt_uses_background_cues_not_hardcoded_map_style(monkeypatch):
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.map.width = 256
    api_main.runtime.world.map.height = 256
    api_main.runtime.world.map.image_layers = []
    background = api_main.store.assets_dir / "test-grey-room-bg.png"
    background.parent.mkdir(parents=True, exist_ok=True)
    from PIL import Image

    Image.new("RGBA", (256, 256), (92, 92, 92, 255)).save(background)
    api_main.runtime.world.map.background_image = "/api/assets/test-grey-room-bg.png"
    client.patch(
        "/api/models",
        json={
            "models": [
                {
                    "id": "model_remote_image",
                    "name": "Remote image",
                    "kind": "remote",
                    "provider": "image-http",
                    "base_url": "https://api.example.test/v1",
                    "api_key": "image-secret",
                    "model": "gpt-image-2",
                    "enabled": True,
                    "capabilities": ["image_generation"],
                }
            ]
        },
    )
    generation_prompt = ""

    def fake_openai_json_request(config, method, path, body=None, timeout=30):
        nonlocal generation_prompt
        if path == "images/edits":
            raise api_main.RemoteProviderError("edit endpoint unsupported")
        assert path == "images/generations"
        generation_prompt = body["prompt"]
        import io

        output = io.BytesIO()
        Image.new("RGBA", (96, 180), (90, 90, 90, 255)).save(output, format="PNG")
        return {"data": [{"b64_json": api_main.base64.b64encode(output.getvalue()).decode("ascii")}]}

    monkeypatch.setattr(api_main, "_openai_json_request", fake_openai_json_request)

    response = client.post(
        "/api/map/image-layers/generate",
        json={
            "prompt": "向左扩展这张室内背景",
            "selection": {"type": "rect", "x": -96, "y": 20, "width": 96, "height": 180},
            "mode": "extension",
            "reference_background": True,
            "provider_id": "model_remote_image",
        },
    )

    assert response.status_code == 200
    assert "left outside edge" in generation_prompt
    assert "mostly gray/neutral surfaces" in generation_prompt
    assert "Do not switch to a top-down fantasy map unless the source background is already that style" in generation_prompt
    monitor = client.get("/api/runtime/status").json()
    image_tasks = monitor["simulation"]["recent_image_generation_tasks"]
    assert image_tasks[0]["operation"] == "extension"
    assert image_tasks[0]["status"] == "done"
    assert response.json()["world"]["map"]["width"] == 256


def test_api_image_layer_generation_real_provider_failure_does_not_create_mock(monkeypatch):
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.map.background_image = None
    api_main.runtime.world.map.image_layers = []
    client.patch(
        "/api/models",
        json={
            "models": [
                {
                    "id": "model_remote_image",
                    "name": "Remote image",
                    "kind": "remote",
                    "provider": "image-http",
                    "base_url": "https://api.example.test/v1",
                    "api_key": "image-secret",
                    "model": "gpt-image-2",
                    "enabled": True,
                    "capabilities": ["image_generation"],
                }
            ]
        },
    )

    def fake_openai_json_request(config, method, path, body=None, timeout=30):
        raise api_main.RemoteProviderError("upstream unavailable")

    monkeypatch.setattr(api_main, "_openai_json_request", fake_openai_json_request)

    response = client.post(
        "/api/map/image-layers/generate",
        json={
            "prompt": "真实服务失败时不要 mock",
            "selection": {"type": "rect", "x": 10, "y": 12, "width": 90, "height": 80},
            "mode": "region",
            "reference_background": False,
            "provider_id": "model_remote_image",
        },
    )

    assert response.status_code == 502
    assert "Image generation failed" in response.json()["detail"]
    assert api_main.runtime.world.map.image_layers == []


def test_api_extension_layer_expands_map_and_layer_management():
    client = TestClient(app)
    api_main.runtime.world = api_main.GameWorld.default()
    api_main.runtime.world.map.width = 100
    api_main.runtime.world.map.height = 100
    api_main.runtime.world.map.image_layers = []
    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200

    generated = client.post(
        "/api/map/image-layers/generate",
        json={
            "prompt": "向右扩展森林边缘",
            "selection": {"type": "rect", "x": 80, "y": 20, "width": 90, "height": 60},
            "mode": "extension",
            "reference_background": False,
            "provider_id": "model_mock_image",
        },
    )
    assert generated.status_code == 200
    layer = generated.json()["layer"]
    assert generated.json()["world"]["map"]["width"] == 170
    assert layer["kind"] == "extension"

    patched = client.patch(
        f"/api/map/image-layers/{layer['id']}",
        json={"name": "右侧森林", "hidden": True, "opacity": 0.45},
    )
    assert patched.status_code == 200
    patched_layer = patched.json()["map"]["image_layers"][0]
    assert patched_layer["name"] == "右侧森林"
    assert patched_layer["hidden"] is True
    assert patched_layer["opacity"] == 0.45

    deleted = client.delete(f"/api/map/image-layers/{layer['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["map"]["image_layers"] == []


def test_api_llm_install_task_pulls_default_qwen_and_configures(monkeypatch):
    client = TestClient(app)
    pulled = []

    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200
    monkeypatch.setattr(api_main, "_ensure_ollama_executable", lambda allow_install=True: "ollama")
    monkeypatch.setattr(api_main, "_wait_for_ollama_service", lambda timeout_seconds: True)
    monkeypatch.setattr(api_main, "_start_ollama_service", lambda executable: None)
    monkeypatch.setattr(api_main, "_detect_local_model_services", lambda: {})
    monkeypatch.setattr(api_main, "_recommended_llm_model_for_device", lambda local_environment=None: "qwen2.5:1.5b")
    monkeypatch.setattr(
        api_main,
        "_detect_ollama_models",
        lambda: list(pulled),
    )

    def fake_pull(executable, model):
        assert executable == "ollama"
        pulled.append(model)
        return True

    monkeypatch.setattr(api_main, "_ollama_pull_model", fake_pull)
    monkeypatch.setattr(
        api_main,
        "_start_llm_install_task",
        lambda task_id, payload=None: api_main._run_llm_install_task(task_id, *api_main._selected_llm_install_models(payload)),
    )

    response = client.post("/api/model-capabilities/llm/install-local")
    assert response.status_code == 200
    task_id = response.json()["task"]["id"]
    task = client.get(f"/api/model-capabilities/tasks/{task_id}").json()["task"]
    assert task["status"] == "done"
    assert "qwen2.5:1.5b" in pulled

    models = client.get("/api/models").json()["models"]
    llm = next(model for model in models if model["id"] == "model_local_llm")
    assert llm["model"] == "qwen2.5:1.5b"
    assert api_main.runtime.default_provider_id == "model_local_llm"
    assert api_main.runtime.providers["model_local_llm"].model == "qwen2.5:1.5b"


def test_api_llm_install_task_uses_winget_when_ollama_missing(monkeypatch):
    client = TestClient(app)
    installed = {"done": False}

    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200

    def fake_ensure(allow_install=True):
        if not installed["done"]:
            assert allow_install is True
            installed["done"] = True
        return "ollama"

    monkeypatch.setattr(api_main, "_ensure_ollama_executable", fake_ensure)
    monkeypatch.setattr(api_main, "_wait_for_ollama_service", lambda timeout_seconds: True)
    monkeypatch.setattr(api_main, "_detect_ollama_models", lambda: [])
    monkeypatch.setattr(api_main, "_recommended_llm_model_for_device", lambda local_environment=None: "qwen2.5:1.5b")
    monkeypatch.setattr(api_main, "_ollama_pull_model", lambda executable, model: True)
    monkeypatch.setattr(
        api_main,
        "_start_llm_install_task",
        lambda task_id, payload=None: api_main._run_llm_install_task(task_id, *api_main._selected_llm_install_models(payload)),
    )

    response = client.post("/api/model-capabilities/llm/install-local")
    assert response.status_code == 200
    task = client.get(f"/api/model-capabilities/tasks/{response.json()['task']['id']}").json()["task"]
    assert task["status"] == "done"
    assert installed["done"] is True


def test_api_llm_install_task_surfaces_pull_failure(monkeypatch):
    client = TestClient(app)

    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200
    monkeypatch.setattr(api_main, "_ensure_ollama_executable", lambda allow_install=True: "ollama")
    monkeypatch.setattr(api_main, "_wait_for_ollama_service", lambda timeout_seconds: True)
    monkeypatch.setattr(api_main, "_detect_ollama_models", lambda: [])
    monkeypatch.setattr(api_main, "_recommended_llm_model_for_device", lambda local_environment=None: "qwen2.5:1.5b")
    monkeypatch.setattr(api_main, "_install_ollama_for_platform", lambda: False)
    monkeypatch.setattr(api_main, "_ollama_pull_model", lambda executable, model: False)
    monkeypatch.setattr(
        api_main,
        "_start_llm_install_task",
        lambda task_id, payload=None: api_main._run_llm_install_task(task_id, *api_main._selected_llm_install_models(payload)),
    )

    response = client.post("/api/model-capabilities/llm/install-local")
    assert response.status_code == 200
    task = client.get(f"/api/model-capabilities/tasks/{response.json()['task']['id']}").json()["task"]
    assert task["status"] == "error"
    assert "qwen2.5:1.5b" in task["error"]


def test_api_llm_recommends_existing_gemma_when_qwen_missing(monkeypatch):
    client = TestClient(app)

    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200
    monkeypatch.setattr(api_main, "_detect_ollama_models", lambda: ["gemma3:1b"])
    monkeypatch.setattr(api_main, "_detect_local_model_services", lambda: {})

    status = client.get("/api/model-capabilities/status")
    llm = next(item for item in status.json()["capabilities"] if item["id"] == "llm")
    assert llm["status"] == "local_available"
    assert llm["recommended_local"]["model"] == "gemma3:1b"

    configured = client.post("/api/model-capabilities/llm/configure-local")
    assert configured.status_code == 200
    assert configured.json()["capability"]["configured_model_name"] == "本地 LLM - gemma3:1b"


def test_api_mac_local_llm_diagnostics_reports_recovery_commands(monkeypatch):
    client = TestClient(app)

    assert client.patch("/api/models", json={"models": default_model_configs()}).status_code == 200
    monkeypatch.setattr(api_main.shutil, "which", lambda name: "/opt/homebrew/bin/brew" if name == "brew" else None)
    monkeypatch.setattr(api_main, "_ollama_service_reachable", lambda: False)
    monkeypatch.setattr(api_main, "_detect_ollama_models", lambda: [])
    monkeypatch.setattr(api_main, "_mac_hardware_summary", lambda: {"chip": "Apple M4", "memory_gb": 16.0})

    response = client.get("/api/local-llm/mac-diagnostics")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["homebrew"]["available"] is True
    assert payload["ollama"]["installed"] is False
    assert "brew install ollama" in payload["recommendation"]["commands"]
    assert "ollama pull qwen2.5:7b" in payload["recommendation"]["commands"]
    assert payload["recommendation"]["small_llm"] == "qwen2.5:1.5b"


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
    assert len(payload["world"]["map"]["regions"][0]["points"]) >= 4


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


def test_api_auto_label_region_with_local_vision(monkeypatch):
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
                    "id": "model_local_vision",
                    "name": "本地图像识别 - qwen2.5vl:3b",
                    "kind": "local",
                    "provider": "ollama",
                    "base_url": "http://127.0.0.1:11434",
                    "model": "qwen2.5vl:3b",
                    "enabled": True,
                    "capabilities": ["vision_labeling"],
                }
            ]
        },
    )
    api_main.runtime.world.map.regions = [
        api_main.MapRegion(
            id="region_label_test",
            name="SAM 分区 1",
            function="unassigned",
            source="model_local_sam_embedded",
            points=[
                api_main.Point(10, 10),
                api_main.Point(120, 10),
                api_main.Point(120, 100),
                api_main.Point(10, 100),
            ],
            notes="待命名",
            tags=["MobileSAM"],
        )
    ]

    monkeypatch.setattr(
        api_main,
        "_label_region_with_model",
        lambda config, world_map, region: {"name": "石板路", "notes": "一段穿过场景中央的道路。", "tags": ["道路", "通行"]},
    )
    response = client.post("/api/map/regions/region_label_test/auto-label")

    assert response.status_code == 200
    region = next(region for region in response.json()["map"]["regions"] if region["id"] == "region_label_test")
    assert region["name"] == "石板路"
    assert "道路" in region["tags"]


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
