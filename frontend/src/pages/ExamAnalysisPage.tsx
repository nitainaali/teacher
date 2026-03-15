import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { uploadExam, streamExamAnalysis, getExamAnalyses, deleteExamAnalysis } from "../api/exams";
import type { ExamAnalysisRecord } from "../api/exams";
import { MarkdownContent } from "../components/MarkdownContent";
import { FileDropZone } from "../components/FileDropZone";

const MAX_FILE_SIZE = 40 * 1024 * 1024; // 40 MB warning threshold

export function ExamAnalysisPage() {
  const { t, i18n } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();

  const [examFile, setExamFile] = useState<File | null>(null);
  const [refFile, setRefFile] = useState<File | null>(null);
  const [guidance, setGuidance] = useState("");
  const [experience, setExperience] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // History sidebar
  const [historyItems, setHistoryItems] = useState<ExamAnalysisRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<ExamAnalysisRecord | null>(null);

  const fetchHistory = async () => {
    if (!courseId) return;
    setLoadingHistory(true);
    try {
      const items = await getExamAnalyses(courseId);
      setHistoryItems(items);
    } catch {
      // silently ignore
    } finally {
      setLoadingHistory(false);
    }
  };

  // On mount: fetch history + check for pending analysis from previous session
  useEffect(() => {
    fetchHistory();

    const key = courseId ? `exam_pending_${courseId}` : null;
    if (!key) return;

    const ts = localStorage.getItem(key);
    if (!ts) return;
    if (Date.now() - parseInt(ts) > 5 * 60 * 1000) {
      localStorage.removeItem(key);
      return;
    }

    // Resume showing spinner + poll every 2s for new item
    setAnalyzing(true);
    const startTs = parseInt(ts);

    const interval = setInterval(async () => {
      try {
        const items = await getExamAnalyses(courseId!);
        const found = items.find(
          (i) => new Date(i.created_at).getTime() > startTs
        );
        if (found) {
          clearInterval(interval);
          setHistoryItems(items);
          setSelectedHistory(found);
          setAnalyzing(false);
          localStorage.removeItem(key);
        }
      } catch {
        // silently ignore
      }
    }, 2000);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      setAnalyzing(false);
      localStorage.removeItem(key);
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [courseId]);

  const handleExamFile = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      setFileError(t("common.fileTooLarge"));
    } else {
      setFileError(null);
    }
    setExamFile(file);
  };

  const handleRefFile = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      setFileError(t("common.fileTooLarge"));
    } else {
      setFileError(null);
    }
    setRefFile(file);
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!examFile) { setError(t("examAnalysis.noFile")); return; }
    if (!courseId) return;

    const key = `exam_pending_${courseId}`;
    localStorage.setItem(key, Date.now().toString());

    setAnalyzing(true);
    setResult("");
    setError(null);
    setSaved(false);
    setSelectedHistory(null);

    try {
      // 1. Upload student exam
      const examUpload = await uploadExam(examFile, courseId, "student_submission");

      // 2. Optionally upload reference exam
      let refExamId: string | undefined;
      if (refFile) {
        const refUpload = await uploadExam(refFile, courseId, "reference");
        refExamId = refUpload.id;
      }

      // 3. Stream silently — collect all chunks, set result only when done
      let accumulated = "";
      for await (const chunk of streamExamAnalysis(examUpload.id, {
        guidance: guidance.trim() || undefined,
        studentExperience: experience.trim() || undefined,
        referenceExamId: refExamId,
        language: i18n.language,
      })) {
        accumulated += chunk;
      }
      setResult(accumulated);
      setSaved(true);

      // Wait for background save, then refresh history and auto-select newest
      setTimeout(async () => {
        try {
          const items = await getExamAnalyses(courseId);
          setHistoryItems(items);
          if (items.length > 0) setSelectedHistory(items[0]);
        } catch {}
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setAnalyzing(false);
      localStorage.removeItem(key);
    }
  };

  const loadHistoryItem = (record: ExamAnalysisRecord) => {
    setSelectedHistory(record);
    setResult("");
    setError(null);
    setSaved(false);
  };

  const handleDeleteHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteExamAnalysis(id);
      if (selectedHistory?.id === id) setSelectedHistory(null);
      fetchHistory();
    } catch {
      // silently ignore
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const imageItem = Array.from(e.clipboardData.items).find((item) =>
      item.type.startsWith("image/")
    );
    if (!imageItem) return;
    e.preventDefault();
    const blob = imageItem.getAsFile();
    if (!blob) return;
    const file = new File([blob], `pasted-${Date.now()}.png`, { type: blob.type });
    if (!examFile) handleExamFile(file);
    else if (!refFile) handleRefFile(file);
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
    <div className="flex gap-5 items-start" onPaste={handlePaste}>
      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 max-w-2xl space-y-5">
        <h2 className="text-xl font-bold text-white">{t("examAnalysis.title")}</h2>

        <form onSubmit={handleAnalyze} className="space-y-4">
          {/* Student exam upload */}
          <div>
            <FileDropZone
              file={examFile}
              onFile={handleExamFile}
              label={t("examAnalysis.uploadExam")}
              hint={t("examAnalysis.uploadHint")}
              emoji="📝"
            />
            <p className="text-xs text-gray-600 mt-1">{t("common.maxFileSize")}</p>
          </div>

          {/* Reference exam upload */}
          <div>
            <FileDropZone
              file={refFile}
              onFile={handleRefFile}
              label={t("examAnalysis.uploadReference")}
              hint={t("examAnalysis.uploadReferenceHint")}
              emoji="📄"
            />
            <p className="text-xs text-gray-600 mt-1">{t("common.maxFileSize")}</p>
          </div>

          {/* File size warning */}
          {fileError && <p className="text-yellow-400 text-sm">{fileError}</p>}

          {/* Guidance */}
          <input
            type="text"
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder={t("examAnalysis.guidancePlaceholder")}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />

          {/* Student experience */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              {t("examAnalysis.experience")}
            </label>
            <textarea
              rows={3}
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              placeholder={t("examAnalysis.experiencePlaceholder")}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={analyzing || !examFile}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {analyzing ? t("examAnalysis.analyzing") : t("examAnalysis.analyze")}
          </button>
        </form>

        {/* ── Analyzing spinner ─────────────────────────────────────────────── */}
        {analyzing && (
          <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
              <p className="text-sm text-gray-400">{t("examAnalysis.analyzing")}</p>
            </div>
          </div>
        )}

        {/* ── Result area ─────────────────────────────────────────────────────── */}
        {selectedHistory ? (
          <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-300">
                {t("examAnalysis.results")}
              </h3>
              <div className="flex items-center gap-3">
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
            {selectedHistory.student_exam_name && (
              <p className="text-xs text-gray-400 mb-3">
                📝 {selectedHistory.student_exam_name}
                {selectedHistory.reference_exam_name && (
                  <span> vs 📄 {selectedHistory.reference_exam_name}</span>
                )}
              </p>
            )}
            <MarkdownContent content={selectedHistory.analysis_result} />
          </div>
        ) : result ? (
          <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">
              {t("examAnalysis.results")}
            </h3>
            <MarkdownContent content={result} />
            {saved && (
              <p className="text-green-400 text-xs mt-3">
                ✓ {t("examAnalysis.savedToProfile")}
              </p>
            )}
          </div>
        ) : null}
      </div>

      {/* ── History sidebar ────────────────────────────────────────────────────── */}
      <div className="w-60 shrink-0 bg-gray-800 rounded-xl border border-gray-700 p-3">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">
          {t("examAnalysis.analysisHistory")}
        </h3>
        {loadingHistory ? (
          <p className="text-xs text-gray-500">{t("common.loading")}</p>
        ) : historyItems.length === 0 ? (
          <p className="text-xs text-gray-500">{t("examAnalysis.noHistory")}</p>
        ) : (
          <div className="space-y-2">
            {historyItems.map((record) => (
              <div
                key={record.id}
                onClick={() => loadHistoryItem(record)}
                className={`group relative w-full text-left rounded-lg px-3 py-2.5 transition-colors border cursor-pointer ${
                  selectedHistory?.id === record.id
                    ? "bg-blue-600/20 border-blue-600/50"
                    : "bg-gray-700/50 border-transparent hover:bg-gray-700 hover:border-gray-600"
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <p className="text-xs text-gray-200 truncate font-medium flex-1">
                    📝 {record.student_exam_name || t("examAnalysis.unknownExam")}
                  </p>
                  <button
                    onClick={(e) => handleDeleteHistory(record.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs transition-opacity shrink-0 ml-1"
                    title={t("common.delete")}
                  >
                    ×
                  </button>
                </div>
                {record.reference_exam_name && (
                  <p className="text-xs text-gray-400 truncate">
                    vs {record.reference_exam_name}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(record.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
