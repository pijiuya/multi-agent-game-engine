import {
  Anchor,
  Box,
  Crosshair,
  ImagePlus,
  MapPin,
  MousePointer2,
  Move,
  Save,
  Scan,
  SquareDashedMousePointer,
  StepForward,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { EditTool } from "../types";

type Props = {
  editTool: EditTool;
  zoomPercent: number;
  onEditTool: (tool: EditTool) => void;
  onStep: () => void;
  onSave: () => void;
  onZoom: (direction: 1 | -1) => void;
  onFit: () => void;
  onUpload: (file: File) => void;
};

export function ToolPanel({
  editTool,
  zoomPercent,
  onEditTool,
  onStep,
  onSave,
  onZoom,
  onFit,
  onUpload
}: Props) {
  return (
    <div className="tool-panel">
      <div className="tool-strip">
        <button aria-label="单步" title="单步" onClick={onStep}>
          <StepForward size={18} />
        </button>
        <button aria-label="保存" title="保存" onClick={onSave}>
          <Save size={18} />
        </button>
      </div>

      <div className="tool-strip">
        <button aria-label="缩小" title="缩小" onClick={() => onZoom(-1)}>
          <ZoomOut size={18} />
        </button>
        <button aria-label="适配视图" title="适配视图" onClick={onFit}>
          <Scan size={18} />
        </button>
        <button aria-label="放大" title="放大" onClick={() => onZoom(1)}>
          <ZoomIn size={18} />
        </button>
        <span className="zoom-readout">{zoomPercent}%</span>
      </div>

      <div className="tool-grid">
        <button
          aria-label="选择"
          title="选择"
          className={editTool === "select" ? "active" : ""}
          onClick={() => onEditTool("select")}
        >
          <MousePointer2 size={18} />
        </button>
        <button
          aria-label="锚点"
          title="锚点"
          className={editTool === "anchor" ? "active" : ""}
          onClick={() => onEditTool("anchor")}
        >
          <Anchor size={18} />
        </button>
        <button
          aria-label="移动 agent"
          title="移动 agent"
          className={editTool === "move" ? "active" : ""}
          onClick={() => onEditTool("move")}
        >
          <Move size={18} />
        </button>
        <button
          aria-label="区域绘制"
          title="区域绘制"
          className={editTool === "region" ? "active" : ""}
          onClick={() => onEditTool("region")}
        >
          <SquareDashedMousePointer size={18} />
        </button>
        <button
          aria-label="元素"
          title="元素"
          className={editTool === "item" ? "active" : ""}
          onClick={() => onEditTool("item")}
        >
          <Box size={18} />
        </button>
        <button
          aria-label="出生点"
          title="出生点"
          className={editTool === "spawn" ? "active" : ""}
          onClick={() => onEditTool("spawn")}
        >
          <MapPin size={18} />
        </button>
        <button aria-label="居中选择" title="居中选择" onClick={() => onEditTool("select")}>
          <Crosshair size={18} />
        </button>
      </div>

      <div className="tool-strip">
        <label className="panel-icon-button" aria-label="导入地图" title="导入地图">
          <ImagePlus size={18} />
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
      </div>
    </div>
  );
}
