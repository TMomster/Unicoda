import { useState, useEffect, useRef } from "react";
import type { Locale } from "../i18n";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AuroraBackground from "./AuroraBackground";
import AuroraLogo from "./AuroraLogo";
import { useLock } from "../contexts/LockContext";
import { MinimizeIcon, MaximizeIcon, RestoreIcon, CloseIcon } from "../constants/windowIcons";

interface Props {
  locale: Locale;
  /** Yolo 模式皮肤 — 显示极光玻璃风格的锁定界面 */
  yolo?: boolean;
}

export default function LockOverlay({ locale, yolo }: Props) {
  const { isLocked, unlock } = useLock();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    if (!pwd) return;
    setUnlocking(true);
    setError(false);
    try {
      const ok = await unlock(pwd);
      if (!ok) {
        setError(true);
        setPassword("");
        setTimeout(() => setError(false), 600);
      }
    } catch {
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
        backgroundColor: yolo ? "transparent" : "#0a0a0c",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        userSelect: "none",
        // ---- Show/hide via CSS only, no DOM removal ----
        opacity: isLocked ? 1 : 0,
        pointerEvents: isLocked ? "auto" : "none",
        transition: "opacity 0.3s ease",
        willChange: "opacity",
      }}
    >
      <style>{`
        .lock-pw-input::placeholder { color: ${yolo ? "rgba(255,255,255,0.4)" : "#5a5a5e"} !important; }
      `}</style>
      {/* Yolo mode: animated aurora background behind the lock card */}
      {yolo && <AuroraBackground />}
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
          ...(yolo ? {
            position: "relative",
            zIndex: 1,
            padding: "40px 48px",
          } : {}),
        }}
      >
        {/* Logo — add glow in yolo mode */}
        <div style={yolo ? {
          filter: "drop-shadow(0 0 20px rgba(100,180,255,0.25)) drop-shadow(0 0 40px rgba(80,120,255,0.1))",
          transition: "filter 0.5s ease",
        } : {}}>
          <AuroraLogo size={80} rounded={16} />
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: "18px",
            fontWeight: 500,
            color: yolo ? "rgba(255,255,255,0.55)" : "#6a6a6e",
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
          <div style={{ position: "relative", width: "280px" }}>
            <input
              ref={inputRef}
              className="lock-pw-input"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                locale === "zh-CN" ? "输入密码解锁" : "Enter password to unlock"
              }
              style={{
                width: "100%",
                padding: "12px 42px 12px 16px",
                borderRadius: "10px",
                border: `1px solid ${error ? "#ef4444" : yolo ? "rgba(255,255,255,0.12)" : "#2a2a2e"}`,
                backgroundColor: yolo ? "rgba(255,255,255,0.04)" : "#141417",
                color: "#e0e0e0",
                fontSize: "15px",
                fontFamily: "inherit",
                outline: "none",
                textAlign: "center",
                transition: "border-color 0.15s, box-shadow 0.15s",
                boxShadow: error ? "0 0 0 2px rgba(239, 68, 68, 0.2)" : yolo ? "0 0 20px rgba(50,150,255,0.05)" : "none",
                animation: error ? "shake 0.4s ease" : undefined,
                ...(yolo ? { backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" } : {}),
              }}
              onFocus={(e) => {
                if (!error) e.currentTarget.style.borderColor = yolo ? "rgba(100,180,255,0.5)" : "#2563eb";
              }}
              onBlur={(e) => {
                if (!error) e.currentTarget.style.borderColor = yolo ? "rgba(255,255,255,0.12)" : "#2a2a2e";
              }}
              disabled={unlocking}
            />
            {/* Eye toggle button */}
            <button
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              style={{
                position: "absolute",
                right: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                border: "none",
                background: "transparent",
                color: yolo ? "rgba(255,255,255,0.6)" : "#e0e0e0",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = yolo ? "rgba(255,255,255,0.6)" : "#e0e0e0"; }}
            >
              {showPassword ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {/* Unlock button */}
          <button
            onClick={handleUnlock}
            disabled={!password || unlocking}
            style={{
              width: "280px",
              padding: "10px 0",
              borderRadius: "10px",
              border: yolo ? "1px solid rgba(59,130,246,0.25)" : "none",
              backgroundColor: password && !unlocking ? (yolo ? "rgba(37,99,235,0.55)" : "#2563eb") : (yolo ? "rgba(255,255,255,0.04)" : "#1a1a1e"),
              color: password && !unlocking ? "#fff" : (yolo ? "rgba(255,255,255,0.3)" : "#5a5a5e"),
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
