from agent_engine.models.provider import MockProvider, ModelRequest


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

