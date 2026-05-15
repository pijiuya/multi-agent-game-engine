import { Minus, PanelsTopLeft } from "lucide-react";
import type { PointerEvent, ReactNode } from "react";
import { useRef } from "react";
import type { PanelState } from "../types";

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type Props = {
  panel: PanelState;
  children: ReactNode;
  onMove: (id: PanelState["id"], x: number, y: number) => void;
  onResize: (id: PanelState["id"], x: number, y: number, width: number, height: number) => void;
  onDragEnd: (id: PanelState["id"]) => void;
  onBringToFront: (id: PanelState["id"]) => void;
  onToggleMinimized: (id: PanelState["id"]) => void;
};

export function FloatingPanel({
  panel,
  children,
  onMove,
  onResize,
  onDragEnd,
  onBringToFront,
  onToggleMinimized
}: Props) {
  const dragRef = useRef<{ pointerId: number; x: number; y: number; panelX: number; panelY: number } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    direction: ResizeDirection;
    x: number;
    y: number;
    panelX: number;
    panelY: number;
    width: number;
    height: number;
  } | null>(null);

  function startResize(direction: ResizeDirection, event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      direction,
      x: event.clientX,
      y: event.clientY,
      panelX: panel.x,
      panelY: panel.y,
      width: panel.width,
      height: panel.height
    };
    onBringToFront(panel.id);
  }

  function moveResize(event: PointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) {
      return;
    }
    event.stopPropagation();
    const deltaX = event.clientX - resize.x;
    const deltaY = event.clientY - resize.y;
    let nextX = resize.panelX;
    let nextY = resize.panelY;
    let nextWidth = resize.width;
    let nextHeight = resize.height;

    if (resize.direction.includes("e")) {
      nextWidth = resize.width + deltaX;
    }
    if (resize.direction.includes("s")) {
      nextHeight = resize.height + deltaY;
    }
    if (resize.direction.includes("w")) {
      nextX = resize.panelX + deltaX;
      nextWidth = resize.width - deltaX;
    }
    if (resize.direction.includes("n")) {
      nextY = resize.panelY + deltaY;
      nextHeight = resize.height - deltaY;
    }

    onResize(panel.id, nextX, nextY, nextWidth, nextHeight);
  }

  function endResize(event: PointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) {
      return;
    }
    event.stopPropagation();
    resizeRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onDragEnd(panel.id);
  }

  return (
    <section
      className={panel.minimized ? "floating-panel minimized" : "floating-panel"}
      data-testid={`panel-${panel.id}`}
      data-docked={panel.dockedTo ?? ""}
      style={{
        left: panel.x,
        top: panel.y,
        width: panel.width,
        height: panel.minimized ? undefined : panel.height,
        zIndex: panel.zIndex
      }}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button, input, textarea, select, label, [contenteditable='true']")) {
          return;
        }
        onBringToFront(panel.id);
      }}
    >
      <header
        className="panel-titlebar"
        data-testid={`panel-title-${panel.id}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            panelX: panel.x,
            panelY: panel.y
          };
          onBringToFront(panel.id);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) {
            return;
          }
          onMove(panel.id, drag.panelX + event.clientX - drag.x, drag.panelY + event.clientY - drag.y);
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) {
            return;
          }
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          onDragEnd(panel.id);
        }}
      >
        <div>
          <PanelsTopLeft size={15} />
          <span>{panel.title}</span>
        </div>
        <button
          aria-label={`${panel.minimized ? "展开" : "折叠"} ${panel.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleMinimized(panel.id);
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Minus size={15} />
        </button>
      </header>
      {!panel.minimized ? <div className="floating-panel-body">{children}</div> : null}
      {!panel.minimized
        ? (["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeDirection[]).map((direction) => (
            <div
              key={direction}
              className={`panel-resize-handle resize-${direction}`}
              data-testid={`resize-${panel.id}-${direction}`}
              onPointerDown={(event) => startResize(direction, event)}
              onPointerMove={moveResize}
              onPointerUp={endResize}
            />
          ))
        : null}
    </section>
  );
}
