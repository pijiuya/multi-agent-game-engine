import { Contrast, LayoutPanelTop, LocateFixed, Pause, Play, SlidersHorizontal, Square } from "lucide-react";
import { useState } from "react";

type Props = {
  appBackgroundOpacity: number;
  running: boolean;
  onRun: () => void;
  onPause: () => void;
  onStop: () => void;
  onAppBackgroundOpacity: (opacity: number) => void;
  onCenterOrigin: () => void;
  appearanceMode: "light" | "dark";
  onToggleAppearance: () => void;
  onResetPanelLayout: () => void;
};

export function TransportControls({
  appBackgroundOpacity,
  running,
  onRun,
  onPause,
  onStop,
  onAppBackgroundOpacity,
  onCenterOrigin,
  appearanceMode,
  onToggleAppearance,
  onResetPanelLayout
}: Props) {
  const [showBackgroundControls, setShowBackgroundControls] = useState(false);
  const opacityPercent = Math.round(appBackgroundOpacity * 100);

  return (
    <div className="transport-control-stack">
      <div className="transport-controls" data-testid="transport-controls">
        <button aria-label="运行" title="运行" className={running ? "active" : ""} onClick={onRun}>
          <Play size={18} />
        </button>
        <button aria-label="暂停" title="暂停" className={!running ? "active" : ""} onClick={onPause}>
          <Pause size={18} />
        </button>
        <button aria-label="停止" title="停止" onClick={onStop}>
          <Square size={17} />
        </button>
        <button aria-label="回归零点" title="回归零点" onClick={onCenterOrigin}>
          <LocateFixed size={18} />
        </button>
        <button
          aria-label="背景透明度"
          title="背景透明度"
          className={showBackgroundControls ? "active" : ""}
          onClick={() => setShowBackgroundControls((current) => !current)}
        >
          <SlidersHorizontal size={18} />
        </button>
        <button aria-label="应用默认面板布局" title="应用默认面板布局" onClick={onResetPanelLayout}>
          <LayoutPanelTop size={18} />
        </button>
        <button
          aria-label="切换黑白反色"
          aria-pressed={appearanceMode === "dark"}
          title="切换黑白反色"
          className={appearanceMode === "dark" ? "active tone-toggle" : "tone-toggle"}
          onClick={onToggleAppearance}
        >
          <Contrast size={18} />
        </button>
      </div>

      {showBackgroundControls ? (
        <section className="background-opacity-popover" data-testid="background-opacity-popover" aria-label="背景透明度设置">
          <div className="background-opacity-head">
            <span>应用背景</span>
            <strong>{opacityPercent}%</strong>
          </div>
          <label className="background-opacity-slider">
            <input
              aria-label="应用背景不透明度"
              max="1"
              min="0"
              onChange={(event) => onAppBackgroundOpacity(Number(event.currentTarget.value))}
              step="0.02"
              type="range"
              value={appBackgroundOpacity}
            />
          </label>
          <p className="background-opacity-hint">只调整应用窗口底色，不影响地图或 agent 场景。</p>
        </section>
      ) : null}
    </div>
  );
}
