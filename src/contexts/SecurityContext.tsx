import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import { readConfigFile, writeConfigFile } from "../utils/configStorage";

// ── 持久化配置项 ─────────────────────────────────────
interface SavedSecuritySettings {
  securityServiceEnabled: boolean;
}

const SETTINGS_KEY = "security";
const DEFAULT_SECURITY_ENABLED = true;

function loadSettingsSync(): SavedSecuritySettings {
  try {
    const raw = readConfigFile(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        securityServiceEnabled:
          typeof parsed.securityServiceEnabled === "boolean"
            ? parsed.securityServiceEnabled
            : DEFAULT_SECURITY_ENABLED,
      };
    }
  } catch {
    // 静默降级
  }
  return { securityServiceEnabled: DEFAULT_SECURITY_ENABLED };
}

function saveSettings(settings: SavedSecuritySettings) {
  try {
    writeConfigFile(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 静默降级
  }
}

// ── Context 类型 ──────────────────────────────────────
export interface SecurityContextType {
  /** 安全服务是否全局启用（设置开关） */
  securityEnabled: boolean;
  /** 设置安全服务状态（外部调用方处理确认弹窗） */
  setSecurityEnabled: (enabled: boolean) => void;
  /** 是否正在监控：securityEnabled && mode === "Agent" */
  isMonitoring: boolean;
  /** 当前对话模式（由外部传入） */
  mode: "Chat" | "Agent";
  /** 设置对话模式 */
  setMode: (mode: "Chat" | "Agent") => void;
  /** 二次确认待处理中，设置面板需阻止再次点击 */
  pendingToggleConfirm: boolean;
  setPendingToggleConfirm: (v: boolean) => void;
}

const SecurityContext = createContext<SecurityContextType | null>(null);

// ── Provider ──────────────────────────────────────────
export function SecurityProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SavedSecuritySettings>(loadSettingsSync);
  const [mode, setMode] = useState<"Chat" | "Agent">("Chat");
  const [pendingToggleConfirm, setPendingToggleConfirm] = useState(false);

  const securityEnabled = settings.securityServiceEnabled;
  const isMonitoring = securityEnabled && mode === "Agent";

  const setSecurityEnabled = useCallback((enabled: boolean) => {
    const next: SavedSecuritySettings = { securityServiceEnabled: enabled };
    setSettings(next);
    saveSettings(next);
  }, []);

  const value = useMemo<SecurityContextType>(
    () => ({
      securityEnabled,
      setSecurityEnabled,
      isMonitoring,
      mode,
      setMode,
      pendingToggleConfirm,
      setPendingToggleConfirm,
    }),
    [securityEnabled, isMonitoring, mode, pendingToggleConfirm],
  );

  return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>;
}

export function useSecurity(): SecurityContextType {
  const ctx = useContext(SecurityContext);
  if (!ctx) throw new Error("useSecurity must be used within SecurityProvider");
  return ctx;
}
