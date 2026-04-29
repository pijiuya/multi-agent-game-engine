import { CircleDot, Image, MapPin, Package, Shapes, UserRound } from "lucide-react";
import type { CanvasPoint, SelectionState, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  selection: SelectionState;
  canvasPoints: CanvasPoint[];
  onSelect: (selection: SelectionState) => void;
};

export function SceneElementsPanel({ world, selection, canvasPoints, onSelect }: Props) {
  const areas = [
    ...world.map.walkable_areas.map((area) => ({ ...area, group: "可行走" })),
    ...world.map.obstacles.map((area) => ({ ...area, group: "障碍" })),
    ...world.map.interaction_zones.map((area) => ({ ...area, group: "互动" }))
  ].filter((area) => !area.metadata?.generated);

  return (
    <div className="scene-list">
      <button
        className={selection.kind === "map" ? "scene-list-row active" : "scene-list-row"}
        onClick={() => onSelect({ kind: "map", id: world.map.id })}
      >
        <Image size={16} />
        <span>{displayName(world.map.name)}</span>
        <small>地图</small>
      </button>

      <div className="panel-section-label">Agent</div>
      {Object.values(world.agent_profiles).map((agent) => (
        <button
          key={agent.id}
          className={selection.kind === "agent" && selection.id === agent.id ? "scene-list-row active" : "scene-list-row"}
          onClick={() => onSelect({ kind: "agent", id: agent.id })}
        >
          <UserRound size={16} />
          <span>{agent.name}</span>
          <small>{agent.role}</small>
        </button>
      ))}

      <div className="panel-section-label">几何区域</div>
      {areas.map((area) => (
        <button
          key={area.id}
          className={selection.kind === "area" && selection.id === area.id ? "scene-list-row active" : "scene-list-row"}
          onClick={() => onSelect({ kind: "area", id: area.id })}
        >
          <Shapes size={16} />
          <span>{area.name}</span>
          <small>{area.group}</small>
        </button>
      ))}

      <div className="panel-section-label">SAM 分层</div>
      {world.map.regions.map((region) => (
        <button
          key={region.id}
          className={selection.kind === "region" && selection.id === region.id ? "scene-list-row active" : "scene-list-row"}
          onClick={() => onSelect({ kind: "region", id: region.id })}
        >
          <Shapes size={16} />
          <span>{region.name}</span>
          <small>{regionFunctionLabel(region.function)}</small>
        </button>
      ))}

      <div className="panel-section-label">元素</div>
      {world.map.items.map((item) => (
        <button
          key={item.id}
          className={selection.kind === "item" && selection.id === item.id ? "scene-list-row active" : "scene-list-row"}
          onClick={() => onSelect({ kind: "item", id: item.id })}
        >
          <Package size={16} />
          <span>{item.name}</span>
          <small>{item.tags.join(", ") || "元素"}</small>
        </button>
      ))}

      <div className="panel-section-label">空点</div>
      {canvasPoints.map((point) => (
        <button
          key={point.id}
          className={selection.kind === "point" && selection.id === point.id ? "scene-list-row active" : "scene-list-row"}
          onClick={() => onSelect({ kind: "point", id: point.id })}
        >
          <CircleDot size={16} />
          <span>{point.name}</span>
          <small>
            {Math.round(point.position.x)}, {Math.round(point.position.y)}
          </small>
        </button>
      ))}

      <div className="panel-section-label">出生点</div>
      {world.map.spawn_points.map((point, index) => (
        <div className="scene-list-row readonly" key={`${point.x}-${point.y}-${index}`}>
          <MapPin size={16} />
          <span>出生点 {index + 1}</span>
          <small>
            {Math.round(point.x)}, {Math.round(point.y)}
          </small>
        </div>
      ))}
    </div>
  );
}

function regionFunctionLabel(value: string) {
  const labels: Record<string, string> = {
    unassigned: "未设定",
    walkable: "道路",
    obstacle: "不可穿过",
    residential: "居住区",
    social: "社交区",
    custom: "自定义"
  };
  return labels[value] ?? value;
}

function displayName(name: string) {
  const labels: Record<string, string> = {
    "New Sandbox": "新沙盒",
    "Untitled Map": "未命名地图"
  };
  return labels[name] ?? name;
}
