import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { MarkdownContent } from "../components/MarkdownContent";
import { HomeworkChat } from "../components/HomeworkChat";
import { getHomeworkHistory, deleteHomeworkSubmission } from "../api/homework";
import type { HomeworkSubmission } from "../api/homework";

import { getCurrentUserId } from "../api/client";

const API_BASE = import.meta.env.VITE_API_URL || "";
const MAX_FILE_BYTES = 40 * 1024 * 1024; // 40 MB warning threshold

export function HomeworkPage() {
  const { t, i18n } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const [knowledgeMode, setKnowledgeMode] = useState<"general" | "course_only">("general");
  const [mode, setMode] = useState<"check" | "help">("check");
  const [revelationLevel, setRevelationLevel] = useState<1 | 2 | 3>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // History sidebar
  const [historyItems, setHistoryItems] = useState<HomeworkSubmission[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<HomeworkSubmission | null>(null);

  const pendingKey = courseId ? `hw_pending_${courseId}` : null;

  const fetchHistory = useCallback(async (): Promise<HomeworkSubmission[]> => {
    if (!courseId) return [];
    setLoadingHistory(true);
    try {
      const items = await getHomeworkHistory(courseId);
      setHistoryItems(items);
      return items;
    } catch {
      return [];
    } finally {
      setLoadingHistory(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // ── localStorage persistence — restore in-progress state on mount ──────────
  useEffect(() => {
    if (!pendingKey || !courseId) return;
    const ts = localStorage.getItem(pendingKey);
    if (!ts) return;
    const age = Date.now() - parseInt(ts);
    if (age > 5 * 60 * 1000) {
      localStorage.removeItem(pendingKey);
      return;
    }

    // Previous session was in-progress — show spinner and poll for result
    setChecking(true);
    const startTs = parseInt(ts);

    const interval = setInterval(async () => {
      const items = await getHomeworkHistory(courseId);
      setHistoryItems(items);
      const found = items.find(
        (i) => new Date(i.created_at).getTime() > startTs
      );
      if (found) {
        clearInterval(interval);
        clearTimeout(timeout);
        setSelectedHistory(found);
        setChecking(false);
        localStorage.removeItem(pendingKey);
      }
    }, 2000);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      setChecking(false);
      localStorage.removeItem(pendingKey);
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [courseId]);

  const addFiles = (incoming: File[] | FileList | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming);
    // Warn about oversized files
    const oversized = arr.find((f) => f.size > MAX_FILE_BYTES);
    if (oversized) {
      setCheckError(t("common.fileTooLarge"));
      return;
    }
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...arr.filter((f) => !names.has(f.name))];
    });
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
    addFiles(pastedFiles);
  };

  const removeFile = (name: string) =>
    setFiles((prev) => prev.filter((f) => f.name !== name));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return;
    setChecking(true);
    setCheckError(null);
    setSelectedHistory(null);

    // Set localStorage flag so state persists across navigation/refresh
    if (pendingKey) localStorage.setItem(pendingKey, Date.now().toString());

    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (courseId) form.append("course_id", courseId);
    form.append("knowledge_mode", knowledgeMode);
    form.append("language", i18n.language);
    form.append("mode", mode);
    form.append("revelation_level", String(revelationLevel));
    if (description.trim()) form.append("user_description", description.trim());

    try {
      const userId = getCurrentUserId();
      const response = await fetch(`${API_BASE}/api/homework/check`, {
        method: "POST",
        headers: userId ? { "X-User-Id": userId } : {},
        body: form,
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${response.status}: ${errText.slice(0, 200)}`);
      }
      if (!response.body) return;

      // Stream until done (display comes from DB, not stream)
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const chunk = line.slice(6);
            if (chunk === "[DONE]") break outer;
            if (chunk.startsWith("[ERROR:")) {
              throw new Error(chunk.slice(7, -1));
            }
          }
        }
      }

      // Wait for backend background task to save, then load from DB
      await new Promise((res) => setTimeout(res, 1500));
      const items = await fetchHistory();
      if (items.length > 0) {
        setSelectedHistory(items[0]);
      }
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setChecking(false);
      if (pendingKey) localStorage.removeItem(pendingKey);
    }
  };

  const loadHistoryItem = (sub: HomeworkSubmission) => {
    setSelectedHistory(sub);
    setCheckError(null);
  };

  const handleDeleteHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteHomeworkSubmission(id);
      if (selectedHistory?.id === id) {
        setSelectedHistory(null);
      }
      fetchHistory();
    } catch {
      // silently ignore
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return (
      d.toLocaleDateString() +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  };

  const revelationOptions: { level: 1 | 2 | 3; label: string }[] = [
    { level: 1, label: t("homework.revelationHint") },
    { level: 2, label: t("homework.revelationGuide") },
    { level: 3, label: t("homework.revelationSolution") },
  ];

  return (
    <div className="flex gap-5 items-start" onPaste={handlePaste}>
      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">{t("homework.title")}</h1>
        <p className="text-gray-400 text-sm mb-6">{t("homework.subtitle")}</p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* ── Mode selector ──────────────────────────────────────────────── */}
          <div className="bg-gray-800 rounded-xl p-4 space-y-3">
            <div className="flex gap-2">
              {(["check", "help"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    mode === m
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                  }`}
                >
                  {t(`homework.mode${m === "check" ? "Check" : "Help"}`)}
                </button>
              ))}
            </div>

            {/* Revelation level — only visible in help mode */}
            {mode === "help" && (
              <div>
                <p className="text-xs text-gray-400 mb-2">{t("homework.revelationLabel")}</p>
                <div className="flex gap-2">
                  {revelationOptions.map(({ level, label }) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setRevelationLevel(level)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        revelationLevel === level
                          ? "bg-purple-600 text-white"
                          : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Knowledge mode ─────────────────────────────────────────────── */}
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-sm text-gray-400 mb-3">{t("knowledgeMode.label")}</p>
            <div className="flex gap-2">
              {(["general", "course_only"] as const).map((km) => (
                <button
                  key={km}
                  type="button"
                  onClick={() => setKnowledgeMode(km)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    knowledgeMode === km
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                  }`}
                >
                  {t(`knowledgeMode.${km === "general" ? "general" : "courseOnly"}`)}
                </button>
              ))}
            </div>
          </div>

          {/* ── Drop zone ──────────────────────────────────────────────────── */}
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              dragOver
                ? "border-blue-500 bg-blue-500/10"
                : "border-gray-700 hover:border-gray-500"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*,.pdf"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <p className="text-gray-500 text-sm">{t("homework.dragDrop")}</p>
            <p className="text-gray-600 text-xs mt-1">{t("common.maxFileSize")}</p>
          </div>

          {/* Selected files list */}
          {files.length > 0 && (
            <div className="space-y-1">
              {files.map((f) => (
                <div
                  key={f.name}
                  className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2"
                >
                  <span className="text-sm text-blue-400 truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(f.name)}
                    className="text-gray-500 hover:text-red-400 ml-2 text-xs shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Optional description */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t("homework.description")}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("homework.descriptionPlaceholder")}
              rows={2}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          {checkError && <p className="text-red-400 text-sm">{checkError}</p>}

          <button
            type="submit"
            disabled={files.length === 0 || checking}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
          >
            {checking ? t("homework.checking") : t("homework.check")}
          </button>
        </form>

        {/* ── Result area ────────────────────────────────────────────────────── */}
        {selectedHistory ? (
          <div className="mt-8 bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold">{t("homework.results.title")}</h2>
              <div className="flex items-center gap-3">
                {selectedHistory.score_text && (
                  <span className="text-sm font-semibold text-green-400">
                    {selectedHistory.score_text}
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  {formatDate(selectedHistory.created_at)}
                </span>
                <button
                  onClick={() => setSelectedHistory(null)}
                  className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
            {selectedHistory.filenames && selectedHistory.filenames.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {selectedHistory.filenames.map((name, i) => (
                  <span
                    key={i}
                    className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
            <MarkdownContent content={selectedHistory.analysis_result} />
          </div>
        ) : checking ? (
          <div className="mt-8 bg-gray-800 rounded-xl p-4 flex items-center gap-3">
            <span className="animate-spin w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full inline-block shrink-0" />
            <span className="text-sm text-gray-400">{t("homework.checking")}</span>
          </div>
        ) : null}

        {/* Embedded follow-up chat after feedback */}
        {selectedHistory && !checking && (
          <HomeworkChat
            homeworkContext={selectedHistory.analysis_result}
            courseId={courseId}
            language={i18n.language}
            submissionId={selectedHistory.id}
            initialMessages={selectedHistory.chat_messages ?? undefined}
            contextImagesB64={selectedHistory.images_b64 ?? undefined}
            initialSessionId={selectedHistory.chat_session_id ?? undefined}
          />
        )}
      </div>

      {/* ── History sidebar ────────────────────────────────────────────────────── */}
      <div className="w-60 shrink-0 bg-gray-800 rounded-xl border border-gray-700 p-3">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("homework.history")}</h3>
        {loadingHistory ? (
          <p className="text-xs text-gray-500">{t("common.loading")}</p>
        ) : historyItems.length === 0 ? (
          <p className="text-xs text-gray-500">{t("homework.noHistory")}</p>
        ) : (
          <div className="space-y-2">
            {historyItems.map((sub) => (
              <div
                key={sub.id}
                onClick={() => loadHistoryItem(sub)}
                className={`group relative w-full text-left rounded-lg px-3 py-2.5 transition-colors border cursor-pointer ${
                  selectedHistory?.id === sub.id
                    ? "bg-blue-600/20 border-blue-600/50"
                    : "bg-gray-700/50 border-transparent hover:bg-gray-700 hover:border-gray-600"
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  {sub.filenames && sub.filenames.length > 0 ? (
                    <p className="text-xs text-gray-200 truncate font-medium flex-1">
                      📄 {sub.filenames[0]}
                      {sub.filenames.length > 1 && ` +${sub.filenames.length - 1}`}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 italic flex-1">{t("homework.noFiles")}</p>
                  )}
                  <button
                    onClick={(e) => handleDeleteHistory(sub.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs transition-opacity shrink-0 ml-1"
                    title={t("common.delete")}
                  >
                    ×
                  </button>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-gray-500">
                    {new Date(sub.created_at).toLocaleDateString()}
                  </span>
                  {sub.score_text && (
                    <span className="text-xs font-semibold text-green-400">
                      {sub.score_text}
                    </span>
                  )}
                </div>
                {/* Show chat indicator if conversation was saved */}
                {sub.chat_messages && sub.chat_messages.length > 0 && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    💬 {Math.floor(sub.chat_messages.length / 2)} {t("homework.chatRounds")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
