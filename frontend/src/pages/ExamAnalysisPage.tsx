import { useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { uploadExam, streamExamAnalysis } from "../api/exams";
import { MarkdownContent } from "../components/MarkdownContent";

function FileDropZone({
  file,
  onFile,
  label,
  hint,
  emoji = "📝",
}: {
  file: File | null;
  onFile: (f: File) => void;
  label: string;
  hint: string;
  emoji?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

  return (
    <div>
      <p className="text-sm font-medium text-gray-300 mb-1">{label}</p>
      <p className="text-xs text-gray-500 mb-2">{hint}</p>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={[
          "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors select-none",
          dragging
            ? "border-blue-500 bg-blue-600/10"
            : "border-gray-600 hover:border-gray-500 hover:bg-gray-700/40",
        ].join(" ")}
      >
        <div className="text-2xl mb-1">{emoji}</div>
        {file ? (
          <p className="text-sm text-blue-400 font-medium">{file.name}</p>
        ) : (
          <p className="text-sm text-gray-400">{t("examAnalysis.dragDrop")}</p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        />
      </div>
    </div>
  );
}

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
  const [saved, setSaved] = useState(false);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!examFile) { setError(t("examAnalysis.noFile")); return; }
    if (!courseId) return;

    setAnalyzing(true);
    setResult("");
    setError(null);
    setSaved(false);

    try {
      // 1. Upload student exam
      const examUpload = await uploadExam(examFile, courseId, "student_submission");

      // 2. Optionally upload reference exam
      let refExamId: string | undefined;
      if (refFile) {
        const refUpload = await uploadExam(refFile, courseId, "reference");
        refExamId = refUpload.id;
      }

      // 3. Stream analysis
      let accumulated = "";
      for await (const chunk of streamExamAnalysis(examUpload.id, {
        guidance: guidance.trim() || undefined,
        studentExperience: experience.trim() || undefined,
        referenceExamId: refExamId,
        language: i18n.language,
      })) {
        accumulated += chunk;
        setResult(accumulated);
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <h2 className="text-xl font-bold text-white">{t("examAnalysis.title")}</h2>

      <form onSubmit={handleAnalyze} className="space-y-4">
        {/* Student exam upload */}
        <FileDropZone
          file={examFile}
          onFile={setExamFile}
          label={t("examAnalysis.uploadExam")}
          hint={t("examAnalysis.uploadHint")}
          emoji="📝"
        />

        {/* Reference exam upload */}
        <FileDropZone
          file={refFile}
          onFile={setRefFile}
          label={t("examAnalysis.uploadReference")}
          hint={t("examAnalysis.uploadReferenceHint")}
          emoji="📄"
        />

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
          <label className="block text-sm text-gray-400 mb-1">{t("examAnalysis.experience")}</label>
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

      {/* Streaming result */}
      {(result || analyzing) && (
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("examAnalysis.results")}</h3>
          <MarkdownContent content={result} />
          {analyzing && (
            <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle mt-1" />
          )}
          {saved && !analyzing && (
            <p className="text-green-400 text-xs mt-3">✓ {t("examAnalysis.savedToProfile")}</p>
          )}
        </div>
      )}
    </div>
  );
}
