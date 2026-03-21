import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MarkdownContent } from "../components/MarkdownContent";
import {
  getUnifiedHistory,
  deleteUnifiedItem,
  type UnifiedHistoryItem,
} from "../api/unified";
import { getChatMessages } from "../api/chat";
import { getHomeworkSubmission } from "../api/homework";
import { getExamAnalysis, updateExamAnalysis } from "../api/exams";
import client, { getCurrentUserId } from "../api/client";

type Mode = "general" | "homework" | "exam";
type ItemType = "general" | "homework" | "exam";
type HistoryFilter = "all" | "general" | "homework" | "exam";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

const API_BASE = import.meta.env.VITE_API_URL || "";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function tagColor(type: ItemType): string {
  if (type === "general") return "bg-blue-600/30 text-blue-400";
  if (type === "homework") return "bg-purple-600/30 text-purple-400";
  return "bg-orange-600/30 text-orange-400";
}

export function UnifiedChatPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  // ── Conversation state ──────────────────────────────────────────────────────
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [activeItemType, setActiveItemType] = useState<ItemType | null>(null);
  const [contextImagesB64, setContextImagesB64] = useState<string[]>([]);

  // ── Input state ─────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>("general");
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [refFile, setRefFile] = useState<File | null>(null);

  // Homework sub-options
  const [hwMode, setHwMode] = useState<"check" | "help">("check");
  const [revelationLevel, setRevelationLevel] = useState<1 | 2 | 3>(1);
  const [knowledgeMode, setKnowledgeMode] = useState("course_only");

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [streaming, setStreaming] = useState(false);
  const [historyItems, setHistoryItems] = useState<UnifiedHistoryItem[]>([]);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null);

  // ── Load history ─────────────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    try {
      const items = await getUnifiedHistory(courseId, historyFilter);
      setHistoryItems(items);
    } catch (e) {
      console.error("Failed to load history", e);
    }
  }, [courseId, historyFilter]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── New conversation ──────────────────────────────────────────────────────────
  const handleNewConversation = () => {
    setMessages([]);
    setSessionId(null);
    setActiveItemId(null);
    setActiveItemType(null);
    setContextImagesB64([]);
    setInput("");
    setFiles([]);
    setRefFile(null);
    setStreaming(false);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const imageItems = Array.from(e.clipboardData.items).filter((item) =>
      item.type.startsWith("image/")
    );
    if (!imageItems.length) return;
    e.preventDefault();
    const pastedFiles = imageItems
      .map((item) => {
        const blob = item.getAsFile();
        if (!blob) return null;
        return new File([blob], `pasted-${Date.now()}.png`, { type: blob.type });
      })
      .filter(Boolean) as File[];
    setFiles((prev) => [...prev, ...pastedFiles]);
  };

  // ── Load history item ────────────────────────────────────────────────────────
  const handleLoadItem = async (item: UnifiedHistoryItem) => {
    if (streaming) return;
    setMessages([]);
    setSessionId(null);
    setActiveItemId(null);
    setActiveItemType(null);
    setContextImagesB64([]);

    if (item.type === "general") {
      const msgs = await getChatMessages(item.id);
      setMessages(
        msgs.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content }))
      );
      setSessionId(item.id);
      setActiveItemId(item.id);
      setActiveItemType("general");
      setKnowledgeMode(item.metadata_?.knowledge_mode ?? "general");
    } else if (item.type === "homework") {
      const sub = await getHomeworkSubmission(item.id);
      const displayMsgs: DisplayMessage[] = [
        { id: `hw-analysis-${sub.id}`, role: "assistant", content: sub.analysis_result },
      ];
      if (sub.chat_session_id) {
        // Load follow-up messages from the linked chat session.
        // Skip any messages before the first user message — those are context_seed inserts
        // (the analysis text seeded as first assistant turn) and would duplicate the analysis above.
        const chatMsgs = await getChatMessages(sub.chat_session_id);
        const firstUserIdx = chatMsgs.findIndex((m) => m.role === "user");
        (firstUserIdx >= 0 ? chatMsgs.slice(firstUserIdx) : []).forEach((m) => {
          displayMsgs.push({ id: m.id, role: m.role as "user" | "assistant", content: m.content });
        });
      } else if (sub.chat_messages) {
        // Legacy fallback: old sessions stored inline before chat_session_id was introduced
        (sub.chat_messages as Array<{ role: string; content: string }>).forEach((m, i) => {
          displayMsgs.push({ id: `hw-chat-${i}`, role: m.role as "user" | "assistant", content: m.content });
        });
      }
      setMessages(displayMsgs);
      setActiveItemId(sub.id);
      setActiveItemType("homework");
      setSessionId(sub.chat_session_id ?? null);
      setContextImagesB64(sub.images_b64 ?? []);
    } else if (item.type === "exam") {
      const record = await getExamAnalysis(item.id);
      const displayMsgs: DisplayMessage[] = [
        { id: `exam-analysis-${record.id}`, role: "assistant", content: record.analysis_result },
      ];
      if (record.chat_session_id) {
        // Skip context_seed messages (before first user message) to avoid duplicating the analysis
        const chatMsgs = await getChatMessages(record.chat_session_id);
        const firstUserIdx = chatMsgs.findIndex((m) => m.role === "user");
        (firstUserIdx >= 0 ? chatMsgs.slice(firstUserIdx) : []).forEach((m) => {
          displayMsgs.push({ id: m.id, role: m.role as "user" | "assistant", content: m.content });
        });
        setSessionId(record.chat_session_id);
      }
      setMessages(displayMsgs);
      setActiveItemId(record.id);
      setActiveItemType("exam");
    }
  };

  // ── Delete history item ──────────────────────────────────────────────────────
  const handleDeleteItem = async (item: UnifiedHistoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(item.id);
    try {
      await deleteUnifiedItem(item.type, item.id);
      if (activeItemId === item.id) handleNewConversation();
      await loadHistory();
    } catch (err) {
      console.error("Delete failed", err);
    } finally {
      setDeletingId(null);
    }
  };

  // ── Streaming helpers ─────────────────────────────────────────────────────────
  const appendStreamingMsg = (id: string) =>
    setMessages((prev) => [...prev, { id, role: "assistant", content: "", isStreaming: true }]);

  const appendToStreamingMsg = (id: string, chunk: string) =>
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m))
    );

  const finalizeMsg = (id: string, content?: string) =>
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, isStreaming: false, ...(content !== undefined ? { content } : {}) }
          : m
      )
    );

  // ── Send ──────────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (streaming) return;

    const isFollowUp = activeItemId !== null;
    const streamId = `stream-${Date.now()}`;

    // Validation
    if (!isFollowUp && mode === "homework" && files.length === 0) {
      alert(t("unifiedChat.attachHomeworkFirst"));
      return;
    }
    if (!isFollowUp && mode === "exam" && files.length === 0) {
      alert(t("unifiedChat.attachExamFirst"));
      return;
    }
    if (isFollowUp && !input.trim()) return;
    if (!isFollowUp && mode === "general" && !input.trim() && files.length === 0) return;

    setStreaming(true);

    try {
      // ──────────────────── HOMEWORK ANALYSIS ────────────────────────────────
      if (!isFollowUp && mode === "homework") {
        const userContent = [
          ...files.map((f) => f.name),
          ...(input.trim() ? [input.trim()] : []),
        ].join(" · ");
        setMessages((prev) => [
          ...prev,
          { id: `user-${Date.now()}`, role: "user", content: userContent },
        ]);
        appendStreamingMsg(streamId);
        const sentFiles = [...files];
        setFiles([]);
        setInput("");

        const form = new FormData();
        sentFiles.forEach((f) => form.append("files", f));
        if (courseId) form.append("course_id", courseId);
        form.append("knowledge_mode", knowledgeMode);
        form.append("language", lang);
        if (input.trim()) form.append("user_description", input.trim());
        form.append("mode", hwMode);
        form.append("revelation_level", String(revelationLevel));

        const userId = getCurrentUserId();
        const resp = await fetch(`${API_BASE}/api/homework/check`, {
          method: "POST",
          headers: userId ? { "X-User-Id": userId } : {},
          body: form,
        });
        if (!resp.ok || !resp.body) throw new Error("Homework check failed");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let submissionId: string | null = null;

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const chunk = line.slice(6);
            if (chunk === "[DONE]") {
              if (submissionId) {
                const sub = await getHomeworkSubmission(submissionId);
                finalizeMsg(streamId, sub.analysis_result);
                setActiveItemId(submissionId);
                setActiveItemType("homework");
                setSessionId(sub.chat_session_id ?? null);
                setContextImagesB64(sub.images_b64 ?? []);
              } else {
                finalizeMsg(streamId);
              }
              await loadHistory();
              break outer;
            }
            if (chunk.startsWith("[SUBMISSION_ID:")) {
              submissionId = chunk.slice(15, -1);
              continue;
            }
            if (chunk.startsWith("[ERROR:")) {
              finalizeMsg(streamId, `❌ ${chunk.slice(7, -1)}`);
              break outer;
            }
            if (chunk) appendToStreamingMsg(streamId, chunk.replace(/\\n/g, "\n"));
          }
        }

      // ──────────────────── EXAM ANALYSIS ────────────────────────────────────
      } else if (!isFollowUp && mode === "exam") {
        const userContent = [
          files[0].name,
          ...(refFile ? [`[ref: ${refFile.name}]`] : []),
          ...(input.trim() ? [input.trim()] : []),
        ].join(" · ");
        setMessages((prev) => [
          ...prev,
          { id: `user-${Date.now()}`, role: "user", content: userContent },
        ]);
        appendStreamingMsg(streamId);
        const sentFiles = [...files];
        const sentRefFile = refFile;
        setFiles([]);
        setRefFile(null);
        setInput("");

        // Upload student exam
        const uploadForm = new FormData();
        uploadForm.append("file", sentFiles[0]);
        uploadForm.append("course_id", courseId ?? "");
        uploadForm.append("exam_type", "student_submission");
        const uploadResp = await client.post<{ id: string }>("/api/exams/upload", uploadForm, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        const examId = uploadResp.data.id;

        // Optionally upload reference exam
        let refExamId: string | undefined;
        if (sentRefFile) {
          const refForm = new FormData();
          refForm.append("file", sentRefFile);
          refForm.append("course_id", courseId ?? "");
          refForm.append("exam_type", "reference");
          const refResp = await client.post<{ id: string }>("/api/exams/upload", refForm, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          refExamId = refResp.data.id;
        }

        // Stream analysis
        const analyzeForm = new FormData();
        if (input.trim()) analyzeForm.append("guidance", input.trim());
        if (refExamId) analyzeForm.append("reference_exam_id", refExamId);
        analyzeForm.append("language", lang);

        const userId2 = getCurrentUserId();
        const resp = await fetch(`${API_BASE}/api/exams/${examId}/analyze`, {
          method: "POST",
          headers: userId2 ? { "X-User-Id": userId2 } : {},
          body: analyzeForm,
        });
        if (!resp.ok || !resp.body) throw new Error("Exam analysis failed");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let recordId: string | null = null;

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const chunk = line.slice(6);
            if (chunk === "[DONE]") {
              if (recordId) {
                const record = await getExamAnalysis(recordId);
                finalizeMsg(streamId, record.analysis_result);
                setActiveItemId(recordId);
                setActiveItemType("exam");
              } else {
                finalizeMsg(streamId);
              }
              await loadHistory();
              break outer;
            }
            if (chunk.startsWith("[RECORD_ID:")) {
              recordId = chunk.slice(11, -1);
              continue;
            }
            if (chunk.startsWith("[ERROR:")) {
              finalizeMsg(streamId, `❌ ${chunk.slice(7, -1)}`);
              break outer;
            }
            if (chunk) appendToStreamingMsg(streamId, chunk);
          }
        }

      // ──────────────────── GENERAL CHAT / FOLLOW-UP ─────────────────────────
      } else {
        const userText = input.trim();
        if (!userText && files.length === 0) return;

        // Convert any attached files to base64 (general mode)
        let imageFiles: string[] = [];
        if (!isFollowUp && files.length > 0) {
          imageFiles = await Promise.all(
            files.map(
              (f) =>
                new Promise<string>((res, rej) => {
                  const reader = new FileReader();
                  reader.onload = () => res((reader.result as string).split(",")[1]);
                  reader.onerror = rej;
                  reader.readAsDataURL(f);
                })
            )
          );
        }

        setMessages((prev) => [
          ...prev,
          { id: `user-${Date.now()}`, role: "user", content: userText },
        ]);
        appendStreamingMsg(streamId);
        setInput("");
        setFiles([]);

        // Determine chat source for follow-ups
        const source =
          isFollowUp
            ? activeItemType === "homework"
              ? "homework_chat"
              : activeItemType === "exam"
              ? "exam_chat"
              : undefined
            : undefined;

        // Include context images on first homework follow-up (no session yet)
        const imagesForRequest: string[] | undefined =
          isFollowUp && !sessionId && activeItemType === "homework" && contextImagesB64.length > 0
            ? contextImagesB64
            : imageFiles.length > 0
            ? imageFiles
            : undefined;

        // On the very first follow-up for homework/exam (no session yet), seed the new
        // chat session with the analysis text so Claude has full context in all turns.
        const analysisMsg =
          isFollowUp && !sessionId && (activeItemType === "homework" || activeItemType === "exam")
            ? messages.find(
                (m) =>
                  m.role === "assistant" &&
                  (m.id.startsWith("hw-analysis-") || m.id.startsWith("exam-analysis-"))
              )
            : undefined;
        const contextSeed = analysisMsg?.content;

        const payload: Record<string, unknown> = {
          message: userText,
          course_id: courseId,
          knowledge_mode: knowledgeMode,
          language: lang,
          ...(sessionId ? { session_id: sessionId } : {}),
          ...(source ? { source } : {}),
          ...(imagesForRequest ? { images: imagesForRequest } : {}),
          ...(contextSeed ? { context_seed: contextSeed } : {}),
        };

        const userId3 = getCurrentUserId();
        const resp = await fetch(`${API_BASE}/api/chat/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(userId3 ? { "X-User-Id": userId3 } : {}),
          },
          body: JSON.stringify(payload),
        });
        if (!resp.ok || !resp.body) throw new Error("Chat request failed");

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let newSessionId: string | null = null;

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const chunk = line.slice(6);
            if (chunk === "[DONE]") {
              const finalSid = newSessionId ?? sessionId;
              if (finalSid) {
                const msgs = await getChatMessages(finalSid);
                setMessages((prev) => {
                  // For homework/exam sessions, preserve the analysis message at the top
                  if (activeItemType === "homework" || activeItemType === "exam") {
                    const analysisMsg = prev.find(
                      (m) =>
                        m.id.startsWith("hw-analysis-") ||
                        m.id.startsWith("exam-analysis-")
                    );
                    const base = analysisMsg ? [analysisMsg] : [];
                    return [
                      ...base,
                      ...msgs.map((m) => ({
                        id: m.id,
                        role: m.role as "user" | "assistant",
                        content: m.content,
                      })),
                    ];
                  }
                  return msgs.map((m) => ({
                    id: m.id,
                    role: m.role as "user" | "assistant",
                    content: m.content,
                  }));
                });
              } else {
                finalizeMsg(streamId);
              }

              // Persist session linkage on first follow-up
              if (newSessionId && isFollowUp && !sessionId) {
                if (activeItemType === "homework" && activeItemId) {
                  client
                    .patch(`/api/homework/history/${activeItemId}`, {
                      chat_session_id: newSessionId,
                    })
                    .catch(console.error);
                } else if (activeItemType === "exam" && activeItemId) {
                  updateExamAnalysis(activeItemId, { chat_session_id: newSessionId }).catch(
                    console.error
                  );
                }
              }

              if (newSessionId) {
                setSessionId(newSessionId);
                if (activeItemType === null) {
                  setActiveItemId(newSessionId);
                  setActiveItemType("general");
                }
              }

              await loadHistory();
              break outer;
            }
            if (chunk.startsWith("[SESSION_ID:")) {
              newSessionId = chunk.slice(12, -1);
              continue;
            }
            if (chunk.startsWith("[ERROR:")) {
              finalizeMsg(streamId, `❌ ${chunk.slice(7, -1)}`);
              break outer;
            }
            if (chunk) appendToStreamingMsg(streamId, chunk);
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      finalizeMsg(streamId, `❌ ${msg}`);
    } finally {
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    e.target.value = "";
  };

  // Programmatic file picker that works in all browsers regardless of CSS/DOM context.
  // Creates a fresh <input> on document.body so no React/CSS restrictions apply.
  const handleFileClick = () => {
    if (streaming) return;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".pdf,image/*";
    document.body.appendChild(input);
    const cleanup = () => {
      if (document.body.contains(input)) document.body.removeChild(input);
    };
    input.addEventListener("change", () => {
      if (input.files && input.files.length > 0) {
        setFiles((prev) => [...prev, ...Array.from(input.files!)]);
      }
      cleanup();
    });
    input.addEventListener("cancel", cleanup);
    input.click();
  };

  const handleRefFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setRefFile(e.target.files[0]);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
  };

  const isFollowUp = activeItemId !== null;

  const sendLabel = streaming
    ? "..."
    : isFollowUp
    ? t("common.send")
    : mode === "homework"
    ? t("unifiedChat.sendHomework")
    : mode === "exam"
    ? t("unifiedChat.sendExam")
    : t("unifiedChat.sendGeneral");

  const filteredHistory =
    historyFilter === "all" ? historyItems : historyItems.filter((i) => i.type === historyFilter);

  const tagLabel = (type: ItemType) => {
    if (type === "general") return t("unifiedChat.tagGeneral");
    if (type === "homework") return t("unifiedChat.tagHomework");
    return t("unifiedChat.tagExam");
  };

  const filterLabel = (f: HistoryFilter) => {
    const key = `unifiedChat.filter${f.charAt(0).toUpperCase() + f.slice(1)}` as
      | "unifiedChat.filterAll"
      | "unifiedChat.filterGeneral"
      | "unifiedChat.filterHomework"
      | "unifiedChat.filterExam";
    return t(key);
  };

  const knowledgeModeToggle = (
    <div className="flex gap-2 text-xs text-gray-400 items-center">
      <span>{t("knowledgeMode.label")}:</span>
      {(["general", "course_only"] as const).map((km) => (
        <button
          key={km}
          onClick={() => setKnowledgeMode(km)}
          className={`px-2 py-0.5 rounded border transition-colors ${
            knowledgeMode === km
              ? "bg-blue-600/40 border-blue-500 text-blue-200"
              : "border-gray-600 hover:text-white"
          }`}
        >
          {t(km === "general" ? "knowledgeMode.general" : "knowledgeMode.courseOnly")}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex h-full overflow-hidden" onPaste={handlePaste}>
      {/* ── Left sidebar ─────────────────────────────────────────────────────── */}
      <div className="w-60 shrink-0 flex flex-col border-r border-gray-700 bg-gray-800">
        {/* New conversation */}
        <div className="p-3 border-b border-gray-700">
          <button
            onClick={handleNewConversation}
            className="w-full text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 transition-colors"
          >
            + {t("unifiedChat.newConversation")}
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex border-b border-gray-700 shrink-0">
          {(["all", "general", "homework", "exam"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setHistoryFilter(f)}
              className={`flex-1 py-2 text-[10px] transition-colors ${
                historyFilter === f
                  ? "text-blue-400 border-b-2 border-blue-500"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {filterLabel(f)}
            </button>
          ))}
        </div>

        {/* History list */}
        <div className="flex-1 overflow-y-auto py-1">
          {filteredHistory.length === 0 && (
            <p className="text-xs text-gray-500 px-4 py-6 text-center">
              {t("unifiedChat.noHistory")}
            </p>
          )}
          {filteredHistory.map((item) => (
            <div
              key={item.id}
              onClick={() => handleLoadItem(item)}
              className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-colors text-xs ${
                activeItemId === item.id
                  ? "bg-blue-600/20 text-blue-200"
                  : "hover:bg-gray-700 text-gray-300"
              }`}
            >
              <span
                className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${tagColor(
                  item.type
                )}`}
              >
                {tagLabel(item.type)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="truncate leading-tight">{item.title}</p>
                <p className="text-gray-500 text-[10px] mt-0.5">{formatDate(item.created_at)}</p>
              </div>
              <button
                onClick={(e) => handleDeleteItem(item, e)}
                disabled={deletingId === item.id}
                className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all"
                title={t("common.delete")}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main area ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          {messages.length === 0 && mode !== "exam" && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-500">
                <p className="text-5xl mb-3">💬</p>
                <p className="text-sm font-medium text-gray-400">{t("unifiedChat.title")}</p>
              </div>
            </div>
          )}

          {/* Exam welcome instruction bubble */}
          {mode === "exam" && messages.length === 0 && !activeItemId && (
            <div className="flex gap-3 justify-start">
              <div className="max-w-[80%] bg-gray-700/60 rounded-2xl rounded-tl-sm px-4 py-3 text-sm">
                <MarkdownContent content={t("unifiedChat.examWelcome")} />
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "user" ? (
                <div
                  dir="auto"
                  className="max-w-[75%] bg-blue-600/80 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm whitespace-pre-wrap"
                >
                  {msg.content}
                </div>
              ) : (
                <div className="max-w-[85%] bg-gray-700/60 rounded-2xl rounded-tl-sm px-4 py-3 text-sm">
                  <MarkdownContent content={msg.content} />
                  {msg.isStreaming && (
                    <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-1 align-middle rounded-sm" />
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-gray-700 bg-gray-800/50 p-3 space-y-2">
          {/* Mode selector (only when not in an active session) */}
          {!isFollowUp && (
            <div className="flex gap-2">
              {(["general", "homework", "exam"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    mode === m
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-gray-600 text-gray-400 hover:text-white hover:border-gray-400"
                  }`}
                >
                  {t(
                    m === "general"
                      ? "unifiedChat.modeGeneral"
                      : m === "homework"
                      ? "unifiedChat.modeHomework"
                      : "unifiedChat.modeExam"
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Sub-options: General */}
          {!isFollowUp && mode === "general" && knowledgeModeToggle}

          {/* Sub-options: Homework */}
          {!isFollowUp && mode === "homework" && (
            <div className="space-y-2">
              <div className="flex gap-2 flex-wrap">
                {(["check", "help"] as const).map((hm) => (
                  <button
                    key={hm}
                    onClick={() => setHwMode(hm)}
                    className={`text-xs px-3 py-1 rounded border transition-colors ${
                      hwMode === hm
                        ? "bg-purple-600/40 border-purple-500 text-purple-200"
                        : "border-gray-600 text-gray-400 hover:text-white"
                    }`}
                  >
                    {t(hm === "check" ? "homework.modeCheck" : "homework.modeHelp")}
                  </button>
                ))}
              </div>
              {hwMode === "help" && (
                <div className="flex gap-1 text-xs text-gray-400 items-center flex-wrap">
                  <span className="mr-1">{t("homework.revelationLabel")}</span>
                  {([1, 2, 3] as const).map((lv) => (
                    <button
                      key={lv}
                      onClick={() => setRevelationLevel(lv)}
                      className={`px-2 py-0.5 rounded border transition-colors ${
                        revelationLevel === lv
                          ? "bg-blue-600/40 border-blue-500 text-blue-200"
                          : "border-gray-600 hover:text-white"
                      }`}
                    >
                      {lv === 1
                        ? t("homework.revelationHint")
                        : lv === 2
                        ? t("homework.revelationGuide")
                        : t("homework.revelationSolution")}
                    </button>
                  ))}
                </div>
              )}
              {knowledgeModeToggle}
            </div>
          )}

          {/* Sub-options: Exam — only reference file picker */}
          {!isFollowUp && mode === "exam" && (
            <div className="flex items-center gap-2">
              <label
                className="text-xs px-3 py-1 border border-gray-600 rounded-lg text-gray-400 hover:text-white hover:border-gray-400 transition-colors truncate max-w-[200px] cursor-pointer"
              >
                📄 {refFile ? refFile.name : t("unifiedChat.examRefFile")}
                <input
                  ref={refFileInputRef}
                  type="file"
                  accept=".pdf,image/*"
                  className="hidden"
                  onChange={handleRefFileChange}
                />
              </label>
              {refFile && (
                <button
                  onClick={() => setRefFile(null)}
                  className="text-gray-500 hover:text-red-400 text-sm"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* File previews */}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 bg-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200"
                >
                  <span className="max-w-[120px] truncate">{f.name}</span>
                  <button
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="text-gray-500 hover:text-red-400 ml-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Text input + send */}
          <div className="flex gap-2 items-end">
            <button
              type="button"
              title={t("common.upload")}
              disabled={streaming}
              onClick={handleFileClick}
              className={`shrink-0 cursor-pointer text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-700 transition-colors ${streaming ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              📎
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                !isFollowUp && mode === "homework"
                  ? t("homework.descriptionPlaceholder")
                  : t("unifiedChat.inputPlaceholder")
              }
              rows={1}
              disabled={streaming}
              className="flex-1 bg-gray-700 text-white rounded-xl px-4 py-2.5 text-sm border border-gray-600 focus:outline-none focus:border-blue-500 resize-none disabled:opacity-40"
              style={{ minHeight: "44px", maxHeight: "120px" }}
            />
            <button
              onClick={handleSend}
              disabled={
                streaming ||
                (!isFollowUp && mode === "homework" && files.length === 0) ||
                (!isFollowUp && mode === "exam" && files.length === 0) ||
                (isFollowUp && !input.trim())
              }
              className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2.5 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sendLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
