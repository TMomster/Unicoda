import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { writeConfigFile } from "../utils/configStorage";

interface FontOption {
  name: string;
  label: string;
}

export type ThemeMode = "dark" | "light";

interface ThemeContextType {
  scale: number;
  fontFamily: string;
  selectedFontName: string;
  fontOptions: FontOption[];
  locale: Locale;
  t: (key: string) => string;
  sessionPath: string;
  userName: string;
  userAvatar: string;
  defaultMarkdown: boolean;
  defaultReasoningOpen: boolean;
  developerMode: boolean;
  theme: ThemeMode;
  setScale: (s: number) => void;
  setSelectedFont: (fontName: string) => void;
  setLocale: (locale: Locale) => void;
  setSessionPath: (path: string) => void;
  setUserName: (name: string) => void;
  setUserAvatar: (dataUrl: string) => void;
  setDefaultMarkdown: (v: boolean) => void;
  setDefaultReasoningOpen: (v: boolean) => void;
  setDeveloperMode: (v: boolean) => void;
  setTheme: (v: ThemeMode) => void;
  resetSettings: () => void;
}

const STORAGE_KEY = "unison-theme";

const FONT_OPTIONS: FontOption[] = [
  { name: "Noto Sans SC", label: "思源黑体 (Noto Sans SC)" },
  { name: "Smiley Sans", label: "得意黑 (Smiley Sans)" },
  { name: "Maple Mono", label: "Maple Mono" },
];

const DEFAULT_FALLBACKS = [
  '"Segoe UI"', '"PingFang SC"', '"Microsoft YaHei"',
  '"PingFang TC"', '"Microsoft JhengHei"', '"Hiragino Sans"',
  '"Noto Sans"', "sans-serif",
];

function buildFontFamily(primary: string): string {
  const name = primary.replace(/"/g, "");
  // 英文字体（Maple Mono）无法渲染中文时，回退到思源黑体
  const chineseFallback = name === "Maple Mono" ? '"Noto Sans SC"' : undefined;
  const fallbacks = chineseFallback
    ? [chineseFallback, ...DEFAULT_FALLBACKS]
    : DEFAULT_FALLBACKS;
  return [`"${name}"`, ...fallbacks].join(", ");
}

// 缩放基准：70% 作为 100% 标准
const BASELINE_SCALE = 0.70;

interface SavedSettings { scale: number; fontName: string; locale: Locale; sessionPath: string; userName: string; userAvatar: string; defaultMarkdown: boolean; defaultReasoningOpen: boolean; developerMode: boolean; theme: ThemeMode; }

/** 外观/行为默认值（resetSettings 会回到这些值，不含隐私和模型配置） */
const DEFAULT_SETTINGS: SavedSettings = { scale: 100, fontName: FONT_OPTIONS[0].name, locale: "en-US" as Locale, sessionPath: "", userName: "用户", userAvatar: "", defaultMarkdown: true, defaultReasoningOpen: true, developerMode: false, theme: "dark" };

function loadSettingsSync(): SavedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s: SavedSettings = JSON.parse(raw);
      // 旧格式迁移（0.70-1.30 → 100-185）
      let scale = s.scale;
      if (scale < 2) {
        scale = Math.round(scale / BASELINE_SCALE * 100);
      }
      return {
        scale: scale ?? 100,
        fontName: s.fontName || FONT_OPTIONS[0].name,
        locale: s.locale ?? "en-US",
        sessionPath: s.sessionPath ?? "",
        userName: s.userName ?? "用户",
        userAvatar: s.userAvatar ?? "",
        defaultMarkdown: s.defaultMarkdown ?? true,
        defaultReasoningOpen: s.defaultReasoningOpen ?? true,
        developerMode: s.developerMode ?? false,
        theme: s.theme ?? "dark",
      };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

/** 将存储的百分比值转换为实际 CSS transform 值 */
export function scaleToTransform(percent: number): number {
  return percent / 100 * BASELINE_SCALE;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(loadSettingsSync);

  const fontFamily = useMemo(() => buildFontFamily(settings.fontName), [settings.fontName]);

  const setScale = useCallback((scale: number) => {
    setSettings((prev) => {
      const next = { ...prev, scale };
      writeConfigFile(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setSelectedFont = useCallback((fontName: string) => {
    setSettings((prev) => {
      const next = { ...prev, fontName };
      writeConfigFile(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setLocale = useCallback((locale: Locale) => {
    setSettings((prev) => {
      const next = { ...prev, locale };
      writeConfigFile(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setSessionPath = useCallback((sessionPath: string) => {
    setSettings((prev) => {
      const next = { ...prev, sessionPath };
      writeConfigFile(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setUserName = useCallback((userName: string) => {
    setSettings((prev) => {
      const next = { ...prev, userName };
      writeConfigFile(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setUserAvatar = useCallback((userAvatar: string) => {
    setSettings((prev) => {
      const next = { ...prev, userAvatar };
      writeConfigFile(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setDefaultMarkdown = useCallback((v: boolean) => {
    setSettings((prev) => {
      const next = { ...prev, defaultMarkdown: v };
      writeConfigFile(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setDefaultReasoningOpen = useCallback((v: boolean) => {
    setSettings((prev) => {
      const next = { ...prev, defaultReasoningOpen: v };
      writeConfigFile(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setDeveloperMode = useCallback((v: boolean) => {
    setSettings((prev) => {
      const next = { ...prev, developerMode: v };
      writeConfigFile(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const setTheme = useCallback((v: ThemeMode) => {
    const root = document.documentElement;
    // Add transition class immediately so browser registers it
    root.classList.add('theme-transition');
    // Double rAF: defer theme change to the NEXT frame,
    // ensuring the class is painted before CSS variables change
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSettings((prev) => {
          const next = { ...prev, theme: v };
          writeConfigFile(STORAGE_KEY, next);
          return next;
        });
        // Remove class after animation completes
        setTimeout(() => {
          root.classList.remove('theme-transition');
        }, 650);
      });
    });
  }, []);

  /** 重置外观/行为配置（不含隐私和模型） */
  const resetSettings = useCallback(() => {
    setSettings((prev) => {
      const next = {
        ...DEFAULT_SETTINGS,
        // 保留这些不重置
        sessionPath: prev.sessionPath,
        userName: prev.userName,
        userAvatar: prev.userAvatar,
      };
      writeConfigFile(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const translate = useCallback(
    (key: string) => t(settings.locale, key),
    [settings.locale],
  );

  const value = useMemo(
    () => ({
      scale: settings.scale,
      fontFamily,
      selectedFontName: settings.fontName,
      fontOptions: FONT_OPTIONS,
      locale: settings.locale,
      t: translate,
      sessionPath: settings.sessionPath,
      userName: settings.userName,
      userAvatar: settings.userAvatar,
      defaultMarkdown: settings.defaultMarkdown,
      defaultReasoningOpen: settings.defaultReasoningOpen,
      developerMode: settings.developerMode,
      theme: settings.theme,
      setScale,
      setSelectedFont,
      setLocale,
      setSessionPath,
      setUserName,
      setUserAvatar,
      setDefaultMarkdown,
      setDefaultReasoningOpen,
      setDeveloperMode,
      setTheme,
      resetSettings,
    }),
    [settings, fontFamily, translate, setScale, setSelectedFont, setLocale, setSessionPath, setUserName, setUserAvatar, setDefaultMarkdown, setDefaultReasoningOpen, setDeveloperMode, setTheme, resetSettings],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
