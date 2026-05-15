import { fallbackWorld } from "./fallbackWorld";
import type {
  ActionExtension,
  ActionExtensionCheckResult,
  AgentAnimation,
  AgentAnimationClip,
  AgentProfile,
  MapGenerationState,
  MapImageLayer,
  MapRegion,
  MapSegmentationState,
  ModelCapabilityId,
  ModelCapabilityStatus,
  ModelCapabilityTask,
  ModelConfig,
  RemoteModelOption,
  RemoteModelTestResult,
  RuntimeStatus,
  Point,
  PolygonArea,
  NarrativeConfig,
  WorldItem,
  WorldMap,
  WorldSnapshot
} from "../types";

declare global {
  interface Window {
    engineRuntime?: {
      apiBase?: string;
    };
  }
}

export const apiBase = resolveApiBase();

function resolveApiBase() {
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE;
  }
  if (typeof window !== "undefined" && window.engineRuntime?.apiBase) {
    return window.engineRuntime.apiBase;
  }
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    return "http://127.0.0.1:8000";
  }
  return "";
}

export async function getWorld(): Promise<WorldSnapshot> {
  try {
    const response = await fetch(`${apiBase}/api/world`);
    if (!response.ok) {
      throw new Error(`world request failed: ${response.status}`);
    }
    return normalizeWorldSnapshot(await response.json());
  } catch {
    return normalizeWorldSnapshot(structuredClone(fallbackWorld));
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

export async function patchNarrative(patch: Partial<Pick<NarrativeConfig, "enabled" | "premise" | "tone" | "cadence_ticks">>): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/narrative`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    return response.ok ? normalizeWorldSnapshot(await response.json()) : null;
  } catch {
    return null;
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

export async function configureLocalCapability(
  capability: ModelCapabilityId,
  payload: { model?: string; models?: string[] } = {}
): Promise<{ models: ModelConfig[]; capability: ModelCapabilityStatus } | null> {
  try {
    const response = await fetch(`${apiBase}/api/model-capabilities/${capability}/configure-local`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: payload.model ?? "", models: payload.models ?? [] })
    });
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

export async function fetchRemoteCapabilityModels(
  capability: ModelCapabilityId,
  payload: { baseUrl: string; apiKey: string; model: string }
): Promise<RemoteModelOption[]> {
  const response = await fetch(`${apiBase}/api/model-capabilities/${capability}/remote-models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_url: payload.baseUrl, api_key: payload.apiKey, model: payload.model })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(String(data.detail ?? "remote model list failed"));
  }
  return (data.models ?? []).map((item: Record<string, unknown>) => ({
    id: String(item.id ?? ""),
    name: item.name == null ? null : String(item.name)
  })).filter((item: RemoteModelOption) => item.id);
}

export async function testRemoteCapability(
  capability: ModelCapabilityId,
  payload: { baseUrl: string; apiKey: string; model: string }
): Promise<RemoteModelTestResult> {
  const response = await fetch(`${apiBase}/api/model-capabilities/${capability}/test-remote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_url: payload.baseUrl, api_key: payload.apiKey, model: payload.model })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(String(data.detail ?? "remote test failed"));
  }
  return {
    ok: Boolean(data.ok),
    provider: String(data.provider ?? ""),
    model: String(data.model ?? payload.model),
    message: String(data.message ?? ""),
    sample: String(data.sample ?? "")
  };
}

export async function installLocalCapability(
  capability: ModelCapabilityId,
  payload: { model?: string; models?: string[] } = {}
): Promise<{ task: ModelCapabilityTask; models: ModelConfig[] } | null> {
  try {
    const response = await fetch(`${apiBase}/api/model-capabilities/${capability}/install-local`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: payload.model ?? "", models: payload.models ?? [] })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(String(data.detail ?? "local install failed"));
    }
    return {
      task: capabilityTaskFromApi(data.task),
      models: (data.models ?? []).map(modelFromApi)
    };
  } catch {
    return null;
  }
}

export async function getModelCapabilityTask(taskId: string): Promise<ModelCapabilityTask | null> {
  try {
    const response = await fetch(`${apiBase}/api/model-capabilities/tasks/${taskId}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(String(data.detail ?? "task request failed"));
    }
    return capabilityTaskFromApi(data.task);
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
}): Promise<MapGenerationState> {
  const response = await fetch(`${apiBase}/api/map/generation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(String(data.detail ?? "map generation failed"));
  }
  return data;
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

export async function deleteMapRegion(regionId: string): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/map/regions/${regionId}`, { method: "DELETE" });
    return response.ok ? normalizeWorldSnapshot(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function createMapRegion(payload: {
  name: string;
  points: Point[];
  holes?: Point[][];
  function?: MapRegion["function"];
  notes?: string;
  tags?: string[];
}): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/map/regions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: payload.name,
        points: payload.points,
        holes: payload.holes ?? [],
        function: payload.function ?? "unassigned",
        notes: payload.notes ?? "",
        tags: payload.tags ?? []
      })
    });
    return response.ok ? normalizeWorldSnapshot(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function booleanMapRegions(payload: {
  targetIds?: string[];
  targetFunction?: MapRegion["function"];
  operation: "union" | "subtract";
  points: Point[];
  holes?: Point[][];
}): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/map/regions/boolean`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_ids: payload.targetIds ?? [],
        target_function: payload.targetFunction ?? null,
        operation: payload.operation,
        points: payload.points,
        holes: payload.holes ?? []
      })
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

export async function generateMapImageLayer(payload: {
  prompt: string;
  selection: { type: "polygon"; points: Point[] } | { type: "rect"; x: number; y: number; width: number; height: number };
  mode: "region" | "extension" | "repaint";
  reference_background: boolean;
  provider_id?: string | null;
  target_layer_id?: string | null;
  region_id?: string | null;
}): Promise<{ world: WorldSnapshot; layer: MapImageLayer }> {
  const response = await fetch(`${apiBase}/api/map/image-layers/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(String(data.detail ?? "image layer generation failed"));
  }
  return {
    world: normalizeWorldSnapshot(data.world ?? data),
    layer: normalizeImageLayer(data.layer)
  };
}

export async function patchMapImageLayer(layerId: string, patch: Partial<Omit<MapImageLayer, "id" | "kind" | "image" | "prompt" | "region_id" | "created_at">>): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/map/image-layers/${layerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    return response.ok ? normalizeWorldSnapshot(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function deleteMapImageLayer(layerId: string): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/map/image-layers/${layerId}`, { method: "DELETE" });
    return response.ok ? normalizeWorldSnapshot(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function autoLabelMapRegion(regionId: string): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/map/regions/${regionId}/auto-label`, {
      method: "POST"
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

export async function getActionExtensions(): Promise<ActionExtension[]> {
  try {
    const response = await fetch(`${apiBase}/api/action-extensions`);
    if (!response.ok) {
      throw new Error(`action extensions request failed: ${response.status}`);
    }
    const data = await response.json();
    return normalizeActionExtensions(data.extensions ?? data.action_extensions ?? data);
  } catch {
    return [];
  }
}

export async function checkActionExtension(code: string): Promise<ActionExtensionCheckResult | null> {
  try {
    const response = await fetch(`${apiBase}/api/action-extensions/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    const data = await response.json();
    return normalizeActionExtensionCheck(data.check ?? data.result ?? data, response.ok);
  } catch {
    return null;
  }
}

export async function createActionExtension(payload: { code: string; enabled?: boolean }): Promise<ActionExtension | null> {
  try {
    const response = await fetch(`${apiBase}/api/action-extensions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    return response.ok ? normalizeActionExtension(data.extension ?? data) : null;
  } catch {
    return null;
  }
}

export async function patchActionExtension(
  extensionId: string,
  patch: Partial<Pick<ActionExtension, "code" | "enabled" | "description" | "permissions">>
): Promise<ActionExtension | null> {
  try {
    const response = await fetch(`${apiBase}/api/action-extensions/${extensionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    const data = await response.json();
    return response.ok ? normalizeActionExtension(data.extension ?? data) : null;
  } catch {
    return null;
  }
}

export async function deleteActionExtension(extensionId: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiBase}/api/action-extensions/${extensionId}`, { method: "DELETE" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function deleteAgent(agentId: string): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/agents/${agentId}`, { method: "DELETE" });
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

export async function deleteMapItem(itemId: string): Promise<WorldSnapshot | null> {
  try {
    const response = await fetch(`${apiBase}/api/map/items/${itemId}`, { method: "DELETE" });
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

export async function getRuntimeStatus(): Promise<RuntimeStatus | null> {
  try {
    const response = await fetch(`${apiBase}/api/runtime/status`);
    if (!response.ok) {
      throw new Error(`runtime status request failed: ${response.status}`);
    }
    return runtimeStatusFromApi(await response.json());
  } catch {
    try {
      const [world, models] = await Promise.all([getWorld(), getModels()]);
      return runtimeStatusFromWorld(world, models);
    } catch {
      return null;
    }
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
  const map = normalizeMap(snapshot.map ?? fallbackWorld.map);
  return {
    ...snapshot,
    map: {
      ...map,
      items: (map.items ?? []).map((item) => ({
        ...item,
        radius: item.radius ?? 32,
        scale: item.scale ?? 1,
        rotation: item.rotation ?? 0,
        image: item.image ?? null,
        description: item.description ?? "",
        tags: item.tags ?? [],
        state: item.state ?? {},
        hidden: Boolean(item.hidden),
        movable: item.movable !== false,
        interactable: item.interactable !== false,
        affordances: normalizeItemAffordances(item.affordances)
      })),
      triggers: map.triggers ?? [],
      spawn_points: map.spawn_points ?? []
    },
    agent_profiles: Object.fromEntries(
      Object.entries(snapshot.agent_profiles ?? {}).map(([agentId, profile]) => [
        agentId,
        {
          ...profile,
          hidden: Boolean(profile.hidden),
          action_space: normalizeActionSpace(profile.action_space),
          animation: normalizeAgentAnimation(profile.animation),
          dialogue_policy: normalizeDialoguePolicy(profile.dialogue_policy)
        }
      ])
    ),
    agent_states: Object.fromEntries(
      Object.entries(snapshot.agent_states ?? {}).map(([agentId, state]) => [
        agentId,
        { ...state, held_item_id: state.held_item_id ?? null, narrative_state: state.narrative_state ?? {} }
      ])
    ),
    decision_events: snapshot.decision_events ?? [],
    narrative: normalizeNarrative(snapshot.narrative),
    scene_director: snapshot.scene_director
      ? {
          pending: Boolean(snapshot.scene_director.pending),
          last_tick: Number(snapshot.scene_director.last_tick ?? -999)
        }
      : undefined
  };
}

function normalizeItemAffordances(value: WorldItem["affordances"] | unknown): WorldItem["affordances"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const action = item.action === "use" ? "use" : item.action === "interact" ? "interact" : null;
      if (!action) {
        return null;
      }
      const affordance: WorldItem["affordances"][number] = {
        action,
        enabled: item.enabled !== false
      };
      if (typeof item.label === "string" && item.label.trim()) {
        affordance.label = item.label.trim();
      }
      if (typeof item.event_message === "string" && item.event_message.trim()) {
        affordance.event_message = item.event_message.trim();
      }
      if (typeof item.status === "string" && item.status.trim()) {
        affordance.status = item.status.trim();
      }
      if (typeof item.range === "number" && Number.isFinite(item.range)) {
        affordance.range = Math.max(1, item.range);
      }
      if (item.required_item_state && typeof item.required_item_state === "object" && !Array.isArray(item.required_item_state)) {
        affordance.required_item_state = item.required_item_state as Record<string, unknown>;
      }
      if (item.set_item_state && typeof item.set_item_state === "object" && !Array.isArray(item.set_item_state)) {
        affordance.set_item_state = item.set_item_state as Record<string, unknown>;
      }
      return affordance;
    })
    .filter((item): item is WorldItem["affordances"][number] => item !== null);
}

function normalizeNarrative(value: unknown): NarrativeConfig {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enabled: Boolean(raw.enabled),
    premise: typeof raw.premise === "string" ? raw.premise : "",
    tone: typeof raw.tone === "string" && raw.tone.trim() ? raw.tone : "grounded",
    cadence_ticks: Math.max(1, Math.round(Number(raw.cadence_ticks ?? 50))),
    last_tick: Math.round(Number(raw.last_tick ?? -999)),
    recent_summary: typeof raw.recent_summary === "string" ? raw.recent_summary : ""
  };
}

function normalizeActionSpace(actions: unknown) {
  const defaults = ["move_to", "say", "interact", "use", "observe", "wait", "stop", "social", "pick_up", "drop_item", "move_item"];
  const current = Array.isArray(actions) ? actions.filter((action): action is string => typeof action === "string") : [];
  return current.length ? Array.from(new Set(current)) : defaults;
}

function normalizeAgentAnimation(value: unknown): AgentAnimation | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const animation = value as Record<string, unknown>;
  const clips = normalizeAnimationClips(animation.clips);
  const legacyClip = normalizeAnimationClip(animation);
  const idleClip = clips.idle ?? legacyClip ?? Object.values(clips)[0];
  if (!idleClip) {
    return null;
  }
  return {
    ...idleClip,
    clips: {
      ...(legacyClip ? { idle: legacyClip } : {}),
      ...clips,
      idle: idleClip
    }
  };
}

function normalizeAnimationClips(value: unknown): Record<string, AgentAnimationClip> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const clips: Record<string, AgentAnimationClip> = {};
  for (const [key, rawClip] of Object.entries(value as Record<string, unknown>)) {
    const name = key.trim();
    const clip = normalizeAnimationClip(rawClip);
    if (name && clip) {
      clips[name] = clip;
    }
  }
  return clips;
}

function normalizeAnimationClip(value: unknown): AgentAnimationClip | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const animation = value as Record<string, unknown>;
  const kind = animation.kind === "gif" || animation.kind === "png_sequence" ? animation.kind : null;
  if (!kind) {
    return null;
  }
  const height = Math.max(0, Number(animation.height ?? 0));
  return {
    kind,
    url: typeof animation.url === "string" ? animation.url : "",
    frames: Array.isArray(animation.frames) ? animation.frames.filter((frame): frame is string => typeof frame === "string") : [],
    fps: Math.max(1, Number(animation.fps ?? 8)),
    max_pixels: Math.max(0, Number(animation.max_pixels ?? 0)),
    width: Math.max(0, Number(animation.width ?? 0)),
    height,
    world_height: clampNumber(Number(animation.world_height ?? animation.worldHeight ?? (height || 72)), 8, 800),
    scale: clampNumber(Number(animation.scale ?? 1), 0.1, 6)
  };
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function normalizeDialoguePolicy(value: unknown) {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enabled: raw.enabled !== false,
    distance: Math.max(1, Number(raw.distance ?? 180)),
    cooldown_ticks: Math.max(1, Math.round(Number(raw.cooldown_ticks ?? 20))),
    language: typeof raw.language === "string" && raw.language.trim() ? raw.language : "auto"
  };
}

function normalizeActionExtensions(value: unknown): ActionExtension[] {
  return Array.isArray(value) ? value.map(normalizeActionExtension).filter((extension): extension is ActionExtension => Boolean(extension)) : [];
}

function normalizeActionExtension(value: unknown): ActionExtension | null {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!raw) {
    return null;
  }
  const actionType = String(raw.action_type ?? raw.type ?? raw.name ?? "").trim();
  const id = String(raw.id ?? actionType).trim();
  if (!id && !actionType) {
    return null;
  }
  return {
    id: id || actionType,
    action_type: actionType || id,
    description: String(raw.description ?? ""),
    code: String(raw.code ?? ""),
    enabled: Boolean(raw.enabled),
    permissions: Array.isArray(raw.permissions) ? raw.permissions.map(String) : [],
    check: raw.check ? normalizeActionExtensionCheck(raw.check, true) : null,
    updated_at: typeof raw.updated_at === "number" ? raw.updated_at : null
  };
}

function normalizeActionExtensionCheck(value: unknown, responseOk: boolean): ActionExtensionCheckResult {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ok: Boolean(raw.ok ?? responseOk),
    action_type: String(raw.action_type ?? raw.type ?? ""),
    description: String(raw.description ?? ""),
    permissions: Array.isArray(raw.permissions) ? raw.permissions.map(String) : [],
    issues: Array.isArray(raw.issues)
      ? raw.issues.map((issue) => {
          const item: Record<string, unknown> = issue && typeof issue === "object" ? (issue as Record<string, unknown>) : { message: issue };
          const severity = String(item.severity ?? "info");
          return {
            severity: severity === "blocker" || severity === "warning" ? severity : "info",
            message: String(item.message ?? item.detail ?? issue ?? ""),
            line: typeof item.line === "number" ? item.line : null
          };
        })
      : []
  };
}

function normalizeMap(input: WorldMap): WorldMap {
  const map = {
    ...fallbackWorld.map,
    ...input,
    walkable_areas: normalizeAreas(input.walkable_areas ?? []),
    obstacles: normalizeAreas(input.obstacles ?? []),
    interaction_zones: normalizeAreas(input.interaction_zones ?? []),
    regions: normalizeRegions(input.regions ?? []),
    region_layers: normalizeRegionLayers(input.region_layers ?? []),
    image_layers: normalizeImageLayers(input.image_layers ?? [])
  };
  const regions = importLegacyAreasAsRegions(map);
  return syncFunctionalRegions({
    ...map,
    regions,
    region_layers: hasRegionLayerData(map.region_layers) ? map.region_layers : buildFallbackRegionLayers(regions)
  });
}

function normalizeAreas(areas: WorldMap["walkable_areas"]) {
  return areas.map((area) => ({ ...area, holes: area.holes ?? [] }));
}

function normalizeRegions(regions: MapRegion[]) {
  return regions.map((region) => ({
    ...region,
    function: normalizeRegionFunction(region.function),
    holes: region.holes ?? [],
    hidden: Boolean(region.hidden)
  }));
}

function normalizeImageLayers(layers: MapImageLayer[]) {
  return (layers ?? []).map(normalizeImageLayer).filter((layer) => layer.image);
}

function normalizeImageLayer(layer: Partial<MapImageLayer>): MapImageLayer {
  return {
    id: String(layer.id ?? ""),
    name: String(layer.name ?? layer.id ?? "图像图层"),
    kind: layer.kind === "background" || layer.kind === "extension" || layer.kind === "region" ? layer.kind : "region",
    image: String(layer.image ?? ""),
    x: Number(layer.x ?? 0),
    y: Number(layer.y ?? 0),
    width: Math.max(1, Number(layer.width ?? 1)),
    height: Math.max(1, Number(layer.height ?? 1)),
    prompt: String(layer.prompt ?? ""),
    region_id: layer.region_id ?? null,
    hidden: Boolean(layer.hidden),
    locked: Boolean(layer.locked),
    opacity: clampNumber(Number(layer.opacity ?? 1), 0, 1),
    created_at: Number(layer.created_at ?? Date.now() / 1000)
  };
}

function normalizeRegionFunction(value: string): MapRegion["function"] {
  return ["walkable", "obstacle", "action", "residential", "social", "custom", "unassigned"].includes(value)
    ? (value as MapRegion["function"])
    : "unassigned";
}

function normalizeRegionLayers(layers: WorldMap["region_layers"]) {
  return (layers ?? []).map((layer) => ({
    ...layer,
    function: normalizeRegionFunction(layer.function),
    polygons: (layer.polygons ?? []).map((polygon) => ({
      points: polygon.points ?? [],
      holes: polygon.holes ?? []
    }))
  }));
}

function importLegacyAreasAsRegions(map: WorldMap): MapRegion[] {
  const regions = [...map.regions];
  const existing = new Set(regions.map((region) => region.id));
  const groups: { areas: WorldMap["walkable_areas"]; fn: MapRegion["function"] }[] = [
    { areas: map.walkable_areas, fn: "walkable" },
    { areas: map.obstacles, fn: "obstacle" },
    { areas: map.interaction_zones, fn: "social" }
  ];
  for (const group of groups) {
    for (const area of group.areas) {
      if (area.metadata?.generated || area.points.length < 3) {
        continue;
      }
      const id = String(area.metadata?.region_id ?? `region_${area.id}`);
      if (existing.has(id)) {
        continue;
      }
      existing.add(id);
      regions.push({
        id,
        name: area.name,
        points: area.points,
        holes: area.holes ?? [],
        source: "manual",
        function: group.fn,
        image_prompt: "",
        notes: "从旧几何区域迁移为统一区域。",
        confidence: 1,
        tags: ["手绘"],
        hidden: false
      });
    }
  }
  return regions;
}

function syncFunctionalRegions(map: WorldMap): WorldMap {
  const walkable_areas: PolygonArea[] = [];
  const obstacles: PolygonArea[] = [];
  const interaction_zones: PolygonArea[] = [];
  for (const region of map.regions) {
    if (region.hidden) {
      continue;
    }
    if (region.function === "walkable" || region.function === "action") {
      walkable_areas.push(regionToArea(region));
    }
    if (region.function === "obstacle") {
      obstacles.push(regionToArea(region));
    }
    if (region.function === "social") {
      interaction_zones.push(regionToArea(region));
    }
  }
  return {
    ...map,
    walkable_areas,
    obstacles,
    interaction_zones,
    region_layers: hasRegionLayerData(map.region_layers) ? map.region_layers : buildFallbackRegionLayers(map.regions)
  };
}

function regionToArea(region: MapRegion): PolygonArea {
  return {
    id: `area_${region.id}`,
    name: region.name,
    kind: region.function === "social" ? "zone" : region.function === "action" ? "walkable" : region.function,
    points: region.points,
    holes: region.holes,
    metadata: {
      generated: true,
      region_id: region.id,
      function: region.function,
      source: region.source,
      notes: region.notes
    }
  };
}

function buildFallbackRegionLayers(regions: MapRegion[]): WorldMap["region_layers"] {
  const labels: Record<MapRegion["function"], string> = {
    walkable: "道路",
    obstacle: "不可通过",
    action: "行动区",
    residential: "居住区",
    social: "社交区",
    custom: "自定义",
    unassigned: "未设定"
  };
  return (Object.keys(labels) as MapRegion["function"][]).map((fn) => {
    const matches = regions.filter((region) => region.function === fn && !region.hidden);
    return {
      function: fn,
      label: labels[fn],
      region_ids: matches.map((region) => region.id),
      polygons: matches.map((region) => ({ points: region.points, holes: region.holes ?? [] }))
    };
  });
}

function hasRegionLayerData(layers: WorldMap["region_layers"]) {
  return layers.some((layer) => layer.region_ids.length > 0 || layer.polygons.length > 0);
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
    installable: Boolean(data.installable),
    recommended_local: data.recommended_local && typeof data.recommended_local === "object" ? modelFromApi(data.recommended_local as Record<string, unknown>) : null,
    local_options: Array.isArray(data.local_options) ? data.local_options.map(localModelOptionFromApi) : [],
    device_recommendation: data.device_recommendation && typeof data.device_recommendation === "object"
      ? localDeviceRecommendationFromApi(data.device_recommendation as Record<string, unknown>)
      : null,
    suggestions: Array.isArray(data.suggestions) ? data.suggestions.map(String) : []
  };
}

function localModelOptionFromApi(data: unknown) {
  const item = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return {
    id: String(item.id ?? item.model ?? ""),
    name: String(item.name ?? item.model ?? ""),
    model: String(item.model ?? ""),
    sizeLabel: String(item.size_label ?? item.sizeLabel ?? ""),
    memoryGb: nullableNumber(item.memory_gb ?? item.memoryGb),
    diskGb: nullableNumber(item.disk_gb ?? item.diskGb),
    description: String(item.description ?? ""),
    installed: Boolean(item.installed),
    recommended: Boolean(item.recommended),
    selectedByDefault: Boolean(item.selected_by_default ?? item.selectedByDefault),
    reason: String(item.reason ?? "")
  };
}

function localDeviceRecommendationFromApi(data: Record<string, unknown>) {
  return {
    model: String(data.model ?? ""),
    name: String(data.name ?? ""),
    sizeLabel: String(data.size_label ?? data.sizeLabel ?? ""),
    reason: String(data.reason ?? ""),
    pythonRequired: Boolean(data.python_required ?? data.pythonRequired)
  };
}

function capabilityTaskFromApi(data: Record<string, unknown>): ModelCapabilityTask {
  return {
    id: String(data.id ?? ""),
    capability: String(data.capability ?? "segmentation") as ModelCapabilityId,
    title: String(data.title ?? ""),
    status: String(data.status ?? "running") as ModelCapabilityTask["status"],
    stage: String(data.stage ?? ""),
    progress: clampProgress(Number(data.progress ?? 0)),
    message: String(data.message ?? ""),
    error: data.error ? String(data.error) : null
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
    apiKeySet: Boolean(data.api_key_set ?? data.apiKeySet ?? data.api_key ?? data.apiKey),
    model: String(data.model ?? ""),
    enabled: Boolean(data.enabled ?? true),
    capabilities: Array.isArray(data.capabilities) ? (data.capabilities as ModelConfig["capabilities"]) : []
  };
}

function runtimeStatusFromApi(data: Record<string, unknown>): RuntimeStatus {
  const simulation = objectValue(data.simulation);
  const hardware = objectValue(data.hardware);
  const platform = objectValue(hardware.platform);
  const loadAverageRaw = hardware.load_average ?? hardware.loadAverage;
  const pendingModelTasks = Array.isArray(simulation.pending_model_tasks)
    ? simulation.pending_model_tasks.map(runtimePendingTaskFromApi)
    : [];
  const pendingImageGenerationTasks = Array.isArray(simulation.pending_image_generation_tasks)
    ? simulation.pending_image_generation_tasks.map(runtimePendingTaskFromApi)
    : [];
  const recentImageGenerationTasks = Array.isArray(simulation.recent_image_generation_tasks)
    ? simulation.recent_image_generation_tasks.map(runtimePendingTaskFromApi)
    : [];
  return {
    timestamp: Number(data.timestamp ?? Date.now() / 1000),
    simulation: {
      running: Boolean(simulation.running),
      tick: Number(simulation.tick ?? 0),
      sceneDirectorPending: Boolean(simulation.scene_director_pending ?? simulation.sceneDirectorPending),
      pendingModelTaskCount: Number(simulation.pending_model_task_count ?? simulation.pendingModelTaskCount ?? 0),
      pendingModelTasks,
      pendingImageGenerationTasks,
      recentImageGenerationTasks
    },
    models: Array.isArray(data.models)
      ? data.models.map((item) => {
          const model = objectValue(item);
          return {
            id: String(model.id ?? ""),
            name: String(model.name ?? ""),
            kind: String(model.kind ?? "local"),
            provider: String(model.provider ?? ""),
            model: String(model.model ?? ""),
            capabilities: Array.isArray(model.capabilities) ? (model.capabilities as ModelConfig["capabilities"]) : [],
            enabled: Boolean(model.enabled ?? true),
            pendingCount: Number(model.pending_count ?? model.pendingCount ?? 0),
            recentEventCount: Number(model.recent_event_count ?? model.recentEventCount ?? 0),
            recentErrorCount: Number(model.recent_error_count ?? model.recentErrorCount ?? 0)
          };
        })
      : [],
    hardware: {
      platform: {
        system: String(platform.system ?? ""),
        release: String(platform.release ?? ""),
        machine: String(platform.machine ?? ""),
        python: String(platform.python ?? "")
      },
      chip: String(hardware.chip ?? ""),
      cpuCount: nullableNumber(hardware.cpu_count ?? hardware.cpuCount),
      loadAverage: Array.isArray(loadAverageRaw) ? loadAverageRaw.map(Number).filter(Number.isFinite) : [],
      loadPercent: nullableNumber(hardware.load_percent ?? hardware.loadPercent),
      memoryTotalBytes: nullableNumber(hardware.memory_total_bytes ?? hardware.memoryTotalBytes),
      memoryAvailableBytes: nullableNumber(hardware.memory_available_bytes ?? hardware.memoryAvailableBytes),
      memoryUsedPercent: nullableNumber(hardware.memory_used_percent ?? hardware.memoryUsedPercent),
      gpuPressureAvailable: Boolean(hardware.gpu_pressure_available ?? hardware.gpuPressureAvailable),
      gpuPressureReason: String(hardware.gpu_pressure_reason ?? hardware.gpuPressureReason ?? "")
    }
  };
}

function runtimePendingTaskFromApi(item: unknown) {
  const task = objectValue(item);
  return {
    id: String(task.id ?? ""),
    agentId: String(task.agent_id ?? task.agentId ?? ""),
    taskKind: String(task.task_kind ?? task.taskKind ?? ""),
    status: String(task.status ?? ""),
    provider: String(task.provider ?? ""),
    providerId: String(task.provider_id ?? task.providerId ?? ""),
    model: String(task.model ?? ""),
    startedTick: Number(task.started_tick ?? task.startedTick ?? 0),
    ageTicks: Number(task.age_ticks ?? task.ageTicks ?? 0),
    ageSeconds: nullableNumber(task.age_seconds ?? task.ageSeconds),
    elapsedMs: nullableNumber(task.elapsed_ms ?? task.elapsedMs),
    operation: String(task.operation ?? ""),
    prompt: String(task.prompt ?? ""),
    width: nullableNumber(task.width) ?? undefined,
    height: nullableNumber(task.height) ?? undefined,
    referenceBackground: Boolean(task.reference_background ?? task.referenceBackground),
    error: String(task.error ?? ""),
    layerId: String(task.layer_id ?? task.layerId ?? ""),
    asset: String(task.asset ?? "")
  };
}

function runtimeStatusFromWorld(world: WorldSnapshot, models: ModelConfig[]): RuntimeStatus {
  const modelTasks = Object.entries(world.model_tasks ?? {})
    .filter(([, task]) => !task.done)
    .map(([agentId, task]) => ({
      agentId,
      provider: String(task.provider ?? ""),
      model: String(task.model ?? ""),
      startedTick: Number(task.started_tick ?? 0),
      ageTicks: Number(task.age_ticks ?? 0)
    }));
  const recentEvents = world.decision_events.slice(-80);
  return {
    timestamp: Date.now() / 1000,
    simulation: {
      running: Boolean(world.running),
      tick: Number(world.tick ?? 0),
      sceneDirectorPending: Boolean(world.scene_director?.pending),
      pendingModelTaskCount: modelTasks.length,
      pendingModelTasks: modelTasks,
      pendingImageGenerationTasks: [],
      recentImageGenerationTasks: []
    },
    models: models.map((model) => {
      const matchingEvents = recentEvents.filter(
        (event) => event.provider === model.provider && (!model.model || event.model === model.model)
      );
      return {
        id: model.id,
        name: model.name,
        kind: model.kind,
        provider: model.provider,
        model: model.model,
        capabilities: model.capabilities,
        enabled: model.enabled,
        pendingCount: modelTasks.filter(
          (task) => task.provider === model.provider && (!model.model || task.model === model.model)
        ).length,
        recentEventCount: matchingEvents.length,
        recentErrorCount: matchingEvents.filter((event) =>
          event.results.some((result) => result.ok === false)
        ).length
      };
    }),
    hardware: browserHardwareStatus()
  };
}

function browserHardwareStatus(): RuntimeStatus["hardware"] {
  const navigatorInfo = typeof navigator === "undefined" ? null : navigator;
  return {
    platform: {
      system: navigatorInfo?.platform ?? "",
      release: "",
      machine: "",
      python: ""
    },
    chip: navigatorInfo?.platform ?? "浏览器兼容模式",
    cpuCount: navigatorInfo?.hardwareConcurrency ?? null,
    loadAverage: [],
    loadPercent: null,
    memoryTotalBytes: null,
    memoryAvailableBytes: null,
    memoryUsedPercent: null,
    gpuPressureAvailable: false,
    gpuPressureReason: "当前后端未提供运行监控接口，先使用浏览器兼容数据；重启后端后可显示更完整的 CPU/内存采样。"
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function defaultCapabilityStatus(): ModelCapabilityStatus[] {
  return [
    {
      id: "llm",
      label: "语言模型 LLM",
      status: "missing",
      summary: "本机引擎服务暂未连接，正在等待模型检测",
      configured: false,
      configured_model_id: null,
      configured_model_name: null,
      local_available: false,
      installable: false,
      recommended_local: null,
      local_options: [],
      device_recommendation: null,
      suggestions: ["桌面版会自动启动内置后端；普通用户不需要预装 Python。"]
    },
    {
      id: "image_generation",
      label: "图片生成",
      status: "missing",
      summary: "本机引擎服务暂未连接，暂时无法检测图片生成器",
      configured: false,
      configured_model_id: null,
      configured_model_name: null,
      local_available: false,
      installable: false,
      recommended_local: null,
      local_options: [],
      device_recommendation: null,
      suggestions: ["现在可以先导入图片；连接本机引擎后再检测本地图片生成器。"]
    },
    {
      id: "segmentation",
      label: "SAM 分层",
      status: "installable",
      summary: "可安装内置 MobileSAM；正在等待本机引擎连接",
      configured: false,
      configured_model_id: null,
      configured_model_name: null,
      local_available: false,
      installable: true,
      recommended_local: null,
      local_options: [],
      device_recommendation: null,
      suggestions: ["桌面版会自动启动本机引擎；连接完成后点击安装并启用内置 SAM。"]
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
      apiKeySet: false,
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
      apiKeySet: false,
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
      apiKeySet: false,
      model: "mock-sam",
      enabled: false,
      capabilities: ["segmentation", "vision_labeling"]
    }
  ];
}
