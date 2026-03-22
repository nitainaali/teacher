import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { getChatSessions, getChatMessages, deleteChatSession, streamChatMessageFetch } from "../api/chat";
import { MarkdownContent } from "../components/MarkdownContent";
import { HelpTooltip } from "../components/HelpTooltip";
import type { ChatSession, ChatMessage } from "../types";

export function ChatPage() {
  const { t, i18n } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [knowledgeMode, setKnowledgeMode] = useState<"general" | "course_only">("general");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [pastedImages, setPastedImages] = useState<string[]>([]); // data URLs for preview
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadSessions(); }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const loadSessions = () => getChatSessions().then(setSessions);

  const loadMessages = (sessionId: string) => {
    setActiveSessionId(sessionId);
    getChatMessages(sessionId).then(setMessages);
  };

  const newSession = () => {
    setActiveSessionId(null);
    setMessages([]);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const imageItem = Array.from(e.clipboardData.items).find((item) =>
      item.type.startsWith("image/")
    );
    if (!imageItem) return;
    e.preventDefault();
    const blob = imageItem.getAsFile();
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPastedImages((prev) => [...prev, reader.result as string]);
    };
    reader.readAsDataURL(blob);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && pastedImages.length === 0) || streaming) return;
    const currentImages = [...pastedImages];
    const currentInput = input.trim() || "מה יש בתמונה?";
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      session_id: activeSessionId || "",
      role: "user",
      content: input.trim() || "🖼️",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setPastedImages([]);
    setStreaming(true);
    setStreamingText("");
    setChatError(null);
    // Strip data:...;base64, prefix to get pure base64
    const base64Images = currentImages.map((d) => d.split(",")[1]).filter(Boolean);
    let sessionIdFromStream: string | null = null;
    let assistantText = "";
    try {
      for await (const chunk of streamChatMessageFetch({
        message: currentInput,
        session_id: activeSessionId ?? undefined,
        course_id: courseId,
        knowledge_mode: knowledgeMode,
        language: i18n.language,
        images: base64Images.length > 0 ? base64Images : undefined,
      })) {
        if (!sessionIdFromStream && chunk.startsWith("[SESSION_ID:")) {
          sessionIdFromStream = chunk.slice(12, -1);
          setActiveSessionId(sessionIdFromStream);
          continue;
        }
        assistantText += chunk;
        setStreamingText(assistantText);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "שגיאה בשליחת ההודעה");
    } finally {
      setStreaming(false);
      setStreamingText("");
      if (sessionIdFromStream || activeSessionId) {
        const sid = sessionIdFromStream || activeSessionId!;
        loadMessages(sid);
        loadSessions();
      }
    }
  };
  const handleDeleteSession = async (id: string) => {
    await deleteChatSession(id);
    if (activeSessionId === id) newSession();
    loadSessions();
  };

  return (
    <div className="flex gap-4 h-[calc(100vh-7rem)]">
      <div className="w-44 shrink-0 bg-gray-700 rounded-xl flex flex-col overflow-hidden">
        <div className="p-3 border-b border-gray-600 flex items-center gap-2">
          <button
            onClick={newSession}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            {t("chat.newSession")}
          </button>
          <HelpTooltip text={t("help.chat")} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-start justify-between px-3 py-2.5 cursor-pointer hover:bg-gray-600 transition-colors ${s.id === activeSessionId ? "bg-gray-600" : ""}`}
              onClick={() => loadMessages(s.id)}
            >
              <div className="flex-1 min-w-0 pr-1">
                {s.first_message && (
                  <p className="text-xs text-gray-200 truncate font-medium">{s.first_message}</p>
                )}
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date(s.created_at).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
                className="hidden group-hover:block text-gray-500 hover:text-red-400 text-xs shrink-0"
              >×</button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-3">
          <div className="flex gap-1">
            {(["general", "course_only"] as const).map((mode) => (
              <button key={mode} onClick={() => setKnowledgeMode(mode)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${knowledgeMode === mode ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
              >
                {t(`knowledgeMode.${mode === "general" ? "general" : "courseOnly"}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[70%] rounded-xl px-4 py-2.5 text-sm ${msg.role === "user" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-100"}`}>
                {msg.role === "assistant" ? (
                  <MarkdownContent content={msg.content} />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))}
          {streamingText && (
            <div className="flex justify-start">
              <div className="max-w-[70%] rounded-xl px-4 py-2.5 text-sm bg-gray-700 text-gray-100">
                <MarkdownContent content={streamingText} />
                <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5" />
              </div>
            </div>
          )}
          {streaming && !streamingText && (
            <div className="flex justify-start">
              <div className="bg-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-400">{t("chat.thinking")}</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {chatError && (
          <div className="px-4 py-2 bg-red-900/30 border-t border-red-700 text-red-400 text-xs">
            {chatError}
          </div>
        )}
        {pastedImages.length > 0 && (
          <div className="flex gap-2 px-4 pt-2 flex-wrap border-t border-gray-700">
            {pastedImages.map((img, i) => (
              <div key={i} className="relative shrink-0">
                <img src={img} className="w-14 h-14 object-cover rounded border border-gray-600" />
                <button
                  type="button"
                  onClick={() => setPastedImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center leading-none"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleSend} className="px-4 py-3 border-t border-gray-700 flex gap-2" onPaste={handlePaste}>
          <input value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={t("chat.placeholder")} disabled={streaming}
            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button type="submit" disabled={(!input.trim() && pastedImages.length === 0) || streaming}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {t("chat.send")}
          </button>
        </form>
      </div>
    </div>
  );
}
