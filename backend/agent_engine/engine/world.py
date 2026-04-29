from __future__ import annotations

from dataclasses import asdict, dataclass, field
from time import time
from typing import Any
from uuid import uuid4

from .geometry import distance, point_in_polygon


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


@dataclass(slots=True)
class Point:
    x: float
    y: float

    def to_dict(self) -> dict[str, float]:
        return {"x": self.x, "y": self.y}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Point":
        return cls(x=float(data["x"]), y=float(data["y"]))


@dataclass(slots=True)
class PolygonArea:
    id: str
    name: str
    points: list[Point]
    kind: str = "walkable"
    metadata: dict[str, Any] = field(default_factory=dict)

    def contains(self, point: Point) -> bool:
        return point_in_polygon(point.to_dict(), [p.to_dict() for p in self.points])

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "points": [p.to_dict() for p in self.points],
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PolygonArea":
        return cls(
            id=data["id"],
            name=data.get("name", data["id"]),
            kind=data.get("kind", "walkable"),
            points=[Point.from_dict(point) for point in data.get("points", [])],
            metadata=data.get("metadata", {}),
        )


@dataclass(slots=True)
class WorldItem:
    id: str
    name: str
    position: Point
    radius: float = 32
    scale: float = 1
    rotation: float = 0
    image: str | None = None
    description: str = ""
    tags: list[str] = field(default_factory=list)
    state: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "position": self.position.to_dict(),
            "radius": self.radius,
            "scale": self.scale,
            "rotation": self.rotation,
            "image": self.image,
            "description": self.description,
            "tags": self.tags,
            "state": self.state,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WorldItem":
        return cls(
            id=data["id"],
            name=data.get("name", data["id"]),
            position=Point.from_dict(data["position"]),
            radius=float(data.get("radius", 32)),
            scale=float(data.get("scale", 1)),
            rotation=float(data.get("rotation", 0)),
            image=data.get("image"),
            description=str(data.get("description", "")),
            tags=list(data.get("tags", [])),
            state=dict(data.get("state", {})),
        )


@dataclass(slots=True)
class WorldMap:
    id: str
    name: str
    width: int
    height: int
    background_image: str | None = None
    walkable_areas: list[PolygonArea] = field(default_factory=list)
    obstacles: list[PolygonArea] = field(default_factory=list)
    interaction_zones: list[PolygonArea] = field(default_factory=list)
    items: list[WorldItem] = field(default_factory=list)
    triggers: list[PolygonArea] = field(default_factory=list)
    spawn_points: list[Point] = field(default_factory=list)

    def is_inside_bounds(self, point: Point) -> bool:
        return 0 <= point.x <= self.width and 0 <= point.y <= self.height

    def is_walkable(self, point: Point) -> bool:
        if not self.is_inside_bounds(point):
            return False
        has_walkable_areas = bool(self.walkable_areas)
        inside_walkable = not has_walkable_areas or any(area.contains(point) for area in self.walkable_areas)
        inside_obstacle = any(obstacle.contains(point) for obstacle in self.obstacles)
        return inside_walkable and not inside_obstacle

    def nearest_spawn(self) -> Point:
        if self.spawn_points:
            return self.spawn_points[0]
        return Point(self.width / 2, self.height / 2)

    def item_by_id(self, item_id: str) -> WorldItem | None:
        return next((item for item in self.items if item.id == item_id), None)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "width": self.width,
            "height": self.height,
            "background_image": self.background_image,
            "walkable_areas": [area.to_dict() for area in self.walkable_areas],
            "obstacles": [area.to_dict() for area in self.obstacles],
            "interaction_zones": [area.to_dict() for area in self.interaction_zones],
            "items": [item.to_dict() for item in self.items],
            "triggers": [trigger.to_dict() for trigger in self.triggers],
            "spawn_points": [point.to_dict() for point in self.spawn_points],
        }

    @classmethod
    def default(cls) -> "WorldMap":
        return cls(
            id="map_default",
            name="Untitled Map",
            width=1200,
            height=800,
            walkable_areas=[
                PolygonArea(
                    id="area_main",
                    name="Main Floor",
                    points=[
                        Point(80, 80),
                        Point(1120, 80),
                        Point(1120, 720),
                        Point(80, 720),
                    ],
                )
            ],
            spawn_points=[Point(240, 220), Point(320, 260), Point(400, 240)],
        )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WorldMap":
        return cls(
            id=data["id"],
            name=data.get("name", data["id"]),
            width=int(data.get("width", 1200)),
            height=int(data.get("height", 800)),
            background_image=data.get("background_image"),
            walkable_areas=[PolygonArea.from_dict(area) for area in data.get("walkable_areas", [])],
            obstacles=[PolygonArea.from_dict(area) for area in data.get("obstacles", [])],
            interaction_zones=[
                PolygonArea.from_dict(area) for area in data.get("interaction_zones", [])
            ],
            items=[WorldItem.from_dict(item) for item in data.get("items", [])],
            triggers=[PolygonArea.from_dict(area) for area in data.get("triggers", [])],
            spawn_points=[Point.from_dict(point) for point in data.get("spawn_points", [])],
        )


DEFAULT_ACTION_SPACE = ["move_to", "say", "interact", "use", "observe", "wait"]


@dataclass(slots=True)
class AgentProfile:
    id: str
    name: str
    role: str = "resident"
    identity: str = "A curious resident in the scene."
    model_provider: str = "mock"
    color: str = "#3b82f6"
    action_space: list[str] = field(default_factory=lambda: list(DEFAULT_ACTION_SPACE))

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentProfile":
        return cls(
            id=data["id"],
            name=data.get("name", data["id"]),
            role=data.get("role", "resident"),
            identity=data.get("identity", "A curious resident in the scene."),
            model_provider=data.get("model_provider", "mock"),
            color=data.get("color", "#3b82f6"),
            action_space=list(data.get("action_space", DEFAULT_ACTION_SPACE)),
        )


@dataclass(slots=True)
class AgentState:
    id: str
    position: Point
    status: str = "idle"
    speed: float = 90.0
    target: Point | None = None
    action_queue: list[dict[str, Any]] = field(default_factory=list)
    pending_model: bool = False
    last_model_tick: int = -999
    cooldowns: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "position": self.position.to_dict(),
            "status": self.status,
            "speed": self.speed,
            "target": self.target.to_dict() if self.target else None,
            "action_queue": self.action_queue,
            "pending_model": self.pending_model,
            "last_model_tick": self.last_model_tick,
            "cooldowns": self.cooldowns,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentState":
        return cls(
            id=data["id"],
            position=Point.from_dict(data["position"]),
            status=data.get("status", "idle"),
            speed=float(data.get("speed", 90)),
            target=Point.from_dict(data["target"]) if data.get("target") else None,
            action_queue=list(data.get("action_queue", [])),
            pending_model=bool(data.get("pending_model", False)),
            last_model_tick=int(data.get("last_model_tick", -999)),
            cooldowns=dict(data.get("cooldowns", {})),
        )


@dataclass(slots=True)
class Relationship:
    from_agent: str
    to_agent: str
    label: str
    score: float = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Relationship":
        return cls(
            from_agent=data["from_agent"],
            to_agent=data["to_agent"],
            label=data.get("label", "knows"),
            score=float(data.get("score", 0)),
        )


@dataclass(slots=True)
class Memory:
    id: str
    agent_id: str
    text: str
    kind: str = "short_term"
    timestamp: float = field(default_factory=time)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Memory":
        return cls(
            id=data.get("id", new_id("mem")),
            agent_id=data["agent_id"],
            text=data["text"],
            kind=data.get("kind", "short_term"),
            timestamp=float(data.get("timestamp", time())),
        )


@dataclass(slots=True)
class Event:
    id: str
    type: str
    message: str
    tick: int
    timestamp: float = field(default_factory=time)
    agent_id: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Event":
        return cls(
            id=data.get("id", new_id("evt")),
            type=data.get("type", "event"),
            message=data.get("message", ""),
            tick=int(data.get("tick", 0)),
            timestamp=float(data.get("timestamp", time())),
            agent_id=data.get("agent_id"),
            payload=dict(data.get("payload", {})),
        )


@dataclass(slots=True)
class AgentAction:
    agent_id: str
    type: str
    payload: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: new_id("act"))
    created_at: float = field(default_factory=time)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentAction":
        return cls(
            id=data.get("id", new_id("act")),
            agent_id=data["agent_id"],
            type=data["type"],
            payload=dict(data.get("payload", {})),
            created_at=float(data.get("created_at", time())),
        )


@dataclass(slots=True)
class GameWorld:
    id: str
    name: str
    map: WorldMap
    agent_profiles: dict[str, AgentProfile] = field(default_factory=dict)
    agent_states: dict[str, AgentState] = field(default_factory=dict)
    relationships: list[Relationship] = field(default_factory=list)
    memories: list[Memory] = field(default_factory=list)
    events: list[Event] = field(default_factory=list)
    tick: int = 0
    running: bool = False

    def add_agent(self, profile: AgentProfile, position: Point | None = None) -> None:
        self.agent_profiles[profile.id] = profile
        self.agent_states[profile.id] = AgentState(
            id=profile.id,
            position=position or self.map.nearest_spawn(),
        )

    def add_event(
        self,
        event_type: str,
        message: str,
        agent_id: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> Event:
        event = Event(
            id=new_id("evt"),
            type=event_type,
            message=message,
            tick=self.tick,
            agent_id=agent_id,
            payload=payload or {},
        )
        self.events.append(event)
        self.events = self.events[-250:]
        return event

    def nearby_agents(self, agent_id: str, radius: float) -> list[AgentProfile]:
        state = self.agent_states[agent_id]
        nearby: list[AgentProfile] = []
        for other_id, other_state in self.agent_states.items():
            if other_id == agent_id:
                continue
            if distance(state.position.to_dict(), other_state.position.to_dict()) <= radius:
                nearby.append(self.agent_profiles[other_id])
        return nearby

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "map": self.map.to_dict(),
            "agent_profiles": {
                agent_id: profile.to_dict() for agent_id, profile in self.agent_profiles.items()
            },
            "agent_states": {
                agent_id: state.to_dict() for agent_id, state in self.agent_states.items()
            },
            "relationships": [relationship.to_dict() for relationship in self.relationships],
            "memories": [memory.to_dict() for memory in self.memories],
            "events": [event.to_dict() for event in self.events],
            "tick": self.tick,
            "running": self.running,
        }

    @classmethod
    def default(cls) -> "GameWorld":
        world = cls(id="world_default", name="New Sandbox", map=WorldMap.default())
        default_agents = [
            ("agent_mira", "Mira", "mediator", "#ef4444", Point(240, 220)),
            ("agent_tao", "Tao", "builder", "#10b981", Point(340, 260)),
            ("agent_ren", "Ren", "observer", "#8b5cf6", Point(440, 300)),
        ]
        for agent_id, name, role, color, position in default_agents:
            world.add_agent(
                AgentProfile(
                    id=agent_id,
                    name=name,
                    role=role,
                    identity=f"{name} is a {role} with a distinct social point of view.",
                    color=color,
                ),
                position=position,
            )
        world.add_event("system", "Sandbox initialized.")
        return world

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "GameWorld":
        return cls(
            id=data.get("id", "world_default"),
            name=data.get("name", "New Sandbox"),
            map=WorldMap.from_dict(data.get("map", WorldMap.default().to_dict())),
            agent_profiles={
                agent_id: AgentProfile.from_dict(profile)
                for agent_id, profile in data.get("agent_profiles", {}).items()
            },
            agent_states={
                agent_id: AgentState.from_dict(state)
                for agent_id, state in data.get("agent_states", {}).items()
            },
            relationships=[
                Relationship.from_dict(item) for item in data.get("relationships", [])
            ],
            memories=[Memory.from_dict(item) for item in data.get("memories", [])],
            events=[Event.from_dict(item) for item in data.get("events", [])],
            tick=int(data.get("tick", 0)),
            running=bool(data.get("running", False)),
        )
