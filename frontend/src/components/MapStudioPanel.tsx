import { CheckCircle2, FileUp, ImagePlus, Layers3, RefreshCw, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { assetUrl } from "../lib/api";
import type {
  MapGenerationState,
  MapRatioPreset,
  MapRegion,
  MapRegionFunction,
  MapSegmentationState,
  ModelConfig,
  SelectionState,
  WorldSnapshot
} from "../types";

export type MapStudioStep = "background" | "segment" | "layers";
type LayerAction = "name" | "regenerate" | "function";

type Props = {
  world: WorldSnapshot;
  models: ModelConfig[];
  activeStep: MapStudioStep;
  activeRegionId: string | null;
  selection: SelectionState;
  generation: MapGenerationState | null;
  segmentation: MapSegmentationState;
  onGenerate: (prompt: string, width: number, height: number, ratio: MapRatioPreset) => void;
  onSetFrame: (width: number, height: number) => void;
  onUploadMap: (file: File) => void;
  onSelectCandidate: (candidateId: string) => void;
  onSegment: () => void;
  onSelect: (selection: SelectionState) => void;
  onActivateRegion: (regionId: string) => void;
  onActiveStepChange: (step: MapStudioStep) => void;
  onUpdateRegion: (regionId: string, patch: Partial<Omit<MapRegion, "id" | "points" | "source">>) => void;
  onRegenerateRegion: (regionId: string, prompt: string) => void;
};

const DEFAULT_PROMPT = "一个适合多 agent 生活和社交的俯视 2D 小镇工作站，有清晰道路、居住区、公共社交空间和不可穿过的景观结构";

const STEPS: { id: MapStudioStep; label: string }[] = [
  { id: "background", label: "背景生成/导入" },
  { id: "segment", label: "SAM 分层" },
  { id: "layers", label: "图层处理" }
];

export function MapStudioPanel({
  world,
  models,
  activeStep,
  activeRegionId,
  selection,
  generation,
  segmentation,
  onGenerate,
  onSetFrame,
  onUploadMap,
  onSelectCandidate,
  onSegment,
  onSelect,
  onActivateRegion,
  onActiveStepChange,
  onUpdateRegion,
  onRegenerateRegion
}: Props) {
  const [layerAction, setLayerAction] = useState<LayerAction>("name");
  const [ratio, setRatio] = useState<MapRatioPreset>(() => ratioFromSize(world.map.width, world.map.height));
  const [width, setWidth] = useState(world.map.width || 1920);
  const [height, setHeight] = useState(world.map.height || 1080);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [regionPrompt, setRegionPrompt] = useState("");

  const segmentationProvider = useMemo(() => enabledModelForCapability(models, "segmentation"), [models]);
  const selectedRegion = activeRegionId ? world.map.regions.find((region) => region.id === activeRegionId) ?? null : null;
  const hasValidSize = width >= 128 && height >= 128;
  const hasBackground = Boolean(world.map.background_image);
  const isSegmenting = segmentation.status === "running";
  const canGenerate = hasValidSize && prompt.trim().length > 0;
  const canSegment = hasBackground && !isSegmenting;

  useEffect(() => {
    setWidth(world.map.width);
    setHeight(world.map.height);
    setRatio(ratioFromSize(world.map.width, world.map.height));
  }, [world.map.width, world.map.height]);

  useEffect(() => {
    if (activeStep === "layers") {
      if (world.map.regions.length > 0 && selection.kind === "map") {
        onSelect({ kind: "regions", id: "all" });
      }
    }
  }, [activeStep, onSelect, selection.kind, world.map.regions]);

  function setPreset(next: MapRatioPreset) {
    setRatio(next);
    if (next === "1:1") {
      setWidth(1080);
      setHeight(1080);
      onSetFrame(1080, 1080);
    }
    if (next === "16:9") {
      setWidth(1920);
      setHeight(1080);
      onSetFrame(1920, 1080);
    }
  }

  function commitCustomSize() {
    if (hasValidSize) {
      onSetFrame(width, height);
    }
  }

  function renameSelectedRegion(name: string) {
    const next = name.trim();
    if (selectedRegion && next && next !== selectedRegion.name) {
      onUpdateRegion(selectedRegion.id, { name: next });
    }
  }

  return (
    <div className="map-studio-panel" data-testid="map-studio-panel">
      <div className="panel-section-label">地图工作台</div>
      <div className="map-workflow-steps" data-testid="map-workflow-steps">
        {STEPS.map((step, index) => (
          <button
            className={stepButtonClass(step.id, activeStep, stepState(step.id, world, generation, segmentation))}
            data-testid={`map-step-${step.id}`}
            key={step.id}
            onClick={() => onActiveStepChange(step.id)}
            type="button"
          >
            <span>{stepState(step.id, world, generation, segmentation) === "done" ? <CheckCircle2 size={12} /> : index + 1}</span>
            <strong>{step.label}</strong>
          </button>
        ))}
      </div>

      {activeStep === "background" ? (
        <section className="map-step-body" data-testid="map-step-body-background">
          <div className="ratio-row" data-testid="map-ratio-controls">
            {(["1:1", "16:9", "custom"] as MapRatioPreset[]).map((option) => (
              <button className={ratio === option ? "active" : ""} key={option} onClick={() => setPreset(option)} type="button">
                {option === "custom" ? "自定义" : option}
              </button>
            ))}
          </div>
          <div className="dimension-row">
            <label>
              <span>宽</span>
              <input
                disabled={ratio !== "custom"}
                min="128"
                onBlur={commitCustomSize}
                onChange={(event) => setWidth(Number(event.currentTarget.value))}
                type="number"
                value={width}
              />
            </label>
            <label>
              <span>高</span>
              <input
                disabled={ratio !== "custom"}
                min="128"
                onBlur={commitCustomSize}
                onChange={(event) => setHeight(Number(event.currentTarget.value))}
                type="number"
                value={height}
              />
            </label>
          </div>
          <label className="prompt-row">
            <span>背景图提示</span>
            <input aria-label="背景图提示" onChange={(event) => setPrompt(event.currentTarget.value)} value={prompt} />
          </label>
          <button
            className="panel-action-button"
            data-testid="generate-map-button"
            disabled={!canGenerate}
            onClick={() => onGenerate(prompt, width, height, ratio)}
            type="button"
          >
            <WandSparkles size={15} />
            生成背景候选
          </button>
          <label className="panel-action-button file-action-button">
            <FileUp size={15} />
            导入现成图片
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) {
                  onUploadMap(file);
                }
                event.currentTarget.value = "";
              }}
            />
          </label>
          {generation ? (
            <div className="candidate-list" data-testid="generated-candidates">
              {generation.candidates.map((candidate) => (
                <button
                  className={generation.selected_candidate_id === candidate.id ? "candidate-card active" : "candidate-card"}
                  key={candidate.id}
                  onClick={() => onSelectCandidate(candidate.id)}
                  type="button"
                >
                  <img alt="生成候选图" src={assetUrl(candidate.url) ?? candidate.url} />
                  <span>{candidate.width} x {candidate.height}</span>
                  {generation.selected_candidate_id === candidate.id ? <small>已应用为地图背景</small> : null}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {activeStep === "segment" ? (
        <section className="map-step-body" data-testid="map-step-body-segment">
          <ProviderCard provider={segmentationProvider} segmentation={segmentation} />
          <ProgressBar segmentation={segmentation} />
          <button className="panel-action-button" data-testid="segment-map-button" disabled={!canSegment} onClick={onSegment} type="button">
            <Layers3 size={15} />
            {isSegmenting ? "SAM 分层中" : "开始 SAM 分层"}
          </button>
          <div className={segmentation.status === "error" || !segmentationProvider ? "segmentation-status error" : "segmentation-status"} data-testid="segmentation-status">
            <ImagePlus size={15} />
            <span>{mapStatusText(world, segmentationProvider, segmentation)}</span>
          </div>
        </section>
      ) : null}

      {activeStep === "layers" ? (
        <section className="map-step-body" data-testid="map-step-body-layers">
          <RegionList activeRegionId={activeRegionId} world={world} onActivateRegion={onActivateRegion} />
          {selectedRegion ? (
            <>
              <div className="ratio-row" data-testid="layer-action-controls">
                <button className={layerAction === "name" ? "active" : ""} onClick={() => setLayerAction("name")} type="button">命名</button>
                <button className={layerAction === "regenerate" ? "active" : ""} onClick={() => setLayerAction("regenerate")} type="button">重生成</button>
                <button className={layerAction === "function" ? "active" : ""} onClick={() => setLayerAction("function")} type="button">功能分区</button>
              </div>
              {layerAction === "name" ? (
                <>
                  <label className="prompt-row">
                    <span>图层名称</span>
                    <input
                      aria-label="图层名称"
                      key={selectedRegion.id}
                      defaultValue={selectedRegion.name}
                      onBlur={(event) => renameSelectedRegion(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          renameSelectedRegion(event.currentTarget.value);
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </label>
                  <div className="segmentation-status">自动命名先不启用；请在这里手动命名。</div>
                </>
              ) : null}
              {layerAction === "regenerate" ? (
                <>
                  <label className="prompt-row">
                    <span>局部重绘提示</span>
                    <input
                      aria-label="局部重绘提示"
                      onChange={(event) => setRegionPrompt(event.currentTarget.value)}
                      placeholder={selectedRegion.image_prompt || selectedRegion.name}
                      value={regionPrompt}
                    />
                  </label>
                  <button
                    className="panel-action-button"
                    disabled={!regionPrompt.trim()}
                    onClick={() => {
                      onRegenerateRegion(selectedRegion.id, regionPrompt.trim());
                      setRegionPrompt("");
                    }}
                    type="button"
                  >
                    <RefreshCw size={15} />
                    重新生成当前图层
                  </button>
                </>
              ) : null}
              {layerAction === "function" ? (
                <FunctionButtons value={selectedRegion.function} onCommit={(value) => onUpdateRegion(selectedRegion.id, { function: value })} />
              ) : null}
            </>
          ) : (
            <div className={world.map.regions.length ? "segmentation-status" : "segmentation-status error"}>
              {world.map.regions.length ? "选择一个区域后，可以命名、重生成或设置功能。" : "还没有区域图层"}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ProviderCard({ provider, segmentation }: { provider: ModelConfig | null; segmentation: MapSegmentationState }) {
  if (!provider) {
    return (
      <div className="model-config-row" data-testid="sam-provider-card">
        <strong>未配置 SAM 分层模型</strong>
        <small>请先在模型管理里安装并启用内置 MobileSAM。</small>
      </div>
    );
  }
  return (
    <div className="model-config-row" data-testid="sam-provider-card">
      <strong>{provider.name}</strong>
      <small>
        {samProviderLabel(provider.provider)} / {provider.model || "未指定模型"}
      </small>
      <small>{provider.provider === "embedded-mobile-sam" ? "内置推理，无需服务地址" : provider.baseUrl || "本地模型"}</small>
      {segmentation.mode === "mock" || segmentation.mode === "local_mock" ? <small>当前结果来自测试 Mock SAM</small> : null}
    </div>
  );
}

function ProgressBar({ segmentation }: { segmentation: MapSegmentationState }) {
  return (
    <div className="segmentation-progress" data-testid="segmentation-progress">
      <div>
        <span style={{ width: `${segmentation.progress}%` }} />
      </div>
      <small>{stageLabel(segmentation.stage)} / {segmentation.progress}%</small>
    </div>
  );
}

function RegionList({
  activeRegionId,
  world,
  onActivateRegion
}: {
  activeRegionId: string | null;
  world: WorldSnapshot;
  onActivateRegion: (regionId: string) => void;
}) {
  return (
    <div className="sam-layer-list" data-testid="sam-layer-list">
      {world.map.regions.map((region) => (
        <button
          className={activeRegionId === region.id ? "scene-list-row active" : "scene-list-row"}
          key={region.id}
          onClick={() => onActivateRegion(region.id)}
          type="button"
        >
          <span>{region.name}</span>
          <small>{functionLabel(region.function)}</small>
        </button>
      ))}
      {world.map.regions.length === 0 ? <div className="segmentation-status error">还没有 SAM 分层结果</div> : null}
    </div>
  );
}

function FunctionButtons({ value, onCommit }: { value: MapRegionFunction; onCommit: (value: MapRegionFunction) => void }) {
  const options: { value: MapRegionFunction; label: string }[] = [
    { value: "walkable", label: "道路" },
    { value: "obstacle", label: "不可穿过" },
    { value: "action", label: "行动区" },
    { value: "residential", label: "居住区" },
    { value: "social", label: "社交区" },
    { value: "custom", label: "自定义" },
    { value: "unassigned", label: "未设定" }
  ];
  return (
    <div className="property-function-row">
      <span>区域功能</span>
      <div>
        {options.map((option) => (
          <button className={value === option.value ? "active" : ""} key={option.value} onClick={() => onCommit(option.value)} type="button">
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function stepButtonClass(step: MapStudioStep, activeStep: MapStudioStep, state: "idle" | "active" | "done" | "error") {
  return `workflow-step ${state}${step === activeStep ? " selected" : ""}`;
}

function stepState(step: MapStudioStep, world: WorldSnapshot, generation: MapGenerationState | null, segmentation: MapSegmentationState) {
  if (step === "background") {
    return world.map.background_image ? "done" : generation?.candidates.length ? "active" : "idle";
  }
  if (step === "segment") {
    if (segmentation.status === "error") {
      return "error";
    }
    return segmentation.status === "done" ? "done" : world.map.background_image ? "active" : "idle";
  }
  if (step === "layers") {
    return world.map.regions.length ? "active" : "idle";
  }
  return "idle";
}

function mapStatusText(world: WorldSnapshot, provider: ModelConfig | null, segmentation: MapSegmentationState) {
  if (!world.map.background_image) {
    return "请先在第一步生成或导入背景图";
  }
  if (segmentation.status === "running") {
    return `正在${stageLabel(segmentation.stage)}`;
  }
  if (segmentation.status === "error") {
    return segmentation.error || "SAM 分层失败";
  }
  if (segmentation.status === "done") {
    const prefix = segmentation.mode === "mock" || segmentation.mode === "local_mock" ? "测试 Mock SAM" : segmentation.provider_name || "SAM";
    return `${prefix} 分层完成，已生成 ${segmentation.region_count} 个区域`;
  }
  if (!provider) {
    return "未配置 SAM 分层模型";
  }
  return "准备调用 SAM 分层模型";
}

function enabledModelForCapability(models: ModelConfig[], capability: ModelConfig["capabilities"][number]) {
  const matching = models.filter((model) => model.enabled && model.capabilities.includes(capability));
  if (capability === "segmentation") {
    return matching.find((model) => model.provider === "embedded-mobile-sam") ?? matching[0] ?? null;
  }
  return matching[0] ?? null;
}

function samProviderLabel(provider: string) {
  if (provider === "mock") {
    return "测试 Mock";
  }
  if (provider === "embedded-mobile-sam") {
    return "内置 MobileSAM";
  }
  return "SAM 分层服务";
}

function stageLabel(stage: MapSegmentationState["stage"]) {
  const labels: Record<MapSegmentationState["stage"], string> = {
    idle: "待机",
    prepare_image: "准备图片",
    call_sam: "调用 SAM",
    smooth_edges: "边缘平滑",
    save_regions: "保存区域",
    done: "完成",
    error: "错误"
  };
  return labels[stage];
}

function functionLabel(value: MapRegionFunction) {
  const labels: Record<MapRegionFunction, string> = {
    unassigned: "未设定",
    walkable: "道路",
    obstacle: "不可穿过",
    action: "行动区",
    residential: "居住区",
    social: "社交区",
    custom: "自定义"
  };
  return labels[value];
}

function ratioFromSize(width: number, height: number): MapRatioPreset {
  if (Math.abs(width - height) <= 2) {
    return "1:1";
  }
  if (Math.abs(width / height - 16 / 9) < 0.02) {
    return "16:9";
  }
  return "custom";
}
