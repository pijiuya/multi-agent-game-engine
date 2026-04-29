import type { KeyboardEvent } from "react";
import type { AgentProfile, CanvasPoint, Point, SelectionState, WorldItem, WorldMap, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  selection: SelectionState;
  canvasPoints: CanvasPoint[];
  onUpdateMap: (patch: Partial<Pick<WorldMap, "name" | "width" | "height" | "background_image">>) => void;
  onUpdateAgent: (agentId: string, patch: Partial<Omit<AgentProfile, "id">>) => void;
  onUpdateItem: (itemId: string, patch: Partial<Omit<WorldItem, "id">>) => void;
  onUploadItemImage: (itemId: string, file: File) => void;
};

export function PropertiesPanel({
  world,
  selection,
  canvasPoints,
  onUpdateMap,
  onUpdateAgent,
  onUpdateItem,
  onUploadItemImage
}: Props) {
  return (
    <div className="properties-panel" key={`${selection.kind}-${selection.id}`}>
      <div className="property-heading">
        <strong>{selectionKindLabel(selection.kind)}</strong>
        <span>{selection.id}</span>
      </div>
      {renderEditor({ world, selection, canvasPoints, onUpdateMap, onUpdateAgent, onUpdateItem, onUploadItemImage })}
    </div>
  );
}

function renderEditor(props: Props) {
  const { world, selection, canvasPoints, onUpdateMap, onUpdateAgent, onUpdateItem, onUploadItemImage } = props;

  if (selection.kind === "agent") {
    const profile = world.agent_profiles[selection.id];
    const state = world.agent_states[selection.id];
    if (!profile || !state) {
      return <Missing label="没有找到 Agent" />;
    }
    return (
      <div className="property-grid">
        <Editable label="名称" value={profile.name} onCommit={(name) => onUpdateAgent(profile.id, { name })} />
        <Editable label="身份" value={profile.role} onCommit={(role) => onUpdateAgent(profile.id, { role })} />
        <Editable label="简介" value={profile.identity} onCommit={(identity) => onUpdateAgent(profile.id, { identity })} />
        <Editable label="颜色" value={profile.color} onCommit={(color) => onUpdateAgent(profile.id, { color })} />
        <Readonly label="位置" value={formatPoint(state.position)} />
        <Readonly label="动作空间" value={profile.action_space.join(", ")} />
      </div>
    );
  }

  if (selection.kind === "item") {
    const item = world.map.items.find((candidate) => candidate.id === selection.id);
    if (!item) {
      return <Missing label="没有找到元素" />;
    }
    return (
      <div className="property-grid">
        <Editable label="名称" value={item.name} onCommit={(name) => onUpdateItem(item.id, { name })} />
        <Readonly label="位置" value={formatPoint(item.position)} />
        <EditableNumber label="半径" value={item.radius} onCommit={(radius) => onUpdateItem(item.id, { radius })} />
        <EditableNumber label="缩放" value={item.scale} step={0.05} onCommit={(scale) => onUpdateItem(item.id, { scale })} />
        <EditableNumber label="旋转" value={item.rotation} onCommit={(rotation) => onUpdateItem(item.id, { rotation })} />
        <Editable label="标签" value={item.tags.join(", ")} onCommit={(tags) => onUpdateItem(item.id, { tags: parseTags(tags) })} />
        <Editable label="简介" value={item.description} onCommit={(description) => onUpdateItem(item.id, { description })} />
        <label className="property-file">
          <span>图片</span>
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                onUploadItemImage(item.id, file);
              }
              event.currentTarget.value = "";
            }}
          />
          <small>{item.image ?? "无"}</small>
        </label>
      </div>
    );
  }

  if (selection.kind === "area") {
    const area = [
      ...world.map.walkable_areas,
      ...world.map.obstacles,
      ...world.map.interaction_zones
    ].find((candidate) => candidate.id === selection.id);
    if (!area) {
      return <Missing label="没有找到区域" />;
    }
    return (
      <div className="property-grid">
        <Readonly label="名称" value={area.name} />
        <Readonly label="类型" value={areaKindLabel(area.kind)} />
        <Readonly label="点位" value={String(area.points.length)} />
        <Readonly label="比例" value="地图单位" />
        <Readonly label="简介" value={JSON.stringify(area.metadata ?? {})} />
      </div>
    );
  }

  if (selection.kind === "point") {
    const point = canvasPoints.find((candidate) => candidate.id === selection.id);
    if (!point) {
      return <Missing label="没有找到空点" />;
    }
    return (
      <div className="property-grid">
        <Readonly label="名称" value={point.name} />
        <Readonly label="类型" value="空点" />
        <Readonly label="位置" value={formatPoint(point.position)} />
        <Readonly label="吸附" value={point.snapped ? "已吸附到网格" : "自由点"} />
      </div>
    );
  }

  return (
    <div className="property-grid">
      <Editable label="名称" value={displayName(world.map.name)} onCommit={(name) => onUpdateMap({ name })} />
      <Readonly label="类型" value="2D 场景地图" />
      <EditableNumber label="宽度" value={world.map.width} onCommit={(width) => onUpdateMap({ width })} />
      <EditableNumber label="高度" value={world.map.height} onCommit={(height) => onUpdateMap({ height })} />
      <Readonly label="背景图" value={world.map.background_image ?? "无"} />
      <Readonly label="简介" value="手绘地图背景，互动内容由人工标注。" />
    </div>
  );
}

function Editable({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  function commitValue(raw: string) {
    const next = raw.trim();
    if (next && next !== value) {
      onCommit(next);
    }
  }
  return (
    <label className="property-edit-row">
      <span>{label}</span>
      <input
        key={value}
        defaultValue={value}
        onBlur={(event) => commitValue(event.currentTarget.value)}
        onKeyDown={(event) => submitOnEnter(event, () => commitValue(event.currentTarget.value))}
      />
    </label>
  );
}

function EditableNumber({
  label,
  value,
  step = 1,
  onCommit
}: {
  label: string;
  value: number;
  step?: number;
  onCommit: (value: number) => void;
}) {
  function commitValue(raw: string) {
    const next = Number(raw);
    if (Number.isFinite(next) && next !== value) {
      onCommit(next);
    }
  }
  return (
    <label className="property-edit-row">
      <span>{label}</span>
      <input
        key={value}
        type="number"
        step={step}
        defaultValue={String(value)}
        onBlur={(event) => commitValue(event.currentTarget.value)}
        onKeyDown={(event) => submitOnEnter(event, () => commitValue(event.currentTarget.value))}
      />
    </label>
  );
}

function Readonly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Missing({ label }: { label: string }) {
  return (
    <div className="property-grid">
      <Readonly label="缺失" value={label} />
    </div>
  );
}

function submitOnEnter(event: KeyboardEvent<HTMLInputElement>, commit: () => void) {
  if (event.key === "Enter") {
    commit();
    event.currentTarget.blur();
  }
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatPoint(point: Point) {
  return `${Math.round(point.x)}, ${Math.round(point.y)}`;
}

function selectionKindLabel(kind: SelectionState["kind"]) {
  const labels: Record<SelectionState["kind"], string> = {
    map: "地图",
    agent: "Agent",
    item: "元素",
    area: "区域",
    point: "空点"
  };
  return labels[kind];
}

function areaKindLabel(kind: string) {
  const labels: Record<string, string> = {
    walkable: "可行走区",
    obstacle: "障碍区",
    zone: "互动区"
  };
  return labels[kind] ?? kind;
}

function displayName(name: string) {
  const labels: Record<string, string> = {
    "New Sandbox": "新沙盒",
    "Untitled Map": "未命名地图"
  };
  return labels[name] ?? name;
}
