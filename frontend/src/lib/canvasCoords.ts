import type { CanvasViewState, Point } from "../types";

export const ORIGIN_POINT: Point = { x: 0, y: 0 };
export const OBJECT_SNAP_STEP = 18;

export function screenToWorld(screen: Point, view: CanvasViewState): Point {
  return {
    x: (screen.x - view.pan.x) / view.zoom,
    y: (screen.y - view.pan.y) / view.zoom
  };
}

export function worldToScreen(world: Point, view: CanvasViewState): Point {
  return {
    x: world.x * view.zoom + view.pan.x,
    y: world.y * view.zoom + view.pan.y
  };
}

export function centerViewOnWorldPoint(view: CanvasViewState, world: Point, viewportCenter: Point): CanvasViewState {
  return {
    zoom: view.zoom,
    pan: {
      x: viewportCenter.x - world.x * view.zoom,
      y: viewportCenter.y - world.y * view.zoom
    },
    fitMode: false
  };
}

export function snapWorldPointToGrid(point: Point, _zoom?: number): Point {
  const step = OBJECT_SNAP_STEP;
  return {
    x: Math.round(point.x / step) * step,
    y: Math.round(point.y / step) * step
  };
}

export function gridWorldStepForZoom(zoom: number) {
  if (zoom < 0.35) {
    return 36;
  }
  if (zoom > 2.5) {
    return 8;
  }
  return 18;
}
