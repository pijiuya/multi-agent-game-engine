import { Maximize2, Minus, Square, X } from "lucide-react";
import type { CSSProperties, PointerEvent, WheelEvent } from "react";
import { useRef, useState } from "react";
import type { CanvasViewState, EditTool, Point, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  editTool: EditTool;
  canvasView: CanvasViewState;
  status: string;
  onViewChange: (view: CanvasViewState) => void;
};

type PanDrag = {
  pointerId: number;
  x: number;
  y: number;
  pan: Point;
};

const MIN_ZOOM = 0.125;
const MAX_ZOOM = 8;

export function SceneViewport({ world, editTool, canvasView, status, onViewChange }: Props) {
  const panDragRef = useRef<PanDrag | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const gridStyle = getGridStyle(canvasView);
  const density = getGridDensity(canvasView.zoom);

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
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
      >
        <div className="workspace-surface" data-testid="workspace-surface" aria-label="透明工作站底图" />
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
    move: "移动"
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
