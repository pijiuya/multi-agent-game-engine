import { useEffect, useMemo, useRef, useState } from "react";
import { AgentPanel } from "./components/AgentPanel";
import { FloatingPanel } from "./components/FloatingPanel";
import { MapStudioPanel } from "./components/MapStudioPanel";
import { ModelManagerPanel } from "./components/ModelManagerPanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
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
  createAgent as createAgentRemote,
  createMapGeneration,
  configureLocalCapability,
  configureRemoteCapability,
  getModelCapabilityTask,
  getModelCapabilityStatus,
  getWorld,
  getModels,
  idleSegmentation,
  installLocalCapability,
  patchAgent,
  patchMap,
  patchMapItem,
  patchMapRegion,
  postAction,
  normalizeWorldSnapshot,
  regenerateMapRegion,
  saveMap,
  segmentMap,
  selectGeneratedMap,
  setSimulation,
  tickSimulation,
  uploadAsset,
  uploadMapImage,
  wsUrl
} from "./lib/api";
import { addAgentLocal, addAreaToMap, addItemToMap, addSpawnToMap, makeId, moveAgentLocal } from "./lib/worldOps";
import type {
  AgentProfile,
  CanvasPoint,
  CanvasViewState,
  EditTool,
  MapGenerationState,
  MapRatioPreset,
  MapRegion,
  MapSegmentationState,
  ModelCapabilityId,
  ModelCapabilityStatus,
  ModelCapabilityTask,
  ModelConfig,
  PanelState,
  Point,
  PolygonArea,
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

type ItemPatch = Partial<Omit<WorldItem, "id">>;
type MapPatch = Partial<Pick<WorldMap, "name" | "width" | "height" | "background_image">>;
type AgentPatch = Partial<Omit<AgentProfile, "id">>;
const PANEL_LAYOUT_STORAGE_KEY = "agent-workstation.panel-layout.v1";

export default function App() {
  const [world, setWorld] = useState<WorldSnapshot | null>(null);
  const [selection, setSelection] = useState<SelectionState>({ kind: "map", id: "map_default" });
  const [editTool, setEditTool] = useState<EditTool>("select");
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [status, setStatus] = useState("载入中");
  const [appearanceMode, setAppearanceMode] = useState<"light" | "dark">("light");
  const [canvasView, setCanvasView] = useState<CanvasViewState>({
    zoom: 1,
    pan: { x: 0, y: 0 },
    fitMode: true
  });
  const [canvasPoints, setCanvasPoints] = useState<CanvasPoint[]>([]);
  const [anchorPoint, setAnchorPoint] = useState<Point | null>(null);
  const [anchorMenu, setAnchorMenu] = useState<AnchorMenuState | null>(null);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [modelCapabilityStatuses, setModelCapabilityStatuses] = useState<ModelCapabilityStatus[]>([]);
  const [modelCapabilityTasks, setModelCapabilityTasks] = useState<Partial<Record<ModelCapabilityId, ModelCapabilityTask>>>({});
  const [generation, setGeneration] = useState<MapGenerationState | null>(null);
  const [segmentation, setSegmentation] = useState<MapSegmentationState>(() => idleSegmentation());
  const [panels, setPanels] = useState<PanelState[]>(() => loadPanelLayout(createInitialPanels()));
  const [zCursor, setZCursor] = useState(() => maxPanelZ(loadPanelLayout(createInitialPanels())));
  const pendingMapPatchRef = useRef<MapPatch>({});
  const pendingAgentPatchesRef = useRef<Record<string, AgentPatch>>({});
  const pendingItemPatchesRef = useRef<Record<string, ItemPatch>>({});
  const pendingLocalItemsRef = useRef<Record<string, WorldItem>>({});

  const selectedAgentId = selection.kind === "agent" ? selection.id : null;
  const selectedAgentExists = useMemo(() => {
    if (!world || !selectedAgentId) {
      return false;
    }
    return Boolean(world.agent_profiles[selectedAgentId]);
  }, [world, selectedAgentId]);

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
    if (selection.kind === "region" && !world.map.regions.some((region) => region.id === selection.id)) {
      setSelection({ kind: "map", id: world.map.id });
    }
    if (selection.kind === "point" && !canvasPoints.some((point) => point.id === selection.id)) {
      setSelection({ kind: "map", id: world.map.id });
    }
  }, [canvasPoints, selection, selectedAgentExists, world]);

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
    if (editTool === "anchor") {
      const snapped = snapWorldPointToGrid(point, canvasView.zoom);
      setAnchorPoint(snapped);
      return;
    }
    if (editTool === "select") {
      setSelection({ kind: "map", id: world.map.id });
      return;
    }
    if (editTool === "walkable" || editTool === "obstacle" || editTool === "zone") {
      setDraftPoints((points) => [...points, snapWorldPointToGrid(point, canvasView.zoom)]);
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
    if (!world || draftPoints.length < 3) {
      return;
    }
    const map = addAreaToMap(world.map, editTool, draftPoints);
    setWorld({ ...world, map });
    const snapshot = await saveMap(map);
    if (snapshot) {
      setWorld(snapshot);
    }
    setDraftPoints([]);
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
    setAnchorPoint(point);
    setAnchorMenu({ x: screen.x, y: screen.y, point });
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

  async function generateMap(prompt: string, width = 1920, height = 1080, ratio: MapRatioPreset = "16:9") {
    if (!world) {
      return;
    }
    const fullPrompt = mapPrompt(prompt, width, height, ratio);
    setSegmentation(idleSegmentation());
    await updateMapPatch({ width, height });
    const task = await createMapGeneration({ prompt: fullPrompt, width, height, ratio, count: 3 });
    if (task) {
      setGeneration(task);
      setStatus("背景候选已生成");
    } else {
      setGeneration(createLocalGeneration(fullPrompt, width, height, ratio));
      setStatus("本地背景候选已生成");
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
          ? { kind: "region", id: result.world.map.regions[0].id }
          : { kind: "map", id: result.world.map.id }
      );
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
        setSelection(nextMap.regions[0] ? { kind: "region", id: nextMap.regions[0].id } : { kind: "map", id: nextMap.id });
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
      setStatus("区域重绘提示已保存");
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

  async function installLocalModelCapability(capability: ModelCapabilityId) {
    const optimisticTask: ModelCapabilityTask = {
      id: makeId("local_model_task"),
      capability,
      title: capability === "segmentation" ? "安装并启用内置 MobileSAM" : "安装本地模型",
      status: "running",
      stage: "connecting",
      progress: 4,
      message: "正在连接本机引擎并启动安装",
      error: null
    };
    setModelCapabilityTasks((current) => ({ ...current, [capability]: optimisticTask }));
    setStatus("正在启动内置模型安装");
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
    setStatus(result.task.message || "内置模型安装中");
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
      setStatus(task.message || "内置模型安装中");
      if (task.status === "done") {
        await refreshModels();
        await refreshModelCapabilities();
        setStatus("内置 MobileSAM 已启用");
        return;
      }
      if (task.status === "error") {
        await refreshModelCapabilities();
        setStatus(task.error || "内置模型安装失败");
        return;
      }
    }
    setStatus("内置模型安装仍在进行，请稍后重新检测");
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
      current.map((panel) =>
        panel.id === id
          ? {
              ...panel,
              x: clamp(x, 16, Math.max(16, window.innerWidth - panel.width - 16)),
              y: clamp(y, 16, Math.max(16, window.innerHeight - 44)),
              dockedTo: null
            }
          : panel
      )
    );
  }

  function resizePanel(id: PanelState["id"], x: number, y: number, width: number, height: number) {
    const minWidth = 92;
    const minHeight = 120;
    setPanels((current) =>
      current.map((panel) => {
        if (panel.id !== id) {
          return panel;
        }
        const nextX = clamp(x, 16, Math.max(16, window.innerWidth - minWidth - 16));
        const nextY = clamp(y, 16, Math.max(16, window.innerHeight - 44));
        const nextWidth = clamp(width, minWidth, Math.max(minWidth, window.innerWidth - nextX - 16));
        const nextHeight = clamp(height, minHeight, Math.max(minHeight, window.innerHeight - nextY - 16));
        return {
          ...panel,
          x: nextX,
          y: nextY,
          width: nextWidth,
          height: nextHeight,
          dockedTo: null
        };
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

  function setZoom(direction: 1 | -1) {
    setCanvasView((view) => ({
      ...view,
      zoom: clamp(view.zoom * (direction > 0 ? 1.18 : 0.82), 0.125, 8),
      fitMode: false
    }));
  }

  if (!world) {
    return (
      <main className={`desktop-workspace tone-${appearanceMode} loading`}>
        <div className="loader" />
      </main>
    );
  }

  return (
    <main className={`desktop-workspace tone-${appearanceMode}`}>
      <SceneViewport
        world={world}
        editTool={editTool}
        canvasView={canvasView}
        selection={selection}
        canvasPoints={canvasPoints}
        anchorPoint={anchorPoint}
        status={status}
        onViewChange={setCanvasView}
        onWorldPoint={(point) => void handleWorldClick(point)}
        onSelect={setSelection}
        onAnchorContext={openAnchorMenu}
        draftPoints={draftPoints}
        onRenameAgent={(agentId, name) => void updateAgentProfile(agentId, { name })}
        onPreviewItem={previewItemPatch}
        onCommitItem={(itemId, patch) => void updateItemPatch(itemId, patch)}
      />

      <TransportControls
        running={world.running}
        onRun={() => void setSimulationRunning(true)}
        onPause={() => void setSimulationRunning(false)}
        onStop={() => void setSimulationRunning(false, true)}
        onCenterOrigin={() => centerOnWorldPoint(ORIGIN_POINT)}
        appearanceMode={appearanceMode}
        onToggleAppearance={() => setAppearanceMode((mode) => (mode === "light" ? "dark" : "light"))}
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
              draftCount={draftPoints.length}
              zoomPercent={Math.round(canvasView.zoom * 100)}
              onEditTool={(tool) => {
                setEditTool(tool);
                if (tool !== "walkable" && tool !== "obstacle" && tool !== "zone") {
                  setDraftPoints([]);
                }
              }}
              onStep={() => void handleStep()}
              onSave={() => void handleSave()}
              onZoom={setZoom}
              onFit={() => setCanvasView({ zoom: 1, pan: { x: 0, y: 0 }, fitMode: true })}
              onFinalizePolygon={() => void finalizePolygon()}
              onClearDraft={() => setDraftPoints([])}
              onUpload={(file) => void handleUpload(file)}
            />
          ) : null}
          {panel.id === "scene" ? (
            <SceneElementsPanel world={world} selection={selection} canvasPoints={canvasPoints} onSelect={setSelection} />
          ) : null}
          {panel.id === "agents" ? (
            <AgentPanel
              world={world}
              selection={selection}
              onSelect={setSelection}
              onLocateAgent={locateAgent}
              onRenameAgent={(agentId, name) => void updateAgentProfile(agentId, { name })}
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
            />
          ) : null}
          {panel.id === "mapStudio" ? (
            <MapStudioPanel
              world={world}
              models={models}
              selection={selection}
              generation={generation}
              segmentation={segmentation}
              onGenerate={(prompt, width, height, ratio) => void generateMap(prompt, width, height, ratio)}
              onSetFrame={(width, height) => void updateMapPatch({ width, height })}
              onUploadMap={(file) => void handleUpload(file)}
              onSelectCandidate={(candidateId) => void selectMapCandidate(candidateId)}
              onSegment={() => void runMapSegmentation()}
              onSelect={setSelection}
              onUpdateRegion={(regionId, patch) => void updateRegion(regionId, patch)}
              onRegenerateRegion={(regionId, prompt) => void regenerateRegion(regionId, prompt)}
              onAutoLabelRegion={(regionId) => void autoLabelRegion(regionId)}
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

function createInitialPanels(): PanelState[] {
  const width = typeof window === "undefined" ? 1280 : window.innerWidth;
  const height = typeof window === "undefined" ? 820 : window.innerHeight;
  if (width < 760) {
    return [
      makePanel("tools", "工具", 16, 84, 96, 552, 44),
      makePanel("scene", "场景列表", 16, 282, Math.min(340, width - 32), 220, 43),
      makePanel("agents", "Agent 面板", 16, 522, Math.min(340, width - 32), 220, 42),
      makePanel("mapStudio", "地图工作台", 16, Math.max(684, height - 152), Math.min(340, width - 32), 280, 45),
      makePanel("models", "模型管理", 16, Math.max(704, height - 152), Math.min(340, width - 32), 280, 41),
      makePanel("properties", "属性", 16, Math.max(724, height - 152), Math.min(340, width - 32), 240, 40)
    ];
  }
  return [
    makePanel("tools", "工具", 42, 126, 96, 552, 44),
    makePanel("scene", "场景列表", 42, 348, 304, 340, 43),
    makePanel("agents", "Agent 面板", Math.max(380, width - 388), 92, 340, 316, 42),
    makePanel("mapStudio", "地图工作台", 154, Math.max(500, height - 312), 340, 296, 45),
    makePanel("models", "模型管理", 520, Math.max(500, height - 312), 360, 296, 41),
    makePanel("properties", "属性", Math.max(380, width - 408), Math.max(440, height - 330), 360, 276, 40)
  ];
}

function makePanel(
  id: PanelState["id"],
  title: string,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number
): PanelState {
  return { id, title, x, y, width, height, minimized: false, dockedTo: null, zIndex };
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
  const minWidth = 92;
  const minHeight = 120;
  const nextX = clamp(panel.x, 16, Math.max(16, window.innerWidth - minWidth - 16));
  const nextY = clamp(panel.y, 16, Math.max(16, window.innerHeight - 44));
  const nextWidth = clamp(panel.width, minWidth, Math.max(minWidth, window.innerWidth - nextX - 16));
  const nextHeight = clamp(panel.height, minHeight, Math.max(minHeight, window.innerHeight - nextY - 16));
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
  const snap = 20;
  let x = active.x;
  let y = active.y;
  let dockedTo: string | null = null;
  const scene = {
    left: 28,
    top: 28,
    right: window.innerWidth - 28,
    bottom: window.innerHeight - 28
  };

  if (Math.abs(x - scene.left) < snap) {
    x = scene.left;
    dockedTo = "scene-left";
  }
  if (Math.abs(y - scene.top) < snap) {
    y = scene.top;
    dockedTo = "scene-top";
  }
  if (Math.abs(x + active.width - scene.right) < snap) {
    x = scene.right - active.width;
    dockedTo = "scene-right";
  }
  if (Math.abs(y + 40 - scene.bottom) < snap) {
    y = scene.bottom - 40;
    dockedTo = "scene-bottom";
  }

  for (const panel of panels) {
    if (panel.id === active.id) {
      continue;
    }
    if (Math.abs(x - (panel.x + panel.width + 8)) < snap) {
      x = panel.x + panel.width + 8;
      dockedTo = panel.id;
    }
    if (Math.abs(x + active.width + 8 - panel.x) < snap) {
      x = panel.x - active.width - 8;
      dockedTo = panel.id;
    }
    if (Math.abs(y - (panel.y + 40)) < snap) {
      y = panel.y + 40;
      dockedTo = panel.id;
    }
  }

  return {
    ...active,
    x: clamp(x, 16, Math.max(16, window.innerWidth - active.width - 16)),
    y: clamp(y, 16, Math.max(16, window.innerHeight - 44)),
    dockedTo
  };
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

function applyRegionPatch(world: WorldSnapshot, regionId: string, patch: Partial<Omit<MapRegion, "id" | "points" | "source">>): WorldSnapshot {
  return {
    ...world,
    map: syncFunctionalRegions({
      ...world.map,
      regions: world.map.regions.map((region) => (region.id === regionId ? { ...region, ...patch } : region))
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
  if (capability === "segmentation") {
    return matching.find((model) => model.provider === "embedded-mobile-sam") ?? matching[0] ?? null;
  }
  return matching[0] ?? null;
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
      tags: ["道路", "移动"]
    },
    {
      id: makeId("region"),
      name: "左上居住区",
      function: "residential",
      source: "local_mock_sam",
      points: [
        { x: width * 0.1, y: height * 0.12 },
        { x: width * 0.34, y: height * 0.12 },
        { x: width * 0.34, y: height * 0.36 },
        { x: width * 0.1, y: height * 0.36 }
      ],
      image_prompt: "",
      notes: "适合放置 agent 起居和身份相关物件。",
      confidence: 0.78,
      tags: ["居住"]
    },
    {
      id: makeId("region"),
      name: "右侧社交广场",
      function: "social",
      source: "local_mock_sam",
      points: [
        { x: width * 0.62, y: height * 0.16 },
        { x: width * 0.87, y: height * 0.16 },
        { x: width * 0.87, y: height * 0.44 },
        { x: width * 0.62, y: height * 0.44 }
      ],
      image_prompt: "",
      notes: "开放区域，适合社交、对话和公共事件。",
      confidence: 0.82,
      tags: ["社交", "公共"]
    },
    {
      id: makeId("region"),
      name: "中心景观障碍",
      function: "obstacle",
      source: "local_mock_sam",
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
      tags: ["障碍"]
    }
  ];
}

function syncFunctionalRegions(map: WorldMap): WorldMap {
  const baseWalkable = map.walkable_areas.filter((area) => !area.metadata?.generated);
  const baseObstacles = map.obstacles.filter((area) => !area.metadata?.generated);
  const baseZones = map.interaction_zones.filter((area) => !area.metadata?.generated);
  return map.regions.reduce(
    (current, region) => {
      const area = regionToArea(region);
      if (!area) {
        return current;
      }
      if (region.function === "walkable") {
        return { ...current, walkable_areas: [...current.walkable_areas, area] };
      }
      if (region.function === "obstacle") {
        return { ...current, obstacles: [...current.obstacles, area] };
      }
      return { ...current, interaction_zones: [...current.interaction_zones, area] };
    },
    { ...map, walkable_areas: baseWalkable, obstacles: baseObstacles, interaction_zones: baseZones }
  );
}

function regionToArea(region: MapRegion): PolygonArea | null {
  if (!["walkable", "obstacle", "social"].includes(region.function)) {
    return null;
  }
  return {
    id: `area_${region.id}`,
    name: region.name,
    kind: region.function === "social" ? "zone" : region.function,
    points: region.points,
    metadata: {
      generated: true,
      region_id: region.id,
      function: region.function,
      source: region.source,
      notes: region.notes
    }
  };
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
