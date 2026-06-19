import { useEffect, useRef } from "react";

/**
 * Animated three-color aurora background with slow-shifting radial gradients.
 * The gradients move continuously to create a subtle, living atmosphere effect.
 */
export default function AuroraBackground() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const timeRef = useRef(0);
  const frameRef = useRef(0);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    // Use CSS transition for smooth visual updates
    el.style.transition = "background 0.08s linear";

    // Three aurora color spots — larger, more intense
    const spots = [
      { cx: 20, cy: 30, r: 80, color: "rgba(30, 180, 255, 0.30)" },  // icy blue
      { cx: 80, cy: 60, r: 75, color: "rgba(200, 80, 255, 0.25)" },  // violet
      { cx: 45, cy: 70, r: 80, color: "rgba(0, 255, 200, 0.20)" },   // cyan
    ];

    // Deep dark base gradient
    const baseGrad = "linear-gradient(135deg, #061a3a 0%, #0f3460 30%, #1a5276 50%, #4a2a6a 70%, #0d2137 100%)";

    const animate = () => {
      frameRef.current++;
      // Throttle to ~30 fps — every 2nd frame
      if (frameRef.current % 2 === 0) {
        timeRef.current += 0.014;
        const t = timeRef.current;

        // Build shifted radial gradients — larger drift & faster oscillation
        const layers = spots.map((s, i) => {
          const phase = i * 1.26;
          const cx = s.cx + Math.sin(t + phase) * 40;
          const cy = s.cy + Math.cos(t * 0.8 + phase) * 35;
          const r = s.r + Math.sin(t * 0.7 + i) * 25;
          return `radial-gradient(circle at ${cx}% ${cy}%, ${s.color} 0%, transparent ${r}%)`;
        });

        el.style.background = [...layers, baseGrad].join(", ");
        el.style.backgroundBlendMode = "overlay, screen, lighten, normal";
      }
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <div
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        willChange: "background",
      }}
    />
  );
}
