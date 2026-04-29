import type { AgentProfile, AgentState, EditTool, Point, PolygonArea, WorldMap, WorldSnapshot } from "../types";

export function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

export function addAreaToMap(map: WorldMap, tool: EditTool, points: Point[]): WorldMap {
  const kind = tool === "walkable" ? "walkable" : tool === "obstacle" ? "obstacle" : "zone";
  const area: PolygonArea = {
    id: makeId(kind),
    name: kind === "walkable" ? "Walkable Area" : kind === "obstacle" ? "Obstacle" : "Interaction Zone",
    kind,
    points
  };
  if (kind === "walkable") {
    return { ...map, walkable_areas: [...map.walkable_areas, area] };
  }
  if (kind === "obstacle") {
    return { ...map, obstacles: [...map.obstacles, area] };
  }
  return { ...map, interaction_zones: [...map.interaction_zones, area] };
}

export function addItemToMap(map: WorldMap, point: Point): WorldMap {
  return {
    ...map,
    items: [
      ...map.items,
      {
        id: makeId("item"),
        name: "Item",
        position: point,
        radius: 34,
        scale: 1,
        rotation: 0,
        image: null,
        description: "",
        tags: [],
        state: {}
      }
    ]
  };
}

export function addSpawnToMap(map: WorldMap, point: Point): WorldMap {
  return { ...map, spawn_points: [...map.spawn_points, point] };
}

export function moveAgentLocal(world: WorldSnapshot, agentId: string, target: Point): WorldSnapshot {
  const state = world.agent_states[agentId];
  if (!state) {
    return world;
  }
  return {
    ...world,
    agent_states: {
      ...world.agent_states,
      [agentId]: { ...state, target, status: "moving" }
    },
    events: [
      ...world.events.slice(-120),
      {
        id: makeId("evt"),
        type: "action",
        message: `${world.agent_profiles[agentId].name} starts moving.`,
        tick: world.tick,
        timestamp: Date.now() / 1000,
        agent_id: agentId,
        payload: { target }
      }
    ]
  };
}

export function addAgentLocal(world: WorldSnapshot, name: string, role: string, point: Point): WorldSnapshot {
  const id = makeId("agent");
  const profile: AgentProfile = {
    id,
    name,
    role,
    identity: `${name} is a ${role} in this simulation.`,
    model_provider: "mock",
    color: randomAgentColor(),
    action_space: ["move_to", "say", "interact", "use", "observe", "wait"]
  };
  const state: AgentState = {
    id,
    position: point,
    status: "idle",
    speed: 90,
    target: null,
    action_queue: [],
    pending_model: false,
    last_model_tick: -999,
    cooldowns: {}
  };
  return {
    ...world,
    agent_profiles: { ...world.agent_profiles, [id]: profile },
    agent_states: { ...world.agent_states, [id]: state }
  };
}

function randomAgentColor() {
  const palette = ["#2563eb", "#dc2626", "#059669", "#7c3aed", "#ea580c", "#0891b2"];
  return palette[Math.floor(Math.random() * palette.length)];
}
