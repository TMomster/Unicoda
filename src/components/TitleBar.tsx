import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTheme } from "../contexts/ThemeContext";
import { MinimizeIcon, MaximizeIcon, RestoreIcon, CloseIcon } from "../constants/windowIcons";

interface Props {
  title: string;
}

export default function TitleBar({ title }: Props) {
  const { t } = useTheme();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    // 初始化状态
    win.isMaximized().then(setMaximized).catch(() => {});
    // 监听窗口 resize（包括拖动还原、快捷键等场景）
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleToggleMax = async () => {
    try {
      await getCurrentWindow().toggleMaximize();
      const m = await getCurrentWindow().isMaximized();
      setMaximized(m);
    } catch {
      // ignore in dev
    }
  };

  const handleClose = () => {
    getCurrentWindow().close();
  };

  const btnCommon: React.CSSProperties = {
    width: "46px",
    height: "100%",
    border: "none",
    background: "transparent",
    color: "#8a8a8e",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontFamily: '"Segoe UI", sans-serif',
    transition: "background 0.12s",
  };

  return (
    <div
      style={{
        height: "36px",
        minHeight: "36px",
        display: "flex",
        alignItems: "center",
        backgroundColor: "#141417",
        userSelect: "none",
        borderBottom: "1px solid #2a2a2e",
      }}
    >
      {/* Drag region + title */}
      <div
        data-tauri-drag-region
        style={{
          flex: 1,
          height: "100%",
          display: "flex",
          alignItems: "center",
          paddingLeft: "14px",
        }}
      >
        <span
          style={{
            fontSize: "13px",
            fontWeight: 500,
            color: "#8a8a8e",
            letterSpacing: "0.3px",
          }}
        >
          {title}
        </span>
      </div>

      {/* Window controls */}
      <button
        onClick={handleMinimize}
        style={btnCommon}
        title={t("minimize")}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#2a2a2e")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
      >
        <MinimizeIcon />
      </button>

      <button
        onClick={handleToggleMax}
        style={btnCommon}
        title={maximized ? t("restore") : t("maximize")}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#2a2a2e")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>

      <button
        onClick={handleClose}
        style={{ ...btnCommon }}
        title={t("close")}
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
  );
}
