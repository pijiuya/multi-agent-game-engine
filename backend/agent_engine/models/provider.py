from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


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
        async with httpx.AsyncClient(timeout=60) as client:
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
        async with httpx.AsyncClient(timeout=60) as client:
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
    return (
        "You control one agent in a game simulation. "
        "Return JSON: {\"text\": string, \"actions\": [{\"type\": string, \"payload\": object}]}.\n"
        f"Agent: {request.agent_id}\n"
        f"Role: {request.role}\n"
        f"Identity: {request.identity}\n"
        f"Action space: {request.action_space}\n"
        f"Observation: {request.observation}\n"
    )


def _parse_model_json(content: str, raw: dict[str, Any]) -> ModelResponse:
    import json

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return ModelResponse(text=content.strip(), actions=[], raw=raw)
    actions = parsed.get("actions", [])
    if not isinstance(actions, list):
        actions = []
    return ModelResponse(text=str(parsed.get("text", "")), actions=actions, raw=raw)

