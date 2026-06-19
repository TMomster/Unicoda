import { useEffect, useRef } from "react";

interface Props {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export default function ConfirmDialog({
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  danger = false,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--c-bg3)",
          border: "1px solid var(--c-bd2)",
          borderRadius: "12px",
          padding: "24px",
          minWidth: "320px",
          maxWidth: "420px",
          boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--c-txt)" }}>
          {title}
        </div>
        <div style={{ fontSize: "14px", color: "var(--c-t2)", lineHeight: 1.5 }}>
          {message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid var(--c-bd2)",
              background: "transparent",
              color: "var(--c-txt)",
              fontSize: "13px",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--c-bd)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: danger ? "#dc2626" : "var(--c-ac)",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = danger ? "#b91c1c" : "var(--c-ah)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = danger ? "#dc2626" : "var(--c-ac)")
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
