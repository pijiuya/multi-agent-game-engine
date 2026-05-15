from agent_engine.models.provider import (
    MockProvider,
    ModelRequest,
    _effective_dialogue_language,
    _enrich_identity,
    _parse_model_json,
    _request_to_prompt,
    _trust_env_for_base_url,
)


async def test_mock_provider_returns_structured_action():
    provider = MockProvider()
    response = await provider.generate(
        ModelRequest(
            agent_id="agent_mira",
            role="mediator",
            identity="test identity",
            observation={"tick": 8, "agent_name": "Mira"},
            action_space=["say", "wait"],
        )
    )

    assert response.text
    assert response.actions[0]["type"] == "say"


async def test_mock_provider_uses_zh_cn_language():
    provider = MockProvider()
    response = await provider.generate(
        ModelRequest(
            agent_id="agent_mira",
            role="mediator",
            identity="test identity",
            observation={"tick": 8, "agent_name": "Mira"},
            action_space=["say", "wait"],
            language="zh-CN",
        )
    )

    assert "分享" in response.text
    assert "我" in response.actions[0]["payload"]["text"]


async def test_mock_provider_mentions_preferred_item_name():
    provider = MockProvider()
    response = await provider.generate(
        ModelRequest(
            agent_id="agent_mira",
            role="mediator",
            identity="test identity",
            observation={
                "tick": 24,
                "agent_name": "Mira",
                "item_context": {
                    "nearby_named_items": [
                        {"id": "item_generic", "name": "Item"},
                        {"id": "item_archive", "name": "绝密档案3", "available_affordances": [{"action": "use"}]},
                    ],
                    "recent_item_events": [{"item_id": "item_archive", "type": "interaction"}],
                },
            },
            action_space=["say", "wait"],
            language="zh-CN",
        )
    )

    assert "绝密档案3" in response.actions[0]["payload"]["text"]


async def test_mock_provider_uses_movement_targets():
    provider = MockProvider()
    response = await provider.generate(
        ModelRequest(
            agent_id="agent_mira",
            role="mediator",
            identity="test identity",
            observation={
                "tick": 6,
                "agent_name": "Mira",
                "movement_targets": [{"label": "right", "point": {"x": 340, "y": 220}}],
            },
            action_space=["move_to", "wait"],
        )
    )

    assert response.actions[0]["type"] == "move_to"
    assert response.actions[0]["payload"]["target"] == {"x": 340, "y": 220}


async def test_mock_provider_uses_movable_item_actions():
    provider = MockProvider()
    response = await provider.generate(
        ModelRequest(
            agent_id="agent_mira",
            role="mediator",
            identity="test identity",
            observation={
                "tick": 12,
                "agent_name": "Mira",
                "nearby_items": [
                    {"id": "item_lamp", "name": "Lamp", "movable": True, "distance": 24},
                    {"id": "item_wall", "name": "Wall", "movable": False, "distance": 18},
                ],
                "movement_targets": [{"label": "right", "point": {"x": 340, "y": 220}}],
            },
            action_space=["pick_up", "move_to", "wait"],
        )
    )

    assert response.actions[0]["type"] == "pick_up"
    assert response.actions[0]["payload"]["item_id"] == "item_lamp"


async def test_mock_provider_can_stop_to_rest():
    provider = MockProvider()
    response = await provider.generate(
        ModelRequest(
            agent_id="agent_mira",
            role="mediator",
            identity="test identity",
            observation={"tick": 14, "agent_name": "Mira"},
            action_space=["stop", "wait"],
        )
    )

    assert response.actions[0]["type"] == "stop"
    assert response.actions[0]["payload"]["reason"] == "rest"


def test_provider_prompt_exposes_action_schema_and_observation():
    prompt = _request_to_prompt(
        ModelRequest(
            agent_id="agent_mira",
            role="mediator",
            identity="test identity",
            observation={"movement_targets": [{"point": {"x": 1, "y": 2}}], "nearby_items": []},
            action_space=["move_to", "social", "stop", "pick_up"],
        )
    )

    assert "move_to" in prompt
    assert "social" in prompt
    assert "stop" in prompt
    assert "pick_up" in prompt
    assert "movement_targets" in prompt


def test_placeholder_identity_is_enriched_but_custom_identity_stays():
    enriched = _enrich_identity(
        "agent_mira",
        "Mira",
        "mediator",
        "Mira is a mediator with a distinct social point of view.",
    )
    custom = _enrich_identity(
        "agent_mira",
        "Mira",
        "mediator",
        "Mira keeps a private notebook of unresolved promises.",
    )

    assert "Core desire" in enriched
    assert "generic greetings" in enriched
    assert custom == "Mira keeps a private notebook of unresolved promises."


def test_effective_dialogue_language_follows_identity_for_auto():
    assert _effective_dialogue_language("auto", "她习惯用中文调停争执。") == "zh-CN"
    assert _effective_dialogue_language("auto", "She speaks in spare English.") == "en-US"
    assert _effective_dialogue_language("zh-CN", "She speaks in spare English.") == "zh-CN"
    assert _effective_dialogue_language("en-US", "她习惯用中文调停争执。") == "en-US"


def test_provider_prompt_exposes_language_and_extension_definitions():
    prompt = _request_to_prompt(
        ModelRequest(
            agent_id="agent_mira",
            role="mediator",
            identity="test identity",
            observation={},
            action_space=["wave"],
            action_definitions=[
                {
                    "type": "wave",
                    "description": "Wave to nearby agents.",
                    "payload_schema": {"type": "object"},
                    "permissions": ["emit_event"],
                }
            ],
            language="zh-CN",
        )
    )

    assert "Simplified Chinese" in prompt
    assert "Extension action definitions" in prompt
    assert "wave" in prompt


def test_provider_prompt_separates_debug_text_from_visible_speech():
    prompt = _request_to_prompt(
        ModelRequest(
            agent_id="agent_mira",
            role="mediator",
            identity="Mira is a mediator with a distinct social point of view.",
            observation={"recent_utterances": [{"text": "I'm listening."}], "conversation_focus": {}},
            action_space=["say", "social", "observe", "wait"],
        )
    )

    assert "Top-level text is private" in prompt
    assert "Visible speech is allowed ONLY" in prompt
    assert "How is your day going?" in prompt
    assert "Core desire" in prompt


def test_parse_model_json_accepts_fenced_json():
    response = _parse_model_json(
        '```json\n{"text":"ok","actions":[{"type":"wait","payload":{"duration":1}}, "bad"]}\n```',
        raw={},
    )

    assert response.text == "ok"
    assert response.actions == [{"type": "wait", "payload": {"duration": 1}}]


def test_local_model_urls_bypass_proxy_environment():
    assert _trust_env_for_base_url("http://127.0.0.1:11434") is False
    assert _trust_env_for_base_url("http://localhost:11434") is False
    assert _trust_env_for_base_url("https://api.example.com/v1") is True
