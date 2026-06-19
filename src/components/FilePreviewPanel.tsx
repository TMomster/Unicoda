import type { FileAttachment } from "../types";

interface Props {
  file: FileAttachment | null;
  onClose: () => void;
}

export default function FilePreviewPanel({ file, onClose }: Props) {
  if (!file) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 299,
          backgroundColor: "rgba(0,0,0,0.3)",
        }}
      />
      {/* Panel */}
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: "50%", minWidth: "360px", maxWidth: "700px",
          zIndex: 300,
          backgroundColor: "var(--c-bg)",
          borderLeft: "1px solid var(--c-bd)",
          display: "flex",
          flexDirection: "column",
          animation: "slide-in-right 0.2s ease",
        }}
      >
        <style>{`
          @keyframes slide-in-right {
            from { transform: translateX(100%); }
            to   { transform: translateX(0); }
          }
        `}</style>

        {/* Header */}
        <div
          style={{
            display: "flex", alignItems: "center", gap: "8px",
            padding: "12px 16px",
            borderBottom: "1px solid var(--c-bd)",
            flexShrink: 0,
          }}
        >
          {file.isImage ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          )}
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--c-txt)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file.name}
          </span>
          <span style={{ fontSize: "11px", color: "var(--c-t5)", whiteSpace: "nowrap" }}>
            {formatSize(file.size)}
          </span>
          <button
            onClick={onClose}
            style={{
              width: "28px", height: "28px", borderRadius: "6px",
              border: "none", background: "transparent",
              color: "var(--c-t6)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, transition: "all 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--c-bd)"; e.currentTarget.style.color = "var(--c-txt)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--c-t6)"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
          {file.isImage ? (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
              <img
                src={file.data}
                alt={file.name}
                style={{
                  maxWidth: "100%",
                  maxHeight: "calc(100vh - 120px)",
                  borderRadius: "8px",
                  objectFit: "contain",
                }}
              />
            </div>
          ) : (
            <pre
              style={{
                margin: 0,
                fontSize: "12px",
                lineHeight: 1.6,
                color: "var(--c-txt)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "'SF Mono','Fira Code','Consolas',monospace",
                overflow: "auto",
              }}
            >
              {file.data}
            </pre>
          )}
        </div>
      </div>
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
