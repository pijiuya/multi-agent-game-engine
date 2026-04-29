import { fallbackWorld } from "./fallbackWorld";
import type {
  AgentProfile,
  MapGenerationState,
  MapRegion,
  MapSegmentationState,
  ModelCapabilityId,
  ModelCapabilityStatus,
  ModelConfig,
  WorldItem,
  WorldMap,
  WorldSnapshot
} from "../types";

export const apiBase = import.meta.env.VITE_API_BASE ?? "";

export async function getWorld(): Promise<WorldSnapshot> {
  try {
    const response = await fetch(`${apiBase}/api/world`);
    if (!response.ok) {
      throw new Error(`world request failed: ${response.status}`);
    }
    return normalizeWorldSnapshot(await response.json());
  } catch {
    return structuredClone(fallbackWorld);
  }
}

export async function saveMap(map: WorldMap): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/map`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(map)
    });
    if (!response.ok) {
      throw new Error(`map save failed: ${response.status}`);
    }
    return normalizeWorldSnapshot(await response.json());
  } catch {
    return null;
  }
}

export async function patchMap(patch: Partial<Pick<WorldMap, "name" | "width" | "height" | "background_image">>) {
  try {
    const response = await fetch(`${apiBase}/api/map`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function getModels(): Promise<ModelConfig[]> {
  try {
    const response = await fetch(`${apiBase}/api/models`);
    if (!response.ok) {
      throw new Error(`models request failed: ${response.status}`);
    }
    const data = await response.json();
    return (data.models ?? []).map(modelFromApi);
  } catch {
    return defaultModels();
  }
}

export async function replaceModels(models: ModelConfig[]): Promise<ModelConfig[]> {
  try {
    const response = await fetch(`${apiBase}/api/models`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models: models.map(modelToApi) })
    });
    if (!response.ok) {
      throw new Error(`models save failed: ${response.status}`);
    }
    const data = await response.json();
    return (data.models ?? []).map(modelFromApi);
  } catch {
    return models;
  }
}

export async function testModel(modelId: string): Promise<{ ok: boolean; message: string; provider: string }> {
  try {
    const response = await fetch(`${apiBase}/api/models/${modelId}/test`, { method: "POST" });
    const data = await response.json();
    return {
      ok: Boolean(response.ok && data.ok),
      message: String(data.message ?? data.detail ?? (response.ok ? "连接可用" : "连接失败")),
      provider: String(data.provider ?? "")
    };
  } catch {
    return { ok: false, message: "连接测试失败", provider: "" };
  }
}

export async function getModelCapabilityStatus(): Promise<ModelCapabilityStatus[]> {
  try {
    const response = await fetch(`${apiBase}/api/model-capabilities/status`);
    if (!response.ok) {
      throw new Error(`model capability status failed: ${response.status}`);
    }
    const data = await response.json();
    return (data.capabilities ?? []).map(capabilityStatusFromApi);
  } catch {
    return defaultCapabilityStatus();
  }
}

export async function configureLocalCapability(capability: ModelCapabilityId): Promise<{ models: ModelConfig[]; capability: ModelCapabilityStatus } | null> {
  try {
    const response = await fetch(`${apiBase}/api/model-capabilities/${capability}/configure-local`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(String(data.detail ?? "local configure failed"));
    }
    return {
      models: (data.models ?? []).map(modelFromApi),
      capability: capabilityStatusFromApi(data.capability)
    };
  } catch {
    return null;
  }
}

export async function configureRemoteCapability(
  capability: ModelCapabilityId,
  payload: { baseUrl: string; apiKey: string; model: string }
): Promise<{ models: ModelConfig[]; capability: ModelCapabilityStatus } | null> {
  try {
    const response = await fetch(`${apiBase}/api/model-capabilities/${capability}/configure-remote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: payload.baseUrl, api_key: payload.apiKey, model: payload.model })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(String(data.detail ?? "remote configure failed"));
    }
    return {
      models: (data.models ?? []).map(modelFromApi),
      capability: capabilityStatusFromApi(data.capability)
    };
  } catch {
    return null;
  }
}

export async function createMapGeneration(payload: {
  prompt: string;
  width: number;
  height: number;
  ratio: string;
  count?: number;
  provider_id?: string | null;
}): Promise<MapGenerationState | null> {
  try {
    const response = await fetch(`${apiBase}/api/map/generation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function selectGeneratedMap(generationId: string, candidateId: string): Promise<{ generation: MapGenerationState; world: WorldSnapshot } | null> {
  try {
    const response = await fetch(`${apiBase}/api/map/generation/${generationId}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_id: candidateId })
    });
    return response.ok ? normalizeGenerationSelection(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function segmentMap(): Promise<{ world: WorldSnapshot | null; segmentation: MapSegmentationState }> {
  try {
    const response = await fetch(`${apiBase}/api/map/segment`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      return {
        world: null,
        segmentation: errorSegmentation(String(data.detail ?? "SAM 分层失败"))
      };
    }
    return {
      world: normalizeWorldSnapshot(data.world ?? data),
      segmentation: normalizeSegmentation(data.segmentation, data.world ?? data)
    };
  } catch {
    return { world: null, segmentation: errorSegmentation("SAM 分层接口不可用") };
  }
}

export async function patchMapRegion(regionId: string, patch: Partial<Omit<MapRegion, "id" | "points" | "source">>): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/map/regions/${regionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    return response.ok ? normalizeWorldSnapshot(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function regenerateMapRegion(regionId: string, prompt: string): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/map/regions/${regionId}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    return response.ok ? normalizeWorldSnapshot(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function patchAgent(agentId: string, patch: Partial<Omit<AgentProfile, "id">>) {
  try {
    const response = await fetch(`${apiBase}/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    return response.ok ? normalizeWorldSnapshot(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function patchMapItem(itemId: string, patch: Partial<Omit<WorldItem, "id">>) {
  try {
    const response = await fetch(`${apiBase}/api/map/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    return response.ok ? normalizeWorldSnapshot(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function postAction(agentId: string, type: string, payload: Record<string, unknown>) {
  try {
    const response = await fetch(`${apiBase}/api/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, type, payload })
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function setSimulation(running: boolean) {
  try {
    const response = await fetch(`${apiBase}/api/simulation/${running ? "start" : "pause"}`, {
      method: "POST"
    });
    return response.ok ? normalizeWorldSnapshot(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function tickSimulation(): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/simulation/tick`, { method: "POST" });
    return response.ok ? normalizeWorldSnapshot(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function createAgent(
  name: string,
  role: string,
  position: { x: number; y: number }
): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role, position })
    });
    return response.ok ? normalizeWorldSnapshot(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function uploadMapImage(file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${apiBase}/api/maps/image`, {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    throw new Error(`upload failed: ${response.status}`);
  }
  return response.json() as Promise<{ asset: string; url: string }>;
}

export async function uploadAsset(file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${apiBase}/api/assets`, {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    throw new Error(`upload failed: ${response.status}`);
  }
  return response.json() as Promise<{ asset: string; url: string }>;
}

export function wsUrl() {
  if (apiBase.startsWith("http")) {
    return apiBase.replace(/^http/, "ws") + "/ws";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function assetUrl(path: string | null) {
  if (!path) {
    return null;
  }
  if (path.startsWith("blob:") || path.startsWith("data:") || path.startsWith("http")) {
    return path;
  }
  return `${apiBase}${path}`;
}

export function normalizeWorldSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  return {
    ...snapshot,
    map: {
      ...fallbackWorld.map,
      ...snapshot.map,
      regions: snapshot.map?.regions ?? [],
      walkable_areas: snapshot.map?.walkable_areas ?? [],
      obstacles: snapshot.map?.obstacles ?? [],
      interaction_zones: snapshot.map?.interaction_zones ?? [],
      items: (snapshot.map?.items ?? []).map((item) => ({
        ...item,
        radius: item.radius ?? 32,
        scale: item.scale ?? 1,
        rotation: item.rotation ?? 0,
        image: item.image ?? null,
        description: item.description ?? "",
        tags: item.tags ?? [],
        state: item.state ?? {}
      })),
      triggers: snapshot.map?.triggers ?? [],
      spawn_points: snapshot.map?.spawn_points ?? []
    }
  };
}

function normalizeSegmentation(data: Partial<MapSegmentationState> | undefined, world: WorldSnapshot): MapSegmentationState {
  return {
    status: data?.status ?? "done",
    progress: clampProgress(data?.progress ?? 100),
    stage: data?.stage ?? "done",
    provider_id: data?.provider_id ?? null,
    provider_name: data?.provider_name ?? null,
    error: data?.error ?? null,
    region_count: data?.region_count ?? world.map.regions.length,
    mode: data?.mode ?? "http"
  };
}

export function idleSegmentation(): MapSegmentationState {
  return {
    status: "idle",
    progress: 0,
    stage: "idle",
    provider_id: null,
    provider_name: null,
    error: null,
    region_count: 0,
    mode: "none"
  };
}

export function errorSegmentation(error: string): MapSegmentationState {
  return {
    status: "error",
    progress: 0,
    stage: "error",
    provider_id: null,
    provider_name: null,
    error,
    region_count: 0,
    mode: "none"
  };
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeGenerationSelection(data: { generation: MapGenerationState; world: WorldSnapshot }) {
  return {
    ...data,
    world: normalizeWorldSnapshot(data.world)
  };
}

function capabilityStatusFromApi(data: Record<string, unknown>): ModelCapabilityStatus {
  return {
    id: String(data.id ?? "llm") as ModelCapabilityId,
    label: String(data.label ?? ""),
    status: String(data.status ?? "missing") as ModelCapabilityStatus["status"],
    summary: String(data.summary ?? ""),
    configured: Boolean(data.configured),
    configured_model_id: data.configured_model_id ? String(data.configured_model_id) : null,
    configured_model_name: data.configured_model_name ? String(data.configured_model_name) : null,
    local_available: Boolean(data.local_available),
    recommended_local: data.recommended_local && typeof data.recommended_local === "object" ? modelFromApi(data.recommended_local as Record<string, unknown>) : null,
    suggestions: Array.isArray(data.suggestions) ? data.suggestions.map(String) : []
  };
}

function modelFromApi(data: Record<string, unknown>): ModelConfig {
  return {
    id: String(data.id ?? ""),
    name: String(data.name ?? ""),
    kind: String(data.kind ?? "local"),
    provider: String(data.provider ?? "mock"),
    baseUrl: String(data.base_url ?? data.baseUrl ?? ""),
    apiKey: String(data.api_key ?? data.apiKey ?? ""),
    model: String(data.model ?? ""),
    enabled: Boolean(data.enabled ?? true),
    capabilities: Array.isArray(data.capabilities) ? (data.capabilities as ModelConfig["capabilities"]) : []
  };
}

function defaultCapabilityStatus(): ModelCapabilityStatus[] {
  return [
    {
      id: "llm",
      label: "语言模型 LLM",
      status: "missing",
      summary: "未连接后端，无法检测本地 LLM",
      configured: false,
      configured_model_id: null,
      configured_model_name: null,
      local_available: false,
      recommended_local: null,
      suggestions: ["启动后端后可检测 Ollama。"]
    },
    {
      id: "image_generation",
      label: "图片生成",
      status: "missing",
      summary: "未连接后端，无法检测图片生成服务",
      configured: false,
      configured_model_id: null,
      configured_model_name: null,
      local_available: false,
      recommended_local: null,
      suggestions: ["可先使用高级配置接入本地图片生成 HTTP 服务。"]
    },
    {
      id: "segmentation",
      label: "SAM 分层",
      status: "missing",
      summary: "未连接后端，无法检测 SAM 服务",
      configured: false,
      configured_model_id: null,
      configured_model_name: null,
      local_available: false,
      recommended_local: null,
      suggestions: ["启动 SAM HTTP 服务后可一键配置。"]
    }
  ];
}

function modelToApi(model: ModelConfig) {
  return {
    id: model.id,
    name: model.name,
    kind: model.kind,
    provider: model.provider,
    base_url: model.baseUrl,
    api_key: model.apiKey,
    model: model.model,
    enabled: model.enabled,
    capabilities: model.capabilities
  };
}

function defaultModels(): ModelConfig[] {
  return [
    {
      id: "model_mock_llm",
      name: "Mock LLM",
      kind: "local",
      provider: "mock",
      baseUrl: "",
      apiKey: "",
      model: "mock-agent",
      enabled: true,
      capabilities: ["llm"]
    },
    {
      id: "model_mock_image",
      name: "Mock 图片生成",
      kind: "local",
      provider: "mock",
      baseUrl: "",
      apiKey: "",
      model: "mock-map-generator",
      enabled: true,
      capabilities: ["image_generation"]
    },
    {
      id: "model_mock_sam",
      name: "Mock SAM 分层（测试）",
      kind: "local",
      provider: "mock",
      baseUrl: "",
      apiKey: "",
      model: "mock-sam",
      enabled: false,
      capabilities: ["segmentation", "vision_labeling"]
    }
  ];
}
