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
  /** 启动时是否要求输入密码 */
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
  /** 隐私服务是否已启用 */
  privacyEnabled: boolean;
  /** 切换隐私服务 */
  setPrivacyEnabled: (enabled: boolean) => Promise<void>;
  /** 闲置自动锁定时间（分钟） */
  idleTimeout: number;
  /** 设置闲置自动锁定时间 */
  setIdleTimeout: (minutes: number) => Promise<void>;
  /** 是否已设置密码 */
  hasPassword: boolean;
  /** 当前是否处于锁定状态 */
  isLocked: boolean;
  /** 启动时是否要求输入密码 */
  startupLockEnabled: boolean;
  /** 设置启动时是否要求输入密码 */
  setStartupLockEnabled: (enabled: boolean) => Promise<void>;
  /** 锁定屏幕 */
  lock: () => Promise<void>;
  /** 尝试解锁 */
  unlock: (password: string) => Promise<boolean>;
  /** 设置初始密码（仅在无密码时可用） */
  setPassword: (password: string) => Promise<boolean>;
  /** 修改密码（需要旧密码） */
  changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>;
  /** 清除密码（关闭锁定服务，需要旧密码） */
  clearPassword: (password: string) => Promise<boolean>;
}

const LockContext = createContext<LockContextType | null>(null);

async function loadLockConfig(): Promise<LockConfig> {
  return readConfigFile<LockConfig>(LOCK_CONFIG_KEY, DEFAULT_LOCK);
}

async function saveLockConfig(config: LockConfig): Promise<void> {
  await writeConfigFile(LOCK_CONFIG_KEY, config);
}

export function LockProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<LockConfig>(DEFAULT_LOCK);
  const [loaded, setLoaded] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 启动时异步加载锁定配置，若隐私服务开启且有密码则自动锁定
  useEffect(() => {
    loadLockConfig().then((loadedConfig) => {
      setConfig(loadedConfig);
      setLoaded(true);
    });
  }, []);

  // 启动后：如果启动锁定、隐私服务开启且有密码 → 自动锁定
  useEffect(() => {
    if (
      loaded &&
      config.startupLockEnabled &&
      config.privacyEnabled &&
      config.passwordHash.length > 0
    ) {
      setConfig((prev) => {
        if (prev.isLocked) return prev;
        const next = { ...prev, isLocked: true };
        saveLockConfig(next);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const hasPassword = config.passwordHash.length > 0;
  const lockServiceActive = config.privacyEnabled && hasPassword;

  const lock = useCallback(async () => {
    if (!config.privacyEnabled) return;
    if (config.passwordHash.length === 0) return;
    const next = { ...config, isLocked: true };
    setConfig(next);
    await saveLockConfig(next);
  }, [config]);

  const unlock = useCallback(
    async (password: string): Promise<boolean> => {
      const hash = await sha256(password);
      if (hash === config.passwordHash) {
        const next = { ...config, isLocked: false };
        setConfig(next);
        await saveLockConfig(next);
        // 解锁后重置闲置计时器
        resetIdleTimer();
        return true;
      }
      return false;
    },
    [config],
  );

  /** 重置闲置自动锁定计时器 */
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  /** 启动闲置计时 */
  const startIdleTimer = useCallback(() => {
    resetIdleTimer();
    if (!config.privacyEnabled || config.passwordHash.length === 0) return;
    if (config.isLocked) return;
    idleTimerRef.current = setTimeout(() => {
      setConfig((prev) => {
        if (!prev.privacyEnabled || prev.passwordHash.length === 0) return prev;
        if (prev.isLocked) return prev;
        const next = { ...prev, isLocked: true };
        saveLockConfig(next);
        return next;
      });
    }, config.idleTimeout * 60 * 1000);
  }, [config.privacyEnabled, config.passwordHash.length, config.isLocked, config.idleTimeout, resetIdleTimer]);

  // 用户活动监听：重置闲置计时
  useEffect(() => {
    if (!config.privacyEnabled || config.passwordHash.length === 0) return;

    const activityEvents = ["mousedown", "keydown", "mousemove", "touchstart", "scroll", "wheel"];
    const handler = () => {
      startIdleTimer();
    };

    activityEvents.forEach((ev) => window.addEventListener(ev, handler, { passive: true }));
    // 初次启动计时
    startIdleTimer();

    // 如果已锁定，清除计时
    if (config.isLocked) {
      resetIdleTimer();
    }

    return () => {
      activityEvents.forEach((ev) => window.removeEventListener(ev, handler));
      resetIdleTimer();
    };
  }, [config.privacyEnabled, config.passwordHash.length, config.isLocked, startIdleTimer, resetIdleTimer]);

  const setPassword = useCallback(
    async (password: string): Promise<boolean> => {
      if (config.passwordHash.length > 0) return false;
      const hash = await sha256(password);
      const next: LockConfig = { ...config, passwordHash: hash, isLocked: false };
      setConfig(next);
      await saveLockConfig(next);
      return true;
    },
    [config],
  );

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string): Promise<boolean> => {
      const oldHash = await sha256(oldPassword);
      if (oldHash !== config.passwordHash) return false;
      const newHash = await sha256(newPassword);
      const next: LockConfig = { ...config, passwordHash: newHash };
      setConfig(next);
      await saveLockConfig(next);
      return true;
    },
    [config],
  );

  const clearPassword = useCallback(
    async (password: string): Promise<boolean> => {
      const hash = await sha256(password);
      if (hash !== config.passwordHash) return false;
      const next: LockConfig = { ...config, passwordHash: "", isLocked: false };
      setConfig(next);
      await saveLockConfig(next);
      return true;
    },
    [config.passwordHash, config.privacyEnabled, config.idleTimeout],
  );

  const setPrivacyEnabled = useCallback(
    async (enabled: boolean) => {
      const next = { ...config, privacyEnabled: enabled };
      // 关闭隐私服务时强制解锁
      if (!enabled) {
        next.isLocked = false;
        resetIdleTimer();
      }
      setConfig(next);
      await saveLockConfig(next);
    },
    [config, resetIdleTimer],
  );

  const setIdleTimeout = useCallback(
    async (minutes: number) => {
      const clamped = Math.max(1, Math.min(60, minutes));
      const next = { ...config, idleTimeout: clamped };
      setConfig(next);
      await saveLockConfig(next);
    },
    [config],
  );

  const setStartupLockEnabled = useCallback(
    async (enabled: boolean) => {
      const next = { ...config, startupLockEnabled: enabled };
      setConfig(next);
      await saveLockConfig(next);
    },
    [config],
  );

  // 全局快捷键 Ctrl+F12（仅在隐私服务开启且有密码时生效）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "F12") {
        e.preventDefault();
        if (config.privacyEnabled && hasPassword && !config.isLocked) {
          lock();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [config.privacyEnabled, config.isLocked, hasPassword, lock]);

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
    [config.privacyEnabled, config.idleTimeout, config.isLocked, config.startupLockEnabled,
     hasPassword, lock, unlock, setPassword, changePassword, clearPassword,
     setPrivacyEnabled, setIdleTimeout, setStartupLockEnabled],
  );

  return <LockContext.Provider value={value}>{children}</LockContext.Provider>;
}

export function useLock(): LockContextType {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error("useLock must be used within LockProvider");
  return ctx;
}
