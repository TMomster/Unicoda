import { useRef, useState, useEffect, type ReactNode, type CSSProperties } from "react";

interface Props {
  children: ReactNode;
  visible: boolean;
  style?: CSSProperties;
  /** 最大高度（px），默认 800 */
  maxHeight?: number;
}

/**
 * 使用 max-height 过渡实现平滑展开/收起动画的通用容器。
 * 无论 visible 为何值，children 始终在 DOM 中，确保过渡流畅。
 */
export default function AnimatedSection({ children, visible, style, maxHeight = 800 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(visible);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
    } else {
      // 等待过渡动画完成后再移除
      const timer = setTimeout(() => setShouldRender(false), 350);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  return (
    <div
      ref={containerRef}
      style={{
        overflow: "hidden",
        maxHeight: visible ? maxHeight : 0,
        opacity: visible ? 1 : 0,
        transition: "max-height 0.35s ease, opacity 0.25s ease",
        ...style,
      }}
    >
      {shouldRender && children}
    </div>
  );
}
