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
        visible_items = [item for item in request.items if not item.get("hidden")]
        premise = str(request.narrative.get("premise") or "The scene keeps changing in small ways.")
        item_names = ", ".join(str(item.get("name") or item.get("id")) for item in visible_items[:3])
        item_clause = f" Nearby scene items: {item_names}." if item_names else ""
        cue = f"{premise} {len(active_agents)} visible agent(s) are present.{item_clause}"
        return SceneDirectorResponse(
            text="Scene director updated the shared narrative context.",
            proposal={
                "events": [
                    {
                        "type": "narration",
                        "message": cue,
                        "payload": {"source": "scene_director"},
                    }
                ],
                "state_changes": [
                    {
                        "op": "add_memory",
                        "agent_id": "__scene__",
                        "kind": "scene",
                        "text": cue,
                    }
                ],
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
                    "Return JSON for scene direction with keys text and proposal. "
                    "proposal may contain events and state_changes only. "
                    "Allowed state_changes are set_agent_narrative_state and add_memory. "
                    "Do not include agent actions. Tie narration to concrete map items in observation.items "
                    "or recent item interaction events whenever they exist. Use item names exactly."
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
