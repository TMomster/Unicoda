/**
 * SearXNG 搜索配置 Context
 *
 * 管理 SearXNG 搜索引擎的配置（实例地址、分类、语言等）。
 * 遵循 ThemeContext / LockContext / ModelContext 相同的持久化模式。
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { readConfigFile, writeConfigFile } from "../utils/configStorage";

/** SearXNG 配置 */
export interface SearxngConfig {
  /** 是否启用 SearXNG（启用后替代 Bing） */
  enabled: boolean;
  /** SearXNG 实例地址，如 http://localhost:8888 */
  baseUrl: string;
  /**
   * 搜索分类，逗号分隔。可选值：
   * general, news, images, videos, files, music, social, it
   */
  categories: string;
  /** 搜索语言，如 zh-CN / en-US / all */
  language: string;
  /** 安全搜索等级：0 = 关闭, 1 = 中等, 2 = 严格 */
  safeSearch: number;
}

export const DEFAULT_SEARXNG_CONFIG: SearxngConfig = {
  enabled: false,
  baseUrl: "http://127.0.0.1:8888",
  categories: "general",
  language: "zh-CN",
  safeSearch: 0,
};

const SEARXNG_CONFIG_KEY = "unison-searxng";

// ─── Context ────────────────────────────────────────────────────────

interface SearchContextValue {
  config: SearxngConfig;
  updateConfig: (partial: Partial<SearxngConfig>) => void;
  resetConfig: () => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

// ─── Provider ──────────────────────────────────────────────────────

export function SearchProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SearxngConfig>(DEFAULT_SEARXNG_CONFIG);
  const loadedRef = useRef(false);

  // 异步加载持久化配置
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    readConfigFile<SearxngConfig>(
      SEARXNG_CONFIG_KEY,
      DEFAULT_SEARXNG_CONFIG,
    ).then((loaded) => {
      setConfig(loaded);
    });
  }, []);

  // 写入配置（立即更新 state + 持久化）
  const updateConfig = useCallback((partial: Partial<SearxngConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      writeConfigFile(SEARXNG_CONFIG_KEY, next);
      return next;
    });
  }, []);

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_SEARXNG_CONFIG);
    writeConfigFile(SEARXNG_CONFIG_KEY, DEFAULT_SEARXNG_CONFIG);
  }, []);

  return (
    <SearchContext.Provider value={{ config, updateConfig, resetConfig }}>
      {children}
    </SearchContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────

export function useSearch(): SearchContextValue {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be used within SearchProvider");
  return ctx;
}
