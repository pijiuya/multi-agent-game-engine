import { useEffect, useMemo, useRef, useState } from "react";
import { AgentPanel } from "./components/AgentPanel";
import { FloatingPanel } from "./components/FloatingPanel";
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
  createAgent as createAgentRemote,
  getWorld,
  patchAgent,
  patchMap,
  patchMapItem,
  postAction,
  saveMap,
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
  PanelState,
  Point,
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
  }, []);

  useEffect(() => {
    savePanelLayout(panels);
  }, [panels]);

  useEffect(() => {
    if (!world) {
      return;
    }
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(wsUrl());
      socket.onopen = () => setStatus("后端已连接");
      socket.onmessage = (event) => {
        const snapshot = JSON.parse(event.data) as WorldSnapshot;
        setWorld(mergeSnapshotWithLocalState(snapshot, {
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
      setStatus("图片已上传");
    } catch {
      setWorld({ ...world, map: { ...world.map, background_image: URL.createObjectURL(file) } });
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
          {panel.id === "properties" ? (
            <PropertiesPanel
              world={world}
              selection={selection}
              canvasPoints={canvasPoints}
              onUpdateMap={(patch) => void updateMapPatch(patch)}
              onUpdateAgent={(agentId, patch) => void updateAgentProfile(agentId, patch)}
              onUpdateItem={(itemId, patch) => void updateItemPatch(itemId, patch)}
              onUploadItemImage={(itemId, file) => void uploadItemImage(itemId, file)}
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
      makePanel("properties", "属性", 16, Math.max(684, height - 152), Math.min(340, width - 32), 240, 41)
    ];
  }
  return [
    makePanel("tools", "工具", 42, 126, 96, 552, 44),
    makePanel("scene", "场景列表", 42, 348, 304, 340, 43),
    makePanel("agents", "Agent 面板", Math.max(380, width - 388), 92, 340, 316, 42),
    makePanel("properties", "属性", Math.max(380, width - 408), Math.max(440, height - 330), 360, 276, 41)
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

function applyItemPatch(world: WorldSnapshot, itemId: string, patch: Partial<Omit<WorldItem, "id">>): WorldSnapshot {
  return {
    ...world,
    map: {
      ...world.map,
      items: world.map.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item))
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
