import { useRef, useEffect } from "react";

interface Props {
  size?: number;
  fontSize?: number;
  rounded?: number;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
}

export default function AuroraLogo({
  size = 28,
  fontSize: fontSizeProp,
  rounded = 8,
  onClick,
  title,
  style,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timeRef = useRef(0);

  // Dynamic aurora animation via inline canvas-like gradient animation
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const gradients = [
      { cx: 15, cy: 25, r: 55, color: "rgba(70, 200, 255, 0.7)" },
      { cx: 85, cy: 65, r: 50, color: "rgba(200, 100, 255, 0.6)" },
      { cx: 40, cy: 70, r: 55, color: "rgba(0, 255, 200, 0.5)" },
      { cx: 70, cy: 30, r: 50, color: "rgba(100, 220, 255, 0.6)" },
    ];

    const baseLinear = "linear-gradient(135deg, #0b2b5e 0%, #1a4b7a 25%, #3a6a9a 50%, #5a3a7a 75%, #2a4a7a 100%)";

    const animate = () => {
      timeRef.current += 0.012;
      const t = timeRef.current;

      const shifted = gradients.map((g, i) => {
        const phase = i * 1.57;
        return `radial-gradient(circle at ${g.cx + Math.sin(t + phase) * 25}% ${g.cy + Math.cos(t * 0.8 + phase) * 20}%, ${g.color} 0%, transparent ${g.r + Math.sin(t * 0.6 + i) * 14}%)`;
      });

      el.style.background = [
        ...shifted,
        baseLinear,
      ].join(", ");
      el.style.backgroundBlendMode = "overlay, screen, lighten, normal, normal";

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const fontSize = fontSizeProp ?? size * 0.5;

  return (
    <div
      ref={canvasRef}
      onClick={onClick}
      title={title}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${rounded}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: `${fontSize}px`,
        fontWeight: 900,
        color: "#fff",
        fontFamily: '"Source Han Sans SC", "Source Han Sans", "Noto Sans SC", sans-serif',
        textShadow: "0 0 20px rgba(255,255,255,0.3), 0 0 60px rgba(200,220,255,0.2)",
        cursor: onClick ? "pointer" : "default",
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
        boxShadow: "0 0 20px rgba(20,100,200,0.2), inset 0 0 30px rgba(10,200,255,0.1)",
        ...style,
      }}
    >
      <span style={{ position: "relative", zIndex: 2, lineHeight: 1 }}>U</span>
    </div>
  );
}
