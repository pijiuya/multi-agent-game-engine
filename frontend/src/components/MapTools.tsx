import {
  Box,
  CircleDot,
  Download,
  Hexagon,
  ImagePlus,
  MapPin,
  MousePointer2,
  Play,
  Save,
  Square,
  SquareDashedMousePointer,
  StepForward,
  Triangle
} from "lucide-react";
import type { EditTool, ViewMode } from "../types";

type Props = {
  viewMode: ViewMode;
  editTool: EditTool;
  running: boolean;
  draftCount: number;
  onViewMode: (mode: ViewMode) => void;
  onEditTool: (tool: EditTool) => void;
  onRunToggle: () => void;
  onStep: () => void;
  onSave: () => void;
  onFinalizePolygon: () => void;
  onClearDraft: () => void;
  onUpload: (file: File) => void;
};

export function MapTools({
  viewMode,
  editTool,
  running,
  draftCount,
  onViewMode,
  onEditTool,
  onRunToggle,
  onStep,
  onSave,
  onFinalizePolygon,
  onClearDraft,
  onUpload
}: Props) {
  return (
    <aside className="tool-rail">
      <div className="brand">
        <Hexagon size={25} />
        <div>
          <h1>Multi-Agent Engine</h1>
          <span>tick {running ? "live" : "paused"}</span>
        </div>
      </div>

      <div className="segmented">
        <button className={viewMode === "2d" ? "active" : ""} onClick={() => onViewMode("2d")}>
          2D
        </button>
        <button className={viewMode === "3d" ? "active" : ""} onClick={() => onViewMode("3d")}>
          3D
        </button>
      </div>

      <div className="tool-group">
        <button aria-label="Run" className={running ? "active" : ""} onClick={onRunToggle}>
          <Play size={19} />
        </button>
        <button aria-label="Step" onClick={onStep}>
          <StepForward size={19} />
        </button>
        <button aria-label="Save" onClick={onSave}>
          <Save size={19} />
        </button>
      </div>

      <div className="tool-group">
        <button aria-label="Select" className={editTool === "select" ? "active" : ""} onClick={() => onEditTool("select")}>
          <MousePointer2 size={19} />
        </button>
        <button aria-label="Walkable" className={editTool === "walkable" ? "active" : ""} onClick={() => onEditTool("walkable")}>
          <SquareDashedMousePointer size={19} />
        </button>
        <button aria-label="Obstacle" className={editTool === "obstacle" ? "active" : ""} onClick={() => onEditTool("obstacle")}>
          <Square size={19} />
        </button>
        <button aria-label="Zone" className={editTool === "zone" ? "active" : ""} onClick={() => onEditTool("zone")}>
          <Triangle size={19} />
        </button>
        <button aria-label="Item" className={editTool === "item" ? "active" : ""} onClick={() => onEditTool("item")}>
          <Box size={19} />
        </button>
        <button aria-label="Spawn" className={editTool === "spawn" ? "active" : ""} onClick={() => onEditTool("spawn")}>
          <MapPin size={19} />
        </button>
        <button aria-label="Move" className={editTool === "move" ? "active" : ""} onClick={() => onEditTool("move")}>
          <CircleDot size={19} />
        </button>
      </div>

      <div className="tool-group">
        <label className="icon-button" aria-label="Upload map">
          <ImagePlus size={19} />
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onUpload(file);
              }
              event.currentTarget.value = "";
            }}
          />
        </label>
        <button aria-label="Finalize polygon" disabled={draftCount < 3} onClick={onFinalizePolygon}>
          <Download size={19} />
        </button>
        <button aria-label="Clear draft" disabled={draftCount === 0} onClick={onClearDraft}>
          ×
        </button>
      </div>
    </aside>
  );
}

