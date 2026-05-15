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
    action_definitions: list[dict[str, Any]] = field(default_factory=list)
    language: str = "auto"
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


def _enrich_identity(agent_id: str, agent_name: str, role: str, identity: str) -> str:
    raw_identity = str(identity or "").strip()
    name = str(agent_name or agent_id or "Agent").strip()
    normalized_role = str(role or "resident").strip().lower()
    if raw_identity and not _is_placeholder_identity(raw_identity, name, normalized_role):
        return raw_identity
    if raw_identity and " is " in raw_identity:
        identity_name = raw_identity.split(" is ", 1)[0].strip()
        if identity_name and len(identity_name) <= 40:
            name = identity_name

    role_key = normalized_role.replace(" ", "_")
    if role_key == "mediator" or name.lower() == "mira":
        return (
            f"{name} is a mediator who wants the group to understand what changed between people. "
            "Core desire: make tense moments speakable without flattening them. "
            "Observation preference: who is avoided, who is being listened to, and what object anchors the conversation. "
            "Voice: warm, specific, gently probing. Avoid: generic greetings, identity recaps, and empty reassurance."
        )
    if role_key == "builder" or name.lower() == "tao":
        return (
            f"{name} is a builder who thinks through materials, paths, weight, and practical precision. "
            "Core desire: make the scene more workable and sturdy. "
            "Observation preference: movable objects, road access, spatial constraints, and whether plans can hold up. "
            "Voice: concrete, economical, craft-minded. Avoid: vague philosophizing, generic greetings, and pretending to be social for no reason."
        )
    if role_key == "observer" or name.lower() == "ren":
        return (
            f"{name} is an observer who tracks small patterns in movement, silence, and repeated choices. "
            "Core desire: notice the detail everyone else skipped. "
            "Observation preference: timing, distance, pauses, repeated routes, and mismatches between words and motion. "
            "Voice: quiet, precise, slightly elliptical. Avoid: identity recaps, weather talk, and explaining plans out loud."
        )
    return (
        f"{name} is a resident with a concrete point of view about this place. "
        "Core desire: respond to nearby people and objects as if they matter. "
        "Observation preference: local changes, useful objects, and recent conversation. "
        "Voice: brief, situated, and first-person. Avoid: generic greetings, identity recaps, and action-plan narration."
    )


def _is_placeholder_identity(identity: str, agent_name: str, role: str) -> bool:
    normalized = " ".join(identity.strip().lower().split())
    name = agent_name.strip().lower()
    role = role.strip().lower()
    placeholders = {
        "a curious resident in the scene.",
        "a resident in the scene.",
        f"{name} is a {role} with a distinct social point of view.",
        f"{name} is an {role} with a distinct social point of view.",
    }
    if normalized in {item.lower() for item in placeholders}:
        return True
    return (
        normalized.endswith("with a distinct social point of view.")
        and (
            normalized.startswith(f"{name} is ")
            or f" is a {role} " in normalized
            or f" is an {role} " in normalized
        )
    )


def _effective_dialogue_language(language: str, identity: str) -> str:
    normalized = str(language or "auto").strip()
    if normalized in {"zh-CN", "en-US"}:
        return normalized
    return "zh-CN" if _contains_cjk(identity) else "en-US"


def _contains_cjk(text: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in str(text or ""))


class MockProvider(ModelProvider):
    name = "mock"

    async def generate(self, request: ModelRequest) -> ModelResponse:
        agent_name = request.observation.get("agent_name", request.agent_id)
        tick = int(request.observation.get("tick", 0))
        identity = _enrich_identity(request.agent_id, str(agent_name), request.role, request.identity)
        language = str(
            request.observation.get("effective_dialogue_language")
            or request.observation.get("dialogue_language")
            or request.language
        )
        zh = _effective_dialogue_language(language, identity) == "zh-CN"
        dialogue_candidates = request.observation.get("dialogue_candidates") or []
        nearby_items = request.observation.get("nearby_items") or []
        movement_targets = request.observation.get("movement_targets") or []
        held_item_id = request.observation.get("held_item_id")
        item_name = _mock_item_name(request.observation) if _mock_should_reference_item(request.observation, request.agent_id) else ""
        if "move_to" in request.action_space and movement_targets and tick % 15 == 0:
            target = movement_targets[0]
            return ModelResponse(
                text=f"{agent_name} moves toward a valid region target.",
                actions=[{"type": "move_to", "payload": {"target": target.get("point")}}],
            )
        if "social" in request.action_space and dialogue_candidates and tick % 10 == 0:
            target = dialogue_candidates[0]
            target_name = target.get("name", target.get("id", "there"))
            text = f"{agent_name} 注意到 {target_name} 就在附近。" if zh else f"{agent_name} notices {target_name} nearby."
            speech = _mock_utterance(str(agent_name), request.role, zh, str(target_name), item_name)
            return ModelResponse(
                text=text,
                actions=[
                    {
                        "type": "social",
                        "payload": {
                            "target_agent_id": target.get("id"),
                            "text": speech,
                        },
                    }
                ],
            )
        movable_items = [item for item in nearby_items if item.get("movable")]
        if "pick_up" in request.action_space and movable_items and not held_item_id and tick % 12 == 0:
            item = movable_items[0]
            return ModelResponse(
                text=(
                    f"{agent_name} 决定拿起 {item.get('name', item.get('id'))}。"
                    if zh
                    else f"{agent_name} decides to pick up {item.get('name', item.get('id'))}."
                ),
                actions=[{"type": "pick_up", "payload": {"item_id": item.get("id")}}],
            )
        if "move_to" in request.action_space and movement_targets and tick % 6 == 0:
            target = movement_targets[0]
            return ModelResponse(
                text=f"{agent_name} 选择了一个附近的目的地。" if zh else f"{agent_name} chooses a nearby destination.",
                actions=[{"type": "move_to", "payload": {"target": target.get("point")}}],
            )
        if "stop" in request.action_space and tick % 14 == 0:
            return ModelResponse(
                text=f"{agent_name} 暂时停下来休息。" if zh else f"{agent_name} rests for a moment.",
                actions=[{"type": "stop", "payload": {"reason": "rest"}}],
            )
        if "say" in request.action_space and tick % 8 == 0:
            return ModelResponse(
                text=f"{agent_name} 分享了一个简短想法。" if zh else f"{agent_name} shares a quick thought.",
                actions=[
                    {
                        "type": "say",
                        "payload": {
                            "text": _mock_utterance(str(agent_name), request.role, zh, item_name=item_name)
                        },
                    }
                ],
            )
        return ModelResponse(
            text=f"{agent_name} 等待并观察。" if zh else f"{agent_name} waits and watches.",
            actions=[{"type": "wait", "payload": {"duration": 1}}],
        )


def _mock_item_name(observation: dict[str, Any]) -> str:
    item_context = observation.get("item_context")
    candidates = item_context.get("nearby_named_items") if isinstance(item_context, dict) else observation.get("nearby_items")
    if not isinstance(candidates, list):
        return ""
    names: list[str] = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if name and name not in names:
            names.append(name)
    for name in names:
        if name.lower() not in {"item", "object"}:
            return name
    return names[0] if names else ""


def _mock_should_reference_item(observation: dict[str, Any], agent_id: str) -> bool:
    if not _mock_item_name(observation):
        return False
    tick = int(observation.get("tick", 0) or 0)
    bucket = tick // 8
    offset = sum(ord(char) for char in str(agent_id or "agent")) % 10
    return (bucket + offset) % 10 == 0


def _mock_utterance(
    agent_name: str,
    role: str,
    zh: bool,
    target_name: str | None = None,
    item_name: str | None = None,
) -> str:
    item_name = str(item_name or "").strip()
    if item_name:
        if target_name:
            return (
                f"{target_name}，你也注意到{item_name}了吗？"
                if zh
                else f"{target_name}, did you notice {item_name} too?"
            )
        return f"我刚才注意到{item_name}。" if zh else f"I just noticed {item_name}."
    role_key = str(role or "").lower()
    if role_key == "mediator" or agent_name.lower() == "mira":
        return (
            f"我想把我们刚才的互动说清楚，{target_name}，你觉得哪里变了？"
            if zh and target_name
            else "我在听这里还没被说出来的那一部分。"
            if zh
            else f"I want to name what shifted between us, {target_name}; what changed for you?"
            if target_name
            else "I'm listening for the part of the room no one has named yet."
        )
    if role_key == "builder" or agent_name.lower() == "tao":
        return (
            f"我在判断这里怎么搭才稳，{target_name}，你觉得哪里需要加固？"
            if zh and target_name
            else "我先看哪一块真的能承重，再决定动手。"
            if zh
            else f"I'm checking what would hold up here, {target_name}; does this arrangement feel sturdy?"
            if target_name
            else "I'm checking which piece would carry weight before I touch anything."
        )
    if role_key == "observer" or agent_name.lower() == "ren":
        return (
            f"我看到我们总绕回这个位置，{target_name}，你也注意到了吗？"
            if zh and target_name
            else "我在记录大家停顿的位置，重复得很有意思。"
            if zh
            else f"I keep seeing us circle back to this spot, {target_name}; did you catch that too?"
            if target_name
            else "I'm tracking the small changes in where everyone pauses."
        )
    return (
        f"我先说具体一点，{target_name}，刚才这里确实变了。"
        if zh and target_name
        else "我想先把眼前这件小事说准。"
        if zh
        else f"I want to be specific, {target_name}; something here just changed."
        if target_name
        else "I want to be specific about what just changed here."
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

    agent_name = str(request.observation.get("agent_name") or request.agent_id)
    identity = _enrich_identity(request.agent_id, agent_name, request.role, request.identity)
    language = _effective_dialogue_language(request.language, identity)
    observation = dict(request.observation)
    observation.setdefault("effective_dialogue_language", language)
    language_line = (
        "Reply in Simplified Chinese (zh-CN).\n"
        if language == "zh-CN"
        else "Reply in English (en-US).\n"
    )
    extension_lines = ""
    if request.action_definitions:
        extension_lines = (
            "Extension action definitions: "
            f"{json.dumps(request.action_definitions, ensure_ascii=False)}\n"
        )
    return (
        "You control one agent in a live 2D game simulation. "
        "Return ONLY valid JSON with this shape: "
        "{\"text\": string, \"actions\": [{\"type\": string, \"payload\": object}]}.\n"
        f"{language_line}"
        "Choose at most one action. Use only action types listed in Action space.\n"
        "Supported action payloads:\n"
        "- move_to: {\"target\":{\"x\":number,\"y\":number}} using a point from observation.movement_targets when possible.\n"
        "- social: {\"target_agent_id\": string, \"text\": string} using observation.dialogue_candidates.\n"
        "- stop: {\"reason\":\"rest\"} to stop moving or rest.\n"
        "- pick_up: {\"item_id\": string} only for nearby_items where movable=true.\n"
        "- drop_item: {\"position\":{\"x\":number,\"y\":number}} when holding an item.\n"
        "- move_item: {\"item_id\": string, \"target\":{\"x\":number,\"y\":number}, \"rotation\":number, \"scale\":number} only for movable nearby items.\n"
        "- interact/use: {\"target_id\": string} for nearby_items where interactable=true; prefer items with available_affordances.\n"
        "- say: {\"text\": string}.\n"
        "- wait: {\"duration\": number}.\n"
        f"{extension_lines}"
        "Output separation:\n"
        "- Top-level text is private narration/debug summary and is NOT shown as a speech bubble.\n"
        "- Visible speech is allowed ONLY in say.payload.text or social.payload.text.\n"
        "- If you choose say/social, payload.text must be a direct in-character line, first-person or directly addressed, 1-2 short sentences.\n"
        "- Never put identity summaries, JSON explanations, action plans, or third-person agent descriptions in visible speech.\n"
        "Role speech rules:\n"
        "- Make speech specific to identity, relationships, agent_recent_events, recent_utterances, conversation_focus, and nearby_items.\n"
        "- Nearby items are scene context, not the only topic. Mention a specific item name only when it genuinely fits the moment, "
        "roughly one out of ten visible utterances; otherwise talk from identity, relationships, movement, or recent events.\n"
        "- Do not repeat identity/role text. Do not say generic greetings like \"How is your day going?\" or weather filler.\n"
        "- For social, address the selected target and react to a recent event, relationship, object, or spatial situation.\n"
        "- If there is no concrete thing to say, choose observe, wait, move_to, or interact instead of weak chatter.\n"
        "Movement is visible only when you choose move_to. If move_to is available and movement_targets is not empty, "
        "regularly choose move_to instead of only saying text. Copy target coordinates exactly from one "
        "observation.movement_targets[].point; never invent coordinates. Respect observation.movement_constraints: "
        "agent centers should keep the listed minimum distance from other agents, and the rules engine may adjust "
        "a move target that would collide.\n"
        "Base speech and social choices primarily on identity, observation.relationships, nearby agents/items, "
        "observation.item_context, "
        "and observation.agent_recent_events. observation.scene_context is weak background mood only; "
        "do not quote narration as the agent's own speech.\n"
        "Use observation.region_context: road/walkable targets have higher movement priority than action areas; "
        "social regions favor social/say actions; residential regions favor calm local routines.\n"
        "Do not invent ids. For social use only observation.dialogue_candidates ids; for interact/use/pick_up use visible nearby item ids. "
        "When available_affordances exists, treat it as the clearest lightweight scene interaction opportunity. "
        "Avoid repeating the same action if agent_recent_events show it just happened.\n"
        f"Agent: {request.agent_id}\n"
        f"Role: {request.role}\n"
        f"Identity: {identity}\n"
        f"Action space: {json.dumps(request.action_space, ensure_ascii=False)}\n"
        f"Observation: {json.dumps(observation, ensure_ascii=False)}\n"
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
