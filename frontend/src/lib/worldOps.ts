import type { AgentProfile, AgentState, MapRegion, MapRegionFunction, Point, PolygonArea, WorldMap, WorldSnapshot } from "../types";

export function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

export function addRegionToMap(map: WorldMap, points: Point[], fn: MapRegionFunction = "unassigned"): { map: WorldMap; region: MapRegion } {
  const region: MapRegion = {
    id: makeId("region"),
    name: "手绘区域",
    points,
    holes: [],
    source: "manual",
    function: fn,
    image_prompt: "",
    notes: "手绘区域。",
    confidence: 1,
    tags: ["手绘"],
    hidden: false
  };
  return { map: syncFunctionalRegions({ ...map, regions: [region, ...map.regions] }), region };
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
        state: {},
        hidden: false,
        movable: true,
        interactable: true,
        affordances: []
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
    action_space: ["move_to", "say", "interact", "use", "observe", "wait", "stop", "social", "pick_up", "drop_item", "move_item"],
    hidden: false,
    animation: null,
    dialogue_policy: { enabled: true, distance: 180, cooldown_ticks: 20, language: "auto" }
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
    cooldowns: {},
    held_item_id: null,
    narrative_state: {}
  };
  return {
    ...world,
    agent_profiles: { ...world.agent_profiles, [id]: profile },
    agent_states: { ...world.agent_states, [id]: state }
  };
}

function syncFunctionalRegions(map: WorldMap): WorldMap {
  const walkable_areas: PolygonArea[] = [];
  const obstacles: PolygonArea[] = [];
  const interaction_zones: PolygonArea[] = [];
  for (const region of map.regions) {
    if (region.hidden) {
      continue;
    }
    const area = regionToArea(region);
    if (region.function === "walkable") {
      walkable_areas.push(area);
    } else if (region.function === "action") {
      walkable_areas.push(area);
    } else if (region.function === "obstacle") {
      obstacles.push(area);
    } else if (region.function === "social") {
      interaction_zones.push(area);
    }
  }
  return { ...map, walkable_areas, obstacles, interaction_zones, region_layers: buildFallbackRegionLayers(map.regions) };
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

function randomAgentColor() {
  const palette = ["#2563eb", "#dc2626", "#059669", "#7c3aed", "#ea580c", "#0891b2"];
  return palette[Math.floor(Math.random() * palette.length)];
}
