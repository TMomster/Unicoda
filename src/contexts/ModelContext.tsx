import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from "react";
import type { ModelConfig } from "../types";
import { readConfigFile, writeConfigFile, saveApiKey, loadApiKey, deleteApiKey } from "../utils/configStorage";

const STORAGE_KEY = "unicoda-models";

let nextModelId = 1;

const DEFAULT_PARAMS: ModelConfig["params"] = { temperature: 1, maxTokens: 4096, topP: 1, frequencyPenalty: 0, presencePenalty: 0, allowFileUpload: false };

function normalizeModel(m: ModelConfig): ModelConfig {
  return { ...m, params: { ...DEFAULT_PARAMS, ...(m.params ?? {}) } };
}

const DEFAULT_PRESETS: ModelConfig[] = [
  {
    id: "preset-openai",
    name: "OpenAI GPT-4o",
    provider: "OpenAI",
    apiKey: "",
    modelName: "gpt-4o",
    baseUrl: "",
    params: { temperature: 1, maxTokens: 4096, topP: 1, frequencyPenalty: 0, presencePenalty: 0, allowFileUpload: true },
  },
  {
    id: "preset-claude",
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    apiKey: "",
    modelName: "claude-3-5-sonnet-20241022",
    baseUrl: "",
    params: { temperature: 1, maxTokens: 4096, topP: 1, frequencyPenalty: 0, presencePenalty: 0, allowFileUpload: true },
  },
  {
    id: "preset-gemini",
    name: "Gemini 2.0 Flash",
    provider: "Google",
    apiKey: "",
    modelName: "gemini-2.0-flash",
    baseUrl: "",
    params: { temperature: 1, maxTokens: 8192, topP: 1, frequencyPenalty: 0, presencePenalty: 0, allowFileUpload: true },
  },
];

function loadModels(): ModelConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr: ModelConfig[] = JSON.parse(raw);
      // restore nextModelId to avoid collision
      for (const m of arr) {
        const num = parseInt(m.id.replace(/^model-/, ""), 10);
        if (!isNaN(num) && num >= nextModelId) nextModelId = num + 1;
      }
      return arr.map(normalizeModel);
    }
  } catch {}
  return DEFAULT_PRESETS;
}

interface ModelContextType {
  models: ModelConfig[];
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
  addModel: () => void;
  updateModel: (id: string, data: Partial<ModelConfig>) => void;
  removeModel: (id: string) => void;
  selectedModel: ModelConfig | undefined;
}

const ModelContext = createContext<ModelContextType | null>(null);

export function ModelProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<ModelConfig[]>(loadModels);
  const [selectedModelId, setSelectedModelId] = useState<string>("");

  // 从配置文件异步加载（覆盖 localStorage 缓存）
  useEffect(() => {
    readConfigFile<ModelConfig[]>(STORAGE_KEY, DEFAULT_PRESETS).then(async (fileModels) => {
      // 从 Credential Manager 恢复每个模型的 API Key
      const restored = await Promise.all(
        fileModels.map(async (m) => {
          const apiKey = await loadApiKey(m.id);
          return { ...m, apiKey: apiKey || m.apiKey };
        }),
      );
      setModels(restored.map(normalizeModel));
      // 恢复 nextModelId
      for (const m of restored) {
        const num = parseInt(m.id.replace(/^model-/, ""), 10);
        if (!isNaN(num) && num >= nextModelId) nextModelId = num + 1;
      }
    });
  }, []);

  // Auto-select first model on init
  useEffect(() => {
    if (!selectedModelId && models.length > 0) {
      setSelectedModelId(models[0].id);
    }
  }, [models, selectedModelId]);

  const persist = useCallback(async (next: ModelConfig[]) => {
    // 保存模型配置到加密文件（不含 API Key）
    const safe = next.map(({ apiKey: _, ...rest }) => ({ ...rest, apiKey: "" }));
    writeConfigFile(STORAGE_KEY, safe);

    // 将 API Key 分别存入 Credential Manager
    for (const m of next) {
      if (m.apiKey) {
        await saveApiKey(m.id, m.apiKey);
      }
    }
  }, []);

  const addModel = useCallback(() => {
    const newModel: ModelConfig = {
      id: `model-${nextModelId++}`,
      name: "New Model",
      provider: "Custom",
      apiKey: "",
      modelName: "",
      baseUrl: "",
      params: { temperature: 1, maxTokens: 4096, topP: 1, frequencyPenalty: 0, presencePenalty: 0, allowFileUpload: false },
    };
    setModels((prev) => {
      const next = [...prev, newModel];
      persist(next);
      return next;
    });
    setSelectedModelId(newModel.id);
  }, [persist]);

  const updateModel = useCallback((id: string, data: Partial<ModelConfig>) => {
    setModels((prev) => {
      const next = prev.map((m) => (m.id === id ? { ...m, ...data } : m));
      persist(next);
      return next;
    });
  }, [persist]);

  const removeModel = useCallback((id: string) => {
    setModels((prev) => {
      const next = prev.filter((m) => m.id !== id);
      persist(next);
      return next;
    });
    // 清理 Credential Manager 中的 API Key
    deleteApiKey(id);
    setSelectedModelId((curr) => (curr === id ? "" : curr));
  }, [persist]);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId),
    [models, selectedModelId],
  );

  const value = useMemo<ModelContextType>(
    () => ({
      models,
      selectedModelId,
      setSelectedModelId,
      addModel,
      updateModel,
      removeModel,
      selectedModel,
    }),
    [models, selectedModelId, addModel, updateModel, removeModel, selectedModel],
  );

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useModels(): ModelContextType {
  const ctx = useContext(ModelContext);
  if (!ctx) throw new Error("useModels must be used within ModelProvider");
  return ctx;
}
