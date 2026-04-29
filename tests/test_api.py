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

