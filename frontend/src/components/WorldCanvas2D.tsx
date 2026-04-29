import { useEffect, useRef } from "react";
import { Application, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { assetUrl } from "../lib/api";
import type { EditTool, Point, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  editTool: EditTool;
  draftPoints: Point[];
  selectedAgentId: string | null;
  onWorldClick: (point: Point) => void;
  onSelectAgent: (agentId: string) => void;
};

export function WorldCanvas2D({
  world,
  editTool,
  draftPoints,
  selectedAgentId,
  onWorldClick,
  onSelectAgent
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const transformRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
  const callbacksRef = useRef({ onWorldClick, onSelectAgent });

  callbacksRef.current = { onWorldClick, onSelectAgent };

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const app = new Application({
      backgroundColor: 0xf8fafc,
      antialias: true,
      preserveDrawingBuffer: true,
      resizeTo: containerRef.current
    });
    appRef.current = app;
    containerRef.current.appendChild(app.view as HTMLCanvasElement);
    app.stage.eventMode = "static";
    app.stage.on("pointerdown", (event) => {
      const { scale, offsetX, offsetY } = transformRef.current;
      const point = {
        x: (event.global.x - offsetX) / scale,
        y: (event.global.y - offsetY) / scale
      };
      if (
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= world.map.width &&
        point.y <= world.map.height
      ) {
        callbacksRef.current.onWorldClick(point);
      }
    });
    const resizeObserver = new ResizeObserver(() => renderWorld());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      app.destroy(true, { children: true, texture: false, baseTexture: false });
      appRef.current = null;
    };
  }, []);

  useEffect(() => {
    renderWorld();
  }, [world, editTool, draftPoints, selectedAgentId]);

  function renderWorld() {
    const app = appRef.current;
    const container = containerRef.current;
    if (!app || !container) {
      return;
    }
    app.stage.removeChildren();
    app.stage.hitArea = new Rectangle(0, 0, app.renderer.width, app.renderer.height);

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    const scale = Math.min(width / world.map.width, height / world.map.height) * 0.96;
    const offsetX = (width - world.map.width * scale) / 2;
    const offsetY = (height - world.map.height * scale) / 2;
    transformRef.current = { scale, offsetX, offsetY };

    const layer = new Graphics();
    layer.position.set(offsetX, offsetY);
    layer.scale.set(scale);
    app.stage.addChild(layer);

    const background = new Graphics();
    background.beginFill(0xffffff);
    background.drawRoundedRect(0, 0, world.map.width, world.map.height, 8);
    background.endFill();
    background.lineStyle(2, 0xCBD5E1, 1);
    background.drawRoundedRect(0, 0, world.map.width, world.map.height, 8);
    layer.addChild(background);

    const backgroundUrl = assetUrl(world.map.background_image);
    if (backgroundUrl) {
      const sprite = new Sprite(Texture.from(backgroundUrl));
      sprite.width = world.map.width;
      sprite.height = world.map.height;
      sprite.alpha = 0.82;
      layer.addChild(sprite);
    }

    world.map.walkable_areas.forEach((area) => drawPolygon(layer, area.points, 0x16a34a, 0.13, 0x15803d));
    world.map.interaction_zones.forEach((area) => drawPolygon(layer, area.points, 0x0ea5e9, 0.18, 0x0369a1));
    world.map.obstacles.forEach((area) => drawPolygon(layer, area.points, 0xef4444, 0.2, 0xb91c1c));
    world.map.spawn_points.forEach((point) => drawMarker(layer, point, 0xf59e0b));
    world.map.items.forEach((item) => {
      const marker = new Graphics();
      marker.beginFill(0xfacc15, 0.95);
      marker.lineStyle(3, 0x854d0e, 1);
      marker.drawCircle(item.position.x, item.position.y, item.radius);
      marker.endFill();
      layer.addChild(marker);
    });

    if (draftPoints.length) {
      const draft = new Graphics();
      draft.lineStyle(4, toolColor(editTool), 1);
      draft.moveTo(draftPoints[0].x, draftPoints[0].y);
      draftPoints.slice(1).forEach((point) => draft.lineTo(point.x, point.y));
      draftPoints.forEach((point) => {
        draft.beginFill(toolColor(editTool), 1);
        draft.drawCircle(point.x, point.y, 7);
        draft.endFill();
      });
      layer.addChild(draft);
    }

    Object.values(world.agent_profiles).forEach((profile) => {
      const state = world.agent_states[profile.id];
      if (!state) {
        return;
      }
      const agent = new Graphics();
      agent.eventMode = "static";
      agent.cursor = "pointer";
      agent.beginFill(parseInt(profile.color.replace("#", ""), 16), 1);
      agent.lineStyle(selectedAgentId === profile.id ? 6 : 3, selectedAgentId === profile.id ? 0x111827 : 0xffffff, 1);
      agent.drawCircle(state.position.x, state.position.y, 19);
      agent.endFill();
      agent.on("pointertap", (event) => {
        event.stopPropagation();
        callbacksRef.current.onSelectAgent(profile.id);
      });
      layer.addChild(agent);

      const label = new Text(profile.name, {
        fontFamily: "Inter, Arial",
        fontSize: 18,
        fill: 0x111827,
        fontWeight: "600",
        align: "center"
      });
      label.anchor.set(0.5, 0);
      label.x = state.position.x;
      label.y = state.position.y + 24;
      layer.addChild(label);

      if (state.target) {
        const line = new Graphics();
        line.lineStyle(2, parseInt(profile.color.replace("#", ""), 16), 0.8);
        line.moveTo(state.position.x, state.position.y);
        line.lineTo(state.target.x, state.target.y);
        line.beginFill(parseInt(profile.color.replace("#", ""), 16), 0.5);
        line.drawCircle(state.target.x, state.target.y, 8);
        line.endFill();
        layer.addChild(line);
      }
    });
  }

  return <div className="world-surface" data-testid="world-2d" ref={containerRef} />;
}

function drawPolygon(layer: Graphics, points: Point[], fill: number, alpha: number, stroke: number) {
  if (points.length < 3) {
    return;
  }
  const graphic = new Graphics();
  graphic.beginFill(fill, alpha);
  graphic.lineStyle(3, stroke, 0.85);
  graphic.drawPolygon(points.flatMap((point) => [point.x, point.y]));
  graphic.endFill();
  layer.addChild(graphic);
}

function drawMarker(layer: Graphics, point: Point, color: number) {
  const marker = new Graphics();
  marker.lineStyle(3, color, 1);
  marker.moveTo(point.x - 14, point.y);
  marker.lineTo(point.x + 14, point.y);
  marker.moveTo(point.x, point.y - 14);
  marker.lineTo(point.x, point.y + 14);
  layer.addChild(marker);
}

function toolColor(tool: EditTool) {
  if (tool === "obstacle") {
    return 0xef4444;
  }
  if (tool === "zone") {
    return 0x0ea5e9;
  }
  return 0x16a34a;
}
