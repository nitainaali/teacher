import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { MarkdownContent } from "../components/MarkdownContent";
import { HomeworkChat } from "../components/HomeworkChat";
import type { HomeworkFeedback } from "../types";
import { getHomeworkHistory, deleteHomeworkSubmission } from "../api/homework";
import type { HomeworkSubmission } from "../api/homework";

const API_BASE = import.meta.env.VITE_API_URL || "";

export function HomeworkPage() {
  const { t, i18n } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const [knowledgeMode, setKnowledgeMode] = useState<"general" | "course_only">("general");
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [checking, setChecking] = useState(false);
  const [rawResponse, setRawResponse] = useState("");
  const [feedback, setFeedback] = useState<HomeworkFeedback | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // History sidebar
  const [historyItems, setHistoryItems] = useState<HomeworkSubmission[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<HomeworkSubmission | null>(null);

  const fetchHistory = () => {
    if (!courseId) return;
    setLoadingHistory(true);
    getHomeworkHistory(courseId)
      .then(setHistoryItems)
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  };

  useEffect(() => {
    fetchHistory();
  }, [courseId]);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      const newOnes = Array.from(incoming).filter((f) => !names.has(f.name));
      return [...prev, ...newOnes];
    });
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
    setRawResponse("");
    setFeedback(null);
    setCheckError(null);
    setSelectedHistory(null);

    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (courseId) form.append("course_id", courseId);
    form.append("knowledge_mode", knowledgeMode);
    form.append("language", i18n.language);
    if (description.trim()) form.append("user_description", description.trim());

    try {
      const response = await fetch(`${API_BASE}/api/homework/check`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${response.status}: ${errText.slice(0, 200)}`);
      }
      if (!response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      let buffer = "";

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
            if (chunk.startsWith("[ERROR:")) {
              throw new Error(chunk.slice(7, -1));
            }
            if (chunk) {
              full += chunk;
              setRawResponse(full);
            }
          }
        }
      }
      const match = full.match(/{[\s\S]*}/);
      if (match) {
        try { setFeedback(JSON.parse(match[0])); } catch { /* leave as raw */ }
      }
      // Refresh history after successful submission
      setTimeout(() => fetchHistory(), 1500);
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setChecking(false);
    }
  };

  const loadHistoryItem = (sub: HomeworkSubmission) => {
    setSelectedHistory(sub);
    setRawResponse("");
    setFeedback(null);
    setCheckError(null);
  };

  const handleDeleteHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteHomeworkSubmission(id);
      if (selectedHistory?.id === id) setSelectedHistory(null);
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

  return (
    <div className="flex gap-5 items-start">
      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">{t("homework.title")}</h1>
        <p className="text-gray-400 text-sm mb-6">{t("homework.subtitle")}</p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-sm text-gray-400 mb-3">{t("knowledgeMode.label")}</p>
            <div className="flex gap-2">
              {(["general", "course_only"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setKnowledgeMode(mode)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    knowledgeMode === mode
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                  }`}
                >
                  {t(`knowledgeMode.${mode === "general" ? "general" : "courseOnly"}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Drop zone */}
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
        ) : feedback ? (
          <div className="mt-8 space-y-4">
            <h2 className="text-lg font-semibold">{t("homework.results.title")}</h2>

            <div className="bg-gray-800 rounded-xl p-4 flex items-center gap-4">
              <span
                className={`text-2xl font-bold ${
                  feedback.overall_correct ? "text-green-400" : "text-yellow-400"
                }`}
              >
                {feedback.score_estimate}
              </span>
              <span
                className={`text-sm ${
                  feedback.overall_correct ? "text-green-400" : "text-yellow-400"
                }`}
              >
                {feedback.overall_correct
                  ? t("homework.results.correct")
                  : t("homework.results.incorrect")}
              </span>
            </div>

            {feedback.errors.length > 0 && (
              <div className="bg-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-red-400 mb-3">
                  {t("homework.results.errors")}
                </h3>
                <div className="space-y-3">
                  {feedback.errors.map((err, i) => (
                    <div key={i} className="border-l-2 border-red-500 pl-3">
                      <p className="text-sm font-medium">
                        {t("homework.results.step")}: {err.step}
                      </p>
                      <p className="text-sm text-gray-400">{err.description}</p>
                      <p className="text-sm text-green-400">
                        {t("homework.results.correction")}: {err.correction}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {feedback.strengths.length > 0 && (
              <div className="bg-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-green-400 mb-2">
                  {t("homework.results.strengths")}
                </h3>
                <ul className="space-y-1">
                  {feedback.strengths.map((s, i) => (
                    <li key={i} className="text-sm text-gray-300">
                      • {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {feedback.suggestions.length > 0 && (
              <div className="bg-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-blue-400 mb-2">
                  {t("homework.results.suggestions")}
                </h3>
                <ul className="space-y-1">
                  {feedback.suggestions.map((s, i) => (
                    <li key={i} className="text-sm text-gray-300">
                      • {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : rawResponse ? (
          <div className="mt-8 bg-gray-800 rounded-xl p-4">
            <h2 className="text-lg font-semibold mb-3">{t("homework.results.title")}</h2>
            <MarkdownContent content={rawResponse} />
            {checking && (
              <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle mt-1" />
            )}
          </div>
        ) : null}

        {/* Embedded follow-up chat after feedback */}
        {(rawResponse || selectedHistory) && !checking && (
          <HomeworkChat
            homeworkContext={rawResponse || selectedHistory?.analysis_result || ""}
            courseId={courseId}
            language={i18n.language}
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
