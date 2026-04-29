import { Maximize2, Minus, Square, X } from "lucide-react";
import type { CSSProperties, MouseEvent, PointerEvent, WheelEvent } from "react";
import { useRef, useState } from "react";
import { screenToWorld, snapWorldPointToGrid } from "../lib/canvasCoords";
import type { CanvasPoint, CanvasViewState, EditTool, Point, SelectionState, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  editTool: EditTool;
  canvasView: CanvasViewState;
  selection: SelectionState;
  canvasPoints: CanvasPoint[];
  anchorPoint: Point | null;
  status: string;
  onViewChange: (view: CanvasViewState) => void;
  onWorldPoint: (point: Point) => void;
  onSelect: (selection: SelectionState) => void;
  onAnchorContext: (screen: Point, world: Point) => void;
};

type PanDrag = {
  pointerId: number;
  x: number;
  y: number;
  pan: Point;
};

const MIN_ZOOM = 0.125;
const MAX_ZOOM = 8;

export function SceneViewport({
  world,
  editTool,
  canvasView,
  selection,
  canvasPoints,
  anchorPoint,
  status,
  onViewChange,
  onWorldPoint,
  onSelect,
  onAnchorContext
}: Props) {
  const panDragRef = useRef<PanDrag | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const gridStyle = getGridStyle(canvasView);
  const density = getGridDensity(canvasView.zoom);
  const worldLayerStyle = {
    transform: `translate(${canvasView.pan.x}px, ${canvasView.pan.y}px) scale(${canvasView.zoom})`
  } as CSSProperties;

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    const nextZoom = clamp(canvasView.zoom * Math.pow(1.0012, -event.deltaY), MIN_ZOOM, MAX_ZOOM);
    const worldUnderCursor = {
      x: (anchor.x - canvasView.pan.x) / canvasView.zoom,
      y: (anchor.y - canvasView.pan.y) / canvasView.zoom
    };
    onViewChange({
      zoom: nextZoom,
      pan: {
        x: anchor.x - worldUnderCursor.x * nextZoom,
        y: anchor.y - worldUnderCursor.y * nextZoom
      },
      fitMode: false
    });
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button === 0) {
      const point = localWorldPoint(event);
      onWorldPoint(editTool === "anchor" ? snapWorldPointToGrid(point, canvasView.zoom) : point);
      return;
    }
    if (event.button !== 1) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panDragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pan: canvasView.pan
    };
    setIsPanning(true);
  }

  function movePan(event: PointerEvent<HTMLDivElement>) {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    onViewChange({
      ...canvasView,
      pan: {
        x: drag.pan.x + event.clientX - drag.x,
        y: drag.pan.y + event.clientY - drag.y
      },
      fitMode: false
    });
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    panDragRef.current = null;
    setIsPanning(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (editTool !== "anchor") {
      return;
    }
    event.preventDefault();
    const point = snapWorldPointToGrid(localWorldPoint(event), canvasView.zoom);
    onAnchorContext({ x: event.clientX, y: event.clientY }, point);
  }

  function localWorldPoint(event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return screenToWorld(
      {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      },
      canvasView
    );
  }

  function stopMarkerPointer(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  return (
    <section
      className={isPanning ? "scene-window panning" : "scene-window"}
      data-testid="scene-viewport"
      data-grid-density={density}
      style={gridStyle}
    >
      <div className="scene-window-material" />
      <div className="scene-window-grid" />
      <header className="scene-header">
        <div>
          <h1>{displayName(world.name)}</h1>
          <span>
            帧 {world.tick} / {status} / 缩放 {Math.round(canvasView.zoom * 100)}%
          </span>
        </div>
        <div className="scene-metrics">
          <span>{Object.keys(world.agent_profiles).length} 个 agent</span>
          <span>{world.map.items.length} 个元素</span>
          <span>{world.events.length} 条事件</span>
        </div>
        <div className="window-controls">
          <button aria-label="最小化窗口" onClick={() => void window.engineWindow?.minimize()}>
            <Minus size={15} />
          </button>
          <button aria-label="最大化窗口" onClick={() => void window.engineWindow?.maximizeToggle()}>
            <Square size={13} />
          </button>
          <button aria-label="关闭窗口" onClick={() => void window.engineWindow?.close()}>
            <X size={15} />
          </button>
        </div>
      </header>
      <div
        className="scene-canvas-shell"
        onWheel={handleWheel}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onContextMenu={handleContextMenu}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
      >
        <div className="workspace-surface" data-testid="workspace-surface" aria-label="透明工作站底图" />
        <div className="world-coordinate-layer" data-testid="world-coordinate-layer" style={worldLayerStyle}>
          <div className="world-origin-marker" data-testid="origin-marker" style={pointStyle({ x: 0, y: 0 })}>
            <span />
          </div>
          {world.map.items.map((item) => (
            <button
              className={selection.kind === "item" && selection.id === item.id ? "world-item-marker active" : "world-item-marker"}
              data-testid={`world-item-${item.id}`}
              data-world-x={item.position.x}
              data-world-y={item.position.y}
              data-world-object="item"
              key={item.id}
              onClick={() => onSelect({ kind: "item", id: item.id })}
              onPointerDown={stopMarkerPointer}
              style={pointStyle(item.position)}
              title={item.name}
            >
              {item.name.slice(0, 1)}
            </button>
          ))}
          {Object.values(world.agent_profiles).map((agent) => {
            const state = world.agent_states[agent.id];
            if (!state) {
              return null;
            }
            return (
              <button
                className={
                  selection.kind === "agent" && selection.id === agent.id ? "world-agent-marker active" : "world-agent-marker"
                }
                data-testid={`world-agent-${agent.id}`}
                data-world-x={state.position.x}
                data-world-y={state.position.y}
                data-world-object="agent"
                key={agent.id}
                onClick={() => onSelect({ kind: "agent", id: agent.id })}
                onPointerDown={stopMarkerPointer}
                style={{ ...pointStyle(state.position), "--agent-color": agent.color } as CSSProperties}
                title={agent.name}
              >
                <span />
                <small>{agent.name}</small>
              </button>
            );
          })}
          {canvasPoints.map((point) => (
            <button
              className={
                selection.kind === "point" && selection.id === point.id ? "world-empty-point-marker active" : "world-empty-point-marker"
              }
              data-testid={`world-point-${point.id}`}
              data-world-x={point.position.x}
              data-world-y={point.position.y}
              data-world-object="point"
              key={point.id}
              onClick={() => onSelect({ kind: "point", id: point.id })}
              onPointerDown={stopMarkerPointer}
              style={pointStyle(point.position)}
              title={point.name}
            />
          ))}
          {anchorPoint ? (
            <button
              aria-label="当前锚点"
              className="world-anchor-marker active"
              data-testid="world-anchor-marker"
              data-world-x={anchorPoint.x}
              data-world-y={anchorPoint.y}
              data-world-object="anchor"
              onPointerDown={stopMarkerPointer}
              style={pointStyle(anchorPoint)}
              title="当前锚点"
            />
          ) : null}
        </div>
        <div className="scene-corner-mark top-left" />
        <div className="scene-corner-mark top-right" />
        <div className="scene-corner-mark bottom-left" />
        <div className="scene-corner-mark bottom-right" />
      </div>
      <footer className="scene-footer">
        <span>{displayName(world.map.name)}</span>
        <span>
          {world.map.width} x {world.map.height}
        </span>
        <span>{toolLabel(editTool)}</span>
        <Maximize2 size={14} />
      </footer>
    </section>
  );
}

function pointStyle(point: Point) {
  return {
    left: `${point.x}px`,
    top: `${point.y}px`
  } as CSSProperties;
}

function getGridStyle(view: CanvasViewState) {
  const density = getGridDensity(view.zoom);
  const baseMinor = density === "fine" ? 8 : density === "simple" ? 36 : 18;
  const baseMajor = density === "fine" ? 64 : density === "simple" ? 144 : 90;
  const minorSize = clamp(baseMinor * view.zoom, 5, 96);
  const majorSize = clamp(baseMajor * view.zoom, 36, 320);
  const minorAlpha = density === "simple" ? 0.08 : density === "fine" ? 0.38 : 0.28;
  const majorAlpha = density === "simple" ? 0.42 : density === "fine" ? 0.5 : 0.42;
  const panX = view.pan.x;
  const panY = view.pan.y;

  return {
    "--grid-pan-x": `${panX}px`,
    "--grid-pan-y": `${panY}px`,
    "--grid-size-minor": `${minorSize}px`,
    "--grid-size-major": `${majorSize}px`,
    "--grid-alpha-minor-x": String(minorAlpha),
    "--grid-alpha-minor-y": String(Math.max(0.06, minorAlpha - 0.02)),
    "--grid-alpha-major-x": String(majorAlpha),
    "--grid-alpha-major-y": String(Math.max(0.08, majorAlpha - 0.04))
  } as CSSProperties;
}

function getGridDensity(zoom: number) {
  if (zoom < 0.35) {
    return "simple";
  }
  if (zoom > 2.5) {
    return "fine";
  }
  return "normal";
}

function toolLabel(tool: EditTool) {
  const labels: Record<EditTool, string> = {
    select: "选择",
    walkable: "可行走区",
    obstacle: "障碍区",
    zone: "互动区",
    item: "元素",
    spawn: "出生点",
    move: "移动",
    anchor: "锚点"
  };
  return labels[tool];
}

function displayName(name: string) {
  const labels: Record<string, string> = {
    "New Sandbox": "新沙盒",
    "Untitled Map": "未命名地图"
  };
  return labels[name] ?? name;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
