import type { WorldSnapshot } from "../types";

export const fallbackWorld: WorldSnapshot = {
  id: "world_default",
  name: "New Sandbox",
  tick: 0,
  running: false,
  map: {
    id: "map_default",
    name: "Untitled Map",
    width: 1200,
    height: 800,
    background_image: null,
    walkable_areas: [
      {
        id: "area_main",
        name: "Main Floor",
        kind: "walkable",
        points: [
          { x: 80, y: 80 },
          { x: 1120, y: 80 },
          { x: 1120, y: 720 },
          { x: 80, y: 720 }
        ],
        holes: []
      }
    ],
    obstacles: [
      {
        id: "obs_table",
        name: "Table",
        kind: "obstacle",
        points: [
          { x: 520, y: 330 },
          { x: 690, y: 330 },
          { x: 690, y: 450 },
          { x: 520, y: 450 }
        ],
        holes: []
      }
    ],
    interaction_zones: [
      {
        id: "zone_notice",
        name: "Notice Wall",
        kind: "zone",
        points: [
          { x: 850, y: 160 },
          { x: 1040, y: 160 },
          { x: 1040, y: 260 },
          { x: 850, y: 260 }
        ],
        holes: []
      }
    ],
    regions: [],
    region_layers: [
      { function: "walkable", label: "道路", region_ids: [], polygons: [] },
      { function: "obstacle", label: "不可通过", region_ids: [], polygons: [] },
      { function: "action", label: "行动区", region_ids: [], polygons: [] },
      { function: "residential", label: "居住区", region_ids: [], polygons: [] },
      { function: "social", label: "社交区", region_ids: [], polygons: [] },
      { function: "custom", label: "自定义", region_ids: [], polygons: [] },
      { function: "unassigned", label: "未设定", region_ids: [], polygons: [] }
    ],
    items: [
      {
        id: "item_lamp",
        name: "Lamp",
        position: { x: 250, y: 470 },
        radius: 34,
        scale: 1,
        rotation: 0,
        image: null,
        description: "A warm scene element.",
        tags: ["light"],
        state: { mood: "warm" },
        hidden: false,
        movable: true
      }
    ],
    triggers: [],
    spawn_points: [
      { x: 240, y: 220 },
      { x: 340, y: 260 },
      { x: 440, y: 300 }
    ]
  },
  agent_profiles: {
    agent_mira: {
      id: "agent_mira",
      name: "Mira",
      role: "mediator",
      identity: "Mira is a mediator with a distinct social point of view.",
      model_provider: "mock",
      color: "#ef4444",
      action_space: ["move_to", "say", "interact", "use", "observe", "wait", "stop", "social", "pick_up", "drop_item", "move_item"],
      hidden: false,
      animation: null,
      dialogue_policy: { enabled: true, distance: 180, cooldown_ticks: 20 }
    },
    agent_tao: {
      id: "agent_tao",
      name: "Tao",
      role: "builder",
      identity: "Tao is a builder with a practical temperament.",
      model_provider: "mock",
      color: "#10b981",
      action_space: ["move_to", "say", "interact", "use", "observe", "wait", "stop", "social", "pick_up", "drop_item", "move_item"],
      hidden: false,
      animation: null,
      dialogue_policy: { enabled: true, distance: 180, cooldown_ticks: 20 }
    },
    agent_ren: {
      id: "agent_ren",
      name: "Ren",
      role: "observer",
      identity: "Ren notices patterns before speaking.",
      model_provider: "mock",
      color: "#8b5cf6",
      action_space: ["move_to", "say", "interact", "use", "observe", "wait", "stop", "social", "pick_up", "drop_item", "move_item"],
      hidden: false,
      animation: null,
      dialogue_policy: { enabled: true, distance: 180, cooldown_ticks: 20 }
    }
  },
  agent_states: {
    agent_mira: {
      id: "agent_mira",
      position: { x: 240, y: 220 },
      status: "idle",
      speed: 90,
      target: null,
      action_queue: [],
      pending_model: false,
      last_model_tick: -999,
      cooldowns: {},
      held_item_id: null
    },
    agent_tao: {
      id: "agent_tao",
      position: { x: 340, y: 260 },
      status: "idle",
      speed: 90,
      target: null,
      action_queue: [],
      pending_model: false,
      last_model_tick: -999,
      cooldowns: {},
      held_item_id: null
    },
    agent_ren: {
      id: "agent_ren",
      position: { x: 440, y: 300 },
      status: "idle",
      speed: 90,
      target: null,
      action_queue: [],
      pending_model: false,
      last_model_tick: -999,
      cooldowns: {},
      held_item_id: null
    }
  },
  relationships: [],
  memories: [],
  decision_events: [],
  events: [
    {
      id: "evt_boot",
      type: "system",
      message: "Sandbox initialized.",
      tick: 0,
      timestamp: Date.now() / 1000,
      payload: {}
    }
  ]
};
