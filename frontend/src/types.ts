export type Point = {
  x: number;
  y: number;
};

export type PolygonArea = {
  id: string;
  name: string;
  kind: string;
  points: Point[];
  holes: Point[][];
  metadata?: Record<string, unknown>;
};

export type MapRegionFunction = "unassigned" | "walkable" | "obstacle" | "action" | "residential" | "social" | "custom";

export type MapRegion = {
  id: string;
  name: string;
  points: Point[];
  holes: Point[][];
  source: string;
  function: MapRegionFunction;
  image_prompt: string;
  notes: string;
  confidence: number;
  tags: string[];
  hidden: boolean;
};

export type RegionLayerPolygon = {
  points: Point[];
  holes: Point[][];
};

export type RegionLayer = {
  function: MapRegionFunction;
  label: string;
  region_ids: string[];
  polygons: RegionLayerPolygon[];
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
  hidden: boolean;
  movable: boolean;
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
  region_layers: RegionLayer[];
};

export type AgentAnimation = {
  kind: "gif" | "png_sequence";
  url: string;
  frames: string[];
  fps: number;
  max_pixels: number;
  width: number;
  height: number;
};

export type DialoguePolicy = {
  enabled: boolean;
  distance: number;
  cooldown_ticks: number;
};

export type AgentProfile = {
  id: string;
  name: string;
  role: string;
  identity: string;
  model_provider: string;
  color: string;
  action_space: string[];
  hidden: boolean;
  animation: AgentAnimation | null;
  dialogue_policy: DialoguePolicy;
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
  held_item_id: string | null;
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

export type DecisionEvent = {
  id: string;
  tick: number;
  agent_id: string;
  provider: string;
  model: string;
  observation: Record<string, unknown>;
  text: string;
  actions: Record<string, unknown>[];
  results: Record<string, unknown>[];
  timestamp: number;
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
  decision_events: DecisionEvent[];
  tick: number;
  running: boolean;
  model_tasks?: Record<string, { done: boolean }>;
};

export type ViewMode = "2d" | "3d";

export type EditTool = "select" | "region" | "item" | "spawn" | "move" | "anchor";

export type RegionDrawOperation = "add" | "subtract";

export type PanelState = {
  id: "tools" | "scene" | "agents" | "properties" | "models" | "mapStudio" | "regions" | "regionDraw";
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
  | { kind: "region"; id: string }
  | { kind: "regionLayer"; id: MapRegionFunction }
  | { kind: "regions"; id: "all" }
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
  status: "ready" | "local_available" | "installable" | "mock_only" | "missing";
  summary: string;
  configured: boolean;
  configured_model_id: string | null;
  configured_model_name: string | null;
  local_available: boolean;
  installable: boolean;
  recommended_local: ModelConfig | null;
  suggestions: string[];
};

export type ModelCapabilityTask = {
  id: string;
  capability: ModelCapabilityId;
  title: string;
  status: "running" | "done" | "error";
  stage: string;
  progress: number;
  message: string;
  error: string | null;
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
  mode: "none" | "http" | "embedded" | "mock" | "local_mock";
};

export type MapRatioPreset = "1:1" | "16:9" | "custom";
