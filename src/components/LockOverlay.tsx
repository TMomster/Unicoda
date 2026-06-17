import { useState, useEffect, useRef } from "react";
import type { Locale } from "../i18n";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AuroraLogo from "./AuroraLogo";
import { useLock } from "../contexts/LockContext";
import { MinimizeIcon, MaximizeIcon, RestoreIcon, CloseIcon } from "../constants/windowIcons";

interface Props {
  locale: Locale;
}

export default function LockOverlay({ locale }: Props) {
  const { isLocked, unlock } = useLock();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Refs to always have the latest values in async handlers
  const pwRef = useRef(password);
  pwRef.current = password;

  // Track maximized state for the restore/maximize button icon
  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setIsMaximized);
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setIsMaximized);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // 锁定后自动聚焦密码输入框
  useEffect(() => {
    if (isLocked && inputRef.current) {
      const id = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(id);
    }
  }, [isLocked]);

  // 解锁成功 → 清空密码
  useEffect(() => {
    if (!isLocked) {
      const id = setTimeout(() => {
        setPassword("");
        setError(false);
      }, 300);
      return () => clearTimeout(id);
    }
  }, [isLocked]);

  /** 非 memoized 的普通 async 函数，通过 ref 读最新 password，杜绝闭包过期 */
  const handleUnlock = async () => {
    const pwd = pwRef.current;
    console.log("[LockOverlay/handleUnlock] trying unlock with pwd length =", pwd?.length, "isLocked =", isLocked);
    if (!pwd) return;
    setUnlocking(true);
    setError(false);
    try {
      const ok = await unlock(pwd);
      console.log("[LockOverlay/handleUnlock] unlock result ok =", ok, "isLocked still =", isLocked);
      if (!ok) {
        setError(true);
        setPassword("");
        setTimeout(() => setError(false), 600);
      }
    } catch (err) {
      console.error("[LockOverlay/handleUnlock] unlock threw:", err);
      setError(true);
      setPassword("");
      setTimeout(() => setError(false), 600);
    } finally {
      setUnlocking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleUnlock();
    }
  };

  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleMaxRestore = () => {
    getCurrentWindow().toggleMaximize();
  };

  const handleClose = () => {
    getCurrentWindow().close();
  };

  // ════════════════════════════════════════════════════
  //  ALWAYS render the overlay — never return null.
  //  pointer-events replaces visibility to ensure the
  //  elements are interactive immediately when locked.
  // ════════════════════════════════════════════════════
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "#0a0a0c",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        userSelect: "none",
        // ---- Show/hide via CSS only, no DOM removal ----
        opacity: isLocked ? 1 : 0,
        pointerEvents: isLocked ? "auto" : "none",
        transition: "opacity 0.25s ease",
        willChange: "opacity",
      }}
    >
      {/* Window controls — drawn directly on the overlay */}
      <div
        data-tauri-drag-region
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "36px",
          zIndex: 1,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          display: "flex",
          zIndex: 2,
        }}
      >
        {/* Minimize */}
        <button
          onClick={handleMinimize}
          style={{
            width: "46px",
            height: "36px",
            border: "none",
            background: "transparent",
            color: "#8a8a8e",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.12s",
          }}
          title={locale === "zh-CN" ? "最小化" : "Minimize"}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <MinimizeIcon />
        </button>
        {/* Maximize / Restore */}
        <button
          onClick={handleMaxRestore}
          style={{
            width: "46px",
            height: "36px",
            border: "none",
            background: "transparent",
            color: "#8a8a8e",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.12s",
          }}
          title={locale === "zh-CN" ? (isMaximized ? "还原" : "最大化") : (isMaximized ? "Restore" : "Maximize")}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          {isMaximized ? <RestoreIcon bgFill="#0a0a0c" /> : <MaximizeIcon />}
        </button>
        {/* Close */}
        <button
          onClick={handleClose}
          style={{
            width: "46px",
            height: "36px",
            border: "none",
            background: "transparent",
            color: "#8a8a8e",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.12s",
          }}
          title={locale === "zh-CN" ? "关闭" : "Close"}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "#e81123";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.color = "#8a8a8e";
          }}
        >
          <CloseIcon />
        </button>
      </div>

      {/* Lock body — centered content */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "28px",
        }}
      >
        {/* Logo */}
        <AuroraLogo size={80} rounded={16} />

        {/* Title */}
        <div
          style={{
            fontSize: "18px",
            fontWeight: 500,
            color: "#6a6a6e",
            letterSpacing: "2px",
          }}
        >
          {locale === "zh-CN" ? "Unison 锁定中" : "Unison Locked"}
        </div>

        {/* Password input */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            alignItems: "center",
          }}
        >
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              locale === "zh-CN" ? "输入密码解锁" : "Enter password to unlock"
            }
            style={{
              width: "280px",
              padding: "12px 16px",
              borderRadius: "10px",
              border: `1px solid ${error ? "#ef4444" : "#2a2a2e"}`,
              backgroundColor: "#141417",
              color: "#e0e0e0",
              fontSize: "15px",
              fontFamily: "inherit",
              outline: "none",
              textAlign: "center",
              transition: "border-color 0.15s, box-shadow 0.15s",
              boxShadow: error ? "0 0 0 2px rgba(239, 68, 68, 0.2)" : "none",
              animation: error ? "shake 0.4s ease" : undefined,
            }}
            onFocus={(e) => {
              if (!error) e.currentTarget.style.borderColor = "#2563eb";
            }}
            onBlur={(e) => {
              if (!error) e.currentTarget.style.borderColor = "#2a2a2e";
            }}
            disabled={unlocking}
          />

          {/* Unlock button */}
          <button
            onClick={handleUnlock}
            disabled={!password || unlocking}
            style={{
              width: "280px",
              padding: "10px 0",
              borderRadius: "10px",
              border: "none",
              backgroundColor: password && !unlocking ? "#2563eb" : "#1a1a1e",
              color: password && !unlocking ? "#fff" : "#5a5a5e",
              fontSize: "14px",
              fontWeight: 600,
              cursor: password && !unlocking ? "pointer" : "default",
              transition: "all 0.15s",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => {
              if (password && !unlocking) {
                e.currentTarget.style.backgroundColor = "#1d4ed8";
              }
            }}
            onMouseLeave={(e) => {
              if (password && !unlocking) {
                e.currentTarget.style.backgroundColor = "#2563eb";
              }
            }}
          >
            {unlocking
              ? locale === "zh-CN"
                ? "解锁中"
                : "Unlocking"
              : locale === "zh-CN"
                ? "解锁"
                : "Unlock"}
          </button>

          {/* Error message */}
          {error && (
            <div
              style={{
                fontSize: "12px",
                color: "#ef4444",
                animation: "fadeIn 0.2s ease",
              }}
            >
              {locale === "zh-CN" ? "密码错误" : "Incorrect password"}
            </div>
          )}
        </div>

        {/* Idle lock hint */}
        <div
          style={{
            position: "absolute",
            bottom: "32px",
            fontSize: "11px",
            color: "#4a4a4e",
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
        </div>
      </div>
    </div>
  );
}
