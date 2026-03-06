import { useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function ExamAnalysisPage() {
  const { t } = useTranslation();
  const { courseId: _courseId } = useParams<{ courseId: string }>();
  const [file, setFile] = useState<File | null>(null);
  const [guidance, setGuidance] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (f: File) => { setFile(f); setResult(null); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setResult(t("examAnalysis.noFile")); return; }
    setAnalyzing(true);
    await new Promise((res) => setTimeout(res, 600));
    setResult(t("examAnalysis.comingSoon"));
    setAnalyzing(false);
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <h2 className="text-xl font-bold text-white">{t("examAnalysis.title")}</h2>

      <form onSubmit={handleAnalyze} className="space-y-4">
        <div>
          <p className="text-sm font-medium text-gray-300 mb-1">{t("examAnalysis.uploadExam")}</p>
          <p className="text-xs text-gray-500 mb-2">{t("examAnalysis.uploadHint")}</p>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={["border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors select-none",
              dragging ? "border-blue-500 bg-blue-600/10" : "border-gray-600 hover:border-gray-500 hover:bg-gray-700/40"
            ].join(" ")}
          >
            <div className="text-3xl mb-2">📝</div>
            {file ? (
              <p className="text-sm text-blue-400 font-medium">{file.name}</p>
            ) : (
              <p className="text-sm text-gray-400">{t("examAnalysis.dragDrop")}</p>
            )}
            <input ref={fileInputRef} type="file" accept=".pdf,image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
          </div>
        </div>

        <input type="text" value={guidance} onChange={(e) => setGuidance(e.target.value)}
          placeholder={t("examAnalysis.guidancePlaceholder")}
          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />

        <button type="submit" disabled={analyzing}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {analyzing ? t("examAnalysis.analyzing") : t("examAnalysis.analyze")}
        </button>
      </form>

      {result && (
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl select-none">🚧</span>
            <span className="text-sm font-semibold text-gray-300">{t("common.comingSoon")}</span>
          </div>
          <p className="text-gray-400 text-sm">{result}</p>
        </div>
      )}
    </div>
  );
}