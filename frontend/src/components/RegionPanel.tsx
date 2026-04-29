import { ChevronDown, ChevronRight, Layers3, Shapes } from "lucide-react";
import { useEffect, useState } from "react";
import type { MapRegionFunction, SelectionState, WorldSnapshot } from "../types";

type Props = {
  world: WorldSnapshot;
  selection: SelectionState;
  onSelect: (selection: SelectionState) => void;
  onObjectContext: (target: { kind: "region"; id: string }, screen: { x: number; y: number }) => void;
};

const FUNCTION_ORDER: MapRegionFunction[] = ["walkable", "obstacle", "action", "residential", "social", "custom", "unassigned"];
const REGION_SECTION_STORAGE_KEY = "agent-workstation.region-panel-sections.v1";

export function RegionPanel({ world, selection, onSelect, onObjectContext }: Props) {
  const [openSections, setOpenSections] = useState<Record<MapRegionFunction, boolean>>(() => loadOpenSections());

  useEffect(() => {
    window.localStorage.setItem(REGION_SECTION_STORAGE_KEY, JSON.stringify(openSections));
  }, [openSections]);

  return (
    <div className="region-panel" data-testid="region-panel">
      {FUNCTION_ORDER.map((fn) => {
        const layer = world.map.region_layers.find((candidate) => candidate.function === fn);
        const regions = world.map.regions.filter((region) => region.function === fn);
        const visibleCount = regions.filter((region) => !region.hidden).length;
        const open = openSections[fn] ?? true;
        const active = selection.kind === "regionLayer" && selection.id === fn;
        return (
          <section className="region-group" data-testid={`region-group-${fn}`} key={fn}>
            <div className={active ? "region-group-header active" : "region-group-header"}>
              <button className="region-group-select" onClick={() => onSelect({ kind: "regionLayer", id: fn })} type="button">
                <Layers3 size={15} />
                <span>{layer?.label ?? functionLabel(fn)}</span>
                <small>{visibleCount} 个 / {layer?.polygons.length ?? 0} 个轮廓</small>
              </button>
              <button
                aria-label={`${open ? "折叠" : "展开"}${layer?.label ?? functionLabel(fn)}`}
                className="section-toggle"
                onClick={(event) => {
                  setOpenSections((current) => ({ ...current, [fn]: !open }));
                }}
                type="button"
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            </div>
            {open ? (
              <div className="region-group-list">
                {regions.map((region) => (
                  <button
                    className={`${selection.kind === "region" && selection.id === region.id ? "scene-list-row active" : "scene-list-row"}${region.hidden ? " hidden-object" : ""}`}
                    key={region.id}
                    onClick={() => onSelect({ kind: "region", id: region.id })}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onSelect({ kind: "region", id: region.id });
                      onObjectContext({ kind: "region", id: region.id }, { x: event.clientX, y: event.clientY });
                    }}
                    type="button"
                  >
                    <Shapes size={15} />
                    <span>{region.name}</span>
                    <small>{region.hidden ? "已隐藏" : sourceLabel(region.source)}</small>
                  </button>
                ))}
                {regions.length === 0 ? <div className="region-empty">暂无区域</div> : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function loadOpenSections(): Record<MapRegionFunction, boolean> {
  const defaults = Object.fromEntries(FUNCTION_ORDER.map((fn) => [fn, true])) as Record<MapRegionFunction, boolean>;
  try {
    return { ...defaults, ...JSON.parse(window.localStorage.getItem(REGION_SECTION_STORAGE_KEY) ?? "{}") };
  } catch {
    return defaults;
  }
}

function functionLabel(value: MapRegionFunction) {
  const labels: Record<MapRegionFunction, string> = {
    walkable: "道路",
    obstacle: "不可通过",
    action: "行动区",
    residential: "居住区",
    social: "社交区",
    custom: "自定义",
    unassigned: "未设定"
  };
  return labels[value];
}

function sourceLabel(value: string) {
  if (value === "manual") {
    return "手绘";
  }
  if (value.includes("sam")) {
    return "SAM";
  }
  return value || "区域";
}
