import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from "react";
import type { ModelConfig } from "../types";
import { readConfigFile, writeConfigFile } from "../utils/configStorage";

const STORAGE_KEY = "unison-models";

let nextModelId = 1;

const DEFAULT_PARAMS: ModelConfig["params"] = { temperature: 1, maxTokens: 4096, topP: 1, frequencyPenalty: 0, presencePenalty: 0 };

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
    params: { temperature: 1, maxTokens: 4096, topP: 1, frequencyPenalty: 0, presencePenalty: 0 },
  },
  {
    id: "preset-claude",
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    apiKey: "",
    modelName: "claude-3-5-sonnet-20241022",
    baseUrl: "",
    params: { temperature: 1, maxTokens: 4096, topP: 1, frequencyPenalty: 0, presencePenalty: 0 },
  },
  {
    id: "preset-gemini",
    name: "Gemini 2.0 Flash",
    provider: "Google",
    apiKey: "",
    modelName: "gemini-2.0-flash",
    baseUrl: "",
    params: { temperature: 1, maxTokens: 8192, topP: 1, frequencyPenalty: 0, presencePenalty: 0 },
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

function saveModelsSync(models: ModelConfig[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
  } catch {}
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
    readConfigFile<ModelConfig[]>(STORAGE_KEY, DEFAULT_PRESETS).then((fileModels) => {
      setModels(fileModels.map(normalizeModel));
      // 恢复 nextModelId
      for (const m of fileModels) {
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

  const persist = useCallback((next: ModelConfig[]) => {
    saveModelsSync(next);
    writeConfigFile(STORAGE_KEY, next);
  }, []);

  const addModel = useCallback(() => {
    const newModel: ModelConfig = {
      id: `model-${nextModelId++}`,
      name: "New Model",
      provider: "Custom",
      apiKey: "",
      modelName: "",
      baseUrl: "",
      params: { temperature: 1, maxTokens: 4096, topP: 1, frequencyPenalty: 0, presencePenalty: 0 },
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
