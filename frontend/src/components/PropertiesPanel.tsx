import type { CanvasPoint, SelectionState, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  selection: SelectionState;
  canvasPoints: CanvasPoint[];
};

export function PropertiesPanel({ world, selection, canvasPoints }: Props) {
  const rows = getPropertyRows(world, selection, canvasPoints);

  return (
    <div className="properties-panel">
      <div className="property-heading">
        <strong>{selectionKindLabel(selection.kind)}</strong>
        <span>{selection.id}</span>
      </div>
      <dl className="property-grid">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function getPropertyRows(world: WorldSnapshot, selection: SelectionState, canvasPoints: CanvasPoint[]) {
  if (selection.kind === "agent") {
    const profile = world.agent_profiles[selection.id];
    const state = world.agent_states[selection.id];
    if (!profile || !state) {
      return [{ label: "缺失", value: "没有找到 Agent" }];
    }
    return [
      { label: "名称", value: profile.name },
      { label: "身份", value: profile.role },
      { label: "简介", value: profile.identity },
      { label: "模型", value: profile.model_provider },
      { label: "位置", value: `${Math.round(state.position.x)}, ${Math.round(state.position.y)}` },
      { label: "比例", value: "1.0 头像半径" },
      { label: "动作空间", value: profile.action_space.join(", ") }
    ];
  }

  if (selection.kind === "item") {
    const item = world.map.items.find((candidate) => candidate.id === selection.id);
    if (!item) {
      return [{ label: "缺失", value: "没有找到元素" }];
    }
    return [
      { label: "名称", value: item.name },
      { label: "类型", value: "元素" },
      { label: "位置", value: `${Math.round(item.position.x)}, ${Math.round(item.position.y)}` },
      { label: "比例", value: `半径 ${item.radius}` },
      { label: "标签", value: item.tags.join(", ") || "无" },
      { label: "简介", value: JSON.stringify(item.state) }
    ];
  }

  if (selection.kind === "area") {
    const area = [
      ...world.map.walkable_areas,
      ...world.map.obstacles,
      ...world.map.interaction_zones
    ].find((candidate) => candidate.id === selection.id);
    if (!area) {
      return [{ label: "缺失", value: "没有找到区域" }];
    }
    return [
      { label: "名称", value: area.name },
      { label: "类型", value: areaKindLabel(area.kind) },
      { label: "点位", value: String(area.points.length) },
      { label: "比例", value: "地图单位" },
      { label: "简介", value: JSON.stringify(area.metadata ?? {}) }
    ];
  }

  if (selection.kind === "point") {
    const point = canvasPoints.find((candidate) => candidate.id === selection.id);
    if (!point) {
      return [{ label: "缺失", value: "没有找到空点" }];
    }
    return [
      { label: "名称", value: point.name },
      { label: "类型", value: "空点" },
      { label: "位置", value: `${Math.round(point.position.x)}, ${Math.round(point.position.y)}` },
      { label: "吸附", value: point.snapped ? "已吸附到网格" : "自由点" },
      { label: "简介", value: "前端本地画布点，暂不写入后端。" }
    ];
  }

  return [
    { label: "名称", value: displayName(world.map.name) },
    { label: "类型", value: "2D 场景地图" },
    { label: "尺寸", value: `${world.map.width} x ${world.map.height}` },
    { label: "比例", value: "1 px = 1 世界单位" },
    { label: "背景图", value: world.map.background_image ?? "无" },
    { label: "简介", value: "手绘地图背景，互动内容由人工标注。" }
  ];
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
