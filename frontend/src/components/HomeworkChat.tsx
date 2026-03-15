import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownContent } from "./MarkdownContent";
import { updateHomeworkChat } from "../api/homework";
import type { ChatMessage } from "../api/homework";

interface HomeworkChatProps {
  homeworkContext: string;
  courseId?: string;
  language: string;
  submissionId?: string;       // ID of the homework submission to save chat to
  initialMessages?: ChatMessage[]; // Restored messages from history
}

const API_BASE = import.meta.env.VITE_API_URL || "";

export function HomeworkChat({
  homeworkContext,
  courseId,
  language,
  submissionId,
  initialMessages,
}: HomeworkChatProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // If initialMessages change (e.g. switching history items), reset messages
  useEffect(() => {
    setMessages(initialMessages ?? []);
    setSessionId(null);
  }, [submissionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const saveMessages = async (msgs: ChatMessage[]) => {
    if (!submissionId) return;
    try {
      await updateHomeworkChat(submissionId, msgs);
    } catch {
      // silently ignore — chat saving is best-effort
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    // First message: prepend homework context
    const isFirst = messages.length === 0;
    const fullMessage = isFirst
      ? `${t("homework.chatContextPrefix")}:\n---\n${homeworkContext}\n---\n\n${text}`
      : text;

    const newUserMsg: ChatMessage = { role: "user", content: text };
    const updatedWithUser = [...messages, newUserMsg];
    setMessages(updatedWithUser);
    setInput("");
    setStreaming(true);

    const assistantPlaceholder: ChatMessage = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    try {
      const response = await fetch(`${API_BASE}/api/chat/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: fullMessage,
          session_id: sessionId,
          course_id: courseId,
          knowledge_mode: "general",
          language,
          source: "homework_chat",
        }),
      });

      if (!response.ok || !response.body) throw new Error();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      let newSessionId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const chunk = line.slice(6);
            if (chunk === "[DONE]") break;
            if (chunk.startsWith("[SESSION_ID:")) {
              newSessionId = chunk.slice(12, -1);
              continue;
            }
            if (chunk.startsWith("[ERROR:")) continue;
            if (chunk) {
              accumulated += chunk;
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: accumulated },
              ]);
            }
          }
        }
      }

      // Load clean content from DB — SSE-accumulated strings can have corrupted
      // LaTeX/newlines due to TCP chunking. DB is the authoritative source.
      const resolvedSessionId = newSessionId || sessionId;
      if (resolvedSessionId) {
        try {
          const msgRes = await fetch(`${API_BASE}/api/chat/sessions/${resolvedSessionId}/messages`);
          if (msgRes.ok) {
            const msgs = (await msgRes.json()) as Array<{ role: string; content: string }>;
            const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
            if (lastAssistant) {
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: lastAssistant.content },
              ]);
            }
          }
        } catch {}
      }

      if (newSessionId) setSessionId(newSessionId);

      // Save the full conversation to DB after each exchange
      const finalMessages: ChatMessage[] = [
        ...updatedWithUser,
        { role: "assistant", content: accumulated },
      ];
      await saveMessages(finalMessages);
      setMessages(finalMessages);
    } catch {
      const errorMsg: ChatMessage = { role: "assistant", content: t("common.error") };
      const withError = [...updatedWithUser, errorMsg];
      setMessages(withError);
      await saveMessages(withError);
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="mt-6 bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-gray-300">{t("homework.chatTitle")}</h3>
      </div>

      {/* Messages */}
      <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-xs text-gray-500 text-center">{t("homework.chatHint")}</p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-100"
              }`}
            >
              {msg.role === "assistant" ? (
                <MarkdownContent content={msg.content} />
              ) : (
                <p>{msg.content}</p>
              )}
              {streaming && i === messages.length - 1 && msg.role === "assistant" && (
                <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-700 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder={t("homework.chatPlaceholder")}
          disabled={streaming}
          className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || streaming}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {t("common.send")}
        </button>
      </div>
    </div>
  );
}
