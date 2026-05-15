from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Protocol

from agent_engine.models.provider import ModelProvider, ModelRequest


@dataclass(slots=True)
class SceneDirectorRequest:
    tick: int
    map: dict[str, Any]
    agents: list[dict[str, Any]]
    recent_events: list[dict[str, Any]]
    items: list[dict[str, Any]] = field(default_factory=list)
    narrative: dict[str, Any] = field(default_factory=dict)
    scene_memories: list[dict[str, Any]] = field(default_factory=list)
    narrative_cues: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "tick": self.tick,
            "map": self.map,
            "agents": self.agents,
            "items": self.items,
            "recent_events": self.recent_events,
            "narrative": self.narrative,
            "scene_memories": self.scene_memories,
            "narrative_cues": self.narrative_cues,
        }


@dataclass(slots=True)
class SceneDirectorResponse:
    text: str = ""
    proposal: dict[str, Any] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


class SceneDirector(Protocol):
    name: str

    async def generate(self, request: SceneDirectorRequest) -> SceneDirectorResponse:
        """Return scene-level narrative context without mutating the world."""


class MockSceneDirector:
    name = "mock-scene-director"

    async def generate(self, request: SceneDirectorRequest) -> SceneDirectorResponse:
        active_agents = [agent for agent in request.agents if agent.get("status") != "hidden"]
        premise = str(request.narrative.get("premise") or "The scene keeps changing in small ways.")
        agent_names = ", ".join(str(agent.get("name") or agent.get("id")) for agent in active_agents[:3])
        agent_clause = f"{agent_names} 的下一步会暴露真正的目标" if agent_names else "每一次停顿都像在倒数"
        cue = f"{premise}：空气骤然收紧，{agent_clause}。"
        return SceneDirectorResponse(
            text=cue,
            proposal={
                "events": [
                    {
                        "type": "narration",
                        "message": cue,
                        "payload": {
                            "source": "scene_director",
                            "guidance": "Use this as dramatic pressure for the next agent choices; do not quote it as dialogue.",
                        },
                    }
                ],
                "state_changes": [
                    {
                        "op": "set_agent_narrative_state",
                        "agent_id": agent.get("id"),
                        "key": "focus",
                        "value": "respond_to_scene_pressure",
                    }
                    for agent in active_agents[:3]
                ],
                "memories": [{"agent_id": "__scene__", "kind": "scene", "text": cue}],
            },
            raw={"mock": True},
        )


class LLMSceneDirector:
    name = "llm-scene-director"

    def __init__(self, provider: ModelProvider, model_name: str | None = None):
        self.provider = provider
        self.model_name = model_name or str(getattr(provider, "model", getattr(provider, "name", "llm")))

    async def generate(self, request: SceneDirectorRequest) -> SceneDirectorResponse:
        model_response = await self.provider.generate(
            ModelRequest(
                agent_id="scene_director",
                role="scene_director",
                identity="A scene director that maintains shared narrative state for a live game scene.",
                action_space=["wait"],
                observation=request.to_dict(),
                system_prompt=(
                    "Return ONLY valid JSON for scene direction with keys text and proposal. "
                    "The top-level text must be an independent visible subtitle, preferably in natural zh-CN unless the premise is clearly English. "
                    "Write one short cinematic/stage-like line with pressure, danger, desire, or a turning point. "
                    "Hint at the next trend or choice without speaking for any agent. "
                    "Never write explanatory bookkeeping such as 'visible objects include...' or 'nearby scene items'. "
                    "proposal.events must include exactly one narration/hint/weather/environment event with the same subtitle. "
                    "Use payload.source='scene_director' and include payload.guidance as a brief next-beat directive for agents. "
                    "proposal.state_changes may include set_agent_narrative_state only with keys mood, focus, or urgency, "
                    "for up to three visible agents. Use these to bias the next agent actions/speech trends. "
                    "Allowed memories are scene/cue memories for agent_id '__scene__'. "
                    "Do not include agent actions. Do not quote the subtitle as agent dialogue. "
                    "Use concrete map items only when they have specific non-default names and are genuinely dramatic; ignore generic names such as Item or Object. "
                    "Use item and agent names exactly when you use them."
                ),
            )
        )
        payload = _extract_director_payload(model_response.text, model_response.raw)
        proposal = payload.get("proposal")
        if not isinstance(proposal, dict):
            proposal = {
                "events": payload.get("events", []),
                "state_changes": payload.get("state_changes", []),
                "memories": payload.get("memories", []),
            }
        return SceneDirectorResponse(
            text=str(payload.get("text") or model_response.text or ""),
            proposal=proposal,
            raw=model_response.raw,
        )


class RemoteNarrativeDirector:
    name = "remote-narrative-director"

    def __init__(self, base_url: str, default_model: str = "", timeout_seconds: float = 75.0):
        self.base_url = base_url.rstrip("/")
        self.default_model = default_model
        self.timeout_seconds = max(1.0, float(timeout_seconds))

    async def generate(self, request: SceneDirectorRequest) -> SceneDirectorResponse:
        import httpx

        model = str(request.narrative.get("service_model") or self.default_model or "").strip()
        async with httpx.AsyncClient(timeout=self.timeout_seconds, trust_env=False) as client:
            response = await client.post(
                f"{self.base_url}/api/narrative/subtitle/generate",
                json={"request": request.to_dict(), "model": model},
            )
            response.raise_for_status()
            data = response.json()
        proposal = data.get("proposal")
        return SceneDirectorResponse(
            text=str(data.get("text") or ""),
            proposal=proposal if isinstance(proposal, dict) else {},
            raw=data if isinstance(data, dict) else {},
        )


def _extract_director_payload(text: str, raw: dict[str, Any]) -> dict[str, Any]:
    for candidate in (_raw_content(raw), text):
        if not candidate:
            continue
        parsed = _parse_json_object(candidate)
        if parsed:
            return parsed
    return {"text": text}


def _raw_content(raw: dict[str, Any]) -> str:
    response = raw.get("response")
    if isinstance(response, str):
        return response
    choices = raw.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            message = first.get("message")
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                return message["content"]
    return ""


def _parse_json_object(content: str) -> dict[str, Any]:
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = "\n".join(
            line for line in stripped.splitlines() if not line.strip().startswith("```")
        ).strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        stripped = stripped[start : end + 1]
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}
