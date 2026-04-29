from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse


@dataclass(slots=True)
class ModelRequest:
    agent_id: str
    role: str
    identity: str
    observation: dict[str, Any]
    action_space: list[str]
    system_prompt: str = ""


@dataclass(slots=True)
class ModelResponse:
    text: str
    actions: list[dict[str, Any]] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)


class ModelProvider(ABC):
    name: str

    @abstractmethod
    async def generate(self, request: ModelRequest) -> ModelResponse:
        """Return language and optional structured actions without mutating the world."""


class MockProvider(ModelProvider):
    name = "mock"

    async def generate(self, request: ModelRequest) -> ModelResponse:
        agent_name = request.observation.get("agent_name", request.agent_id)
        tick = int(request.observation.get("tick", 0))
        dialogue_candidates = request.observation.get("dialogue_candidates") or []
        nearby_items = request.observation.get("nearby_items") or []
        movement_targets = request.observation.get("movement_targets") or []
        held_item_id = request.observation.get("held_item_id")
        if "social" in request.action_space and dialogue_candidates and tick % 10 == 0:
            target = dialogue_candidates[0]
            target_name = target.get("name", target.get("id", "there"))
            return ModelResponse(
                text=f"{agent_name} notices {target_name} nearby.",
                actions=[
                    {
                        "type": "social",
                        "payload": {
                            "target_agent_id": target.get("id"),
                            "text": f"Hi {target_name}, what are you noticing here?",
                        },
                    }
                ],
            )
        movable_items = [item for item in nearby_items if item.get("movable")]
        if "pick_up" in request.action_space and movable_items and not held_item_id and tick % 12 == 0:
            item = movable_items[0]
            return ModelResponse(
                text=f"{agent_name} decides to pick up {item.get('name', item.get('id'))}.",
                actions=[{"type": "pick_up", "payload": {"item_id": item.get("id")}}],
            )
        if "move_to" in request.action_space and movement_targets and tick % 6 == 0:
            target = movement_targets[0]
            return ModelResponse(
                text=f"{agent_name} chooses a nearby destination.",
                actions=[{"type": "move_to", "payload": {"target": target.get("point")}}],
            )
        if "stop" in request.action_space and tick % 14 == 0:
            return ModelResponse(
                text=f"{agent_name} rests for a moment.",
                actions=[{"type": "stop", "payload": {"reason": "rest"}}],
            )
        if "say" in request.action_space and tick % 8 == 0:
            return ModelResponse(
                text=f"{agent_name} shares a quick thought.",
                actions=[
                    {
                        "type": "say",
                        "payload": {"text": f"I am noticing the space at tick {tick}."},
                    }
                ],
            )
        return ModelResponse(
            text=f"{agent_name} waits and watches.",
            actions=[{"type": "wait", "payload": {"duration": 1}}],
        )


class OllamaProvider(ModelProvider):
    name = "ollama"

    def __init__(self, base_url: str = "http://127.0.0.1:11434", model: str = "llama3.1"):
        self.base_url = base_url.rstrip("/")
        self.model = model

    async def generate(self, request: ModelRequest) -> ModelResponse:
        import httpx

        prompt = _request_to_prompt(request)
        async with httpx.AsyncClient(timeout=60, trust_env=_trust_env_for_base_url(self.base_url)) as client:
            response = await client.post(
                f"{self.base_url}/api/generate",
                json={"model": self.model, "prompt": prompt, "stream": False, "format": "json"},
            )
            response.raise_for_status()
            data = response.json()
        return _parse_model_json(data.get("response", ""), raw=data)


class OpenAICompatibleProvider(ModelProvider):
    name = "openai-compatible"

    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    async def generate(self, request: ModelRequest) -> ModelResponse:
        import httpx

        prompt = _request_to_prompt(request)
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        async with httpx.AsyncClient(timeout=60, trust_env=_trust_env_for_base_url(self.base_url)) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json={
                    "model": self.model,
                    "messages": [
                        {
                            "role": "system",
                            "content": request.system_prompt
                            or "Return JSON with keys text and actions.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            data = response.json()
        content = data["choices"][0]["message"]["content"]
        return _parse_model_json(content, raw=data)


def _request_to_prompt(request: ModelRequest) -> str:
    import json

    return (
        "You control one agent in a live 2D game simulation. "
        "Return ONLY valid JSON with this shape: "
        "{\"text\": string, \"actions\": [{\"type\": string, \"payload\": object}]}.\n"
        "Choose at most one action. Use only action types listed in Action space.\n"
        "Supported action payloads:\n"
        "- move_to: {\"target\":{\"x\":number,\"y\":number}} using a point from observation.movement_targets when possible.\n"
        "- social: {\"target_agent_id\": string, \"text\": string} using observation.dialogue_candidates.\n"
        "- stop: {\"reason\":\"rest\"} to stop moving or rest.\n"
        "- pick_up: {\"item_id\": string} only for nearby_items where movable=true.\n"
        "- drop_item: {\"position\":{\"x\":number,\"y\":number}} when holding an item.\n"
        "- move_item: {\"item_id\": string, \"target\":{\"x\":number,\"y\":number}, \"rotation\":number, \"scale\":number} only for movable nearby items.\n"
        "- interact/use: {\"target_id\": string} only for visible nearby targets.\n"
        "- say: {\"text\": string}.\n"
        "- wait: {\"duration\": number}.\n"
        "Do not invent ids. Avoid repeating the same action if recent_events show it just happened.\n"
        f"Agent: {request.agent_id}\n"
        f"Role: {request.role}\n"
        f"Identity: {request.identity}\n"
        f"Action space: {json.dumps(request.action_space, ensure_ascii=False)}\n"
        f"Observation: {json.dumps(request.observation, ensure_ascii=False)}\n"
    )


def _parse_model_json(content: str, raw: dict[str, Any]) -> ModelResponse:
    import json

    content = _extract_json_object(content)
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return ModelResponse(text=content.strip(), actions=[], raw=raw)
    actions = parsed.get("actions", [])
    if not isinstance(actions, list):
        actions = []
    actions = [action for action in actions if isinstance(action, dict)]
    return ModelResponse(text=str(parsed.get("text", "")), actions=actions, raw=raw)


def _extract_json_object(content: str) -> str:
    stripped = content.strip()
    if stripped.startswith("```"):
        lines = [line for line in stripped.splitlines() if not line.strip().startswith("```")]
        stripped = "\n".join(lines).strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        return stripped[start:end + 1]
    return stripped


def _trust_env_for_base_url(base_url: str) -> bool:
    hostname = urlparse(base_url).hostname or ""
    return hostname not in {"localhost", "127.0.0.1", "::1", "0.0.0.0"}
