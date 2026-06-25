import { useEffect, useRef } from "react";

/**
 * Animated three-color aurora background using CSS-only approach.
 * Uses CSS @keyframes animations for gradient shifts instead of
 * JS-driven requestAnimationFrame, offloading animation to the
 * compositor thread for much better performance.
 *
 * @param theme - "light" → bright blue aurora, "dark" → dark purple aurora
 */
interface Props {
  theme?: "dark" | "light";
}

export default function AuroraBackground({ theme = "dark" }: Props) {
  const idRef = useRef<string>(`aurora-${Math.random().toString(36).slice(2, 8)}`);
  const id = idRef.current;

  useEffect(() => {
    // Inject CSS keyframes dynamically — one-time cost
    const styleId = `aurora-style-${id}`;
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes aurora-drift-${id}-1 {
        0%   { transform: translate(0%, 0%) scale(1); }
        25%  { transform: translate(30%, -20%) scale(1.15); }
        50%  { transform: translate(-15%, 25%) scale(0.9); }
        75%  { transform: translate(20%, 15%) scale(1.1); }
        100% { transform: translate(0%, 0%) scale(1); }
      }
      @keyframes aurora-drift-${id}-2 {
        0%   { transform: translate(0%, 0%) scale(1); }
        33%  { transform: translate(-25%, 30%) scale(0.85); }
        66%  { transform: translate(20%, -15%) scale(1.2); }
        100% { transform: translate(0%, 0%) scale(1); }
      }
      @keyframes aurora-drift-${id}-3 {
        0%   { transform: translate(0%, 0%) scale(1); }
        50%  { transform: translate(25%, -25%) scale(1.1); }
        100% { transform: translate(0%, 0%) scale(1); }
      }
    `;
    document.head.appendChild(style);
    return () => {
      const el = document.getElementById(styleId);
      if (el) el.remove();
    };
  }, [id]);

  const isLight = theme === "light";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        contain: "paint style layout",
      }}
    >
      {/* Base gradient layer */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: isLight
            ? "linear-gradient(135deg, #0d2b5e 0%, #1a4a7a 25%, #2a6a9a 50%, #5a3a7a 75%, #1a2a4a 100%)"
            : "linear-gradient(135deg, #050008 0%, #120021 25%, #1e0038 50%, #140028 75%, #0a0015 100%)",
        }}
      />
      {/* Aurora spot 1 */}
      <div
        style={{
          position: "absolute",
          width: "90vw",
          height: "90vw",
          left: "-25vw",
          top: "-25vw",
          borderRadius: "50%",
          background: isLight
            ? "radial-gradient(circle, rgba(60, 200, 255, 0.35) 0%, transparent 70%)"
            : "radial-gradient(circle, rgba(90, 30, 160, 0.35) 0%, transparent 70%)",
          animation: `aurora-drift-${id}-1 12s ease-in-out infinite`,
          willChange: "transform",
          pointerEvents: "none",
        }}
      />
      {/* Aurora spot 2 */}
      <div
        style={{
          position: "absolute",
          width: "75vw",
          height: "75vw",
          right: "-15vw",
          bottom: "-15vw",
          borderRadius: "50%",
          background: isLight
            ? "radial-gradient(circle, rgba(220, 100, 255, 0.30) 0%, transparent 70%)"
            : "radial-gradient(circle, rgba(150, 50, 200, 0.30) 0%, transparent 70%)",
          animation: `aurora-drift-${id}-2 16s ease-in-out infinite`,
          willChange: "transform",
          pointerEvents: "none",
          mixBlendMode: "screen",
        }}
      />
      {/* Aurora spot 3 */}
      <div
        style={{
          position: "absolute",
          width: "80vw",
          height: "80vw",
          left: "25vw",
          top: "35vh",
          borderRadius: "50%",
          background: isLight
            ? "radial-gradient(circle, rgba(0, 255, 220, 0.25) 0%, transparent 70%)"
            : "radial-gradient(circle, rgba(100, 20, 180, 0.20) 0%, transparent 70%)",
          animation: `aurora-drift-${id}-3 14s ease-in-out infinite`,
          willChange: "transform",
          pointerEvents: "none",
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}
