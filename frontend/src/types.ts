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

export type MapImageLayer = {
  id: string;
  name: string;
  kind: "background" | "region" | "extension";
  image: string;
  x: number;
  y: number;
  width: number;
  height: number;
  prompt: string;
  region_id: string | null;
  hidden: boolean;
  locked: boolean;
  opacity: number;
  created_at: number;
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
  image_layers: MapImageLayer[];
};

export type AgentAnimationClip = {
  kind: "gif" | "png_sequence";
  url: string;
  frames: string[];
  fps: number;
  max_pixels: number;
  width: number;
  height: number;
  world_height: number;
  scale: number;
};

export type AgentAnimation = AgentAnimationClip & {
  clips: Record<string, AgentAnimationClip>;
};

export type DialoguePolicy = {
  enabled: boolean;
  distance: number;
  cooldown_ticks: number;
  language: string;
};

export type ActionExtensionCheckIssue = {
  severity: "blocker" | "warning" | "info";
  message: string;
  line?: number | null;
};

export type ActionExtensionCheckResult = {
  ok: boolean;
  action_type: string;
  description: string;
  permissions: string[];
  issues: ActionExtensionCheckIssue[];
};

export type ActionExtension = {
  id: string;
  action_type: string;
  description: string;
  code: string;
  enabled: boolean;
  permissions: string[];
  check?: ActionExtensionCheckResult | null;
  updated_at?: number | null;
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
  narrative_state: Record<string, unknown>;
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

export type NarrativeConfig = {
  enabled: boolean;
  premise: string;
  tone: string;
  cadence_ticks: number;
  last_tick: number;
  recent_summary: string;
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
  narrative: NarrativeConfig;
  tick: number;
  running: boolean;
  model_tasks?: Record<string, { done: boolean; provider?: string; model?: string; started_tick?: number; age_ticks?: number }>;
  scene_director?: {
    pending: boolean;
    last_tick: number;
  };
};

export type ViewMode = "2d" | "3d";

export type EditTool = "select" | "region" | "imageGenerate" | "item" | "spawn" | "move" | "anchor";

export type ImageGenerationMode = "region" | "extension" | "repaint";

export type ImageSelectionMode = "rect" | "ratioRect" | "polygon";

export type ImageAspectPreset = "1:1" | "4:3" | "16:9" | "map";

export type RegionDrawOperation = "add" | "subtract";

export type PanelState = {
  id:
    | "tools"
    | "scene"
    | "agents"
    | "properties"
    | "models"
    | "runtimeMonitor"
    | "imageGeneration"
    | "mapStudio"
    | "regions"
    | "regionDraw"
    | "narrative";
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
  | { kind: "imageLayer"; id: string }
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
  apiKeySet: boolean;
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

export type RemoteModelOption = {
  id: string;
  name: string | null;
};

export type RemoteModelTestResult = {
  ok: boolean;
  provider: string;
  model: string;
  message: string;
  sample: string;
};

export type RuntimePendingModelTask = {
  id?: string;
  agentId: string;
  taskKind?: string;
  status?: string;
  provider: string;
  providerId?: string;
  model: string;
  startedTick: number;
  ageTicks: number;
  ageSeconds?: number | null;
  elapsedMs?: number | null;
  operation?: string;
  prompt?: string;
  width?: number;
  height?: number;
  referenceBackground?: boolean;
  error?: string;
  layerId?: string;
  asset?: string;
};

export type RuntimeModelStatus = {
  id: string;
  name: string;
  kind: string;
  provider: string;
  model: string;
  capabilities: ModelCapability[];
  enabled: boolean;
  pendingCount: number;
  recentEventCount: number;
  recentErrorCount: number;
};

export type RuntimeHardwareStatus = {
  platform: {
    system: string;
    release: string;
    machine: string;
    python: string;
  };
  chip: string;
  cpuCount: number | null;
  loadAverage: number[];
  loadPercent: number | null;
  memoryTotalBytes: number | null;
  memoryAvailableBytes: number | null;
  memoryUsedPercent: number | null;
  gpuPressureAvailable: boolean;
  gpuPressureReason: string;
};

export type RuntimeStatus = {
  timestamp: number;
  simulation: {
    running: boolean;
    tick: number;
    sceneDirectorPending: boolean;
    pendingModelTaskCount: number;
    pendingModelTasks: RuntimePendingModelTask[];
    pendingImageGenerationTasks?: RuntimePendingModelTask[];
    recentImageGenerationTasks?: RuntimePendingModelTask[];
  };
  models: RuntimeModelStatus[];
  hardware: RuntimeHardwareStatus;
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
