from fastapi.testclient import TestClient

from agent_engine.api import main as api_main
from agent_engine.api.main import app
from agent_engine.engine.action_extensions import compile_action_extension
from agent_engine.engine.simulation import SimulationRuntime
from agent_engine.engine.world import GameWorld
from agent_engine.persistence.sqlite_store import ProjectStore


SAFE_EXTENSION_CODE = """
ACTION = {
    "type": "wave",
    "description": "Wave to nearby agents.",
    "payload_schema": {"type": "object", "properties": {"text": {"type": "string"}}},
    "permissions": ["emit_event"],
}

def validate(world, agent_id, payload):
    text = str(payload.get("text", "")).strip()
    return (bool(text), "wave requires text")

def apply(world, agent_id, payload):
    profile = world.agent_profiles[agent_id]
    text = str(payload.get("text", "")).strip()
    return {"event_type": "gesture", "message": profile.name + " waves: " + text}
"""


def test_action_extension_registers_persists_and_executes(tmp_path, monkeypatch):
    store = ProjectStore(tmp_path / "project")
    runtime = SimulationRuntime(store.load_world())
    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "runtime", runtime)
    api_main._sync_runtime_model_providers()
    api_main._sync_runtime_action_extensions()

    client = TestClient(app)
    checked = client.post("/api/action-extensions/check", json={"code": SAFE_EXTENSION_CODE})
    assert checked.status_code == 200
    assert checked.json()["ok"] is True
    assert checked.json()["action"]["type"] == "wave"

    created = client.post(
        "/api/action-extensions",
        json={"id": "ext_wave", "name": "Wave", "code": SAFE_EXTENSION_CODE, "enabled": True},
    )
    assert created.status_code == 200
    assert created.json()["extension"]["payload_schema"]["type"] == "object"

    listed = client.get("/api/action-extensions")
    assert listed.json()["extensions"][0]["id"] == "ext_wave"

    action = client.post(
        "/api/actions",
        json={"agent_id": "agent_mira", "type": "wave", "payload": {"text": "hello"}},
    )
    assert action.status_code == 200
    assert action.json()["ok"] is True
    assert action.json()["event"]["type"] == "gesture"

    patched = client.patch("/api/action-extensions/ext_wave", json={"enabled": False})
    assert patched.status_code == 200
    assert patched.json()["extension"]["enabled"] is False

    deleted = client.delete("/api/action-extensions/ext_wave")
    assert deleted.status_code == 200
    assert deleted.json()["extensions"] == []


def test_action_extension_rejects_dangerous_code(tmp_path, monkeypatch):
    store = ProjectStore(tmp_path / "project")
    runtime = SimulationRuntime(store.load_world())
    monkeypatch.setattr(api_main, "store", store)
    monkeypatch.setattr(api_main, "runtime", runtime)
    api_main._sync_runtime_model_providers()
    api_main._sync_runtime_action_extensions()
    client = TestClient(app)

    dangerous = "import os\nACTION = {'type':'bad','description':'bad','payload_schema':{},'permissions':[]}\ndef validate(world, agent_id, payload): return True\ndef apply(world, agent_id, payload): return True"
    checked = client.post("/api/action-extensions/check", json={"code": dangerous})
    assert checked.status_code == 200
    assert checked.json()["ok"] is False
    assert "not allowed" in checked.json()["errors"][0]

    created = client.post("/api/action-extensions", json={"code": dangerous})
    assert created.status_code == 400


def test_enabled_extension_enters_runtime_action_space_and_definitions():
    extension = compile_action_extension({"id": "ext_wave", "code": SAFE_EXTENSION_CODE})
    runtime = SimulationRuntime(GameWorld.default())
    runtime.set_action_extensions([extension])

    assert "wave" in runtime._effective_action_space([])
    assert runtime._action_definitions()[0]["type"] == "wave"
