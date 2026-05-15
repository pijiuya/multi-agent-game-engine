import { Maximize2, Minus, Square, X } from "lucide-react";
import type { CSSProperties, MouseEvent, PointerEvent, WheelEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { screenToWorld, snapWorldPointToGrid, worldToScreen } from "../lib/canvasCoords";
import { assetUrl } from "../lib/api";
import type {
  AgentAnimationClip,
  AgentProfile,
  CanvasPoint,
  CanvasViewState,
  EditTool,
  ImageSelectionMode,
  MapRegionFunction,
  Point,
  SelectionState,
  WorldItem,
  WorldSnapshot
} from "../types";

type Props = {
  world: WorldSnapshot;
  editTool: EditTool;
  canvasView: CanvasViewState;
  selection: SelectionState;
  canvasPoints: CanvasPoint[];
  anchorPoint: Point | null;
  showRegions: boolean;
  showAllRegionLayers: boolean;
  activeRegionFunction: MapRegionFunction | null;
  draftPoints: Point[];
  imageSelectionMode: ImageSelectionMode;
  imageAspectRatio: number;
  status: string;
  appearanceMode: "light" | "dark";
  onViewChange: (view: CanvasViewState) => void;
  onWorldPoint: (point: Point) => void;
  onImageDraft: (points: Point[]) => void;
  onSelect: (selection: SelectionState) => void;
  onAnchorContext: (screen: Point, world: Point) => void;
  onObjectContext: (target: { kind: "agent" | "item" | "region" | "imageLayer"; id: string }, screen: Point) => void;
  onRenameAgent: (agentId: string, name: string) => void;
  onPreviewItem: (itemId: string, patch: Partial<Omit<WorldItem, "id">>) => void;
  onCommitItem: (itemId: string, patch: Partial<Omit<WorldItem, "id">>) => void;
};

type PanDrag = {
  pointerId: number;
  x: number;
  y: number;
  pan: Point;
};

type ImageSelectionDrag = {
  pointerId: number;
  start: Point;
};

type ItemTransform = {
  pointerId: number;
  item: WorldItem;
  mode: "move" | "scale" | "rotate";
  offset: Point;
  lastPatch: Partial<Omit<WorldItem, "id">>;
};

const MIN_ZOOM = 0.125;
const MAX_ZOOM = 8;

export function SceneViewport({
  world,
  editTool,
  canvasView,
  selection,
  canvasPoints,
  anchorPoint,
  showRegions,
  showAllRegionLayers,
  activeRegionFunction,
  draftPoints,
  imageSelectionMode,
  imageAspectRatio,
  status,
  appearanceMode,
  onViewChange,
  onWorldPoint,
  onImageDraft,
  onSelect,
  onAnchorContext,
  onObjectContext,
  onRenameAgent,
  onPreviewItem,
  onCommitItem
}: Props) {
  const panDragRef = useRef<PanDrag | null>(null);
  const imageSelectionDragRef = useRef<ImageSelectionDrag | null>(null);
  const transformRef = useRef<ItemTransform | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [itemImageAspects, setItemImageAspects] = useState<Record<string, number>>({});
  const gridStyle = getGridStyle(canvasView);
  const density = getGridDensity(canvasView.zoom);
  const worldLayerStyle = {
    transform: `translate(${canvasView.pan.x}px, ${canvasView.pan.y}px) scale(${canvasView.zoom})`
  } as CSSProperties;
  const visibleItems = world.map.items.filter((item) => !item.hidden);
  const visibleAgents = Object.values(world.agent_profiles).filter((agent) => !agent.hidden);
  const selectedItem = selection.kind === "item" ? world.map.items.find((item) => item.id === selection.id && !item.hidden) : null;
  const selectedRegion = selection.kind === "region" ? world.map.regions.find((region) => region.id === selection.id && !region.hidden) : null;
  const backgroundUrl = assetUrl(world.map.background_image) ?? world.map.background_image;
  const visibleRegionLayers = showRegions
    ? world.map.region_layers.filter((layer) => {
        if (!layer.polygons.length) {
          return false;
        }
        return showAllRegionLayers || layer.function === activeRegionFunction;
      })
    : [];
  const dialogueEvents = world.events
    .filter((event) => (event.type === "speech" || event.type === "dialogue") && event.agent_id && world.agent_states[event.agent_id])
    .slice(-4);

  useEffect(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) {
      return;
    }
    let frame = 0;
    const draw = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => drawStableGrid(canvas, canvasView, density));
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    if (canvas.parentElement) {
      observer.observe(canvas.parentElement);
    }
    window.addEventListener("resize", draw);
    draw();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [appearanceMode, canvasView, density]);

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    const nextZoom = clamp(canvasView.zoom * Math.pow(1.0012, -event.deltaY), MIN_ZOOM, MAX_ZOOM);
    const worldUnderCursor = {
      x: (anchor.x - canvasView.pan.x) / canvasView.zoom,
      y: (anchor.y - canvasView.pan.y) / canvasView.zoom
    };
    onViewChange({
      zoom: nextZoom,
      pan: {
        x: anchor.x - worldUnderCursor.x * nextZoom,
        y: anchor.y - worldUnderCursor.y * nextZoom
      },
      fitMode: false
    });
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button === 0) {
      const point = localWorldPoint(event);
      if (editTool === "imageGenerate" && imageSelectionMode !== "polygon") {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        imageSelectionDragRef.current = { pointerId: event.pointerId, start: point };
        onImageDraft([point, point]);
        return;
      }
      onWorldPoint(editTool === "anchor" ? snapWorldPointToGrid(point, canvasView.zoom) : point);
      return;
    }
    if (event.button !== 1) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panDragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pan: canvasView.pan
    };
    setIsPanning(true);
  }

  function movePan(event: PointerEvent<HTMLDivElement>) {
    const imageDrag = imageSelectionDragRef.current;
    if (imageDrag && imageDrag.pointerId === event.pointerId) {
      event.preventDefault();
      const rawEnd = localWorldFromClient(event.clientX, event.clientY);
      const end = imageSelectionMode === "ratioRect" ? lockPointToAspect(imageDrag.start, rawEnd, imageAspectRatio) : rawEnd;
      onImageDraft([imageDrag.start, end]);
      return;
    }
    const transform = transformRef.current;
    if (transform && transform.pointerId === event.pointerId) {
      event.preventDefault();
      const point = localWorldFromClient(event.clientX, event.clientY);
      const patch = itemPatchFromDrag(transform, point, canvasView.zoom);
      transform.lastPatch = patch;
      onPreviewItem(transform.item.id, patch);
      return;
    }
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    onViewChange({
      ...canvasView,
      pan: {
        x: drag.pan.x + event.clientX - drag.x,
        y: drag.pan.y + event.clientY - drag.y
      },
      fitMode: false
    });
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    const imageDrag = imageSelectionDragRef.current;
    if (imageDrag && imageDrag.pointerId === event.pointerId) {
      event.preventDefault();
      imageSelectionDragRef.current = null;
      const rawEnd = localWorldFromClient(event.clientX, event.clientY);
      const end = imageSelectionMode === "ratioRect" ? lockPointToAspect(imageDrag.start, rawEnd, imageAspectRatio) : rawEnd;
      onImageDraft([imageDrag.start, end]);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    const transform = transformRef.current;
    if (transform && transform.pointerId === event.pointerId) {
      event.preventDefault();
      transformRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      onCommitItem(transform.item.id, transform.lastPatch);
      return;
    }
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    panDragRef.current = null;
    setIsPanning(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (editTool !== "anchor") {
      return;
    }
    event.preventDefault();
    const point = snapWorldPointToGrid(localWorldPoint(event), canvasView.zoom);
    onAnchorContext({ x: event.clientX, y: event.clientY }, point);
  }

  function openObjectMenu(event: MouseEvent<Element>, target: { kind: "agent" | "item" | "region" | "imageLayer"; id: string }) {
    event.preventDefault();
    event.stopPropagation();
    onObjectContext(target, { x: event.clientX, y: event.clientY });
  }

  function localWorldPoint(event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return screenToWorld(
      {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      },
      canvasView
    );
  }

  function localWorldFromClient(clientX: number, clientY: number): Point {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return screenToWorld({ x: clientX - rect.left, y: clientY - rect.top }, canvasView);
  }

  function stopMarkerPointer(event: PointerEvent<HTMLButtonElement>) {
    if (event.button === 0) {
      event.stopPropagation();
    }
  }

  function startItemTransform(mode: ItemTransform["mode"], item: WorldItem, event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    const point = localWorldFromClient(event.clientX, event.clientY);
    const offset = { x: point.x - item.position.x, y: point.y - item.position.y };
    transformRef.current = {
      pointerId: event.pointerId,
      item,
      mode,
      offset,
      lastPatch: {}
    };
    onSelect({ kind: "item", id: item.id });
    const move = (nativeEvent: globalThis.PointerEvent) => {
      const transform = transformRef.current;
      if (!transform || transform.pointerId !== event.pointerId) {
        return;
      }
      const nextPoint = localWorldFromClient(nativeEvent.clientX, nativeEvent.clientY);
      const patch = itemPatchFromDrag(transform, nextPoint, canvasView.zoom);
      transform.lastPatch = patch;
      onPreviewItem(transform.item.id, patch);
    };
    const up = () => {
      const transform = transformRef.current;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!transform || transform.pointerId !== event.pointerId) {
        return;
      }
      transformRef.current = null;
      onCommitItem(transform.item.id, transform.lastPatch);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function renameAgent(agentId: string, currentName: string) {
    const next = window.prompt("重命名 Agent", currentName)?.trim();
    if (next && next !== currentName) {
      onRenameAgent(agentId, next);
    }
  }

  return (
    <section
      className={`scene-window tool-${editTool}${isPanning ? " panning" : ""}`}
      data-testid="scene-viewport"
      data-grid-density={density}
      style={gridStyle}
    >
      <div className="scene-window-surface">
        <div className="scene-window-material" />
        <canvas
          ref={gridCanvasRef}
          aria-hidden="true"
          className="scene-window-grid-canvas"
          data-testid="scene-grid-canvas"
        />
      </div>
      <header className="scene-header">
        <div>
          <h1>{displayName(world.name)}</h1>
          <span>
            帧 {world.tick} / {status} / 缩放 {Math.round(canvasView.zoom * 100)}%
          </span>
        </div>
        <div className="scene-metrics">
          <span>{visibleAgents.length} 个 agent</span>
          <span>{visibleItems.length} 个元素</span>
          <span>{world.events.length} 条事件</span>
        </div>
        <div className="window-controls">
          <button aria-label="最小化窗口" onClick={() => void window.engineWindow?.minimize()}>
            <Minus size={15} />
          </button>
          <button aria-label="最大化窗口" onClick={() => void window.engineWindow?.maximizeToggle()}>
            <Square size={13} />
          </button>
          <button aria-label="关闭窗口" onClick={() => void window.engineWindow?.close()}>
            <X size={15} />
          </button>
        </div>
      </header>
      <div
        ref={shellRef}
        className="scene-canvas-shell"
        onWheel={handleWheel}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onContextMenu={handleContextMenu}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
      >
        <div className="workspace-surface" data-testid="workspace-surface" aria-label="透明工作站底图" />
        <div className="world-coordinate-layer" data-testid="world-coordinate-layer" style={worldLayerStyle}>
          {backgroundUrl ? (
            <img
              alt="地图背景"
              className="world-map-background"
              data-testid="world-map-background"
              draggable={false}
              onClick={(event) => {
                event.stopPropagation();
                onSelect({ kind: "map", id: world.map.id });
              }}
              onPointerDown={(event) => {
                if (event.button === 0 && editTool === "select") {
                  event.stopPropagation();
                }
              }}
              src={backgroundUrl}
              style={{ left: 0, top: 0, width: world.map.width, height: world.map.height }}
            />
          ) : (
            <button
              aria-label="选择地图框"
              className="world-map-frame"
              data-testid="world-map-frame"
              onClick={(event) => {
                if (editTool === "select") {
                  event.stopPropagation();
                  onSelect({ kind: "map", id: world.map.id });
                }
              }}
              onPointerDown={(event) => {
                if (event.button === 0 && editTool === "select") {
                  event.stopPropagation();
                }
              }}
              style={{ left: 0, top: 0, width: world.map.width, height: world.map.height }}
            >
              <span>{world.map.width} x {world.map.height}</span>
            </button>
          )}
          {world.map.image_layers.filter((layer) => !layer.hidden).map((layer) => (
            <img
              alt={layer.name}
              className={`world-image-layer${selection.kind === "imageLayer" && selection.id === layer.id ? " active" : ""}`}
              data-testid={`world-image-layer-${layer.id}`}
              draggable={false}
              key={layer.id}
              onClick={(event) => {
                event.stopPropagation();
                onSelect({ kind: "imageLayer", id: layer.id });
              }}
              onContextMenu={(event) => openObjectMenu(event, { kind: "imageLayer", id: layer.id })}
              src={assetUrl(layer.image) ?? layer.image}
              style={{
                left: layer.x,
                top: layer.y,
                width: layer.width,
                height: layer.height,
                opacity: layer.opacity
              }}
            />
          ))}
          <svg
            className="world-vector-layer"
            data-testid="world-vector-layer"
            style={{ width: world.map.width, height: world.map.height }}
          >
            {visibleRegionLayers.map((layer) =>
              layer.polygons.map((polygon, index) => (
                  <path
                    className={`world-region-layer world-region-${layer.function} ${activeRegionFunction === layer.function ? "active" : ""}`}
                    data-testid={`world-region-layer-${layer.function}-${index}`}
                    d={polygonPath(polygon.points, polygon.holes)}
                    fillRule="evenodd"
                    key={`${layer.function}-${index}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect({ kind: "regionLayer", id: layer.function });
                    }}
                    onContextMenu={(event) => {
                      if (layer.region_ids.length === 1) {
                        openObjectMenu(event, { kind: "region", id: layer.region_ids[0] });
                      }
                    }}
                  />
                ))
            )}
            {showRegions && selectedRegion ? (
              <path
                className="world-region-source active"
                d={polygonPath(selectedRegion.points, selectedRegion.holes)}
                fillRule="evenodd"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect({ kind: "region", id: selectedRegion.id });
                }}
                onContextMenu={(event) => openObjectMenu(event, { kind: "region", id: selectedRegion.id })}
              />
            ) : null}
            {draftPoints.length > 0 ? <DraftSelection editTool={editTool} points={draftPoints} /> : null}
          </svg>
          <div className="world-origin-marker" data-testid="origin-marker" style={pointStyle({ x: 0, y: 0 })}>
            <span />
          </div>
          {visibleItems.map((item) => (
            <button
              className={selection.kind === "item" && selection.id === item.id ? "world-item-marker active" : "world-item-marker"}
              data-testid={`world-item-${item.id}`}
              data-world-x={item.position.x}
              data-world-y={item.position.y}
              data-world-object="item"
              key={item.id}
              onClick={() => onSelect({ kind: "item", id: item.id })}
              onContextMenu={(event) => openObjectMenu(event, { kind: "item", id: item.id })}
              onPointerDown={(event) => startItemTransform("move", item, event)}
              style={itemStyle(item, item.image ? itemImageAspects[item.id] : null)}
              title={item.name}
            >
              {item.image ? (
                <img
                  alt=""
                  draggable={false}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    if (!image.naturalWidth || !image.naturalHeight) {
                      return;
                    }
                    const aspect = image.naturalWidth / image.naturalHeight;
                    setItemImageAspects((current) => (current[item.id] === aspect ? current : { ...current, [item.id]: aspect }));
                  }}
                  src={assetUrl(item.image) ?? item.image}
                />
              ) : (
                item.name.slice(0, 1)
              )}
            </button>
          ))}
          {canvasPoints.map((point) => (
              <button
              className={
                selection.kind === "point" && selection.id === point.id ? "world-empty-point-marker active" : "world-empty-point-marker"
              }
              data-testid={`world-point-${point.id}`}
              data-world-x={point.position.x}
              data-world-y={point.position.y}
              data-world-object="point"
              key={point.id}
              onClick={() => onSelect({ kind: "point", id: point.id })}
              onPointerDown={stopMarkerPointer}
              style={pointStyle(point.position)}
              title={point.name}
            />
          ))}
          {anchorPoint ? (
            <button
              aria-label="当前锚点"
              className="world-anchor-marker active"
              data-testid="world-anchor-marker"
              data-world-x={anchorPoint.x}
              data-world-y={anchorPoint.y}
              data-world-object="anchor"
              onPointerDown={stopMarkerPointer}
              style={pointStyle(anchorPoint)}
              title="当前锚点"
            />
          ) : null}
        </div>
        <div className="world-label-layer" data-testid="world-label-layer">
          {visibleAgents.map((agent) => {
            const state = world.agent_states[agent.id];
            if (!state) {
              return null;
            }
            const animationFrame = agentAnimationFrame(agent, state.status, world.tick);
            return (
              <button
                className={
                  `${selection.kind === "agent" && selection.id === agent.id ? "world-agent-marker active" : "world-agent-marker"}${animationFrame ? " has-sprite" : ""}`
                }
                data-testid={`world-agent-${agent.id}`}
                data-world-x={state.position.x}
                data-world-y={state.position.y}
                data-world-object="agent"
                key={agent.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect({ kind: "agent", id: agent.id });
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  renameAgent(agent.id, agent.name);
                }}
                onContextMenu={(event) => openObjectMenu(event, { kind: "agent", id: agent.id })}
                onPointerDown={stopMarkerPointer}
                style={{ ...screenPointStyle(state.position, canvasView), "--agent-color": agent.color } as CSSProperties}
                title={agent.name}
              >
                {animationFrame ? (
                  <img
                    alt=""
                    className="world-agent-sprite"
                    draggable={false}
                    src={animationFrame.src}
                    style={agentSpriteStyle(animationFrame.clip, canvasView.zoom)}
                  />
                ) : (
                  <span />
                )}
              </button>
            );
          })}
          {visibleItems.map((item) => (
            <button
              className={selection.kind === "item" && selection.id === item.id ? "world-item-label active" : "world-item-label"}
              data-testid={`world-item-label-${item.id}`}
              key={item.id}
              onClick={(event) => {
                event.stopPropagation();
                onSelect({ kind: "item", id: item.id });
              }}
              onContextMenu={(event) => openObjectMenu(event, { kind: "item", id: item.id })}
              onPointerDown={(event) => event.stopPropagation()}
              style={screenPointStyle(item.position, canvasView)}
              title={item.name}
            >
              {item.name}
            </button>
          ))}
          {visibleAgents.map((agent) => {
            const state = world.agent_states[agent.id];
            if (!state) {
              return null;
            }
            return (
              <button
                className={
                  selection.kind === "agent" && selection.id === agent.id ? "world-agent-label active" : "world-agent-label"
                }
                data-testid={`world-agent-label-${agent.id}`}
                key={agent.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect({ kind: "agent", id: agent.id });
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  renameAgent(agent.id, agent.name);
                }}
                onContextMenu={(event) => openObjectMenu(event, { kind: "agent", id: agent.id })}
                onPointerDown={(event) => event.stopPropagation()}
                style={screenPointStyle(state.position, canvasView)}
                title={agent.name}
              >
              {agent.name}
            </button>
            );
          })}
          {dialogueEvents.map((event) => {
            const state = event.agent_id ? world.agent_states[event.agent_id] : null;
            if (!state) {
              return null;
            }
            return (
              <div
                className="world-dialogue-bubble"
                data-testid={`world-dialogue-${event.id}`}
                key={event.id}
                style={screenPointStyle(state.position, canvasView)}
              >
                {dialogueText(event.message)}
              </div>
            );
          })}
          {selectedItem ? (
            <div
              className="item-transform-box"
              data-testid="item-transform-box"
              style={screenItemTransformStyle(selectedItem, canvasView, selectedItem.image ? itemImageAspects[selectedItem.id] : null)}
            >
              <button
                aria-label="移动元素"
                className="item-transform-center"
                onPointerDown={(event) => startItemTransform("move", selectedItem, event)}
              />
              <button
                aria-label="缩放元素"
                className="item-transform-handle scale"
                onPointerDown={(event) => startItemTransform("scale", selectedItem, event)}
              />
              <button
                aria-label="旋转元素"
                className="item-transform-handle rotate"
                onPointerDown={(event) => startItemTransform("rotate", selectedItem, event)}
              />
            </div>
          ) : null}
        </div>
      </div>
      <footer className="scene-footer">
        <span>{displayName(world.map.name)}</span>
        <span>
          {world.map.width} x {world.map.height}
        </span>
        <span>{toolLabel(editTool)}</span>
        <Maximize2 size={14} />
      </footer>
    </section>
  );
}

function pointStyle(point: Point) {
  return {
    left: `${point.x}px`,
    top: `${point.y}px`
  } as CSSProperties;
}

function screenPointStyle(point: Point, view: CanvasViewState) {
  const screen = worldToScreen(point, view);
  return {
    left: `${screen.x}px`,
    top: `${screen.y}px`
  } as CSSProperties;
}

function itemStyle(item: WorldItem, aspect: number | null | undefined) {
  const size = item.radius * 2 * item.scale;
  const dimensions = itemDimensions(size, aspect);
  return {
    ...pointStyle(item.position),
    width: `${dimensions.width}px`,
    height: `${dimensions.height}px`,
    transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`
  } as CSSProperties;
}

function agentAnimationFrame(agent: AgentProfile, status: string, tick: number): { src: string; clip: AgentAnimationClip } | null {
  const animation = agent.animation;
  if (!animation) {
    return null;
  }
  const clip = animation.clips[status] ?? animation.clips.idle ?? animation;
  if (clip.kind === "gif") {
    const src = assetUrl(clip.url) ?? clip.url;
    return src ? { src, clip } : null;
  }
  if (!clip.frames.length) {
    return null;
  }
  const frameIndex = Math.floor((tick / 10) * Math.max(1, clip.fps)) % clip.frames.length;
  const frame = clip.frames[frameIndex];
  const src = assetUrl(frame) ?? frame;
  return src ? { src, clip } : null;
}

function agentSpriteStyle(clip: AgentAnimationClip, zoom: number) {
  const sourceWidth = clip.width > 0 ? clip.width : 52;
  const sourceHeight = clip.height > 0 ? clip.height : 52;
  const screenHeight = clamp((clip.world_height || sourceHeight || 72) * zoom * clamp(clip.scale || 1, 0.1, 6), 8, 800);
  const aspect = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 1;
  return {
    width: `${screenHeight * aspect}px`,
    height: `${screenHeight}px`
  } as CSSProperties;
}

function dialogueText(message: string) {
  const [, text] = message.split(": ");
  return (text || message).slice(0, 90);
}

function screenItemTransformStyle(item: WorldItem, view: CanvasViewState, aspect: number | null | undefined) {
  const screen = worldToScreen(item.position, view);
  const size = Math.max(18, item.radius * 2 * item.scale * view.zoom);
  const dimensions = itemDimensions(size, aspect);
  return {
    left: `${screen.x}px`,
    top: `${screen.y}px`,
    width: `${dimensions.width}px`,
    height: `${dimensions.height}px`,
    transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`
  } as CSSProperties;
}

function itemDimensions(maxSide: number, aspect: number | null | undefined) {
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) {
    return { width: maxSide, height: maxSide };
  }
  if (aspect >= 1) {
    return { width: maxSide, height: maxSide / aspect };
  }
  return { width: maxSide * aspect, height: maxSide };
}

function itemPatchFromDrag(transform: ItemTransform, point: Point, zoom: number): Partial<Omit<WorldItem, "id">> {
  if (transform.mode === "move") {
    return {
      position: snapWorldPointToGrid(
        {
          x: point.x - transform.offset.x,
          y: point.y - transform.offset.y
        },
        zoom
      )
    };
  }
  if (transform.mode === "scale") {
    const distance = Math.hypot(point.x - transform.item.position.x, point.y - transform.item.position.y);
    return {
      scale: clamp(distance / Math.max(1, transform.item.radius), 0.25, 5)
    };
  }
  return {
    rotation: Math.round((Math.atan2(point.y - transform.item.position.y, point.x - transform.item.position.x) * 180) / Math.PI + 90)
  };
}

function getGridStyle(view: CanvasViewState) {
  const density = getGridDensity(view.zoom);
  const baseMinor = density === "fine" ? 8 : density === "simple" ? 36 : 18;
  const baseMajor = density === "fine" ? 64 : density === "simple" ? 144 : 90;
  const minorSize = clamp(baseMinor * view.zoom, 5, 96);
  const majorSize = clamp(baseMajor * view.zoom, 36, 320);
  const minorAlpha = density === "simple" ? 0.08 : density === "fine" ? 0.38 : 0.28;
  const majorAlpha = density === "simple" ? 0.42 : density === "fine" ? 0.5 : 0.42;
  const panX = view.pan.x;
  const panY = view.pan.y;

  return {
    "--grid-pan-x": `${panX}px`,
    "--grid-pan-y": `${panY}px`,
    "--grid-size-minor": `${minorSize}px`,
    "--grid-size-major": `${majorSize}px`,
    "--grid-alpha-minor-x": String(minorAlpha),
    "--grid-alpha-minor-y": String(Math.max(0.06, minorAlpha - 0.02)),
    "--grid-alpha-major-x": String(majorAlpha),
    "--grid-alpha-major-y": String(Math.max(0.08, majorAlpha - 0.04))
  } as CSSProperties;
}

function drawStableGrid(canvas: HTMLCanvasElement, view: CanvasViewState, density: string) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  const pixelWidth = Math.ceil(width * dpr);
  const pixelHeight = Math.ceil(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const style = getComputedStyle(canvas);
  const rgb = style.getPropertyValue("--grid-rgb").trim() || "0, 0, 0";
  const materialRgb = style.getPropertyValue("--material-rgb").trim() || "248, 248, 248";
  const minorStep = parseFloat(style.getPropertyValue("--grid-size-minor")) || 18;
  const majorStep = parseFloat(style.getPropertyValue("--grid-size-major")) || 90;
  const minorAlpha = parseFloat(style.getPropertyValue("--grid-alpha-minor-x")) || 0.28;
  const majorAlpha = parseFloat(style.getPropertyValue("--grid-alpha-major-x")) || 0.42;
  context.save();
  drawCanvasMaterial(context, width, height, materialRgb);
  if (density !== "simple") {
    drawGridLines(context, width, height, minorStep, view.pan, `rgba(${rgb}, ${minorAlpha})`, dpr);
  }
  drawGridLines(context, width, height, majorStep, view.pan, `rgba(${rgb}, ${majorAlpha})`, dpr);
  applyCanvasFade(context, width, height);
  context.restore();
}

function drawCanvasMaterial(context: CanvasRenderingContext2D, width: number, height: number, rgb: string) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.hypot(width, height) / 2;
  const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  gradient.addColorStop(0, `rgba(${rgb}, 0.62)`);
  gradient.addColorStop(0.42, `rgba(${rgb}, 0.5)`);
  gradient.addColorStop(0.68, `rgba(${rgb}, 0.26)`);
  gradient.addColorStop(0.84, `rgba(${rgb}, 0.08)`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function applyCanvasFade(context: CanvasRenderingContext2D, width: number, height: number) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.hypot(width, height) / 2;
  const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.9)");
  gradient.addColorStop(0.74, "rgba(255, 255, 255, 0.45)");
  gradient.addColorStop(0.9, "rgba(255, 255, 255, 0.1)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.globalCompositeOperation = "destination-in";
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = "source-over";
}

function drawGridLines(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  step: number,
  pan: Point,
  strokeStyle: string,
  dpr: number
) {
  if (!Number.isFinite(step) || step < 4) {
    return;
  }
  context.beginPath();
  context.lineWidth = 1 / dpr;
  context.strokeStyle = strokeStyle;
  const xStart = modulo(pan.x, step);
  const yStart = modulo(pan.y, step);
  const align = 0.5 / dpr;
  for (let x = xStart; x <= width; x += step) {
    const alignedX = Math.round(x * dpr) / dpr + align;
    context.moveTo(alignedX, 0);
    context.lineTo(alignedX, height);
  }
  for (let y = yStart; y <= height; y += step) {
    const alignedY = Math.round(y * dpr) / dpr + align;
    context.moveTo(0, alignedY);
    context.lineTo(width, alignedY);
  }
  context.stroke();
}

function getGridDensity(zoom: number) {
  if (zoom < 0.35) {
    return "simple";
  }
  if (zoom > 2.5) {
    return "fine";
  }
  return "normal";
}

function DraftSelection({ editTool, points }: { editTool: EditTool; points: Point[] }) {
  const isImageTool = editTool === "imageGenerate";
  if (isImageTool && points.length === 2) {
    const [first, second] = points;
    const x = Math.min(first.x, second.x);
    const y = Math.min(first.y, second.y);
    const width = Math.abs(second.x - first.x);
    const height = Math.abs(second.y - first.y);
    return (
      <g className="world-image-draft-area" data-testid="world-image-draft-area">
        <rect height={height} width={width} x={x} y={y} />
        <circle cx={first.x} cy={first.y} r="5" />
        <circle cx={second.x} cy={second.y} r="5" />
      </g>
    );
  }
  return (
    <g className={isImageTool ? "world-image-draft-area" : "world-draft-area"} data-testid={isImageTool ? "world-image-draft-area" : "world-draft-area"}>
      <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} />
      {points.map((point, index) => (
        <circle cx={point.x} cy={point.y} key={`${point.x}-${point.y}-${index}`} r="5" />
      ))}
    </g>
  );
}

function lockPointToAspect(start: Point, end: Point, aspectRatio: number): Point {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return end;
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const width = Math.abs(dx);
  const height = Math.abs(dy);
  if (width < 1 || height < 1) {
    return end;
  }
  const currentAspect = width / height;
  if (currentAspect > aspectRatio) {
    return {
      x: start.x + Math.sign(dx || 1) * height * aspectRatio,
      y: end.y
    };
  }
  return {
    x: end.x,
    y: start.y + Math.sign(dy || 1) * (width / aspectRatio)
  };
}

function modulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function toolLabel(tool: EditTool) {
  const labels: Record<EditTool, string> = {
    select: "选择",
    region: "区域绘制",
    imageGenerate: "图像生成",
    item: "元素",
    spawn: "出生点",
    move: "移动",
    anchor: "锚点"
  };
  return labels[tool];
}

function polygonPath(points: Point[], holes: Point[][] = []) {
  return [points, ...holes]
    .filter((ring) => ring.length >= 3)
    .map((ring) => `M ${ring.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`)
    .join(" ");
}

function displayName(name: string) {
  const labels: Record<string, string> = {
    "New Sandbox": "新沙盒",
    "Untitled Map": "未命名地图"
  };
  return labels[name] ?? name;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
