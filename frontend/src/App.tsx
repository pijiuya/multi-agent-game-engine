import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { AgentPanel } from "./components/AgentPanel";
import { FloatingPanel } from "./components/FloatingPanel";
import { ImageGenerationPanel } from "./components/ImageGenerationPanel";
import { MapStudioPanel, type MapStudioStep } from "./components/MapStudioPanel";
import { ModelManagerPanel } from "./components/ModelManagerPanel";
import { latestNarrativeLine, NarrativePanel } from "./components/NarrativePanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { RegionDrawPanel } from "./components/RegionDrawPanel";
import { RegionPanel } from "./components/RegionPanel";
import { RuntimeMonitorPanel } from "./components/RuntimeMonitorPanel";
import { SceneElementsPanel } from "./components/SceneElementsPanel";
import { SceneViewport } from "./components/SceneViewport";
import { ToolPanel } from "./components/ToolPanel";
import { TransportControls } from "./components/TransportControls";
import {
  centerViewOnWorldPoint,
  ORIGIN_POINT,
  snapWorldPointToGrid
} from "./lib/canvasCoords";
import {
  autoLabelMapRegion,
  booleanMapRegions,
  createMapRegion,
  createAgent as createAgentRemote,
  deleteAgent,
  deleteMapImageLayer,
  deleteMapItem,
  deleteMapRegion,
  createMapGeneration,
  generateMapImageLayer,
  configureLocalCapability,
  configureRemoteCapability,
  fetchRemoteCapabilityModels,
  getModelCapabilityTask,
  getModelCapabilityStatus,
  getRuntimeStatus,
  getWorld,
  getModels,
  idleSegmentation,
  installLocalCapability,
  patchAgent,
  patchMapImageLayer,
  patchMap,
  patchMapItem,
  patchMapRegion,
  patchNarrative,
  postAction,
  normalizeWorldSnapshot,
  regenerateMapRegion,
  saveMap,
  segmentMap,
  selectGeneratedMap,
  setSimulation,
  testRemoteCapability,
  tickSimulation,
  uploadAsset,
  uploadMapImage,
  wsUrl
} from "./lib/api";
import { addAgentLocal, addItemToMap, addRegionToMap, addSpawnToMap, makeId, moveAgentLocal } from "./lib/worldOps";
import type {
  AgentProfile,
  CanvasPoint,
  CanvasViewState,
  EditTool,
  ImageAspectPreset,
  ImageGenerationMode,
  ImageSelectionMode,
  MapGenerationState,
  MapImageLayer,
  MapRatioPreset,
  MapRegion,
  MapRegionFunction,
  MapSegmentationState,
  NarrativeConfig,
  RegionDrawOperation,
  ModelCapabilityId,
  ModelCapabilityStatus,
  ModelCapabilityTask,
  ModelConfig,
  PanelState,
  Point,
  PolygonArea,
  RemoteModelOption,
  RemoteModelTestResult,
  RuntimeStatus,
  SelectionState,
  WorldItem,
  WorldMap,
  WorldSnapshot
} from "./types";

type AnchorMenuState = {
  x: number;
  y: number;
  point: Point;
};

type ObjectMenuTarget = { kind: "agent" | "item" | "region" | "imageLayer"; id: string };
type ObjectMenuState = ObjectMenuTarget & { x: number; y: number };

type ItemPatch = Partial<Omit<WorldItem, "id">>;
type ImageLayerPatch = Partial<Omit<MapImageLayer, "id" | "kind" | "image" | "prompt" | "region_id" | "created_at">>;
type ImageSelectionPayload =
  | { type: "polygon"; points: Point[] }
  | { type: "rect"; x: number; y: number; width: number; height: number };
type MapPatch = Partial<Pick<WorldMap, "name" | "width" | "height" | "background_image">>;
type AgentPatch = Partial<Omit<AgentProfile, "id">>;
const PANEL_LAYOUT_STORAGE_KEY = "agent-workstation.panel-layout.v6";
const PANEL_MARGIN = 16;
const PANEL_GAP = 8;
const PANEL_SNAP_DISTANCE = 20;
const PANEL_MIN_WIDTH = 92;
const PANEL_MIN_HEIGHT = 120;
const PANEL_MINIMIZED_HEIGHT = 40;

export default function App() {
  const [world, setWorld] = useState<WorldSnapshot | null>(null);
  const [selection, setSelection] = useState<SelectionState>({ kind: "map", id: "map_default" });
  const [editTool, setEditTool] = useState<EditTool>("select");
  const [regionDrawOperation, setRegionDrawOperation] = useState<RegionDrawOperation>("add");
  const [regionDrawTargetFunction, setRegionDrawTargetFunction] = useState<MapRegionFunction>("walkable");
  const [imageGenerationMode, setImageGenerationMode] = useState<ImageGenerationMode>("region");
  const [imageSelectionMode, setImageSelectionMode] = useState<ImageSelectionMode>("rect");
  const [imageAspectPreset, setImageAspectPreset] = useState<ImageAspectPreset>("1:1");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageReferenceBackground, setImageReferenceBackground] = useState(true);
  const [imageCreateNewLayer, setImageCreateNewLayer] = useState(false);
  const [imageGenerationBusy, setImageGenerationBusy] = useState(false);
  const [imageGenerationError, setImageGenerationError] = useState<string | null>(null);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [mapStudioStep, setMapStudioStep] = useState<MapStudioStep>("background");
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [imageDraftPoints, setImageDraftPoints] = useState<Point[]>([]);
  const [status, setStatus] = useState("载入中");
  const [appearanceMode, setAppearanceMode] = useState<"light" | "dark">("light");
  const [appBackgroundOpacity, setAppBackgroundOpacity] = useState(0);
  const [canvasView, setCanvasView] = useState<CanvasViewState>({
    zoom: 1,
    pan: { x: 0, y: 0 },
    fitMode: true
  });
  const [canvasPoints, setCanvasPoints] = useState<CanvasPoint[]>([]);
  const [anchorPoint, setAnchorPoint] = useState<Point | null>(null);
  const [anchorMenu, setAnchorMenu] = useState<AnchorMenuState | null>(null);
  const [objectMenu, setObjectMenu] = useState<ObjectMenuState | null>(null);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [modelCapabilityStatuses, setModelCapabilityStatuses] = useState<ModelCapabilityStatus[]>([]);
  const [modelCapabilityTasks, setModelCapabilityTasks] = useState<Partial<Record<ModelCapabilityId, ModelCapabilityTask>>>({});
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeStatusStale, setRuntimeStatusStale] = useState(false);
  const [generation, setGeneration] = useState<MapGenerationState | null>(null);
  const [segmentation, setSegmentation] = useState<MapSegmentationState>(() => idleSegmentation());
  const [panels, setPanels] = useState<PanelState[]>(() => loadPanelLayout(createInitialPanels()));
  const [zCursor, setZCursor] = useState(() => maxPanelZ(loadPanelLayout(createInitialPanels())));
  const pendingMapPatchRef = useRef<MapPatch>({});
  const pendingAgentPatchesRef = useRef<Record<string, AgentPatch>>({});
  const pendingItemPatchesRef = useRef<Record<string, ItemPatch>>({});
  const pendingLocalItemsRef = useRef<Record<string, WorldItem>>({});

  const selectedAgentId = selection.kind === "agent" ? selection.id : null;
  const activeRegionFunction = useMemo(() => {
    if (!world) {
      return regionDrawTargetFunction;
    }
    if (editTool === "region") {
      return regionDrawTargetFunction;
    }
    if (selection.kind === "regionLayer") {
      return selection.id;
    }
    if (selection.kind === "region") {
      return world.map.regions.find((region) => region.id === selection.id)?.function ?? regionDrawTargetFunction;
    }
    return regionDrawTargetFunction;
  }, [editTool, regionDrawTargetFunction, selection, world]);
  const selectedAgentExists = useMemo(() => {
    if (!world || !selectedAgentId) {
      return false;
    }
    return Boolean(world.agent_profiles[selectedAgentId]);
  }, [world, selectedAgentId]);
  const narrativeLine = useMemo(() => (world ? latestNarrativeLine(world.events) : null), [world?.events]);
  const imageGenerationProvider = useMemo(() => enabledModelForCapability(models, "image_generation"), [models]);
  const hasRealImageGenerationProvider = Boolean(imageGenerationProvider && imageGenerationProvider.provider !== "mock");
  const runtimeMonitorActive = useMemo(
    () => panels.some((panel) => panel.id === "runtimeMonitor" && !panel.minimized),
    [panels]
  );

  useEffect(() => {
    void refreshWorld();
    void refreshModels();
    void refreshModelCapabilities();
  }, []);

  useEffect(() => {
    const retry = window.setInterval(() => {
      void refreshModels();
      void refreshModelCapabilities();
    }, 3500);
    return () => window.clearInterval(retry);
  }, []);

  useEffect(() => {
    if (!runtimeMonitorActive) {
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      const nextStatus = await getRuntimeStatus();
      if (cancelled) {
        return;
      }
      if (nextStatus) {
        setRuntimeStatus(nextStatus);
        setRuntimeStatusStale(false);
      } else {
        setRuntimeStatusStale(true);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runtimeMonitorActive]);

  useEffect(() => {
    savePanelLayout(panels);
  }, [panels]);

  useEffect(() => {
    if (!world) {
      return;
    }
    if (typeof window !== "undefined" && window.localStorage.getItem("agent-workstation.disable-ws") === "1") {
      return;
    }
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(wsUrl());
      socket.onopen = () => setStatus("后端已连接");
      socket.onmessage = (event) => {
        const snapshot = JSON.parse(event.data) as WorldSnapshot;
        if (!snapshot || typeof snapshot !== "object" || !snapshot.map || !snapshot.agent_profiles) {
          return;
        }
        setWorld(mergeSnapshotWithLocalState(normalizeWorldSnapshot(snapshot), {
          mapPatch: pendingMapPatchRef.current,
          agentPatches: pendingAgentPatchesRef.current,
          itemPatches: pendingItemPatchesRef.current,
          localItems: pendingLocalItemsRef.current
        }));
      };
      socket.onerror = () => setStatus("本地预览");
      socket.onclose = () => setStatus((current) => (current === "后端已连接" ? "本地预览" : current));
    } catch {
      setStatus("本地预览");
    }
    return () => socket?.close();
  }, [Boolean(world)]);

  useEffect(() => {
    if (!world) {
      return;
    }
    if (selection.kind === "map" && selection.id !== world.map.id) {
      setSelection({ kind: "map", id: world.map.id });
    }
    if (selection.kind === "agent" && !selectedAgentExists) {
      setSelection({ kind: "map", id: world.map.id });
    }
    if (selection.kind === "item" && !world.map.items.some((item) => item.id === selection.id)) {
      setSelection({ kind: "map", id: world.map.id });
    }
    if (selection.kind === "imageLayer" && !world.map.image_layers.some((layer) => layer.id === selection.id)) {
      setSelection({ kind: "map", id: world.map.id });
    }
    if (selection.kind === "region" && !world.map.regions.some((region) => region.id === selection.id)) {
      setSelection({ kind: "map", id: world.map.id });
    }
    if (selection.kind === "regions" && world.map.regions.length === 0) {
      setSelection({ kind: "map", id: world.map.id });
    }
    if (activeRegionId && !world.map.regions.some((region) => region.id === activeRegionId)) {
      setActiveRegionId(world.map.regions[0]?.id ?? null);
    }
    if (selection.kind === "point" && !canvasPoints.some((point) => point.id === selection.id)) {
      setSelection({ kind: "map", id: world.map.id });
    }
  }, [activeRegionId, canvasPoints, selection, selectedAgentExists, world]);

  useEffect(() => {
    if (!["region", "imageGenerate"].includes(editTool)) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void finalizeActiveDraft();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (editTool === "imageGenerate") {
          setImageDraftPoints([]);
        } else {
          setDraftPoints([]);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draftPoints, editTool, imageDraftPoints, imageGenerationBusy, imageGenerationMode, imagePrompt, imageReferenceBackground, imageCreateNewLayer, imageGenerationProvider, regionDrawOperation, regionDrawTargetFunction, selection, world]);

  async function refreshWorld() {
    const snapshot = await getWorld();
    setWorld(snapshot);
    setSelection((current) => {
      if (current.kind !== "map") {
        return current;
      }
      return { kind: "map", id: snapshot.map.id };
    });
    setStatus("就绪");
  }

  async function refreshModels() {
    setModels(await getModels());
  }

  async function refreshModelCapabilities() {
    setModelCapabilityStatuses(await getModelCapabilityStatus());
  }

  async function refreshRuntimeStatus() {
    const nextStatus = await getRuntimeStatus();
    if (nextStatus) {
      setRuntimeStatus(nextStatus);
      setRuntimeStatusStale(false);
    } else {
      setRuntimeStatusStale(true);
    }
  }

  async function setSimulationRunning(running: boolean, stopped = false) {
    if (!world) {
      return;
    }
    const snapshot = await setSimulation(running);
    if (snapshot) {
      setWorld(snapshot);
      setStatus(stopped ? "已停止" : running ? "运行中" : "已暂停");
    } else {
      setWorld({ ...world, running });
      setStatus("本地预览");
    }
  }

  async function handleStep() {
    const snapshot = await tickSimulation();
    if (snapshot) {
      setWorld(snapshot);
      setStatus("后端已连接");
    } else {
      setStatus("本地预览");
    }
  }

  async function handleSave() {
    if (!world) {
      return;
    }
    const snapshot = await saveMap(world.map);
    if (snapshot) {
      setWorld(snapshot);
      setStatus("已保存");
    } else {
      setStatus("本地更改");
    }
  }

  async function handleUpload(file: File) {
    if (!world) {
      return;
    }
    try {
      const result = await uploadMapImage(file);
      setWorld({ ...world, map: { ...world.map, background_image: result.url } });
      setSegmentation(idleSegmentation());
      setStatus("图片已上传");
    } catch {
      setWorld({ ...world, map: { ...world.map, background_image: URL.createObjectURL(file) } });
      setSegmentation(idleSegmentation());
      setStatus("本地图片");
    }
  }

  async function handleWorldClick(point: Point) {
    if (!world) {
      return;
    }
    setAnchorMenu(null);
    setObjectMenu(null);
    if (editTool === "anchor") {
      const snapped = snapWorldPointToGrid(point, canvasView.zoom);
      setAnchorPoint(snapped);
      return;
    }
    if (editTool === "select") {
      setSelection({ kind: "map", id: world.map.id });
      return;
    }
    if (editTool === "region") {
      setDraftPoints((points) => [...points, snapWorldPointToGrid(point, canvasView.zoom)]);
      return;
    }
    if (editTool === "imageGenerate" && imageSelectionMode === "polygon") {
      setImageDraftPoints((points) => [...points, snapWorldPointToGrid(point, canvasView.zoom)]);
      return;
    }
    if (editTool === "item") {
      const map = addItemToMap(world.map, point);
      const item = map.items[map.items.length - 1];
      if (item) {
        setPendingLocalItem(pendingLocalItemsRef, item);
      }
      setWorld({ ...world, map });
      setSelection(item ? { kind: "item", id: item.id } : selection);
      setEditTool("select");
      const snapshot = await saveMap(map);
      if (snapshot) {
        if (item && snapshot.map.items.some((savedItem) => savedItem.id === item.id)) {
          clearPendingLocalItem(pendingLocalItemsRef, item.id);
        }
        setWorld(mergeSnapshotWithLocalState(snapshot, pendingState(pendingMapPatchRef, pendingAgentPatchesRef, pendingItemPatchesRef, pendingLocalItemsRef)));
      }
      return;
    }
    if (editTool === "spawn") {
      const map = addSpawnToMap(world.map, snapWorldPointToGrid(point, canvasView.zoom));
      setWorld({ ...world, map });
      setEditTool("select");
      const snapshot = await saveMap(map);
      if (snapshot) {
        setWorld(snapshot);
      }
      return;
    }
    if (editTool === "move" && selectedAgentId) {
      const result = await postAction(selectedAgentId, "move_to", { target: point });
      if (result?.ok) {
        await refreshWorld();
      } else {
        setWorld(moveAgentLocal(world, selectedAgentId, point));
      }
    }
  }

  async function finalizePolygon() {
    if (!world || draftPoints.length < 2) {
      return;
    }
    if (editTool !== "region") {
      setDraftPoints([]);
      return;
    }
    setMapStudioStep("layers");
    const targetLayer = world.map.region_layers.find((layer) => layer.function === regionDrawTargetFunction);
    const targetRegion = activeRegionId
      ? world.map.regions.find((region) => region.id === activeRegionId && region.function === regionDrawTargetFunction && !region.hidden) ?? null
      : null;
    const booleanTarget = targetRegion
      ? { targetIds: [targetRegion.id] }
      : { targetFunction: regionDrawTargetFunction };
    if (regionDrawOperation === "subtract" && !targetRegion && !targetLayer?.region_ids.length) {
      setStatus("目标功能层没有可扣减区域");
      return;
    }
    if (regionDrawOperation === "subtract" || targetRegion || targetLayer?.region_ids.length) {
      const snapshot = await booleanMapRegions({
        ...booleanTarget,
        operation: regionDrawOperation === "subtract" ? "subtract" : "union",
        points: draftPoints
      });
      if (snapshot) {
        setWorld(snapshot);
        const nextTargetRegion = targetRegion
          ? snapshot.map.regions.find((region) => region.id === targetRegion.id)
          : null;
        if (nextTargetRegion) {
          setActiveRegionId(nextTargetRegion.id);
          setSelection({ kind: "region", id: nextTargetRegion.id });
          setStatus(regionDrawOperation === "subtract" ? "选中区域已扣减" : "选中区域已扩展");
        } else {
          const nextLayer = snapshot.map.region_layers.find((layer) => layer.function === regionDrawTargetFunction);
          const nextSelectedRegion = nextLayer?.region_ids[0]
            ? snapshot.map.regions.find((region) => region.id === nextLayer.region_ids[0])
            : null;
          setActiveRegionId(nextSelectedRegion?.id ?? null);
          setSelection({ kind: "regionLayer", id: regionDrawTargetFunction });
          setStatus(regionDrawOperation === "subtract" ? "区域已扣减" : "区域已扩展");
        }
        setDraftPoints([]);
      } else {
        if (regionDrawOperation === "add" && !targetRegion) {
          const result = addRegionToMap(world.map, draftPoints, regionDrawTargetFunction);
          setWorld({ ...world, map: result.map });
          setActiveRegionId(result.region.id);
          setSelection({ kind: "regionLayer", id: regionDrawTargetFunction });
          setStatus("本地手绘区域");
          setDraftPoints([]);
          return;
        }
        setStatus("区域布尔保存失败，草稿已保留");
      }
      return;
    }
    const snapshot = await createMapRegion({
      name: `${regionFunctionLabel(regionDrawTargetFunction)}手绘区域`,
      points: draftPoints,
      function: regionDrawTargetFunction,
      notes: `手绘增加到${regionFunctionLabel(regionDrawTargetFunction)}。`
    });
    if (snapshot) {
      setWorld(snapshot);
      const created = snapshot.map.regions.find((region) => region.function === regionDrawTargetFunction) ?? snapshot.map.regions[0];
      setActiveRegionId(created?.id ?? null);
      setSelection({ kind: "regionLayer", id: regionDrawTargetFunction });
      setStatus("手绘区域已创建");
      setDraftPoints([]);
    } else {
      const result = addRegionToMap(world.map, draftPoints, regionDrawTargetFunction);
      setWorld({ ...world, map: result.map });
      setActiveRegionId(result.region.id);
      setSelection({ kind: "regionLayer", id: regionDrawTargetFunction });
      setStatus("本地手绘区域");
      setDraftPoints([]);
    }
  }

  async function finalizeActiveDraft() {
    if (editTool === "imageGenerate") {
      await generateImageFromPanel();
      return;
    }
    await finalizePolygon();
  }

  async function generateImageFromPanel() {
    if (!world || imageGenerationBusy) {
      return;
    }
    const selectionPayload = imageSelectionFromDraft(imageDraftPoints);
    const prompt = imagePrompt.trim();
    const selectedLayer = selection.kind === "imageLayer" ? world.map.image_layers.find((layer) => layer.id === selection.id) ?? null : null;
    const selectedRegion = selection.kind === "region" ? world.map.regions.find((region) => region.id === selection.id) ?? null : null;
    const effectiveSelection = selectionPayload ?? imageSelectionFromTarget(imageGenerationMode, selectedLayer, selectedRegion);
    if (!effectiveSelection || !prompt) {
      setImageGenerationError(!prompt ? "请输入图像提示词" : "请先在画布上创建选区");
      return;
    }
    const provider = imageGenerationProvider;
    if (!provider || provider.provider === "mock") {
      setImageGenerationError("未启用真实图片生成模型。请先在模型管理的图片生成高级配置中保存并启用服务。");
      setStatus("未启用真实图片生成模型");
      return;
    }
    const targetLayerId = imageGenerationMode === "repaint" && !imageCreateNewLayer ? selectedLayer?.id ?? null : null;
    const regionId = imageGenerationMode === "repaint" ? selectedRegion?.id ?? selectedLayer?.region_id ?? null : null;
    setImageGenerationBusy(true);
    setImageGenerationError(null);
    setStatus(imageModeRunningText(imageGenerationMode));
    try {
      const result = await generateMapImageLayer({
        prompt,
        selection: effectiveSelection,
        mode: imageGenerationMode,
        reference_background: imageReferenceBackground && Boolean(world.map.background_image),
        provider_id: provider?.id ?? null,
        target_layer_id: targetLayerId,
        region_id: regionId
      });
      setWorld(result.world);
      setSelection({ kind: "imageLayer", id: result.layer.id });
      setImageDraftPoints([]);
      setEditTool("select");
      setStatus(imageModeDoneText(imageGenerationMode));
    } catch (error) {
      const message = error instanceof Error ? error.message : "接口不可用";
      setImageGenerationError(message);
      setStatus(`图像生成失败：${message}`);
    } finally {
      setImageGenerationBusy(false);
    }
  }

  async function createAgent(name: string, role: string, point: Point) {
    if (!world) {
      return;
    }
    const previousIds = new Set(Object.keys(world.agent_profiles));
    const remoteSnapshot = await createAgentRemote(name, role, point);
    if (remoteSnapshot) {
      setWorld(remoteSnapshot);
      const created =
        Object.values(remoteSnapshot.agent_profiles).find((agent) => !previousIds.has(agent.id)) ??
        Object.values(remoteSnapshot.agent_profiles).find((agent) => agent.name === name);
      setSelection(created ? { kind: "agent", id: created.id } : selection);
      setStatus("后端已连接");
      return;
    }
    setStatus("本地预览");
    const snapshot = addAgentLocal(world, name, role, point);
    setWorld(snapshot);
    const created = Object.values(snapshot.agent_profiles).find((agent) => agent.name === name);
    if (created) {
      setSelection({ kind: "agent", id: created.id });
    }
  }

  function centerOnWorldPoint(point: Point) {
    const shell = document.querySelector(".scene-canvas-shell");
    const rect = shell?.getBoundingClientRect();
    const center = rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    setCanvasView((view) => centerViewOnWorldPoint(view, point, center));
  }

  function selectFromWorld(next: SelectionState) {
    if (next.kind === "region") {
      setActiveRegionId(next.id);
      setMapStudioStep("layers");
      const region = world?.map.regions.find((candidate) => candidate.id === next.id);
      if (region) {
        setRegionDrawTargetFunction(region.function);
      }
    }
    if (next.kind === "regionLayer") {
      setActiveRegionId(null);
      setRegionDrawTargetFunction(next.id);
    }
    if (next.kind === "regions") {
      setMapStudioStep("layers");
    }
    setSelection(next);
  }

  function activateRegion(regionId: string) {
    const region = world?.map.regions.find((candidate) => candidate.id === regionId);
    setActiveRegionId(regionId);
    if (region) {
      setRegionDrawTargetFunction(region.function);
    }
    setSelection({ kind: "region", id: regionId });
    setMapStudioStep("layers");
  }

  function locateAgent(agentId: string) {
    if (!world) {
      return;
    }
    const state = world.agent_states[agentId];
    if (!state) {
      return;
    }
    setSelection({ kind: "agent", id: agentId });
    centerOnWorldPoint(state.position);
  }

  function openAnchorMenu(screen: Point, point: Point) {
    setObjectMenu(null);
    setAnchorPoint(point);
    setAnchorMenu({ x: screen.x, y: screen.y, point });
  }

  function openObjectMenu(target: ObjectMenuTarget, screen: Point) {
    setAnchorMenu(null);
    if (target.kind === "agent") {
      setSelection({ kind: "agent", id: target.id });
    } else if (target.kind === "item") {
      setSelection({ kind: "item", id: target.id });
    } else if (target.kind === "imageLayer") {
      setSelection({ kind: "imageLayer", id: target.id });
    } else {
      activateRegion(target.id);
    }
    setObjectMenu({ ...target, x: screen.x, y: screen.y });
  }

  async function setObjectHidden(target: ObjectMenuTarget, hidden: boolean) {
    setObjectMenu(null);
    if (target.kind === "agent") {
      await updateAgentProfile(target.id, { hidden });
      setStatus(hidden ? "Agent 已隐藏" : "Agent 已显示");
      return;
    }
    if (target.kind === "item") {
      await updateItemPatch(target.id, { hidden });
      setStatus(hidden ? "元素已隐藏" : "元素已显示");
      return;
    }
    if (target.kind === "imageLayer") {
      await updateImageLayer(target.id, { hidden });
      setStatus(hidden ? "图层已隐藏" : "图层已显示");
      return;
    }
    await updateRegion(target.id, { hidden });
    setStatus(hidden ? "区域已隐藏" : "区域已显示");
  }

  async function deleteObject(target: ObjectMenuTarget) {
    if (!world) {
      return;
    }
    setObjectMenu(null);
    if (target.kind === "agent") {
      clearPendingAgent(target.id);
      setWorld(deleteAgentLocal(world, target.id));
      setSelection({ kind: "map", id: world.map.id });
      const snapshot = await deleteAgent(target.id);
      if (snapshot) {
        setWorld(mergeSnapshotWithLocalState(snapshot, pendingState(pendingMapPatchRef, pendingAgentPatchesRef, pendingItemPatchesRef, pendingLocalItemsRef)));
        setStatus("Agent 已删除");
      } else {
        setStatus("本地已删除 Agent");
      }
      return;
    }
    if (target.kind === "item") {
      clearPendingItemPatch(pendingItemPatchesRef, target.id);
      clearPendingLocalItem(pendingLocalItemsRef, target.id);
      setWorld(deleteItemLocal(world, target.id));
      setSelection({ kind: "map", id: world.map.id });
      const snapshot = await deleteMapItem(target.id);
      if (snapshot) {
        setWorld(mergeSnapshotWithLocalState(snapshot, pendingState(pendingMapPatchRef, pendingAgentPatchesRef, pendingItemPatchesRef, pendingLocalItemsRef)));
        setStatus("元素已删除");
      } else {
        setStatus("本地已删除元素");
      }
      return;
    }
    if (target.kind === "imageLayer") {
      setWorld({ ...world, map: { ...world.map, image_layers: world.map.image_layers.filter((layer) => layer.id !== target.id) } });
      setSelection({ kind: "map", id: world.map.id });
      const snapshot = await deleteMapImageLayer(target.id);
      if (snapshot) {
        setWorld(snapshot);
        setStatus("图层已删除");
      } else {
        setStatus("本地已删除图层");
      }
      return;
    }
    setWorld(deleteRegionLocal(world, target.id));
    setActiveRegionId(null);
    setSelection({ kind: "map", id: world.map.id });
    const snapshot = await deleteMapRegion(target.id);
    if (snapshot) {
      setWorld(snapshot);
      setStatus("区域已删除");
    } else {
      setStatus("本地已删除区域");
    }
  }

  function clearPendingAgent(agentId: string) {
    const next = { ...pendingAgentPatchesRef.current };
    delete next[agentId];
    pendingAgentPatchesRef.current = next;
  }

  async function generateAgentFromAnchor(point: Point) {
    setAnchorMenu(null);
    await createAgent("新 Agent", "居民", point);
  }

  async function generateItemFromAnchor(point: Point) {
    if (!world) {
      return;
    }
    const map = addItemToMap(world.map, point);
    const item = map.items[map.items.length - 1];
    if (item) {
      setPendingLocalItem(pendingLocalItemsRef, item);
    }
    setWorld({ ...world, map });
    const remoteSnapshot = await saveMap(map);
    if (remoteSnapshot) {
      if (item && remoteSnapshot.map.items.some((savedItem) => savedItem.id === item.id)) {
        clearPendingLocalItem(pendingLocalItemsRef, item.id);
      }
      setWorld(mergeSnapshotWithLocalState(remoteSnapshot, pendingState(pendingMapPatchRef, pendingAgentPatchesRef, pendingItemPatchesRef, pendingLocalItemsRef)));
    }
    if (item) {
      setSelection({ kind: "item", id: item.id });
    }
    setAnchorMenu(null);
  }

  function generatePointFromAnchor(point: Point) {
    const canvasPoint: CanvasPoint = {
      id: makeId("point"),
      name: `空点 ${canvasPoints.length + 1}`,
      position: point,
      snapped: true
    };
    setCanvasPoints((points) => [...points, canvasPoint]);
    setSelection({ kind: "point", id: canvasPoint.id });
    setAnchorMenu(null);
  }

  async function updateMapPatch(patch: MapPatch) {
    if (!world) {
      return;
    }
    setPendingMapPatch(pendingMapPatchRef, patch);
    const nextWorld = { ...world, map: { ...world.map, ...patch } };
    setWorld(nextWorld);
    const snapshot = await patchMap(patch);
    if (snapshot) {
      clearPendingMapPatch(pendingMapPatchRef, patch);
      setWorld(mergeSnapshotWithLocalState(snapshot, pendingState(pendingMapPatchRef, pendingAgentPatchesRef, pendingItemPatchesRef, pendingLocalItemsRef)));
      setStatus("已保存");
    } else {
      setStatus("本地更改");
    }
  }

  async function updateNarrativeConfig(patch: Partial<Pick<NarrativeConfig, "enabled" | "premise" | "tone" | "cadence_ticks">>) {
    if (!world) {
      return;
    }
    setWorld({ ...world, narrative: { ...world.narrative, ...patch } });
    const snapshot = await patchNarrative(patch);
    if (snapshot) {
      setWorld(snapshot);
      setStatus("叙事已更新");
    } else {
      setStatus("本地叙事预览");
    }
  }

  async function generateMap(prompt: string, width = 1920, height = 1080, ratio: MapRatioPreset = "16:9") {
    if (!world) {
      return;
    }
    const fullPrompt = mapPrompt(prompt, width, height, ratio);
    setSegmentation(idleSegmentation());
    await updateMapPatch({ width, height });
    const provider = enabledModelForCapability(models, "image_generation");
    if (!provider) {
      setStatus("未启用真实图片生成模型");
      return;
    }
    try {
      const task = await createMapGeneration({ prompt: fullPrompt, width, height, ratio, count: 3, provider_id: provider?.id ?? null });
      setGeneration(task);
      setStatus("背景候选已生成");
    } catch (error) {
      setStatus(`图片生成失败：${error instanceof Error ? error.message : "远程服务不可用"}`);
    }
  }

  async function selectMapCandidate(candidateId: string) {
    if (!generation) {
      return;
    }
    const result = await selectGeneratedMap(generation.id, candidateId);
    if (result) {
      setGeneration(result.generation);
      setWorld(result.world);
      setSelection({ kind: "map", id: result.world.map.id });
      setSegmentation(idleSegmentation());
      setStatus("背景已选择");
      return;
    }
    const candidate = generation.candidates.find((item) => item.id === candidateId);
    if (candidate && world) {
      const nextGeneration = { ...generation, selected_candidate_id: candidateId };
      const nextWorld = {
        ...world,
        map: {
          ...world.map,
          width: generation.width,
          height: generation.height,
          background_image: candidate.url
        }
      };
      setGeneration(nextGeneration);
      setWorld(nextWorld);
      setSelection({ kind: "map", id: nextWorld.map.id });
      setSegmentation(idleSegmentation());
      setStatus("本地背景已选择");
    }
  }

  async function runMapSegmentation() {
    const provider = enabledModelForCapability(models, "segmentation");
    setSegmentation({
      status: "running",
      progress: 35,
      stage: "call_sam",
      provider_id: provider?.id ?? null,
      provider_name: provider?.name ?? null,
      error: null,
      region_count: 0,
      mode: "none"
    });
    const result = await segmentMap();
    if (result.world) {
      setWorld(result.world);
      setSegmentation(result.segmentation);
      setSelection(
        result.world.map.regions[0]
          ? { kind: "regions", id: "all" }
          : { kind: "map", id: result.world.map.id }
      );
      setActiveRegionId(result.world.map.regions[0]?.id ?? null);
      setMapStudioStep("layers");
      const prefix = result.segmentation.mode === "mock" ? "测试 Mock SAM" : "SAM";
      setStatus(`${prefix} 分层完成`);
      return;
    }

    const allowLocalMock = typeof window !== "undefined" && window.localStorage.getItem("agent-workstation.enable-mock-sam") === "1";
    if (allowLocalMock) {
      setWorld((current) => {
        if (!current) {
          return current;
        }
        const nextMap = syncFunctionalRegions({
          ...current.map,
          regions: createLocalRegions(current.map.width, current.map.height)
        });
        const nextWorld = { ...current, map: nextMap };
        setSelection(nextMap.regions[0] ? { kind: "regions", id: "all" } : { kind: "map", id: nextMap.id });
        setActiveRegionId(nextMap.regions[0]?.id ?? null);
        setMapStudioStep("layers");
        setSegmentation({
          status: "done",
          progress: 100,
          stage: "done",
          provider_id: "local_mock_sam",
          provider_name: "测试 Mock SAM",
          error: null,
          region_count: nextMap.regions.length,
          mode: "local_mock"
        });
        return nextWorld;
      });
      setStatus("测试 Mock SAM 分层完成");
      return;
    }
    setSegmentation(result.segmentation);
    setStatus(result.segmentation.error || "SAM 分层失败");
  }

  async function updateRegion(regionId: string, patch: Partial<Omit<MapRegion, "id" | "points" | "source">>) {
    setSelection({ kind: "region", id: regionId });
    setActiveRegionId(regionId);
    setMapStudioStep("layers");
    setWorld((current) => (current ? applyRegionPatch(current, regionId, patch) : current));
    const snapshot = await patchMapRegion(regionId, patch);
    if (snapshot) {
      setWorld(snapshot);
      setStatus("区域已保存");
    } else {
      setStatus("本地区域更改");
    }
  }

  async function regenerateRegion(regionId: string, prompt: string) {
    const snapshot = await regenerateMapRegion(regionId, prompt);
    if (snapshot) {
      setWorld(snapshot);
      const regionLayers = snapshot.map.image_layers.filter((layer) => layer.region_id === regionId);
      const latestLayer = regionLayers[regionLayers.length - 1];
      if (latestLayer) {
        setSelection({ kind: "imageLayer", id: latestLayer.id });
      }
      setStatus("区域重绘图层已生成");
    } else {
      setWorld((current) =>
        current
          ? applyRegionPatch(current, regionId, {
              image_prompt: prompt,
              notes: `已为此区域记录局部重绘提示：${prompt}`
            })
          : current
      );
      setStatus("本地区域重绘提示已保存");
    }
  }

  async function configureLocalModelCapability(capability: ModelCapabilityId) {
    const optimisticTask: ModelCapabilityTask = {
      id: makeId("local_model_task"),
      capability,
      title: capability === "llm" ? "启用本地 LLM" : capability === "segmentation" ? "启用内置 MobileSAM" : "启用本地模型",
      status: "running",
      stage: "configuring",
      progress: 20,
      message: capability === "llm" ? "正在启用本地 LLM" : capability === "segmentation" ? "正在启用内置 MobileSAM" : "正在启用本地模型",
      error: null
    };
    setModelCapabilityTasks((current) => ({ ...current, [capability]: optimisticTask }));
    setStatus(optimisticTask.message);
    const result = await configureLocalCapability(capability);
    if (result) {
      setModels(result.models);
      setModelCapabilityStatuses((current) => mergeCapabilityStatus(current, result.capability));
      const doneMessage = capability === "llm"
        ? "本地 LLM 已启用"
        : capability === "segmentation"
          ? "内置 MobileSAM 已启用"
          : "本地模型配置已启用";
      setModelCapabilityTasks((current) => ({
        ...current,
        [capability]: {
          ...optimisticTask,
          status: "done",
          stage: "done",
          progress: 100,
          message: doneMessage,
          error: null
        }
      }));
      setStatus(doneMessage);
    } else {
      await refreshModelCapabilities();
      const errorMessage = capability === "segmentation"
        ? "内置 MobileSAM 尚未安装，请先安装并启用"
        : "未检测到可用本地能力";
      setModelCapabilityTasks((current) => ({
        ...current,
        [capability]: {
          ...optimisticTask,
          status: "error",
          stage: "error",
          progress: 100,
          message: "启用失败",
          error: errorMessage
        }
      }));
      setStatus(errorMessage);
    }
  }

  async function autoLabelRegion(regionId: string) {
    const snapshot = await autoLabelMapRegion(regionId);
    if (snapshot) {
      setWorld(snapshot);
      setSelection({ kind: "region", id: regionId });
      setStatus("图层已由本地图像识别模型命名");
    } else {
      setStatus("图层自动命名失败");
    }
  }

  async function configureRemoteModelCapability(capability: ModelCapabilityId, draft: { baseUrl: string; apiKey: string; model: string }) {
    const result = await configureRemoteCapability(capability, draft);
    if (result) {
      setModels(result.models);
      setModelCapabilityStatuses((current) => mergeCapabilityStatus(current, result.capability));
      setStatus("远程备用配置已保存");
    } else {
      setStatus("远程配置保存失败");
    }
  }

  async function loadRemoteModelsForCapability(
    capability: ModelCapabilityId,
    draft: { baseUrl: string; apiKey: string; model: string }
  ): Promise<RemoteModelOption[]> {
    const options = await fetchRemoteCapabilityModels(capability, draft);
    setStatus(options.length ? "远程模型列表已读取" : "远程模型列表为空");
    return options;
  }

  async function testRemoteModelCapability(
    capability: ModelCapabilityId,
    draft: { baseUrl: string; apiKey: string; model: string }
  ): Promise<RemoteModelTestResult> {
    const result = await testRemoteCapability(capability, draft);
    setStatus(result.ok ? "远程 API 测试成功" : "远程 API 测试失败");
    return result;
  }

  async function installLocalModelCapability(capability: ModelCapabilityId) {
    const optimisticTask: ModelCapabilityTask = {
      id: makeId("local_model_task"),
      capability,
      title: capability === "llm" ? "下载并启用本地 LLM" : capability === "segmentation" ? "安装并启用内置 MobileSAM" : "安装本地模型",
      status: "running",
      stage: "connecting",
      progress: 4,
      message: capability === "llm" ? "正在连接 Ollama 并准备本地 LLM" : "正在连接本机引擎并启动安装",
      error: null
    };
    setModelCapabilityTasks((current) => ({ ...current, [capability]: optimisticTask }));
    setStatus(capability === "llm" ? "正在准备本地 LLM" : "正在启动内置模型安装");
    const result = await installLocalCapability(capability);
    if (!result) {
      setModelCapabilityTasks((current) => ({
        ...current,
        [capability]: {
          ...optimisticTask,
          status: "error",
          stage: "error",
          progress: 100,
          message: "安装启动失败",
          error: "本机引擎暂未连接，或当前后端还不是最新版本。请稍后重试，必要时重启 Electron。"
        }
      }));
      setStatus("本机引擎暂未连接，请稍后重试安装");
      return;
    }
    if (result.models.length) {
      setModels(result.models);
    }
    setModelCapabilityTasks((current) => ({ ...current, [capability]: result.task }));
    setStatus(result.task.message || (capability === "llm" ? "本地 LLM 准备中" : "内置模型安装中"));
    void pollModelCapabilityTask(capability, result.task.id);
  }

  async function pollModelCapabilityTask(capability: ModelCapabilityId, taskId: string) {
    for (let attempt = 0; attempt < 1800; attempt += 1) {
      await delay(1000);
      const task = await getModelCapabilityTask(taskId);
      if (!task) {
        setStatus("内置模型安装状态丢失");
        return;
      }
      setModelCapabilityTasks((current) => ({ ...current, [capability]: task }));
      setStatus(task.message || (capability === "llm" ? "本地 LLM 准备中" : "内置模型安装中"));
      if (task.status === "done") {
        await refreshModels();
        await refreshModelCapabilities();
        setStatus(capability === "llm" ? "本地 LLM 已启用" : "内置 MobileSAM 已启用");
        return;
      }
      if (task.status === "error") {
        await refreshModelCapabilities();
        setStatus(task.error || (capability === "llm" ? "本地 LLM 准备失败" : "内置模型安装失败"));
        return;
      }
    }
    setStatus(capability === "llm" ? "本地 LLM 仍在准备，请稍后重新检测" : "内置模型安装仍在进行，请稍后重新检测");
  }

  async function updateAgentProfile(agentId: string, patch: AgentPatch) {
    if (!world) {
      return;
    }
    const profile = world.agent_profiles[agentId];
    if (!profile) {
      return;
    }
    setPendingAgentPatch(pendingAgentPatchesRef, agentId, patch);
    setWorld({
      ...world,
      agent_profiles: {
        ...world.agent_profiles,
        [agentId]: { ...profile, ...patch }
      }
    });
    const snapshot = await patchAgent(agentId, patch);
    if (snapshot) {
      clearPendingAgentPatch(pendingAgentPatchesRef, agentId, patch);
      setWorld(mergeSnapshotWithLocalState(snapshot, pendingState(pendingMapPatchRef, pendingAgentPatchesRef, pendingItemPatchesRef, pendingLocalItemsRef)));
      setStatus("已保存");
    } else {
      setStatus("本地更改");
    }
  }

  function previewItemPatch(itemId: string, patch: Partial<Omit<WorldItem, "id">>) {
    setPendingItemPatch(pendingItemPatchesRef, itemId, patch);
    setSelection({ kind: "item", id: itemId });
    setWorld((current) => (current ? applyItemPatch(current, itemId, patch) : current));
  }

  async function updateItemPatch(itemId: string, patch: Partial<Omit<WorldItem, "id">>) {
    if (!world) {
      return;
    }
    if (Object.keys(patch).length === 0) {
      return;
    }
    setPendingItemPatch(pendingItemPatchesRef, itemId, patch);
    setSelection({ kind: "item", id: itemId });
    setWorld((current) => (current ? applyItemPatch(current, itemId, patch) : current));
    const snapshot = await patchMapItem(itemId, patch);
    if (snapshot) {
      clearPendingItemPatch(pendingItemPatchesRef, itemId);
      setWorld(mergeSnapshotWithLocalState(snapshot, pendingState(pendingMapPatchRef, pendingAgentPatchesRef, pendingItemPatchesRef, pendingLocalItemsRef)));
      setStatus("已保存");
    } else {
      setStatus("本地更改");
    }
  }

  async function uploadItemImage(itemId: string, file: File) {
    try {
      const result = await uploadAsset(file);
      await updateItemPatch(itemId, { image: result.url });
    } catch {
      await updateItemPatch(itemId, { image: URL.createObjectURL(file) });
      setStatus("本地图片");
    }
  }

  function movePanel(id: PanelState["id"], x: number, y: number) {
    setPanels((current) =>
      current.map((panel) => (panel.id === id ? clampPanelToViewport({ ...panel, x, y, dockedTo: null }) : panel))
    );
  }

  async function updateImageLayer(layerId: string, patch: ImageLayerPatch) {
    if (!world || Object.keys(patch).length === 0) {
      return;
    }
    setSelection({ kind: "imageLayer", id: layerId });
    setWorld((current) => (current ? applyImageLayerPatch(current, layerId, patch) : current));
    const snapshot = await patchMapImageLayer(layerId, patch);
    if (snapshot) {
      setWorld(snapshot);
      setStatus("图层已保存");
    } else {
      setStatus("本地图层更改");
    }
  }

  function resizePanel(id: PanelState["id"], x: number, y: number, width: number, height: number) {
    setPanels((current) =>
      current.map((panel) => {
        if (panel.id !== id) {
          return panel;
        }
        return clampPanelToViewport({ ...panel, x, y, width, height, dockedTo: null });
      })
    );
  }

  function snapPanel(id: PanelState["id"]) {
    setPanels((current) => {
      const active = current.find((panel) => panel.id === id);
      if (!active) {
        return current;
      }
      const snapped = snapToTargets(active, current);
      return current.map((panel) => (panel.id === id ? snapped : panel));
    });
  }

  function bringPanelToFront(id: PanelState["id"]) {
    setZCursor((value) => value + 1);
    setPanels((current) =>
      current.map((panel) => (panel.id === id ? { ...panel, zIndex: zCursor + 1 } : panel))
    );
  }

  function togglePanelMinimized(id: PanelState["id"]) {
    setPanels((current) =>
      current.map((panel) => (panel.id === id ? { ...panel, minimized: !panel.minimized } : panel))
    );
  }

  function openPanel(id: PanelState["id"]) {
    setPanels((current) => {
      const nextZ = maxPanelZ(current) + 1;
      setZCursor(nextZ);
      return current.map((panel) =>
        panel.id === id ? clampPanelToViewport({ ...panel, minimized: false, zIndex: nextZ }) : panel
      );
    });
  }

  function openImageGeneration(mode: ImageGenerationMode = imageGenerationMode) {
    setImageGenerationMode(mode);
    setEditTool("imageGenerate");
    setImageGenerationError(null);
    setPanels((current) => {
      const nextZ = maxPanelZ(current) + 1;
      setZCursor(nextZ);
      const focusedPanel = imageGenerationPanelForViewport(nextZ);
      if (!current.some((panel) => panel.id === "imageGeneration")) {
        return [...current, focusedPanel];
      }
      return current.map((panel) => (panel.id === "imageGeneration" ? { ...focusedPanel, dockedTo: panel.dockedTo } : panel));
    });
    setStatus("图像生成工具已打开");
  }

  function openRuntimeMonitor() {
    setPanels((current) => {
      const nextZ = maxPanelZ(current) + 1;
      setZCursor(nextZ);
      const focusedPanel = runtimeMonitorPanelForViewport(nextZ);
      if (!current.some((panel) => panel.id === "runtimeMonitor")) {
        return [...current, focusedPanel];
      }
      return current.map((panel) => (panel.id === "runtimeMonitor" ? { ...focusedPanel, dockedTo: panel.dockedTo } : panel));
    });
    setStatus("运行监控已打开");
    void refreshRuntimeStatus();
  }

  function openModelsPanel() {
    openPanel("models");
    setStatus("请在模型管理中配置图片生成 API");
  }

  function resetPanelLayout() {
    const nextPanels = createInitialPanels();
    setPanels(nextPanels);
    setZCursor(maxPanelZ(nextPanels));
  }

  function setZoom(direction: 1 | -1) {
    setCanvasView((view) => ({
      ...view,
      zoom: clamp(view.zoom * (direction > 0 ? 1.18 : 0.82), 0.125, 8),
      fitMode: false
    }));
  }

  if (!world) {
    return (
      <main className={`desktop-workspace tone-${appearanceMode} loading`} style={appBackgroundStyle(appBackgroundOpacity)}>
        <div className="loader" />
      </main>
    );
  }

  return (
    <main className={`desktop-workspace tone-${appearanceMode}`} style={appBackgroundStyle(appBackgroundOpacity)}>
      <SceneViewport
        world={world}
        editTool={editTool}
        canvasView={canvasView}
        selection={selection}
        canvasPoints={canvasPoints}
        anchorPoint={anchorPoint}
        showRegions={
          editTool === "region" ||
          mapStudioStep === "layers" ||
          selection.kind === "region" ||
          selection.kind === "regionLayer" ||
          selection.kind === "regions"
        }
        showAllRegionLayers={selection.kind === "regions"}
        activeRegionFunction={activeRegionFunction}
        status={status}
        appearanceMode={appearanceMode}
        imageSelectionMode={imageSelectionMode}
        imageAspectRatio={imageAspectRatioForPreset(imageAspectPreset, world.map.width, world.map.height)}
        onViewChange={setCanvasView}
        onWorldPoint={(point) => void handleWorldClick(point)}
        onImageDraft={setImageDraftPoints}
        onSelect={(next) => selectFromWorld(next)}
        onAnchorContext={openAnchorMenu}
        onObjectContext={(target, screen) => openObjectMenu(target, screen)}
        draftPoints={editTool === "imageGenerate" ? imageDraftPoints : draftPoints}
        onRenameAgent={(agentId, name) => void updateAgentProfile(agentId, { name })}
        onPreviewItem={previewItemPatch}
        onCommitItem={(itemId, patch) => void updateItemPatch(itemId, patch)}
      />

      {narrativeLine ? (
        <div className="scene-subtitle" data-testid="scene-subtitle">
          <span>{narrativeLine.message}</span>
        </div>
      ) : null}

      <TransportControls
        appBackgroundOpacity={appBackgroundOpacity}
        running={world.running}
        onRun={() => void setSimulationRunning(true)}
        onPause={() => void setSimulationRunning(false)}
        onStop={() => void setSimulationRunning(false, true)}
        onAppBackgroundOpacity={setAppBackgroundOpacity}
        onCenterOrigin={() => centerOnWorldPoint(ORIGIN_POINT)}
        onOpenRuntimeMonitor={openRuntimeMonitor}
        appearanceMode={appearanceMode}
        onToggleAppearance={() => setAppearanceMode((mode) => (mode === "light" ? "dark" : "light"))}
        onResetPanelLayout={resetPanelLayout}
      />

      {anchorMenu ? (
        <div
          className="anchor-context-menu"
          data-testid="anchor-context-menu"
          onContextMenu={(event) => event.preventDefault()}
          style={{ left: anchorMenu.x, top: anchorMenu.y }}
        >
          <button onClick={() => void generateAgentFromAnchor(anchorMenu.point)}>生成 Agent</button>
          <button onClick={() => void generateItemFromAnchor(anchorMenu.point)}>生成地图元素</button>
          <button onClick={() => generatePointFromAnchor(anchorMenu.point)}>生成空点</button>
        </div>
      ) : null}

      {objectMenu ? (
        <ObjectContextMenu
          menu={objectMenu}
          target={objectMenuTarget(world, objectMenu)}
          onClose={() => setObjectMenu(null)}
          onDelete={() => void deleteObject(objectMenu)}
          onHidden={(hidden) => void setObjectHidden(objectMenu, hidden)}
        />
      ) : null}

      {panels.map((panel) => (
        <FloatingPanel
          key={panel.id}
          panel={panel}
          onMove={movePanel}
          onResize={resizePanel}
          onDragEnd={snapPanel}
          onBringToFront={bringPanelToFront}
          onToggleMinimized={togglePanelMinimized}
        >
          {panel.id === "tools" ? (
            <ToolPanel
              editTool={editTool}
              zoomPercent={Math.round(canvasView.zoom * 100)}
              onEditTool={(tool) => {
                setEditTool(tool);
                if (!["region", "imageGenerate"].includes(tool)) {
                  setDraftPoints([]);
                  setImageDraftPoints([]);
                }
                if (tool === "region") {
                  setMapStudioStep("layers");
                  openPanel("regionDraw");
                  openPanel("regions");
                }
                if (tool === "imageGenerate") {
                  openImageGeneration();
                }
              }}
              onStep={() => void handleStep()}
              onSave={() => void handleSave()}
              onZoom={setZoom}
              onFit={() => setCanvasView({ zoom: 1, pan: { x: 0, y: 0 }, fitMode: true })}
              onUpload={(file) => void handleUpload(file)}
            />
          ) : null}
          {panel.id === "scene" ? (
            <SceneElementsPanel
              world={world}
              selection={selection}
              canvasPoints={canvasPoints}
              onSelect={selectFromWorld}
              onObjectContext={(target, screen) => openObjectMenu(target, screen)}
            />
          ) : null}
          {panel.id === "regions" ? (
            <RegionPanel
              world={world}
              selection={selection}
              onSelect={selectFromWorld}
              onObjectContext={(target, screen) => openObjectMenu(target, screen)}
            />
          ) : null}
          {panel.id === "regionDraw" ? (
            <RegionDrawPanel
              operation={regionDrawOperation}
              targetFunction={regionDrawTargetFunction}
              targetLayer={world.map.region_layers.find((layer) => layer.function === regionDrawTargetFunction) ?? null}
              draftCount={draftPoints.length}
              finishMinPoints={3}
              title="区域绘制"
              onOperation={setRegionDrawOperation}
              onTargetFunction={(fn) => {
                setRegionDrawTargetFunction(fn);
                setActiveRegionId(null);
                setSelection({ kind: "regionLayer", id: fn });
              }}
              onFinish={() => void finalizeActiveDraft()}
              onUndoPoint={() => setDraftPoints((points) => points.slice(0, -1))}
              onClear={() => setDraftPoints([])}
            />
          ) : null}
          {panel.id === "narrative" ? (
            <NarrativePanel world={world} onUpdate={(patch) => void updateNarrativeConfig(patch)} />
          ) : null}
          {panel.id === "imageGeneration" ? (
            <ImageGenerationPanel
              world={world}
              selection={selection}
              mode={imageGenerationMode}
              selectionMode={imageSelectionMode}
              aspectPreset={imageAspectPreset}
              prompt={imagePrompt}
              referenceBackground={imageReferenceBackground}
              createNewLayer={imageCreateNewLayer}
              draftPoints={imageDraftPoints}
              busy={imageGenerationBusy}
              error={imageGenerationError}
              providerName={imageGenerationProvider?.name ?? imageGenerationProvider?.model ?? null}
              hasRealProvider={hasRealImageGenerationProvider}
              onOpenModels={openModelsPanel}
              onMode={(mode) => {
                setImageGenerationMode(mode);
                setImageGenerationError(null);
                if (mode === "extension" && imageSelectionMode === "polygon") {
                  setImageSelectionMode("rect");
                  setImageDraftPoints([]);
                }
                if (mode === "extension") {
                  setImageReferenceBackground(Boolean(world.map.background_image));
                }
              }}
              onSelectionMode={(mode) => {
                setImageSelectionMode(mode);
                setImageDraftPoints([]);
              }}
              onAspectPreset={setImageAspectPreset}
              onPrompt={setImagePrompt}
              onReferenceBackground={setImageReferenceBackground}
              onCreateNewLayer={setImageCreateNewLayer}
              onGenerate={() => void generateImageFromPanel()}
              onUndoPoint={() => setImageDraftPoints((points) => points.slice(0, -1))}
              onClearSelection={() => setImageDraftPoints([])}
            />
          ) : null}
          {panel.id === "agents" ? (
            <AgentPanel
              world={world}
              selection={selection}
              onSelect={setSelection}
              onLocateAgent={locateAgent}
              onRenameAgent={(agentId, name) => void updateAgentProfile(agentId, { name })}
              onUpdateAgent={(agentId, patch) => void updateAgentProfile(agentId, patch)}
              onCreateAgent={(name, role, point) => void createAgent(name, role, point)}
              onRefresh={() => void refreshWorld()}
            />
          ) : null}
          {panel.id === "models" ? (
            <ModelManagerPanel
              models={models}
              statuses={modelCapabilityStatuses}
              tasks={modelCapabilityTasks}
              onRefresh={() => void refreshModelCapabilities()}
              onConfigureLocal={(capability) => void configureLocalModelCapability(capability)}
              onInstallLocal={(capability) => void installLocalModelCapability(capability)}
              onConfigureRemote={(capability, draft) => void configureRemoteModelCapability(capability, draft)}
              onFetchRemoteModels={loadRemoteModelsForCapability}
              onTestRemote={testRemoteModelCapability}
            />
          ) : null}
          {panel.id === "runtimeMonitor" ? (
            <RuntimeMonitorPanel
              status={runtimeStatus}
              stale={runtimeStatusStale}
              onRefresh={() => void refreshRuntimeStatus()}
            />
          ) : null}
          {panel.id === "mapStudio" ? (
            <MapStudioPanel
              world={world}
              models={models}
              activeStep={mapStudioStep}
              activeRegionId={activeRegionId}
              selection={selection}
              generation={generation}
              segmentation={segmentation}
              onGenerate={(prompt, width, height, ratio) => void generateMap(prompt, width, height, ratio)}
              onSetFrame={(width, height) => void updateMapPatch({ width, height })}
              onUploadMap={(file) => void handleUpload(file)}
              onSelectCandidate={(candidateId) => void selectMapCandidate(candidateId)}
              onSegment={() => void runMapSegmentation()}
              onSelect={selectFromWorld}
              onActivateRegion={activateRegion}
              onActiveStepChange={setMapStudioStep}
              onUpdateRegion={(regionId, patch) => void updateRegion(regionId, patch)}
              onRegenerateRegion={(regionId, prompt) => void regenerateRegion(regionId, prompt)}
            />
          ) : null}
          {panel.id === "properties" ? (
            <PropertiesPanel
              world={world}
              selection={selection}
              canvasPoints={canvasPoints}
              generation={generation}
              segmentation={segmentation}
              onUpdateMap={(patch) => void updateMapPatch(patch)}
              onUpdateAgent={(agentId, patch) => void updateAgentProfile(agentId, patch)}
              onUpdateItem={(itemId, patch) => void updateItemPatch(itemId, patch)}
              onUpdateImageLayer={(layerId, patch) => void updateImageLayer(layerId, patch)}
              onRepaintImageLayer={(layerId) => {
                const layer = world.map.image_layers.find((candidate) => candidate.id === layerId);
                setSelection({ kind: "imageLayer", id: layerId });
                setImagePrompt(layer?.prompt ?? "");
                openImageGeneration("repaint");
              }}
              onUploadItemImage={(itemId, file) => void uploadItemImage(itemId, file)}
              onUpdateRegion={(regionId, patch) => void updateRegion(regionId, patch)}
              onRegenerateRegion={(regionId, prompt) => void regenerateRegion(regionId, prompt)}
            />
          ) : null}
        </FloatingPanel>
      ))}
    </main>
  );
}

function ObjectContextMenu({
  menu,
  target,
  onClose,
  onDelete,
  onHidden
}: {
  menu: ObjectMenuState;
  target: { name: string; hidden: boolean; label: string } | null;
  onClose: () => void;
  onDelete: () => void;
  onHidden: (hidden: boolean) => void;
}) {
  const hidden = Boolean(target?.hidden);
  return (
    <div
      className="object-context-menu"
      data-testid="object-context-menu"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: menu.x, top: menu.y }}
    >
      <div className="context-menu-heading">
        <span>{target?.name ?? "对象"}</span>
        <small>{target?.label ?? objectKindLabel(menu.kind)}</small>
      </div>
      <button onClick={() => onHidden(!hidden)}>{hidden ? "显示" : "隐藏"}</button>
      <button className="danger" onClick={onDelete}>删除</button>
      <button onClick={onClose}>取消</button>
    </div>
  );
}

function objectMenuTarget(world: WorldSnapshot, menu: ObjectMenuTarget) {
  if (menu.kind === "agent") {
    const agent = world.agent_profiles[menu.id];
    return agent ? { name: agent.name, hidden: agent.hidden, label: "Agent" } : null;
  }
  if (menu.kind === "item") {
    const item = world.map.items.find((candidate) => candidate.id === menu.id);
    return item ? { name: item.name, hidden: item.hidden, label: "元素" } : null;
  }
  if (menu.kind === "imageLayer") {
    const layer = world.map.image_layers.find((candidate) => candidate.id === menu.id);
    return layer ? { name: layer.name, hidden: layer.hidden, label: layer.kind === "extension" ? "边缘延展图层" : "区域图层" } : null;
  }
  const region = world.map.regions.find((candidate) => candidate.id === menu.id);
  return region ? { name: region.name, hidden: region.hidden, label: "区域轮廓" } : null;
}

function objectKindLabel(kind: ObjectMenuTarget["kind"]) {
  const labels: Record<ObjectMenuTarget["kind"], string> = {
    agent: "Agent",
    item: "元素",
    imageLayer: "图像图层",
    region: "区域轮廓"
  };
  return labels[kind];
}

function createInitialPanels(): PanelState[] {
  const width = typeof window === "undefined" ? 1280 : window.innerWidth;
  const height = typeof window === "undefined" ? 820 : window.innerHeight;
  if (width < 560) {
    const panelWidth = Math.max(PANEL_MIN_WIDTH, width - PANEL_MARGIN * 2);
    const toolHeight = clamp(height - 420, 150, 280);
    let y = 84;
    const nextY = (panelHeight: number) => {
      const current = y;
      y += panelHeight + PANEL_GAP;
      return current;
    };
    return [
      makePanel("tools", "工具", PANEL_MARGIN, nextY(toolHeight), panelWidth, toolHeight, 44),
      makePanel("scene", "场景列表", PANEL_MARGIN, nextY(PANEL_MINIMIZED_HEIGHT), panelWidth, 220, 43, true),
      makePanel("agents", "Agent 面板", PANEL_MARGIN, nextY(PANEL_MINIMIZED_HEIGHT), panelWidth, 220, 42, true),
      makePanel("properties", "属性", PANEL_MARGIN, nextY(PANEL_MINIMIZED_HEIGHT), panelWidth, 240, 40, true),
      makePanel("regions", "区域", PANEL_MARGIN, nextY(PANEL_MINIMIZED_HEIGHT), panelWidth, 220, 46, true),
      makePanel("regionDraw", "区域绘制", PANEL_MARGIN, nextY(PANEL_MINIMIZED_HEIGHT), panelWidth, 220, 47, true),
      makePanel("imageGeneration", "图像生成", PANEL_MARGIN, nextY(PANEL_MINIMIZED_HEIGHT), panelWidth, 300, 50, true),
      makePanel("narrative", "场景叙事", PANEL_MARGIN, nextY(PANEL_MINIMIZED_HEIGHT), panelWidth, 260, 48, true),
      makePanel("mapStudio", "地图工作台", PANEL_MARGIN, nextY(PANEL_MINIMIZED_HEIGHT), panelWidth, 240, 45, true),
      makePanel("models", "模型管理", PANEL_MARGIN, nextY(PANEL_MINIMIZED_HEIGHT), panelWidth, 240, 41, true),
      makePanel("runtimeMonitor", "运行监控", PANEL_MARGIN, nextY(PANEL_MINIMIZED_HEIGHT), panelWidth, 260, 49, true)
    ].map(clampPanelToViewport);
  }
  if (width < 1120) {
    const left = PANEL_MARGIN;
    const rightWidth = Math.min(340, Math.max(250, Math.floor((width - PANEL_MARGIN * 3 - 104) / 2)));
    const midX = left + 104 + PANEL_GAP;
    const rightX = Math.min(width - rightWidth - PANEL_MARGIN, midX + rightWidth + PANEL_GAP);
    return [
      makePanel("tools", "工具", left, 96, 96, Math.min(480, height - 128), 44),
      makePanel("scene", "场景列表", midX, 96, rightWidth, 220, 43),
      makePanel("regions", "区域", midX, 324, rightWidth, 210, 46),
      makePanel("mapStudio", "地图工作台", midX, 542, rightWidth, 220, 45),
      makePanel("agents", "Agent 面板", rightX, 96, rightWidth, 220, 42),
      makePanel("properties", "属性", rightX, 324, rightWidth, 210, 40),
      makePanel("regionDraw", "区域绘制", rightX, 542, rightWidth, 220, 47),
      makePanel("imageGeneration", "图像生成", rightX, 770, rightWidth, 320, 50, true),
      makePanel("runtimeMonitor", "运行监控", rightX, 770, rightWidth, 260, 49),
      makePanel("narrative", "场景叙事", rightX, 1038, rightWidth, 220, 48, true),
      makePanel("models", "模型管理", rightX, 1266, rightWidth, 220, 41, true)
    ].map(clampPanelToViewport);
  }
  const top = 96;
  const left = 28;
  const leftPanelX = left + 108;
  const centerX = Math.max(452, Math.round((width - 360) / 2));
  const rightWidth = Math.min(344, Math.max(320, width - 936));
  const rightX = Math.max(centerX + 372, width - rightWidth - 28);
  return [
    makePanel("tools", "工具", left, top, 96, 520, 44),
    makePanel("scene", "场景列表", leftPanelX, top, 304, 260, 43),
    makePanel("regions", "区域", leftPanelX, top + 268, 304, 248, 46),
    makePanel("regionDraw", "区域绘制", centerX, top, 340, 248, 47),
    makePanel("imageGeneration", "图像生成", centerX, top + 260, 340, 332, 50, true),
    makePanel("mapStudio", "地图工作台", centerX, top + 260, 340, 260, 45),
    makePanel("models", "模型管理", centerX, top + 528, 360, Math.max(160, height - top - 544), 41),
    makePanel("agents", "Agent 面板", rightX, top, rightWidth, 260, 42),
    makePanel("properties", "属性", rightX, top + 268, rightWidth, 248, 40),
    makePanel("runtimeMonitor", "运行监控", rightX, top + 524, rightWidth, 292, 49),
    makePanel("narrative", "场景叙事", rightX, top + 824, rightWidth, Math.max(180, height - top - 840), 48, true)
  ].map(clampPanelToViewport);
}

function makePanel(
  id: PanelState["id"],
  title: string,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number,
  minimized = false
): PanelState {
  return { id, title, x, y, width, height, minimized, dockedTo: null, zIndex };
}

function runtimeMonitorPanelForViewport(zIndex: number): PanelState {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 820 : window.innerHeight;
  const width = clamp(Math.min(360, viewportWidth - PANEL_MARGIN * 2), PANEL_MIN_WIDTH, 360);
  const height = clamp(Math.min(320, viewportHeight - 132), PANEL_MIN_HEIGHT, 360);
  const x = Math.max(PANEL_MARGIN, viewportWidth - width - PANEL_MARGIN);
  const y = Math.min(112, Math.max(PANEL_MARGIN, viewportHeight - height - PANEL_MARGIN));
  return clampPanelToViewport(makePanel("runtimeMonitor", "运行监控", x, y, width, height, zIndex, false));
}

function imageGenerationPanelForViewport(zIndex: number): PanelState {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 820 : window.innerHeight;
  const width = clamp(Math.min(380, viewportWidth - PANEL_MARGIN * 2), 320, 420);
  const height = clamp(Math.min(420, viewportHeight - 132), 320, 460);
  const x = Math.max(PANEL_MARGIN, Math.round((viewportWidth - width) / 2));
  const y = Math.min(128, Math.max(PANEL_MARGIN, viewportHeight - height - PANEL_MARGIN));
  return clampPanelToViewport(makePanel("imageGeneration", "图像生成", x, y, width, height, zIndex, false));
}

function loadPanelLayout(defaultPanels: PanelState[]): PanelState[] {
  if (typeof window === "undefined") {
    return defaultPanels;
  }
  try {
    const raw = window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return defaultPanels;
    }
    const parsed = JSON.parse(raw) as { panels?: Partial<PanelState>[] } | Partial<PanelState>[];
    const savedPanels = Array.isArray(parsed) ? parsed : parsed.panels;
    if (!Array.isArray(savedPanels)) {
      return defaultPanels;
    }
    return defaultPanels.map((panel) => {
      const saved = savedPanels.find((candidate) => candidate.id === panel.id);
      if (!saved) {
        return clampPanelToViewport(panel);
      }
      return clampPanelToViewport({
        ...panel,
        x: safeNumber(saved.x, panel.x),
        y: safeNumber(saved.y, panel.y),
        width: safeNumber(saved.width, panel.width),
        height: safeNumber(saved.height, panel.height),
        minimized: Boolean(saved.minimized),
        dockedTo: typeof saved.dockedTo === "string" ? saved.dockedTo : null,
        zIndex: safeNumber(saved.zIndex, panel.zIndex)
      });
    });
  } catch {
    return defaultPanels;
  }
}

function savePanelLayout(panels: PanelState[]) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      PANEL_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        panels: panels.map((panel) => ({
          id: panel.id,
          x: panel.x,
          y: panel.y,
          width: panel.width,
          height: panel.height,
          minimized: panel.minimized,
          dockedTo: panel.dockedTo,
          zIndex: panel.zIndex
        }))
      })
    );
  } catch {
    // Layout persistence is a convenience; editor behavior should continue without storage.
  }
}

function clampPanelToViewport(panel: PanelState): PanelState {
  if (typeof window === "undefined") {
    return panel;
  }
  const nextWidth = clamp(panel.width, PANEL_MIN_WIDTH, Math.max(PANEL_MIN_WIDTH, window.innerWidth - PANEL_MARGIN * 2));
  const nextHeight = clamp(panel.height, PANEL_MIN_HEIGHT, Math.max(PANEL_MIN_HEIGHT, window.innerHeight - PANEL_MARGIN * 2));
  const visibleHeight = panel.minimized ? PANEL_MINIMIZED_HEIGHT : nextHeight;
  const nextX = clamp(panel.x, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerWidth - nextWidth - PANEL_MARGIN));
  const nextY = clamp(panel.y, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerHeight - visibleHeight - PANEL_MARGIN));
  return {
    ...panel,
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight
  };
}

function safeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function maxPanelZ(panels: PanelState[]) {
  return Math.max(40, ...panels.map((panel) => panel.zIndex));
}

function snapToTargets(active: PanelState, panels: PanelState[]): PanelState {
  let x = active.x;
  let y = active.y;
  const sourceX = active.x;
  const sourceY = active.y;
  let dockedTo: string | null = null;
  const activeHeight = panelVisibleHeight(active);
  let bestX = PANEL_SNAP_DISTANCE;
  let bestY = PANEL_SNAP_DISTANCE;

  const snapX = (targetX: number, label: string) => {
    const distance = Math.abs(sourceX - targetX);
    if (distance < bestX) {
      x = targetX;
      bestX = distance;
      dockedTo = label;
    }
  };
  const snapY = (targetY: number, label: string) => {
    const distance = Math.abs(sourceY - targetY);
    if (distance < bestY) {
      y = targetY;
      bestY = distance;
      dockedTo = label;
    }
  };

  const viewport = {
    left: PANEL_MARGIN,
    top: PANEL_MARGIN,
    right: window.innerWidth - PANEL_MARGIN,
    bottom: window.innerHeight - PANEL_MARGIN
  };

  snapX(viewport.left, "screen:left");
  snapX(viewport.right - active.width, "screen:right");
  snapY(viewport.top, "screen:top");
  snapY(viewport.bottom - activeHeight, "screen:bottom");

  for (const panel of panels) {
    if (panel.id === active.id) {
      continue;
    }
    const panelHeight = panelVisibleHeight(panel);
    const verticalOverlap = rangesOverlap(y, y + activeHeight, panel.y, panel.y + panelHeight, PANEL_SNAP_DISTANCE);
    const horizontalOverlap = rangesOverlap(x, x + active.width, panel.x, panel.x + panel.width, PANEL_SNAP_DISTANCE);

    if (verticalOverlap) {
      snapX(panel.x + panel.width + PANEL_GAP, `panel:${panel.id}:right`);
      snapX(panel.x - active.width - PANEL_GAP, `panel:${panel.id}:left`);
      snapX(panel.x, `panel:${panel.id}:left-align`);
      snapX(panel.x + panel.width - active.width, `panel:${panel.id}:right-align`);
    }
    if (horizontalOverlap) {
      snapY(panel.y + panelHeight + PANEL_GAP, `panel:${panel.id}:bottom`);
      snapY(panel.y - activeHeight - PANEL_GAP, `panel:${panel.id}:top`);
      snapY(panel.y, `panel:${panel.id}:top-align`);
      snapY(panel.y + panelHeight - activeHeight, `panel:${panel.id}:bottom-align`);
    }
  }

  return clampPanelToViewport({
    ...active,
    x,
    y,
    dockedTo
  });
}

function panelVisibleHeight(panel: PanelState) {
  return panel.minimized ? PANEL_MINIMIZED_HEIGHT : panel.height;
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number, tolerance = 0) {
  return startA <= endB + tolerance && startB <= endA + tolerance;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function applyItemPatch(world: WorldSnapshot, itemId: string, patch: Partial<Omit<WorldItem, "id">>): WorldSnapshot {
  return {
    ...world,
    map: {
      ...world.map,
      items: world.map.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
    }
  };
}

function applyImageLayerPatch(world: WorldSnapshot, layerId: string, patch: ImageLayerPatch): WorldSnapshot {
  return {
    ...world,
    map: {
      ...world.map,
      image_layers: world.map.image_layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer))
    }
  };
}

function imageSelectionFromDraft(points: Point[]): ImageSelectionPayload | null {
  if (points.length === 2) {
    const [first, second] = points;
    const x = Math.min(first.x, second.x);
    const y = Math.min(first.y, second.y);
    const width = Math.abs(second.x - first.x);
    const height = Math.abs(second.y - first.y);
    if (width < 1 || height < 1) {
      return null;
    }
    return {
      type: "rect" as const,
      x,
      y,
      width,
      height
    };
  }
  if (points.length >= 3) {
    return { type: "polygon" as const, points };
  }
  return null;
}

function imageSelectionFromTarget(mode: ImageGenerationMode, layer: MapImageLayer | null, region: MapRegion | null): ImageSelectionPayload | null {
  if (mode !== "repaint") {
    return null;
  }
  if (layer) {
    return {
      type: "rect",
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height
    };
  }
  if (region && region.points.length >= 3) {
    return { type: "polygon", points: region.points };
  }
  return null;
}

function imageAspectRatioForPreset(preset: ImageAspectPreset, mapWidth: number, mapHeight: number) {
  if (preset === "4:3") {
    return 4 / 3;
  }
  if (preset === "16:9") {
    return 16 / 9;
  }
  if (preset === "map") {
    return mapHeight > 0 ? mapWidth / mapHeight : 1;
  }
  return 1;
}

function imageModeRunningText(mode: ImageGenerationMode) {
  if (mode === "extension") {
    return "正在生成边缘延展图层";
  }
  if (mode === "repaint") {
    return "正在重绘图层";
  }
  return "正在生成区域图层";
}

function imageModeDoneText(mode: ImageGenerationMode) {
  if (mode === "extension") {
    return "边缘延展图层已生成";
  }
  if (mode === "repaint") {
    return "图层已重绘";
  }
  return "区域图层已生成";
}

function applyRegionPatch(world: WorldSnapshot, regionId: string, patch: Partial<Omit<MapRegion, "id" | "points" | "source">>): WorldSnapshot {
  return {
    ...world,
    map: syncFunctionalRegions({
      ...world.map,
      regions: world.map.regions.map((region) => (region.id === regionId ? { ...region, ...patch } : region))
    })
  };
}

function deleteAgentLocal(world: WorldSnapshot, agentId: string): WorldSnapshot {
  const { [agentId]: _profile, ...agentProfiles } = world.agent_profiles;
  const { [agentId]: _state, ...agentStates } = world.agent_states;
  return {
    ...world,
    agent_profiles: agentProfiles,
    agent_states: agentStates,
    relationships: world.relationships.filter((relationship) => relationship.from_agent !== agentId && relationship.to_agent !== agentId),
    memories: world.memories.filter((memory) => memory.agent_id !== agentId)
  };
}

function deleteItemLocal(world: WorldSnapshot, itemId: string): WorldSnapshot {
  return {
    ...world,
    map: {
      ...world.map,
      items: world.map.items.filter((item) => item.id !== itemId)
    }
  };
}

function deleteRegionLocal(world: WorldSnapshot, regionId: string): WorldSnapshot {
  return {
    ...world,
    map: syncFunctionalRegions({
      ...world.map,
      regions: world.map.regions.filter((region) => region.id !== regionId)
    })
  };
}

function mapPrompt(prompt: string, width: number, height: number, ratio: MapRatioPreset) {
  return [
    "生成稳定的 2D 游戏背景图，俯视或轻等距视角，无文字，无 UI，无角色，边界清晰，适合后续 SAM 分区。",
    "需要包含可识别道路、不可穿过结构、潜在居住区、社交区和自定义兴趣点。",
    `地图比例：${ratio}；目标尺寸：${width} x ${height} 像素。`,
    `用户需求：${prompt}`
  ].join("\n");
}

function enabledModelForCapability(models: ModelConfig[], capability: ModelConfig["capabilities"][number]) {
  const matching = models.filter((model) => model.enabled && model.capabilities.includes(capability));
  if (capability === "image_generation") {
    return matching.find((model) => model.provider !== "mock") ?? null;
  }
  if (capability === "segmentation") {
    return matching.find((model) => model.provider === "embedded-mobile-sam") ?? matching[0] ?? null;
  }
  return matching[0] ?? null;
}

function regionFunctionLabel(value: MapRegionFunction) {
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

function mergeCapabilityStatus(statuses: ModelCapabilityStatus[], next: ModelCapabilityStatus): ModelCapabilityStatus[] {
  const hasExisting = statuses.some((status) => status.id === next.id);
  if (!hasExisting) {
    return [...statuses, next];
  }
  return statuses.map((status) => (status.id === next.id ? next : status));
}

function createLocalGeneration(prompt: string, width: number, height: number, ratio: MapRatioPreset): MapGenerationState {
  const id = makeId("local_gen");
  return {
    id,
    status: "done",
    prompt,
    ratio,
    width,
    height,
    provider_id: "model_mock_image",
    selected_candidate_id: null,
    candidates: [0, 1, 2].map((index) => {
      const hue = (index * 68 + prompt.length * 5) % 360;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="hsl(${hue}, 34%, 82%)"/>
            <stop offset="1" stop-color="hsl(${(hue + 88) % 360}, 32%, 64%)"/>
          </linearGradient>
          <pattern id="grid" width="96" height="96" patternUnits="userSpaceOnUse">
            <path d="M0 0H96V96H0Z" fill="none" stroke="rgba(20,20,20,.13)" stroke-width="2"/>
            <path d="M0 48H96M48 0V96" stroke="rgba(255,255,255,.22)" stroke-width="1"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg)"/>
        <rect width="100%" height="100%" fill="url(#grid)" opacity=".78"/>
        <path d="M${width * 0.07} ${height * 0.62} C ${width * 0.28} ${height * 0.44}, ${width * 0.55} ${height * 0.72}, ${width * 0.9} ${height * 0.42}" fill="none" stroke="rgba(36,36,36,.38)" stroke-width="${Math.max(18, width * 0.018)}" stroke-linecap="round"/>
        <rect x="${width * 0.1}" y="${height * 0.12}" width="${width * 0.24}" height="${height * 0.24}" rx="18" fill="rgba(255,255,255,.24)" stroke="rgba(20,20,20,.22)" stroke-width="4"/>
        <rect x="${width * 0.62}" y="${height * 0.16}" width="${width * 0.25}" height="${height * 0.28}" rx="22" fill="rgba(255,255,255,.2)" stroke="rgba(20,20,20,.2)" stroke-width="4"/>
        <circle cx="${width * 0.46}" cy="${height * 0.36}" r="${Math.min(width, height) * 0.09}" fill="rgba(255,255,255,.18)" stroke="rgba(20,20,20,.18)" stroke-width="4"/>
      </svg>`;
      return {
        id: `${id}_candidate_${index + 1}`,
        url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        prompt,
        width,
        height,
        provider_id: "model_mock_image"
      };
    })
  };
}

function createLocalRegions(width: number, height: number): MapRegion[] {
  return [
    {
      id: makeId("region"),
      name: "主道路",
      function: "walkable",
      source: "local_mock_sam",
      holes: [],
      points: [
        { x: width * 0.06, y: height * 0.58 },
        { x: width * 0.28, y: height * 0.47 },
        { x: width * 0.54, y: height * 0.62 },
        { x: width * 0.9, y: height * 0.38 },
        { x: width * 0.93, y: height * 0.48 },
        { x: width * 0.55, y: height * 0.74 },
        { x: width * 0.28, y: height * 0.58 },
        { x: width * 0.08, y: height * 0.69 }
      ],
      image_prompt: "",
      notes: "本地 mock 识别为主要移动路径。",
      confidence: 0.86,
      tags: ["道路", "移动"],
      hidden: false
    },
    {
      id: makeId("region"),
      name: "左上居住区",
      function: "residential",
      source: "local_mock_sam",
      holes: [],
      points: [
        { x: width * 0.1, y: height * 0.12 },
        { x: width * 0.34, y: height * 0.12 },
        { x: width * 0.34, y: height * 0.36 },
        { x: width * 0.1, y: height * 0.36 }
      ],
      image_prompt: "",
      notes: "适合放置 agent 起居和身份相关物件。",
      confidence: 0.78,
      tags: ["居住"],
      hidden: false
    },
    {
      id: makeId("region"),
      name: "右侧社交广场",
      function: "social",
      source: "local_mock_sam",
      holes: [],
      points: [
        { x: width * 0.62, y: height * 0.16 },
        { x: width * 0.87, y: height * 0.16 },
        { x: width * 0.87, y: height * 0.44 },
        { x: width * 0.62, y: height * 0.44 }
      ],
      image_prompt: "",
      notes: "开放区域，适合社交、对话和公共事件。",
      confidence: 0.82,
      tags: ["社交", "公共"],
      hidden: false
    },
    {
      id: makeId("region"),
      name: "中心景观障碍",
      function: "obstacle",
      source: "local_mock_sam",
      holes: [],
      points: [
        { x: width * 0.41, y: height * 0.28 },
        { x: width * 0.51, y: height * 0.28 },
        { x: width * 0.56, y: height * 0.37 },
        { x: width * 0.5, y: height * 0.47 },
        { x: width * 0.4, y: height * 0.45 },
        { x: width * 0.36, y: height * 0.36 }
      ],
      image_prompt: "",
      notes: "中心实体结构，默认不可穿过。",
      confidence: 0.8,
      tags: ["障碍"],
      hidden: false
    }
  ];
}

function syncFunctionalRegions(map: WorldMap): WorldMap {
  const walkable_areas: PolygonArea[] = [];
  const obstacles: PolygonArea[] = [];
  const interaction_zones: PolygonArea[] = [];
  for (const region of map.regions) {
    if (region.hidden) {
      continue;
    }
    const area = regionToArea(region);
    if (!area) {
      continue;
    }
    if (region.function === "walkable" || region.function === "action") {
      walkable_areas.push(area);
    } else if (region.function === "obstacle") {
      obstacles.push(area);
    } else if (region.function === "social") {
      interaction_zones.push(area);
    }
  }
  return { ...map, walkable_areas, obstacles, interaction_zones, region_layers: buildFallbackRegionLayers(map.regions) };
}

function regionToArea(region: MapRegion): PolygonArea | null {
  if (!["walkable", "action", "obstacle", "social"].includes(region.function)) {
    return null;
  }
  return {
    id: `area_${region.id}`,
    name: region.name,
    kind: region.function === "social" ? "zone" : region.function === "action" ? "walkable" : region.function,
    points: region.points,
    holes: region.holes,
    metadata: {
      generated: true,
      region_id: region.id,
      function: region.function,
      source: region.source,
      notes: region.notes
    }
  };
}

function buildFallbackRegionLayers(regions: MapRegion[]): WorldMap["region_layers"] {
  const labels: Record<MapRegionFunction, string> = {
    walkable: "道路",
    obstacle: "不可通过",
    action: "行动区",
    residential: "居住区",
    social: "社交区",
    custom: "自定义",
    unassigned: "未设定"
  };
  return (Object.keys(labels) as MapRegionFunction[]).map((fn) => {
    const matches = regions.filter((region) => region.function === fn && !region.hidden);
    return {
      function: fn,
      label: labels[fn],
      region_ids: matches.map((region) => region.id),
      polygons: matches.map((region) => ({ points: region.points, holes: region.holes ?? [] }))
    };
  });
}

type PendingState = {
  mapPatch: MapPatch;
  agentPatches: Record<string, AgentPatch>;
  itemPatches: Record<string, ItemPatch>;
  localItems: Record<string, WorldItem>;
};

function pendingState(
  mapPatchRef: { current: MapPatch },
  agentPatchRef: { current: Record<string, AgentPatch> },
  itemPatchRef: { current: Record<string, ItemPatch> },
  localItemsRef: { current: Record<string, WorldItem> }
): PendingState {
  return {
    mapPatch: mapPatchRef.current,
    agentPatches: agentPatchRef.current,
    itemPatches: itemPatchRef.current,
    localItems: localItemsRef.current
  };
}

function mergeSnapshotWithLocalState(snapshot: WorldSnapshot, pending: PendingState): WorldSnapshot {
  const withMapPatch = Object.keys(pending.mapPatch).length
    ? { ...snapshot, map: { ...snapshot.map, ...pending.mapPatch } }
    : snapshot;
  const withAgentPatches = Object.entries(pending.agentPatches).reduce((current, [agentId, patch]) => {
    const profile = current.agent_profiles[agentId];
    if (!profile) {
      return current;
    }
    return {
      ...current,
      agent_profiles: {
        ...current.agent_profiles,
        [agentId]: { ...profile, ...patch }
      }
    };
  }, withMapPatch);
  const withLocalItems = Object.values(pending.localItems).reduce((current, item) => {
    if (current.map.items.some((existing) => existing.id === item.id)) {
      return current;
    }
    return {
      ...current,
      map: {
        ...current.map,
        items: [...current.map.items, item]
      }
    };
  }, withAgentPatches);
  return Object.entries(pending.itemPatches).reduce(
    (current, [itemId, patch]) => applyItemPatch(current, itemId, patch),
    withLocalItems
  );
}

function setPendingItemPatch(ref: { current: Record<string, ItemPatch> }, itemId: string, patch: ItemPatch) {
  ref.current = {
    ...ref.current,
    [itemId]: {
      ...ref.current[itemId],
      ...patch
    }
  };
}

function setPendingMapPatch(ref: { current: MapPatch }, patch: MapPatch) {
  ref.current = {
    ...ref.current,
    ...patch
  };
}

function clearPendingMapPatch(ref: { current: MapPatch }, patch: MapPatch) {
  const next = { ...ref.current };
  for (const key of Object.keys(patch) as (keyof MapPatch)[]) {
    delete next[key];
  }
  ref.current = next;
}

function setPendingAgentPatch(ref: { current: Record<string, AgentPatch> }, agentId: string, patch: AgentPatch) {
  ref.current = {
    ...ref.current,
    [agentId]: {
      ...ref.current[agentId],
      ...patch
    }
  };
}

function clearPendingAgentPatch(ref: { current: Record<string, AgentPatch> }, agentId: string, patch: AgentPatch) {
  const currentPatch = ref.current[agentId];
  if (!currentPatch) {
    return;
  }
  const nextPatch = { ...currentPatch };
  for (const key of Object.keys(patch) as (keyof AgentPatch)[]) {
    delete nextPatch[key];
  }
  const next = { ...ref.current };
  if (Object.keys(nextPatch).length) {
    next[agentId] = nextPatch;
  } else {
    delete next[agentId];
  }
  ref.current = next;
}

function clearPendingItemPatch(ref: { current: Record<string, ItemPatch> }, itemId: string) {
  const next = { ...ref.current };
  delete next[itemId];
  ref.current = next;
}

function setPendingLocalItem(ref: { current: Record<string, WorldItem> }, item: WorldItem) {
  ref.current = {
    ...ref.current,
    [item.id]: item
  };
}

function clearPendingLocalItem(ref: { current: Record<string, WorldItem> }, itemId: string) {
  const next = { ...ref.current };
  delete next[itemId];
  ref.current = next;
}

function appBackgroundStyle(opacity: number) {
  return { "--app-background-opacity": opacity } as CSSProperties;
}
