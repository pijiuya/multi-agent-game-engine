import { Activity, AlertTriangle, Cloud, Cpu, HardDrive, Image as ImageIcon, RefreshCw, Server } from "lucide-react";
import { useEffect, useState } from "react";
import type { RuntimeModelStatus, RuntimePendingModelTask, RuntimeStatus } from "../types";

type Props = {
  status: RuntimeStatus | null;
  stale: boolean;
  onRefresh: () => void;
};

export function RuntimeMonitorPanel({ status, stale, onRefresh }: Props) {
  const [samples, setSamples] = useState<RuntimeSample[]>([]);
  const localModels = status?.models.filter((model) => model.kind !== "remote") ?? [];
  const remoteModels = status?.models.filter((model) => model.kind === "remote") ?? [];
  const imageTasks = status?.simulation.recentImageGenerationTasks ?? [];
  const runningImageTasks = imageTasks.filter((task) => task.status === "running");
  const recoveryEntries = Object.entries(status?.simulation.providerRecovery ?? {}).filter(([, entry]) => entry.remainingTicks > 0);
  const agentDecisionTasks = status?.simulation.pendingModelTasks.filter((task) => task.operation === "agent_decision" || task.taskKind === "agent_decision") ?? [];

  useEffect(() => {
    if (!status) {
      return;
    }
    setSamples((current) => [...current, runtimeSample(status)].slice(-72));
  }, [status?.timestamp, status?.simulation.tick]);

  return (
    <div className="runtime-monitor-panel" data-testid="runtime-monitor-panel">
      <div className="runtime-monitor-header">
        <div>
          <strong>运行监控</strong>
          <small>{status ? `更新于 ${formatTime(status.timestamp)}` : "等待本机引擎数据"}</small>
        </div>
        <button className="panel-action-button" onClick={onRefresh} type="button">
          <RefreshCw size={15} />
          刷新
        </button>
      </div>

      {stale ? (
        <div className="runtime-warning" data-testid="runtime-monitor-stale">
          <AlertTriangle size={15} />
          <span>连接中断，正在保留上一次监控数据。</span>
        </div>
      ) : null}

      {recoveryEntries.length ? (
        <div className="runtime-warning" data-testid="runtime-monitor-recovery">
          <AlertTriangle size={15} />
          <span>
            模型拥堵自愈中：
            {recoveryEntries
              .map(([provider, entry]) => `${provider} 约 ${Math.ceil(entry.remainingTicks / 10)}s`)
              .join(" / ")}
            ，agent 暂用本地轻量规则继续行动。
          </span>
        </div>
      ) : null}

      <div className="runtime-metric-grid">
        <MetricCard
          icon={<Activity size={16} />}
          label="模拟运行"
          value={status?.simulation.running ? "运行中" : "已暂停"}
          detail={status ? `Tick ${status.simulation.tick}` : "暂无数据"}
        />
        <MetricCard
          icon={<Server size={16} />}
          label="模型调用"
          value={`${status?.simulation.pendingModelTaskCount ?? 0}`}
          detail={runningImageTasks.length ? `图片生成 ${runningImageTasks.length} 个` : status?.simulation.sceneDirectorPending ? "叙事导演处理中" : "无叙事导演任务"}
        />
        <MetricCard
          icon={<Cpu size={16} />}
          label="CPU 压力"
          value={percentLabel(status?.hardware.loadPercent)}
          detail={loadLabel(status)}
        />
        <MetricCard
          icon={<HardDrive size={16} />}
          label="内存压力"
          value={percentLabel(status?.hardware.memoryUsedPercent)}
          detail={memoryLabel(status)}
        />
      </div>

      <section className="runtime-profiler" data-testid="runtime-profiler">
        <div className="runtime-section-title">
          <Activity size={15} />
          <span>Profiler 波形</span>
        </div>
        <RuntimeWaveGraph samples={samples} />
        <div className="runtime-profiler-legend">
          <span className="cpu">CPU</span>
          <span className="memory">内存</span>
          <span className="model">模型队列</span>
        </div>
      </section>

      <section className="runtime-section">
        <div className="runtime-section-title">
          <ImageIcon size={15} />
          <span>图片生成</span>
        </div>
        <ImageTaskList tasks={imageTasks} />
      </section>

      <section className="runtime-section">
        <div className="runtime-section-title">
          <Cpu size={15} />
          <span>Agent 决策</span>
        </div>
        <AgentDecisionTaskList tasks={agentDecisionTasks} />
      </section>

      <section className="runtime-section">
        <div className="runtime-section-title">
          <Server size={15} />
          <span>本地模型</span>
        </div>
        <ModelList models={localModels} empty="暂无本地模型配置" />
      </section>

      <section className="runtime-section">
        <div className="runtime-section-title">
          <Cloud size={15} />
          <span>线上模型</span>
        </div>
        <ModelList models={remoteModels} empty="暂无线上模型配置" />
      </section>

      <section className="runtime-section">
        <div className="runtime-section-title">
          <Cpu size={15} />
          <span>本地设备</span>
        </div>
        <div className="runtime-device-card">
          <strong>{status?.hardware.chip || status?.hardware.platform.machine || "未知设备"}</strong>
          <small>{status ? `${status.hardware.platform.system} ${status.hardware.platform.release}` : "暂无平台信息"}</small>
          <span>{status?.hardware.gpuPressureReason || "GPU/M 系列压力需要更高权限采样，本面板保持低影响读取。"}</span>
        </div>
      </section>
    </div>
  );
}

type RuntimeSample = {
  cpu: number | null;
  memory: number | null;
  model: number;
};

function runtimeSample(status: RuntimeStatus): RuntimeSample {
  return {
    cpu: status.hardware.loadPercent,
    memory: status.hardware.memoryUsedPercent,
    model: Math.min(100, status.simulation.pendingModelTaskCount * 25)
  };
}

function RuntimeWaveGraph({ samples }: { samples: RuntimeSample[] }) {
  const points = samples.length ? samples : [{ cpu: null, memory: null, model: 0 }];
  return (
    <svg className="runtime-wave-graph" viewBox="0 0 320 112" role="img" aria-label="运行监控波形图">
      <defs>
        <linearGradient id="runtimeWaveFade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 25, 50, 75, 100].map((value) => (
        <g key={value}>
          <line className="runtime-wave-grid" x1="0" x2="320" y1={valueToY(value)} y2={valueToY(value)} />
          <text className="runtime-wave-label" x="4" y={valueToY(value) - 3}>{value}</text>
        </g>
      ))}
      <WaveLine className="memory" samples={points.map((sample) => sample.memory)} />
      <WaveLine className="model" samples={points.map((sample) => sample.model)} />
      <WaveLine className="cpu" samples={points.map((sample) => sample.cpu)} />
    </svg>
  );
}

function WaveLine({ className, samples }: { className: string; samples: Array<number | null> }) {
  const path = wavePath(samples);
  return path ? <path className={`runtime-wave-line ${className}`} d={path} /> : null;
}

function wavePath(samples: Array<number | null>) {
  const values = samples.map((value) => (value == null ? 0 : clampValue(value)));
  if (!values.length) {
    return "";
  }
  const step = values.length > 1 ? 320 / (values.length - 1) : 320;
  return values
    .map((value, index) => `${index === 0 ? "M" : "L"} ${Math.round(index * step * 10) / 10} ${valueToY(value)}`)
    .join(" ");
}

function valueToY(value: number) {
  return Math.round((104 - clampValue(value)) * 0.96 + 4);
}

function clampValue(value: number) {
  return Math.max(0, Math.min(100, value));
}

function MetricCard({
  icon,
  label,
  value,
  detail
}: {
  icon: JSX.Element;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="runtime-metric-card">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ModelList({ models, empty }: { models: RuntimeModelStatus[]; empty: string }) {
  if (!models.length) {
    return <div className="runtime-empty">{empty}</div>;
  }
  return (
    <div className="runtime-model-list">
      {models.map((model) => (
        <article className={model.enabled ? "runtime-model-row" : "runtime-model-row disabled"} key={model.id}>
          <div>
            <strong>{model.name || model.id}</strong>
            <small>{model.model || model.provider}</small>
          </div>
          <div className="runtime-model-badges">
            <span>{model.provider}</span>
            {model.capabilities.map((capability) => (
              <span key={capability}>{capabilityLabel(capability)}</span>
            ))}
          </div>
          <div className="runtime-model-stats">
            <span>{model.enabled ? "启用" : "停用"}</span>
            <span>调用 {model.recentEventCount}</span>
            <span>错误 {model.recentErrorCount}</span>
            {model.pendingCount ? <strong>运行中 {model.pendingCount}</strong> : <span>空闲</span>}
          </div>
        </article>
      ))}
    </div>
  );
}

function ImageTaskList({ tasks }: { tasks: RuntimePendingModelTask[] }) {
  if (!tasks.length) {
    return <div className="runtime-empty">暂无图片生成任务</div>;
  }
  return (
    <div className="runtime-model-list" data-testid="runtime-image-task-list">
      {tasks.slice(0, 8).map((task) => (
        <article className={task.status === "error" ? "runtime-model-row disabled" : "runtime-model-row"} key={task.id ?? `${task.operation}-${task.startedTick}`}>
          <div>
            <strong>{imageOperationLabel(task.operation)}</strong>
            <small>{task.prompt || `${task.width ?? "?"} x ${task.height ?? "?"}`}</small>
          </div>
          <div className="runtime-model-badges">
            <span>{task.provider || "image"}</span>
            <span>{task.model || "模型"}</span>
            {task.referenceBackground ? <span>参考背景</span> : null}
          </div>
          <div className="runtime-model-stats">
            <span>{imageTaskStatusLabel(task)}</span>
            {task.elapsedMs != null ? <span>{Math.round(task.elapsedMs / 1000)}s</span> : task.ageSeconds != null ? <span>{task.ageSeconds}s</span> : null}
            {task.error ? <span>错误</span> : task.layerId ? <span>已写入图层</span> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function AgentDecisionTaskList({ tasks }: { tasks: RuntimePendingModelTask[] }) {
  if (!tasks.length) {
    return <div className="runtime-empty">无阻塞中的 agent 决策</div>;
  }
  return (
    <div className="runtime-model-list" data-testid="runtime-agent-task-list">
      {tasks.slice(0, 6).map((task) => (
        <article className="runtime-model-row" key={task.agentId || `${task.provider}-${task.startedTick}`}>
          <div>
            <strong>{task.agentId || "agent"}</strong>
            <small>{task.provider || "provider"} / {task.model || "model"}</small>
          </div>
          <div className="runtime-model-badges">
            <span>决策中</span>
            {task.watchdogAgeTicks ? <span>watchdog {task.watchdogAgeTicks} tick</span> : null}
          </div>
          <div className="runtime-model-stats">
            <span>{task.ageTicks} tick</span>
            {task.watchdogAgeTicks ? <span>{Math.max(0, task.watchdogAgeTicks - task.ageTicks)} tick 后自愈</span> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function imageOperationLabel(operation?: string) {
  const labels: Record<string, string> = {
    background: "背景候选",
    region: "区域生成",
    extension: "边缘扩展",
    repaint: "重绘"
  };
  return labels[operation ?? ""] ?? "图片生成";
}

function imageTaskStatusLabel(task: RuntimePendingModelTask) {
  if (task.status === "running") {
    return "生成中";
  }
  if (task.status === "error") {
    return task.error ? `失败：${task.error.slice(0, 18)}` : "失败";
  }
  return "完成";
}

function capabilityLabel(capability: string) {
  const labels: Record<string, string> = {
    llm: "LLM",
    image_generation: "图片",
    segmentation: "分层",
    vision_labeling: "视觉"
  };
  return labels[capability] ?? capability;
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function percentLabel(value: number | null | undefined) {
  return value == null ? "未知" : `${Math.round(value)}%`;
}

function loadLabel(status: RuntimeStatus | null) {
  if (!status) {
    return "暂无负载";
  }
  const load = status.hardware.loadAverage[0];
  const cpuCount = status.hardware.cpuCount;
  return load == null ? `CPU ${cpuCount ?? "未知"} 核` : `1m load ${load} / ${cpuCount ?? "?"} 核`;
}

function memoryLabel(status: RuntimeStatus | null) {
  if (!status) {
    return "暂无内存";
  }
  const total = bytesToGiB(status.hardware.memoryTotalBytes);
  const available = bytesToGiB(status.hardware.memoryAvailableBytes);
  if (!total || !available) {
    return "内存读取受限";
  }
  return `${available} GiB 可用 / ${total} GiB`;
}

function bytesToGiB(value: number | null) {
  if (!value) {
    return "";
  }
  return (value / 1024 / 1024 / 1024).toFixed(1);
}
