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

export type WorldItem = {
  id: string;
  name: string;
  position: Point;
  radius: number;
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

export type EditTool = "select" | "walkable" | "obstacle" | "zone" | "item" | "spawn" | "move";

export type PanelState = {
  id: "tools" | "scene" | "agents" | "properties";
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
  | { kind: "area"; id: string };

export type CanvasViewState = {
  zoom: number;
  pan: Point;
  fitMode: boolean;
};

