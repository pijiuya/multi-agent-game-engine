from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent_engine.engine.scene_director import LLMSceneDirector, SceneDirectorRequest
from agent_engine.models.provider import OllamaProvider


DEFAULT_NARRATIVE_MODEL = "qwen2.5:1.5b"
OLLAMA_BASE_URL = os.getenv("AGENT_ENGINE_NARRATIVE_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
NARRATIVE_MODEL = os.getenv("AGENT_ENGINE_NARRATIVE_LLM_MODEL", DEFAULT_NARRATIVE_MODEL)

app = FastAPI(title="Agent Engine Narrative Subtitle Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

state: dict[str, Any] = {
    "pending": 0,
    "last_error": "",
    "last_model": "",
}


class SubtitleGeneratePayload(BaseModel):
    request: dict[str, Any] = Field(default_factory=dict)
    model: str | None = None


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {"ok": True, "service": "narrative", "model": _default_model()}


@app.get("/api/narrative/status")
async def narrative_status() -> dict[str, Any]:
    models = await _ollama_models()
    model = state["last_model"] or _default_model(models)
    return {
        "enabled": True,
        "healthy": bool(models),
        "base_url": OLLAMA_BASE_URL,
        "model": model,
        "available_models": models,
        "pending": int(state["pending"]),
        "last_error": str(state["last_error"]),
    }


@app.post("/api/narrative/subtitle/generate")
async def generate_subtitle(payload: SubtitleGeneratePayload) -> dict[str, Any]:
    request_data = dict(payload.request or {})
    model = str(payload.model or "").strip() or _default_model(await _ollama_models())
    state["pending"] = int(state["pending"]) + 1
    state["last_model"] = model
    try:
        request = SceneDirectorRequest(
            tick=int(request_data.get("tick", 0)),
            map=dict(request_data.get("map") or {}),
            agents=list(request_data.get("agents") or []),
            recent_events=list(request_data.get("recent_events") or []),
            items=list(request_data.get("items") or []),
            narrative=dict(request_data.get("narrative") or {}),
            scene_memories=list(request_data.get("scene_memories") or []),
            narrative_cues=list(request_data.get("narrative_cues") or []),
        )
        director = LLMSceneDirector(
            OllamaProvider(base_url=OLLAMA_BASE_URL, model=model),
            model_name=model,
        )
        response = await director.generate(request)
        state["last_error"] = ""
        return {
            "text": response.text,
            "proposal": response.proposal,
            "raw": {"service": "narrative", "model": model},
        }
    except Exception as exc:
        state["last_error"] = str(exc)
        raise HTTPException(status_code=502, detail=f"Narrative service failed: {exc}") from exc
    finally:
        state["pending"] = max(0, int(state["pending"]) - 1)


async def _ollama_models() -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=2.0, trust_env=False) as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            response.raise_for_status()
            data = response.json()
    except Exception:
        return []
    models: list[str] = []
    for item in data.get("models", []):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("model") or "").strip()
        if name:
            models.append(name)
    return models


def _default_model(models: list[str] | None = None) -> str:
    if models and NARRATIVE_MODEL not in set(models):
        return models[0]
    return NARRATIVE_MODEL
