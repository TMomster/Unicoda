import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { readConfigFile, writeConfigFile } from "../utils/configStorage";
import { sha256 } from "../utils/crypto";

const LOCK_CONFIG_KEY = "unison-lock";

interface LockConfig {
  /** SHA-256 哈希后的密码，空字符串表示未设置 */
  passwordHash: string;
  /** 当前是否处于锁定状态 */
  isLocked: boolean;
  /** 隐私服务总开关 */
  privacyEnabled: boolean;
  /** 闲置自动锁定时间（分钟），默认 5 */
  idleTimeout: number;
  /** 启动时要求输入密码 */
  startupLockEnabled: boolean;
}

const DEFAULT_LOCK: LockConfig = {
  passwordHash: "",
  isLocked: false,
  privacyEnabled: false,
  idleTimeout: 5,
  startupLockEnabled: false,
};

interface LockContextType {
  privacyEnabled: boolean;
  setPrivacyEnabled: (enabled: boolean) => Promise<void>;
  idleTimeout: number;
  setIdleTimeout: (minutes: number) => Promise<void>;
  hasPassword: boolean;
  isLocked: boolean;
  startupLockEnabled: boolean;
  setStartupLockEnabled: (enabled: boolean) => Promise<void>;
  lock: () => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  setPassword: (password: string) => Promise<boolean>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>;
  clearPassword: (password: string) => Promise<boolean>;
}

const LockContext = createContext<LockContextType | null>(null);

async function loadLockConfig(): Promise<LockConfig> {
  const loaded = await readConfigFile<Partial<LockConfig>>(
    LOCK_CONFIG_KEY,
    DEFAULT_LOCK,
  );
  return { ...DEFAULT_LOCK, ...loaded };
}

function saveLockConfig(config: LockConfig): void {
  // fire-and-forget — don't block the event loop
  writeConfigFile(LOCK_CONFIG_KEY, config);
}

export function LockProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<LockConfig>(DEFAULT_LOCK);
  const [loaded, setLoaded] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- ref-based snapshot — always up-to-date for event handlers ----
  const configRef = useRef(config);
  configRef.current = config;

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  /** Just set isLocked via functional updater — never stale */
  const performLock = useCallback(() => {
    setConfig((prev) => {
      if (!prev.privacyEnabled || prev.passwordHash.length === 0) {
        return prev;
      }
      if (prev.isLocked) {
        return prev;
      }
      const next = { ...prev, isLocked: true };
      saveLockConfig(next);
      return next;
    });
  }, []);

  // 启动时异步加载锁定配置
  useEffect(() => {
    loadLockConfig().then((loadedConfig) => {
      // 如果未启用启动锁，则忽略持久化的 isLocked 状态
      if (!loadedConfig.startupLockEnabled) {
        loadedConfig.isLocked = false;
      }
      setConfig(loadedConfig);
      setLoaded(true);
    });
  }, []);

  // 启动后：如果启用了"启动时需输入密码"且有密码 → 自动锁定
  useEffect(() => {
    if (loaded && config.startupLockEnabled && config.privacyEnabled && config.passwordHash.length > 0) {
      setConfig((prev) => {
        if (prev.isLocked) return prev;
        const next = { ...prev, isLocked: true };
        saveLockConfig(next);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // ---- 🔐 Global hotkey Ctrl+F12 ----
  // Uses refs so the handler never goes stale; effect deps are empty so
  // the listener is registered ONCE and never churned.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "F12") {
        e.preventDefault();
        const c = configRef.current;
        if (c.privacyEnabled && c.passwordHash.length > 0 && !c.isLocked) {
          performLock();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 🕐 Idle auto-lock ----
  // Rerun whenever the relevant config values change, but use ref-based
  // startIdleTimer to avoid the closure-staleness problem.
  useEffect(() => {
    const isActive = config.privacyEnabled && config.passwordHash.length > 0;

    const activityEvents = [
      "mousedown",
      "keydown",
      "mousemove",
      "touchstart",
      "scroll",
      "wheel",
    ] as const;

    const start = () => {
      resetIdleTimer();
      const c = configRef.current;
      if (!c.privacyEnabled || c.passwordHash.length === 0) return;
      if (c.isLocked) return;
      let delayMs = c.idleTimeout * 60 * 1000;
      if (!Number.isFinite(delayMs) || delayMs <= 0) delayMs = 5 * 60 * 1000; // fallback
      idleTimerRef.current = setTimeout(() => {
        performLock();
      }, delayMs);
    };

    const handler = () => start();

    if (isActive && !config.isLocked) {
      activityEvents.forEach((ev) =>
        window.addEventListener(ev, handler, { passive: true }),
      );
      start();
    }

    if (config.isLocked) {
      resetIdleTimer();
    }

    return () => {
      activityEvents.forEach((ev) => window.removeEventListener(ev, handler));
      resetIdleTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.privacyEnabled, config.passwordHash.length, config.isLocked, config.idleTimeout]);

  // ---- Public API ----

  const lock = useCallback(async () => {
    performLock();
  }, [performLock]);

  const unlock = useCallback(
    async (password: string): Promise<boolean> => {
      const hash = await sha256(password);
      const expected = configRef.current.passwordHash;
      if (hash !== expected) return false;
      resetIdleTimer();
      setConfig((prev) => {
        if (!prev.isLocked) return prev;
        const next = { ...prev, isLocked: false };
        saveLockConfig(next);
        return next;
      });
      return true;
    },
    [resetIdleTimer],
  );

  const setPassword = useCallback(
    async (password: string): Promise<boolean> => {
      if (config.passwordHash.length > 0) return false;
      const hash = await sha256(password);
      const next: LockConfig = { ...config, passwordHash: hash, isLocked: false };
      setConfig(next);
      saveLockConfig(next);
      return true;
    },
    [config],
  );

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string): Promise<boolean> => {
      const oldHash = await sha256(oldPassword);
      if (oldHash !== configRef.current.passwordHash) return false;
      const newHash = await sha256(newPassword);
      setConfig((prev) => {
        const next = { ...prev, passwordHash: newHash };
        saveLockConfig(next);
        return next;
      });
      return true;
    },
    [],
  );

  const clearPassword = useCallback(
    async (password: string): Promise<boolean> => {
      const hash = await sha256(password);
      if (hash !== configRef.current.passwordHash) return false;
      setConfig((prev) => {
        const next = { ...prev, passwordHash: "", isLocked: false };
        saveLockConfig(next);
        return next;
      });
      return true;
    },
    [],
  );

  const setPrivacyEnabled = useCallback(
    async (enabled: boolean) => {
      setConfig((prev) => {
        const next = { ...prev, privacyEnabled: enabled };
        if (!enabled) {
          next.isLocked = false;
          resetIdleTimer();
        }
        saveLockConfig(next);
        return next;
      });
    },
    [resetIdleTimer],
  );

  const setIdleTimeout = useCallback(
    async (minutes: number) => {
      const clamped = Math.max(1, Math.min(60, minutes));
      setConfig((prev) => {
        if (prev.idleTimeout === clamped) return prev;
        const next = { ...prev, idleTimeout: clamped };
        saveLockConfig(next);
        return next;
      });
    },
    [],
  );

  const setStartupLockEnabled = useCallback(
    async (enabled: boolean) => {
      setConfig((prev) => {
        if (prev.startupLockEnabled === enabled) return prev;
        const next = { ...prev, startupLockEnabled: enabled };
        saveLockConfig(next);
        return next;
      });
    },
    [],
  );

  const hasPassword = config.passwordHash.length > 0;

  const value = useMemo<LockContextType>(
    () => ({
      privacyEnabled: config.privacyEnabled,
      setPrivacyEnabled,
      idleTimeout: config.idleTimeout,
      setIdleTimeout,
      hasPassword,
      isLocked: config.isLocked,
      startupLockEnabled: config.startupLockEnabled,
      setStartupLockEnabled,
      lock,
      unlock,
      setPassword,
      changePassword,
      clearPassword,
    }),
    [
      config.privacyEnabled,
      config.idleTimeout,
      config.isLocked,
      config.startupLockEnabled,
      hasPassword,
      lock,
      unlock,
      setPassword,
      changePassword,
      clearPassword,
      setPrivacyEnabled,
      setIdleTimeout,
      setStartupLockEnabled,
    ],
  );

  return <LockContext.Provider value={value}>{children}</LockContext.Provider>;
}

export function useLock(): LockContextType {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error("useLock must be used within LockProvider");
  return ctx;
}
