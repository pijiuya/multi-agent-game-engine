from agent_engine.models.provider import MockProvider, ModelRequest, _parse_model_json, _request_to_prompt, _trust_env_for_base_url


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
