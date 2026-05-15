import { ChevronDown, ChevronRight, CircleDot, Image, Layers3, MapPin, Package, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { CanvasPoint, SelectionState, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  selection: SelectionState;
  canvasPoints: CanvasPoint[];
  onSelect: (selection: SelectionState) => void;
  onObjectContext: (target: { kind: "agent" | "item" | "imageLayer"; id: string }, screen: { x: number; y: number }) => void;
};

export function SceneElementsPanel({ world, selection, canvasPoints, onSelect, onObjectContext }: Props) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => loadOpenSections());

  useEffect(() => {
    window.localStorage.setItem(SCENE_SECTION_STORAGE_KEY, JSON.stringify(openSections));
  }, [openSections]);

  function toggle(section: string) {
    setOpenSections((current) => ({ ...current, [section]: !(current[section] ?? true) }));
  }

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

      <SectionHeader count={Object.keys(world.agent_profiles).length} label="Agent" open={openSections.agents ?? true} onToggle={() => toggle("agents")} />
      {openSections.agents !== false
        ? Object.values(world.agent_profiles).map((agent) => (
            <button
              key={agent.id}
              className={`${selection.kind === "agent" && selection.id === agent.id ? "scene-list-row active" : "scene-list-row"}${agent.hidden ? " hidden-object" : ""}`}
              onClick={() => onSelect({ kind: "agent", id: agent.id })}
              onContextMenu={(event) => {
                event.preventDefault();
                onSelect({ kind: "agent", id: agent.id });
                onObjectContext({ kind: "agent", id: agent.id }, { x: event.clientX, y: event.clientY });
              }}
            >
              <UserRound size={16} />
              <span>{agent.name}</span>
              <small>{agent.hidden ? "已隐藏" : agent.role}</small>
            </button>
          ))
        : null}

      <SectionHeader count={world.map.items.length} label="元素" open={openSections.items ?? true} onToggle={() => toggle("items")} />
      {openSections.items !== false
        ? world.map.items.map((item) => (
            <button
              key={item.id}
              className={`${selection.kind === "item" && selection.id === item.id ? "scene-list-row active" : "scene-list-row"}${item.hidden ? " hidden-object" : ""}`}
              onClick={() => onSelect({ kind: "item", id: item.id })}
              onContextMenu={(event) => {
                event.preventDefault();
                onSelect({ kind: "item", id: item.id });
                onObjectContext({ kind: "item", id: item.id }, { x: event.clientX, y: event.clientY });
              }}
            >
              <Package size={16} />
              <span>{item.name}</span>
              <small>{item.hidden ? "已隐藏" : item.movable ? item.tags.join(", ") || "可移动" : "不可移动"}</small>
            </button>
          ))
        : null}

      <SectionHeader count={world.map.image_layers.length} label="图层" open={openSections.layers ?? true} onToggle={() => toggle("layers")} />
      {openSections.layers !== false
        ? world.map.image_layers.map((layer) => (
            <button
              key={layer.id}
              className={`${selection.kind === "imageLayer" && selection.id === layer.id ? "scene-list-row active" : "scene-list-row"}${layer.hidden ? " hidden-object" : ""}`}
              onClick={() => onSelect({ kind: "imageLayer", id: layer.id })}
              onContextMenu={(event) => {
                event.preventDefault();
                onSelect({ kind: "imageLayer", id: layer.id });
                onObjectContext({ kind: "imageLayer", id: layer.id }, { x: event.clientX, y: event.clientY });
              }}
            >
              <Layers3 size={16} />
              <span>{layer.name}</span>
              <small>{layer.hidden ? "已隐藏" : layerKindLabel(layer.kind)}</small>
            </button>
          ))
        : null}

      <SectionHeader count={canvasPoints.length} label="空点" open={openSections.points ?? true} onToggle={() => toggle("points")} />
      {openSections.points !== false
        ? canvasPoints.map((point) => (
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
          ))
        : null}

      <SectionHeader count={world.map.spawn_points.length} label="出生点" open={openSections.spawns ?? true} onToggle={() => toggle("spawns")} />
      {openSections.spawns !== false
        ? world.map.spawn_points.map((point, index) => (
            <div className="scene-list-row readonly" key={`${point.x}-${point.y}-${index}`}>
              <MapPin size={16} />
              <span>出生点 {index + 1}</span>
              <small>
                {Math.round(point.x)}, {Math.round(point.y)}
              </small>
            </div>
          ))
        : null}
    </div>
  );
}

const SCENE_SECTION_STORAGE_KEY = "agent-workstation.scene-sections.v1";

function SectionHeader({ count, label, open, onToggle }: { count: number; label: string; open: boolean; onToggle: () => void }) {
  return (
    <button className="panel-section-toggle" onClick={onToggle} type="button">
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      <span>{label}</span>
      <small>{count} 个</small>
    </button>
  );
}

function loadOpenSections() {
  const defaults = { agents: true, items: true, layers: true, points: true, spawns: true };
  try {
    return { ...defaults, ...JSON.parse(window.localStorage.getItem(SCENE_SECTION_STORAGE_KEY) ?? "{}") };
  } catch {
    return defaults;
  }
}

function layerKindLabel(kind: string) {
  if (kind === "extension") {
    return "边缘延展";
  }
  if (kind === "background") {
    return "背景";
  }
  return "区域生成";
}

function displayName(name: string) {
  const labels: Record<string, string> = {
    "New Sandbox": "新沙盒",
    "Untitled Map": "未命名地图"
  };
  return labels[name] ?? name;
}
