import { Check, Eraser, Plus, RotateCcw, Undo2 } from "lucide-react";
import type { MapRegionFunction, RegionDrawOperation, RegionLayer } from "../types";

type Props = {
  operation: RegionDrawOperation;
  targetFunction: MapRegionFunction;
  targetLayer: RegionLayer | null;
  draftCount: number;
  finishMinPoints?: number;
  title?: string;
  onOperation: (operation: RegionDrawOperation) => void;
  onTargetFunction: (fn: MapRegionFunction) => void;
  onFinish: () => void;
  onUndoPoint: () => void;
  onClear: () => void;
};

const TARGET_FUNCTIONS: MapRegionFunction[] = ["walkable", "obstacle", "action", "residential", "social", "custom"];

export function RegionDrawPanel({
  operation,
  targetFunction,
  targetLayer,
  draftCount,
  finishMinPoints = 3,
  title = "区域绘制",
  onOperation,
  onTargetFunction,
  onFinish,
  onUndoPoint,
  onClear
}: Props) {
  const targetCount = targetLayer?.region_ids.length ?? 0;
  const finishDisabled = draftCount < finishMinPoints || (operation === "subtract" && targetCount === 0);
  return (
    <div className="region-draw-panel" data-testid="region-draw-panel">
      <div className="panel-section-label">{title}</div>
      <div className="ratio-row" data-testid="region-draw-operation">
        <button className={operation === "add" ? "active" : ""} onClick={() => onOperation("add")} type="button">
          <Plus size={14} />
          增加区域
        </button>
        <button className={operation === "subtract" ? "active" : ""} onClick={() => onOperation("subtract")} type="button">
          <Eraser size={14} />
          减少区域
        </button>
      </div>

      <div className="region-target-grid" data-testid="region-target-grid">
        {TARGET_FUNCTIONS.map((fn) => (
          <button className={targetFunction === fn ? "active" : ""} key={fn} onClick={() => onTargetFunction(fn)} type="button">
            {functionLabel(fn)}
          </button>
        ))}
      </div>

      <div className={operation === "subtract" && targetCount === 0 ? "segmentation-status error" : "segmentation-status"}>
        <span>目标：{functionLabel(targetFunction)}</span>
        <small>{targetCount} 个来源块 / {targetLayer?.polygons.length ?? 0} 个整体轮廓 / 草稿 {draftCount} 点</small>
        {operation === "subtract" && targetCount === 0 ? <small>减少区域前需要目标功能层已有范围。</small> : null}
      </div>

      <div className="tool-strip">
        <button aria-label="完成区域绘制" disabled={finishDisabled} onClick={onFinish} type="button">
          <Check size={15} />
          完成
        </button>
        <button aria-label="撤销上一点" disabled={draftCount === 0} onClick={onUndoPoint} type="button">
          <Undo2 size={15} />
          撤销
        </button>
        <button aria-label="清空草稿" disabled={draftCount === 0} onClick={onClear} type="button">
          <RotateCcw size={15} />
          清空
        </button>
      </div>
      <div className="segmentation-status">{finishMinPoints <= 2 ? "两点生成矩形；三点以上生成手绘区域。Enter 完成；Esc 清空。" : "Enter 完成绘制；Esc 清空草稿。"}</div>
    </div>
  );
}

function functionLabel(value: MapRegionFunction) {
  const labels: Record<MapRegionFunction, string> = {
    walkable: "道路",
    obstacle: "不可通过",
    action: "行动区",
    residential: "居住区",
    social: "社交区",
    custom: "自定义",
    unassigned: "未设定"
  };
  return labels[value];
}
