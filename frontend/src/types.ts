export type Point = {
  x: number;
  y: number;
};

export type PolygonArea = {
  id: string;
  name: string;
  kind: string;
  points: Point[];
  metadata?: Record<string, unknown>;
};

export type MapRegionFunction = "unassigned" | "walkable" | "obstacle" | "residential" | "social" | "custom";

export type MapRegion = {
  id: string;
  name: string;
  points: Point[];
  source: string;
  function: MapRegionFunction;
  image_prompt: string;
  notes: string;
  confidence: number;
  tags: string[];
};

export type WorldItem = {
  id: string;
  name: string;
  position: Point;
  radius: number;
  scale: number;
  rotation: number;
  image: string | null;
  description: string;
  tags: string[];
  state: Record<string, unknown>;
};

export type WorldMap = {
  id: string;
  name: string;
  width: number;
  height: number;
  background_image: string | null;
  walkable_areas: PolygonArea[];
  obstacles: PolygonArea[];
  interaction_zones: PolygonArea[];
  items: WorldItem[];
  triggers: PolygonArea[];
  spawn_points: Point[];
  regions: MapRegion[];
};

export type AgentProfile = {
  id: string;
  name: string;
  role: string;
  identity: string;
  model_provider: string;
  color: string;
  action_space: string[];
};

export type AgentState = {
  id: string;
  position: Point;
  status: string;
  speed: number;
  target: Point | null;
  action_queue: Record<string, unknown>[];
  pending_model: boolean;
  last_model_tick: number;
  cooldowns: Record<string, number>;
};

export type WorldEvent = {
  id: string;
  type: string;
  message: string;
  tick: number;
  timestamp: number;
  agent_id?: string | null;
  payload: Record<string, unknown>;
};

export type WorldSnapshot = {
  id: string;
  name: string;
  map: WorldMap;
  agent_profiles: Record<string, AgentProfile>;
  agent_states: Record<string, AgentState>;
  relationships: {
    from_agent: string;
    to_agent: string;
    label: string;
    score: number;
  }[];
  memories: {
    id: string;
    agent_id: string;
    text: string;
    kind: string;
    timestamp: number;
  }[];
  events: WorldEvent[];
  tick: number;
  running: boolean;
  model_tasks?: Record<string, { done: boolean }>;
};

export type ViewMode = "2d" | "3d";

export type EditTool = "select" | "walkable" | "obstacle" | "zone" | "item" | "spawn" | "move" | "anchor";

export type PanelState = {
  id: "tools" | "scene" | "agents" | "properties" | "models" | "mapStudio";
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  dockedTo: string | null;
  zIndex: number;
};

export type SelectionState =
  | { kind: "map"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "item"; id: string }
  | { kind: "area"; id: string }
  | { kind: "region"; id: string }
  | { kind: "point"; id: string };

export type CanvasViewState = {
  zoom: number;
  pan: Point;
  fitMode: boolean;
};

export type CanvasPoint = {
  id: string;
  name: string;
  position: Point;
  snapped: boolean;
};

export type ModelCapability = "llm" | "image_generation" | "segmentation" | "vision_labeling";

export type ModelCapabilityId = "llm" | "image_generation" | "segmentation";

export type ModelConfig = {
  id: string;
  name: string;
  kind: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  capabilities: ModelCapability[];
};

export type ModelCapabilityStatus = {
  id: ModelCapabilityId;
  label: string;
  status: "ready" | "local_available" | "mock_only" | "missing";
  summary: string;
  configured: boolean;
  configured_model_id: string | null;
  configured_model_name: string | null;
  local_available: boolean;
  recommended_local: ModelConfig | null;
  suggestions: string[];
};

export type GeneratedImageCandidate = {
  id: string;
  url: string;
  prompt: string;
  width: number;
  height: number;
  provider_id: string;
};

export type MapGenerationState = {
  id: string;
  status: string;
  prompt: string;
  ratio: string;
  width: number;
  height: number;
  provider_id: string;
  candidates: GeneratedImageCandidate[];
  selected_candidate_id: string | null;
};

export type MapSegmentationStage = "idle" | "prepare_image" | "call_sam" | "smooth_edges" | "save_regions" | "done" | "error";

export type MapSegmentationState = {
  status: "idle" | "running" | "done" | "error";
  progress: number;
  stage: MapSegmentationStage;
  provider_id: string | null;
  provider_name: string | null;
  error: string | null;
  region_count: number;
  mode: "none" | "http" | "mock" | "local_mock";
};

export type MapRatioPreset = "1:1" | "16:9" | "custom";
