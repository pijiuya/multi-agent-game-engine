import { useEffect, useMemo, useState } from "react";
import { AgentPanel } from "./components/AgentPanel";
import { FloatingPanel } from "./components/FloatingPanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { SceneElementsPanel } from "./components/SceneElementsPanel";
import { SceneViewport } from "./components/SceneViewport";
import { ToolPanel } from "./components/ToolPanel";
import { TransportControls } from "./components/TransportControls";
import {
  createAgent as createAgentRemote,
  getWorld,
  postAction,
  saveMap,
  setSimulation,
  tickSimulation,
  uploadMapImage,
  wsUrl
} from "./lib/api";
import { addAgentLocal, addAreaToMap, addItemToMap, addSpawnToMap, moveAgentLocal } from "./lib/worldOps";
import type { CanvasViewState, EditTool, PanelState, Point, SelectionState, WorldSnapshot } from "./types";

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
  const [panels, setPanels] = useState<PanelState[]>(() => createInitialPanels());
  const [zCursor, setZCursor] = useState(40);

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
    if (!world) {
      return;
    }
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(wsUrl());
      socket.onopen = () => setStatus("后端已连接");
      socket.onmessage = (event) => {
        const snapshot = JSON.parse(event.data) as WorldSnapshot;
        setWorld(snapshot);
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
  }, [selection, selectedAgentExists, world]);

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
    if (editTool === "select") {
      setSelection({ kind: "map", id: world.map.id });
      return;
    }
    if (editTool === "walkable" || editTool === "obstacle" || editTool === "zone") {
      setDraftPoints((points) => [...points, point]);
      return;
    }
    if (editTool === "item") {
      setWorld({ ...world, map: addItemToMap(world.map, point) });
      return;
    }
    if (editTool === "spawn") {
      setWorld({ ...world, map: addSpawnToMap(world.map, point) });
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

  function finalizePolygon() {
    if (!world || draftPoints.length < 3) {
      return;
    }
    setWorld({ ...world, map: addAreaToMap(world.map, editTool, draftPoints) });
    setDraftPoints([]);
  }

  async function createAgent(name: string, role: string, point: Point) {
    if (!world) {
      return;
    }
    const remoteSnapshot = await createAgentRemote(name, role, point);
    if (remoteSnapshot) {
      setWorld(remoteSnapshot);
      const created = Object.values(remoteSnapshot.agent_profiles).find((agent) => agent.name === name);
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
        status={status}
        onViewChange={setCanvasView}
      />

      <TransportControls
        running={world.running}
        onRun={() => void setSimulationRunning(true)}
        onPause={() => void setSimulationRunning(false)}
        onStop={() => void setSimulationRunning(false, true)}
        appearanceMode={appearanceMode}
        onToggleAppearance={() => setAppearanceMode((mode) => (mode === "light" ? "dark" : "light"))}
      />

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
              onFinalizePolygon={finalizePolygon}
              onClearDraft={() => setDraftPoints([])}
              onUpload={(file) => void handleUpload(file)}
            />
          ) : null}
          {panel.id === "scene" ? (
            <SceneElementsPanel world={world} selection={selection} onSelect={setSelection} />
          ) : null}
          {panel.id === "agents" ? (
            <AgentPanel
              world={world}
              selection={selection}
              onSelect={setSelection}
              onCreateAgent={(name, role, point) => void createAgent(name, role, point)}
              onRefresh={() => void refreshWorld()}
            />
          ) : null}
          {panel.id === "properties" ? <PropertiesPanel world={world} selection={selection} /> : null}
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
