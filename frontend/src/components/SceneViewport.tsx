import { Maximize2, Minus, Square, X } from "lucide-react";
import type { CanvasViewState, EditTool, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  editTool: EditTool;
  canvasView: CanvasViewState;
  status: string;
};

export function SceneViewport({ world, editTool, canvasView, status }: Props) {
  return (
    <section className="scene-window" data-testid="scene-viewport">
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
      <div className="scene-canvas-shell">
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
