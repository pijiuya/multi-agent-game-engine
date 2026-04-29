import { fallbackWorld } from "./fallbackWorld";
import type {
  AgentAnimation,
  AgentProfile,
  MapGenerationState,
  MapRegion,
  MapSegmentationState,
  ModelCapabilityId,
  ModelCapabilityStatus,
  ModelCapabilityTask,
  ModelConfig,
  Point,
  PolygonArea,
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

export async function installLocalCapability(capability: ModelCapabilityId): Promise<{ task: ModelCapabilityTask; models: ModelConfig[] } | null> {
  try {
    const response = await fetch(`${apiBase}/api/model-capabilities/${capability}/install-local`, { method: "POST" });
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
        movable: item.movable !== false
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
        { ...state, held_item_id: state.held_item_id ?? null }
      ])
    ),
    decision_events: snapshot.decision_events ?? []
  };
}

function normalizeActionSpace(actions: unknown) {
  const defaults = ["move_to", "say", "interact", "use", "observe", "wait", "stop", "social", "pick_up", "drop_item", "move_item"];
  const current = Array.isArray(actions) ? actions.filter((action): action is string => typeof action === "string") : [];
  return Array.from(new Set([...current, ...defaults]));
}

function normalizeAgentAnimation(value: unknown): AgentAnimation | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const animation = value as Record<string, unknown>;
  const kind = animation.kind === "gif" || animation.kind === "png_sequence" ? animation.kind : null;
  if (!kind) {
    return null;
  }
  return {
    kind,
    url: typeof animation.url === "string" ? animation.url : "",
    frames: Array.isArray(animation.frames) ? animation.frames.filter((frame): frame is string => typeof frame === "string") : [],
    fps: Math.max(1, Number(animation.fps ?? 8)),
    max_pixels: Math.max(0, Number(animation.max_pixels ?? 0)),
    width: Math.max(0, Number(animation.width ?? 0)),
    height: Math.max(0, Number(animation.height ?? 0))
  };
}

function normalizeDialoguePolicy(value: unknown) {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enabled: raw.enabled !== false,
    distance: Math.max(1, Number(raw.distance ?? 180)),
    cooldown_ticks: Math.max(1, Math.round(Number(raw.cooldown_ticks ?? 20)))
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
    region_layers: normalizeRegionLayers(input.region_layers ?? [])
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
    suggestions: Array.isArray(data.suggestions) ? data.suggestions.map(String) : []
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
      summary: "本机引擎服务暂未连接，正在等待模型检测",
      configured: false,
      configured_model_id: null,
      configured_model_name: null,
      local_available: false,
      installable: false,
      recommended_local: null,
      suggestions: ["桌面版会自动启动本机引擎；如果一直没有连接，请确认 Python 依赖已安装。"]
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
