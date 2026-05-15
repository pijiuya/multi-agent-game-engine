import { Check, Crop, Expand, RotateCcw, Settings, Sparkles, WandSparkles, X } from "lucide-react";
import type { ReactNode } from "react";
import type {
  ImageAspectPreset,
  ImageGenerationMode,
  ImageSelectionMode,
  MapImageLayer,
  MapRegion,
  Point,
  SelectionState,
  WorldSnapshot
} from "../types";

type ImageSelectionPayload =
  | { type: "polygon"; points: Point[] }
  | { type: "rect"; x: number; y: number; width: number; height: number };

type Props = {
  world: WorldSnapshot;
  selection: SelectionState;
  mode: ImageGenerationMode;
  selectionMode: ImageSelectionMode;
  aspectPreset: ImageAspectPreset;
  prompt: string;
  referenceBackground: boolean;
  createNewLayer: boolean;
  draftPoints: Point[];
  busy: boolean;
  error: string | null;
  providerName: string | null;
  hasRealProvider: boolean;
  onOpenModels: () => void;
  onMode: (mode: ImageGenerationMode) => void;
  onSelectionMode: (mode: ImageSelectionMode) => void;
  onAspectPreset: (preset: ImageAspectPreset) => void;
  onPrompt: (prompt: string) => void;
  onReferenceBackground: (enabled: boolean) => void;
  onCreateNewLayer: (enabled: boolean) => void;
  onGenerate: () => void;
  onUndoPoint: () => void;
  onClearSelection: () => void;
};

export function ImageGenerationPanel({
  world,
  selection,
  mode,
  selectionMode,
  aspectPreset,
  prompt,
  referenceBackground,
  createNewLayer,
  draftPoints,
  busy,
  error,
  providerName,
  hasRealProvider,
  onOpenModels,
  onMode,
  onSelectionMode,
  onAspectPreset,
  onPrompt,
  onReferenceBackground,
  onCreateNewLayer,
  onGenerate,
  onUndoPoint,
  onClearSelection
}: Props) {
  const selectedLayer = selection.kind === "imageLayer" ? world.map.image_layers.find((layer) => layer.id === selection.id) ?? null : null;
  const selectedRegion = selection.kind === "region" ? world.map.regions.find((region) => region.id === selection.id) ?? null : null;
  const payload = imageSelectionFromDraft(draftPoints) ?? targetSelection(mode, selectedLayer, selectedRegion);
  const availableSelectionModes: ImageSelectionMode[] = mode === "extension" ? ["rect", "ratioRect"] : ["rect", "ratioRect", "polygon"];
  const canGenerate = hasRealProvider && Boolean(prompt.trim()) && Boolean(payload) && !busy;

  if (!hasRealProvider) {
    return (
      <div className="image-generation-panel disabled" data-testid="image-generation-panel">
        <div className="panel-section-label">图像生成</div>
        <div className="image-config-empty" data-testid="image-provider-status">
          <Settings size={18} />
          <strong>需要先配置图片生成 API</strong>
          <span>请到模型管理的“图片生成”高级配置中填写服务地址、API Key 和模型名。配置完成后这里会启用区域生成、边缘扩展和重绘。</span>
          <button className="panel-action-button" onClick={onOpenModels} type="button">
            打开模型管理
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="image-generation-panel" data-testid="image-generation-panel">
      <div className="panel-section-label">图像生成</div>
      <div className="segmentation-status" data-testid="image-provider-status">当前模型：{providerName || "图片生成模型"}</div>

      <div className="image-mode-grid" data-testid="image-generation-mode">
        <ModeButton active={mode === "region"} description="在选区内生成透明图片图层" icon={<WandSparkles size={14} />} label="区域生成" onClick={() => onMode("region")} />
        <ModeButton active={mode === "extension"} description="向地图外扩展并衔接原图" icon={<Expand size={14} />} label="边缘扩展" onClick={() => onMode("extension")} />
        <ModeButton active={mode === "repaint"} description="重绘当前图层或区域" icon={<RotateCcw size={14} />} label="重绘" onClick={() => onMode("repaint")} />
      </div>

      <div className="ratio-row" data-testid="image-selection-mode">
        {availableSelectionModes.includes("rect") ? (
          <button className={selectionMode === "rect" ? "active" : ""} onClick={() => onSelectionMode("rect")} type="button">
            <Crop size={14} />
            拖拽矩形
          </button>
        ) : null}
        {availableSelectionModes.includes("ratioRect") ? (
          <button className={selectionMode === "ratioRect" ? "active" : ""} onClick={() => onSelectionMode("ratioRect")} type="button">
            <Crop size={14} />
            等比矩形
          </button>
        ) : null}
        {availableSelectionModes.includes("polygon") ? (
          <button className={selectionMode === "polygon" ? "active" : ""} onClick={() => onSelectionMode("polygon")} type="button">
            <Sparkles size={14} />
            手绘区域
          </button>
        ) : null}
      </div>

      {selectionMode === "ratioRect" ? (
        <div className="ratio-row compact" data-testid="image-aspect-presets">
          {(["1:1", "4:3", "16:9", "map"] as ImageAspectPreset[]).map((preset) => (
            <button className={aspectPreset === preset ? "active" : ""} key={preset} onClick={() => onAspectPreset(preset)} type="button">
              {preset === "map" ? "地图比例" : preset}
            </button>
          ))}
        </div>
      ) : null}

      <label className="prompt-row">
        <span>{mode === "extension" ? "延展提示词" : mode === "repaint" ? "重绘提示词" : "生成提示词"}</span>
        <textarea
          aria-label="图像生成提示词"
          onChange={(event) => onPrompt(event.currentTarget.value)}
          placeholder={promptPlaceholder(mode)}
          rows={3}
          value={prompt}
        />
      </label>

      <div className="image-option-grid">
        <label className="property-toggle-row">
          <span>参考背景风格</span>
          <input checked={referenceBackground} disabled={!world.map.background_image} onChange={(event) => onReferenceBackground(event.currentTarget.checked)} type="checkbox" />
          <small>{world.map.background_image ? "使用当前底图" : "无背景图"}</small>
        </label>
        <label className="property-toggle-row">
          <span>生成为新图层</span>
          <input checked={createNewLayer} onChange={(event) => onCreateNewLayer(event.currentTarget.checked)} type="checkbox" />
          <small>{mode === "repaint" && !createNewLayer ? "覆盖目标" : "保留历史"}</small>
        </label>
      </div>

      <div className="image-selection-summary" data-testid="image-selection-summary">
        <strong>{targetLabel(mode, selectedLayer, selectedRegion)}</strong>
        <span>{payload ? selectionLabel(payload, draftPoints.length === 0 && mode === "repaint") : selectionHint(selectionMode, mode)}</span>
      </div>

      {error ? <div className="segmentation-status error">{error}</div> : null}

      <div className="tool-strip">
        <button className="panel-action-button" data-testid="image-generate-submit" disabled={!canGenerate} onClick={onGenerate} type="button">
          <Check size={15} />
          {busy ? "生成中" : actionLabel(mode)}
        </button>
        <button disabled={!draftPoints.length || busy} onClick={onClearSelection} type="button">
          <X size={15} />
          清空选区
        </button>
        {selectionMode === "polygon" ? (
          <button disabled={!draftPoints.length || busy} onClick={onUndoPoint} type="button">
            撤销一点
          </button>
        ) : null}
      </div>
      <div className="segmentation-status">{workflowHint(selectionMode, mode, draftPoints.length)}</div>
    </div>
  );
}

function ModeButton({ active, description, icon, label, onClick }: { active: boolean; description: string; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={active ? "active" : ""} onClick={onClick} type="button">
      {icon}
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </button>
  );
}

function imageSelectionFromDraft(points: Point[]): ImageSelectionPayload | null {
  if (points.length === 2) {
    const [first, second] = points;
    const width = Math.abs(second.x - first.x);
    const height = Math.abs(second.y - first.y);
    if (width < 1 || height < 1) {
      return null;
    }
    return {
      type: "rect",
      x: Math.min(first.x, second.x),
      y: Math.min(first.y, second.y),
      width,
      height
    };
  }
  if (points.length >= 3) {
    return { type: "polygon", points };
  }
  return null;
}

function targetSelection(mode: ImageGenerationMode, layer: MapImageLayer | null, region: MapRegion | null): ImageSelectionPayload | null {
  if (mode !== "repaint") {
    return null;
  }
  if (layer) {
    return { type: "rect", x: layer.x, y: layer.y, width: layer.width, height: layer.height };
  }
  if (region && region.points.length >= 3) {
    return { type: "polygon", points: region.points };
  }
  return null;
}

function promptPlaceholder(mode: ImageGenerationMode) {
  if (mode === "extension") {
    return "延展地图边缘，保持原地图俯视风格、道路和地貌连续";
  }
  if (mode === "repaint") {
    return "重新绘制当前图层或区域，保留整体地图风格";
  }
  return "生成适合这个区域的俯视地图元素，透明背景";
}

function actionLabel(mode: ImageGenerationMode) {
  if (mode === "extension") {
    return "扩展地图边缘";
  }
  if (mode === "repaint") {
    return "重绘图层";
  }
  return "生成区域图层";
}

function targetLabel(mode: ImageGenerationMode, layer: MapImageLayer | null, region: MapRegion | null) {
  if (mode !== "repaint") {
    return "目标：当前选区";
  }
  if (layer) {
    return `目标：${layer.name}`;
  }
  if (region) {
    return `目标：${region.name}`;
  }
  return "目标：当前选区";
}

function selectionHint(mode: ImageSelectionMode, generationMode: ImageGenerationMode) {
  if (generationMode === "repaint") {
    return "可直接使用当前目标，也可以重新框选范围";
  }
  if (mode === "polygon") {
    return "点击画布添加至少 3 个点";
  }
  if (mode === "ratioRect") {
    return "在画布拖拽一个等比矩形";
  }
  return "在画布拖拽一个矩形";
}

function selectionLabel(selection: ImageSelectionPayload, fromTarget = false) {
  const prefix = fromTarget ? "使用当前目标：" : "";
  if (selection.type === "rect") {
    return `${prefix}选区 ${Math.round(selection.width)} x ${Math.round(selection.height)}，位于 ${Math.round(selection.x)}, ${Math.round(selection.y)}`;
  }
  return `${prefix}手绘区域 ${selection.points.length} 点`;
}

function workflowHint(mode: ImageSelectionMode, generationMode: ImageGenerationMode, draftCount: number) {
  if (generationMode === "repaint" && draftCount === 0) {
    return "重绘会优先使用当前图层/区域范围；也可以重新拖拽或手绘选区。";
  }
  if (mode === "polygon") {
    return draftCount < 3 ? `点击画布添加点位，至少需要 3 点；当前 ${draftCount} 点。` : "手绘区域已可生成。Enter 执行，Esc 清空。";
  }
  if (mode === "ratioRect") {
    return "在画布上拖拽，选区会锁定当前比例。Enter 执行，Esc 清空。";
  }
  return "在画布上拖拽一个矩形。Enter 执行，Esc 清空。";
}
