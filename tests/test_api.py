from fastapi.testclient import TestClient

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
