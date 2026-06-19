import { useRef, useEffect } from "react";
import type { Message, FileAttachment } from "../types";
import MessageBubble from "./MessageBubble";

interface Props {
  messages: Message[];
  modelName?: string;
  userName?: string;
  userAvatar?: string;
  defaultMarkdown?: boolean;
  defaultReasoningOpen?: boolean;
  developerMode?: boolean;
  t: (key: string) => string;
  onPreviewFile?: (file: FileAttachment) => void;
}

/**
 * Yolo-mode dedicated chat panel.
 * Renders messages inside a stable semi-transparent dark panel
 * instead of floating directly on the aurora background.
 * This eliminates text fuzziness caused by the animated aurora gradients.
 */
export default function YoloChatPanel({
  messages,
  modelName,
  userName,
  userAvatar,
  defaultMarkdown,
  defaultReasoningOpen,
  developerMode,
  t,
  onPreviewFile,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const userNearBottomRef = useRef(true);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      userNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (container && userNearBottomRef.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  return (
    <div ref={scrollRef} className="chat-scroll" style={{
      flex: 1,
      overflowY: "auto",
      position: "relative",
    }}>
      <div style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "0 24px",
      }}>
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            modelName={modelName}
            userName={userName}
            userAvatar={userAvatar}
            defaultMarkdown={defaultMarkdown}
            defaultReasoningOpen={defaultReasoningOpen}
            developerMode={developerMode}
            t={t}
            yolo
            onPreviewFile={onPreviewFile}
          />
        ))}
      </div>
    </div>
  );
}
