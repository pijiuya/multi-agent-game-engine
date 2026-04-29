import { Contrast, LocateFixed, Pause, Play, Square } from "lucide-react";

type Props = {
  running: boolean;
  onRun: () => void;
  onPause: () => void;
  onStop: () => void;
  onCenterOrigin: () => void;
  appearanceMode: "light" | "dark";
  onToggleAppearance: () => void;
};

export function TransportControls({
  running,
  onRun,
  onPause,
  onStop,
  onCenterOrigin,
  appearanceMode,
  onToggleAppearance
}: Props) {
  return (
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
        aria-label="切换黑白反色"
        aria-pressed={appearanceMode === "dark"}
        title="切换黑白反色"
        className={appearanceMode === "dark" ? "active tone-toggle" : "tone-toggle"}
        onClick={onToggleAppearance}
      >
        <Contrast size={18} />
      </button>
    </div>
  );
}
