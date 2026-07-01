import { useEffect, useRef, useState } from "react";
import { Send, Download, FileText, Mic } from "lucide-react";
import { getChatHistory, sendChatMessage, getChatFileUrl, markChatAsRead, ChatMessage } from "../../api/chat";
import styles from "./ChatPanel.module.css";
import { useUnread } from "../../contexts/UnreadContext";

interface Props {
  telegramId: string;
  displayName: string;
}

function MediaMessage({ msg }: { msg: ChatMessage }) {
  const fileUrl = msg.fileId ? getChatFileUrl(msg.fileId) : null;

  if (msg.messageType === "photo" && fileUrl) {
    return <img src={fileUrl} alt="фото" className={styles.mediaImg} />;
  }

  if ((msg.messageType === "voice" || msg.messageType === "audio") && fileUrl) {
    return <audio controls src={fileUrl} className={styles.audioPlayer} />;
  }

  if (msg.messageType === "video" || msg.messageType === "video_note") {
    return (
      <a href={fileUrl ?? "#"} target="_blank" rel="noreferrer" className={styles.fileLink}>
        <Download size={14} /> Скачать видео
      </a>
    );
  }

  if (msg.messageType === "document") {
    return (
      <a href={fileUrl ?? "#"} target="_blank" rel="noreferrer" className={styles.fileLink}>
        <FileText size={14} /> Скачать файл
      </a>
    );
  }

  if (msg.messageType === "sticker" && fileUrl) {
    return <img src={fileUrl} alt="стикер" className={styles.stickerImg} />;
  }

  const label: Record<string, string> = {
    voice: "🎤 Голосовое",
    audio: "🎵 Аудио",
    video: "🎬 Видео",
    video_note: "📹 Видеосообщение",
    document: "📎 Файл",
    sticker: "😄 Стикер",
    other: "📎 Вложение",
  };

  return (
    <span className={styles.mediaLabel}>
      <Mic size={13} /> {label[msg.messageType] ?? msg.messageType}
    </span>
  );
}

export function ChatPanel({ telegramId, displayName }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { refresh: refreshUnread } = useUnread();

  const load = async () => {
    try {
      const data = await getChatHistory(telegramId);
      setMessages(data);
    } catch {
      // silent — don't flash error on background poll
    }
  };

  useEffect(() => {
    markChatAsRead(telegramId).then(refreshUnread).catch(() => {});
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [telegramId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const msg = await sendChatMessage(telegramId, text);
      setMessages((prev) => [...prev, msg]);
      setInput("");
      inputRef.current?.focus();
    } catch (err: any) {
      setError(err.message || "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        Чат с {displayName}
      </div>

      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.empty}>Сообщений пока нет</div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`${styles.bubble} ${msg.direction === "out" ? styles.bubbleOut : styles.bubbleIn}`}
          >
            {msg.text && <span>{msg.text}</span>}
            {!msg.text && <MediaMessage msg={msg} />}
            <span className={styles.time}>{formatTime(msg.timestamp)}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <div className={styles.sendError}>{error}</div>}

      <div className={styles.inputRow}>
        <textarea
          ref={inputRef}
          className={styles.input}
          placeholder="Написать сообщение... (Enter — отправить)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={sending}
        />
        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={sending || !input.trim()}
          title="Отправить"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
