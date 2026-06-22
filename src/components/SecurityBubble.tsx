import { useSecurity } from "../contexts/SecurityContext";

interface Props {
  t: (key: string) => string;
}

export default function SecurityBubble({ t }: Props) {
  const { isMonitoring, mode } = useSecurity();

  if (!isMonitoring) return null;

  const label = `${mode === "Agent" ? "Agent" : ""}`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: "8px 16px",
        marginBottom: "12px",
        borderRadius: "10px",
        backgroundColor: "rgba(34, 197, 94, 0.1)",
        border: "1px solid rgba(34, 197, 94, 0.3)",
        fontSize: "12px",
        color: "var(--c-txt)",
        userSelect: "none",
        maxWidth: "100%",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: "#22c55e",
          flexShrink: 0,
          boxShadow: "0 0 6px rgba(34,197,94,0.6)",
        }}
      />
      <span style={{ fontWeight: 600 }}>Unicoda Security</span>
      <span style={{ color: "var(--c-t3)" }}>·</span>
      <span>{t("securityActive")}</span>
    </div>
  );
}
