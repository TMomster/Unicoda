import { useState, useEffect, useRef, useCallback } from "react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import AuroraLogo from "./AuroraLogo";
import { useLock } from "../contexts/LockContext";

interface Props {
  locale: Locale;
}

export default function LockOverlay({ locale }: Props) {
  const { isLocked, unlock } = useLock();
  const [showOverlay, setShowOverlay] = useState(isLocked);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 锁定：立即显示；解锁：等动画完成再隐藏
  useEffect(() => {
    if (isLocked) {
      setShowOverlay(true);
    } else {
      const timer = setTimeout(() => {
        setShowOverlay(false);
        setPassword("");
        setError(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isLocked]);

  // 锁定后自动聚焦密码输入框
  useEffect(() => {
    if (isLocked && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 350);
    }
  }, [isLocked]);

  const handleUnlock = useCallback(async () => {
    if (!password) return;
    setUnlocking(true);
    const ok = await unlock(password);
    setUnlocking(false);
    if (ok) {
      setError(false);
    } else {
      setError(true);
      setPassword("");
      setTimeout(() => setError(false), 600);
    }
  }, [password, unlock]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleUnlock();
      }
    },
    [handleUnlock],
  );

  if (!showOverlay) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "#0a0a0c",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "28px",
        opacity: isLocked ? 1 : 0,
        transition: "opacity 0.3s ease",
        userSelect: "none",
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
        {locale === "zh-CN" ? "Unicoda 锁定中" : "Unicoda Locked"}
      </div>

      {/* Password input */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={locale === "zh-CN" ? "输入密码解锁" : "Enter password to unlock"}
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
            boxShadow: error
              ? "0 0 0 2px rgba(239, 68, 68, 0.2)"
              : "none",
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
            ? (locale === "zh-CN" ? "解锁中..." : "Unlocking...")
            : (locale === "zh-CN" ? "解锁" : "Unlock")}
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
            {locale === "zh-CN" ? "密码错误，请重试" : "Incorrect password, try again"}
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
        {locale === "zh-CN"
          ? "闲置后将自动锁定 · Ctrl+F12 手动锁定"
          : "Auto-lock on idle · Ctrl+F12 to lock"}
      </div>
    </div>
  );
}
