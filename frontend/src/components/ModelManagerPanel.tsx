import { Plus, Save, TestTube2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ModelCapability, ModelConfig } from "../types";

type TestResult = {
  ok: boolean;
  message: string;
  provider: string;
};

type Props = {
  models: ModelConfig[];
  onSaveModels: (models: ModelConfig[]) => Promise<void> | void;
  onTestModel: (modelId: string) => Promise<TestResult>;
};

const CAPABILITIES: { value: ModelCapability; label: string }[] = [
  { value: "llm", label: "LLM" },
  { value: "image_generation", label: "图片生成" },
  { value: "segmentation", label: "SAM 分层" },
  { value: "vision_labeling", label: "图像识别" }
];

export function ModelManagerPanel({ models, onSaveModels, onTestModel }: Props) {
  const [draftModels, setDraftModels] = useState<ModelConfig[]>(models);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  useEffect(() => {
    setDraftModels(models);
  }, [models]);

  function updateModel(id: string, patch: Partial<ModelConfig>) {
    setDraftModels((current) => current.map((model) => (model.id === id ? { ...model, ...patch } : model)));
  }

  function toggleCapability(model: ModelConfig, capability: ModelCapability) {
    const current = new Set(model.capabilities);
    if (current.has(capability)) {
      current.delete(capability);
    } else {
      current.add(capability);
    }
    updateModel(model.id, { capabilities: Array.from(current) });
  }

  function addModel() {
    const id = `model_${Date.now()}`;
    setDraftModels((current) => [
      ...current,
      {
        id,
        name: "新模型",
        kind: "remote",
        provider: "http",
        baseUrl: "",
        model: "",
        enabled: false,
        capabilities: []
      }
    ]);
  }

  async function testConnection(modelId: string) {
    setTestResults((current) => ({
      ...current,
      [modelId]: { ok: false, provider: "", message: "测试中" }
    }));
    await onSaveModels(draftModels);
    const result = await onTestModel(modelId);
    setTestResults((current) => ({ ...current, [modelId]: result }));
  }

  return (
    <div className="model-manager-panel" data-testid="model-manager-panel">
      <div className="panel-section-label">模型管理</div>
      <div className="model-config-list" data-testid="model-config-list">
        {draftModels.map((model) => {
          const result = testResults[model.id];
          return (
            <div className="model-config-row" data-testid={`model-config-${model.id}`} key={model.id}>
              <label className="model-enable-row">
                <input
                  checked={model.enabled}
                  onChange={(event) => updateModel(model.id, { enabled: event.currentTarget.checked })}
                  type="checkbox"
                />
                <span>{model.name}</span>
              </label>
              <div className="model-field-grid">
                <label>
                  <span>名称</span>
                  <input
                    aria-label={`${model.name} 名称`}
                    onChange={(event) => updateModel(model.id, { name: event.currentTarget.value })}
                    value={model.name}
                  />
                </label>
                <label>
                  <span>Provider</span>
                  <input
                    aria-label={`${model.name} Provider`}
                    onChange={(event) => updateModel(model.id, { provider: event.currentTarget.value })}
                    value={model.provider}
                  />
                </label>
                <label>
                  <span>模型</span>
                  <input
                    aria-label={`${model.name} 模型`}
                    onChange={(event) => updateModel(model.id, { model: event.currentTarget.value })}
                    value={model.model}
                  />
                </label>
                <label>
                  <span>HTTP 地址</span>
                  <input
                    aria-label={`${model.name} HTTP 地址`}
                    onChange={(event) => updateModel(model.id, { baseUrl: event.currentTarget.value })}
                    value={model.baseUrl}
                  />
                </label>
              </div>
              <div className="capability-row" aria-label={`${model.name} 能力`}>
                {CAPABILITIES.map((capability) => (
                  <label key={capability.value}>
                    <input
                      checked={model.capabilities.includes(capability.value)}
                      onChange={() => toggleCapability(model, capability.value)}
                      type="checkbox"
                    />
                    <span>{capability.label}</span>
                  </label>
                ))}
              </div>
              <div className="model-row-actions">
                <button className="model-test-button" onClick={() => void testConnection(model.id)} type="button">
                  <TestTube2 size={14} />
                  测试连接
                </button>
                <button
                  aria-label={`删除 ${model.name}`}
                  className="model-delete-button"
                  onClick={() => setDraftModels((current) => current.filter((item) => item.id !== model.id))}
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {result ? (
                <div className={result.ok ? "model-test-result ok" : "model-test-result error"} data-testid={`model-test-${model.id}`}>
                  {result.message}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <button className="panel-action-button" onClick={addModel} type="button">
        <Plus size={15} />
        新增模型
      </button>
      <button className="panel-action-button" onClick={() => onSaveModels(draftModels)} type="button">
        <Save size={15} />
        保存模型配置
      </button>
    </div>
  );
}
