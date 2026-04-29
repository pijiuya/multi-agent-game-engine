import { useEffect, useMemo, useState } from "react";
import { EventLog } from "./components/EventLog";
import { Inspector } from "./components/Inspector";
import { MapTools } from "./components/MapTools";
import { WorldCanvas2D } from "./components/WorldCanvas2D";
import { WorldView3D } from "./components/WorldView3D";
import { createAgent as createAgentRemote, getWorld, postAction, saveMap, setSimulation, tickSimulation, uploadMapImage, wsUrl } from "./lib/api";
import { addAgentLocal, addAreaToMap, addItemToMap, addSpawnToMap, moveAgentLocal } from "./lib/worldOps";
import type { EditTool, Point, ViewMode, WorldSnapshot } from "./types";

export default function App() {
  const [world, setWorld] = useState<WorldSnapshot | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [editTool, setEditTool] = useState<EditTool>("select");
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [status, setStatus] = useState("loading");

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
      socket.onopen = () => setStatus("backend live");
      socket.onmessage = (event) => {
        const snapshot = JSON.parse(event.data) as WorldSnapshot;
        setWorld(snapshot);
      };
      socket.onerror = () => setStatus("local preview");
      socket.onclose = () => setStatus((current) => (current === "backend live" ? "local preview" : current));
    } catch {
      setStatus("local preview");
    }
    return () => socket?.close();
  }, [Boolean(world)]);

  useEffect(() => {
    if (!selectedAgentExists && world) {
      setSelectedAgentId(Object.keys(world.agent_profiles)[0] ?? null);
    }
  }, [selectedAgentExists, world]);

  async function refreshWorld() {
    const snapshot = await getWorld();
    setWorld(snapshot);
    setSelectedAgentId((current) => current ?? Object.keys(snapshot.agent_profiles)[0] ?? null);
    setStatus(snapshot === null ? "local preview" : "ready");
  }

  async function handleRunToggle() {
    if (!world) {
      return;
    }
    const snapshot = await setSimulation(!world.running);
    if (snapshot) {
      setWorld(snapshot);
      setStatus("backend live");
    } else {
      setWorld({ ...world, running: !world.running });
      setStatus("local preview");
    }
  }

  async function handleStep() {
    const snapshot = await tickSimulation();
    if (snapshot) {
      setWorld(snapshot);
      setStatus("backend live");
    } else {
      setStatus("local preview");
    }
  }

  async function handleSave() {
    if (!world) {
      return;
    }
    const snapshot = await saveMap(world.map);
    if (snapshot) {
      setWorld(snapshot);
      setStatus("saved");
    } else {
      setStatus("local changes");
    }
  }

  async function handleUpload(file: File) {
    if (!world) {
      return;
    }
    try {
      const result = await uploadMapImage(file);
      setWorld({ ...world, map: { ...world.map, background_image: result.url } });
      setStatus("image uploaded");
    } catch {
      setWorld({ ...world, map: { ...world.map, background_image: URL.createObjectURL(file) } });
      setStatus("local image");
    }
  }

  async function handleWorldClick(point: Point) {
    if (!world) {
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
      setSelectedAgentId(created?.id ?? selectedAgentId);
      setStatus("backend live");
      return;
    }
    setStatus("local preview");
    const snapshot = addAgentLocal(world, name, role, point);
    setWorld(snapshot);
    const created = Object.values(snapshot.agent_profiles).find((agent) => agent.name === name);
    setSelectedAgentId(created?.id ?? selectedAgentId);
  }

  if (!world) {
    return (
      <main className="app-shell loading">
        <div className="loader" />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <MapTools
        viewMode={viewMode}
        editTool={editTool}
        running={world.running}
        draftCount={draftPoints.length}
        onViewMode={setViewMode}
        onEditTool={(tool) => {
          setEditTool(tool);
          if (tool !== "walkable" && tool !== "obstacle" && tool !== "zone") {
            setDraftPoints([]);
          }
        }}
        onRunToggle={() => void handleRunToggle()}
        onStep={() => void handleStep()}
        onSave={() => void handleSave()}
        onFinalizePolygon={finalizePolygon}
        onClearDraft={() => setDraftPoints([])}
        onUpload={(file) => void handleUpload(file)}
      />

      <section className="stage-column">
        <div className="stage-header">
          <div>
            <h2>{world.name}</h2>
            <span>
              tick {world.tick} · {status}
            </span>
          </div>
          <div className="metrics">
            <span>{Object.keys(world.agent_profiles).length} agents</span>
            <span>{world.map.walkable_areas.length + world.map.obstacles.length + world.map.interaction_zones.length} shapes</span>
            <span>{world.events.length} events</span>
          </div>
        </div>
        <div className="stage-frame">
          {viewMode === "2d" ? (
            <WorldCanvas2D
              world={world}
              editTool={editTool}
              draftPoints={draftPoints}
              selectedAgentId={selectedAgentId}
              onWorldClick={(point) => void handleWorldClick(point)}
              onSelectAgent={setSelectedAgentId}
            />
          ) : (
            <WorldView3D world={world} selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />
          )}
        </div>
      </section>

      <section className="right-column">
        <Inspector
          world={world}
          selectedAgentId={selectedAgentId}
          onSelectAgent={setSelectedAgentId}
          onCreateAgent={(name, role, point) => void createAgent(name, role, point)}
          onRefresh={() => void refreshWorld()}
        />
        <EventLog events={world.events} />
      </section>
    </main>
  );
}
