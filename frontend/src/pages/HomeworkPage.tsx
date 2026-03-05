import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getCourses } from "../api/courses";
import type { Course, HomeworkFeedback } from "../types";

const API_BASE = import.meta.env.VITE_API_URL || "";

export function HomeworkPage() {
  const { t } = useTranslation();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [knowledgeMode, setKnowledgeMode] = useState<"general" | "course_only">("general");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [checking, setChecking] = useState(false);
  const [rawResponse, setRawResponse] = useState("");
  const [feedback, setFeedback] = useState<HomeworkFeedback | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getCourses().then((cs) => {
      setCourses(cs);
      if (cs.length > 0) setCourseId(cs[0].id);
    });
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setChecking(true);
    setRawResponse("");
    setFeedback(null);

    const form = new FormData();
    form.append("file", file);
    if (courseId) form.append("course_id", courseId);
    form.append("knowledge_mode", knowledgeMode);

    try {
      const response = await fetch(`${API_BASE}/api/homework/check`, {
        method: "POST",
        body: form,
      });

      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const chunk = line.slice(6);
            if (chunk !== "[DONE]") {
              full += chunk;
              setRawResponse(full);
            }
          }
        }
      }

      // Try to parse JSON feedback
      const match = full.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          setFeedback(JSON.parse(match[0]));
        } catch {
          // leave as raw
        }
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">{t("homework.title")}</h1>
      <p className="text-gray-400 text-sm mb-6">{t("homework.subtitle")}</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Knowledge mode toggle */}
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

        {/* Course selector */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t("homework.selectCourse")}</label>
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="">—</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* File upload */}
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            dragOver ? "border-blue-500 bg-blue-500/10" : "border-gray-700 hover:border-gray-500"
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
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }}
          />
          {file ? (
            <p className="text-blue-400 font-medium">{file.name}</p>
          ) : (
            <p className="text-gray-500 text-sm">{t("homework.dragDrop")}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={!file || checking}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {checking ? t("homework.checking") : t("homework.check")}
        </button>
      </form>

      {/* Results */}
      {feedback ? (
        <div className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold">{t("homework.results.title")}</h2>

          <div className="bg-gray-800 rounded-xl p-4 flex items-center gap-4">
            <span className={`text-2xl font-bold ${feedback.overall_correct ? "text-green-400" : "text-yellow-400"}`}>
              {feedback.score_estimate}
            </span>
            <span className={`text-sm ${feedback.overall_correct ? "text-green-400" : "text-yellow-400"}`}>
              {feedback.overall_correct ? t("homework.results.correct") : t("homework.results.incorrect")}
            </span>
          </div>

          {feedback.errors.length > 0 && (
            <div className="bg-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-red-400 mb-3">{t("homework.results.errors")}</h3>
              <div className="space-y-3">
                {feedback.errors.map((err, i) => (
                  <div key={i} className="border-l-2 border-red-500 pl-3">
                    <p className="text-sm font-medium">{t("homework.results.step")}: {err.step}</p>
                    <p className="text-sm text-gray-400">{err.description}</p>
                    <p className="text-sm text-green-400">{t("homework.results.correction")}: {err.correction}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {feedback.strengths.length > 0 && (
            <div className="bg-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-green-400 mb-2">{t("homework.results.strengths")}</h3>
              <ul className="space-y-1">
                {feedback.strengths.map((s, i) => (
                  <li key={i} className="text-sm text-gray-300">• {s}</li>
                ))}
              </ul>
            </div>
          )}

          {feedback.suggestions.length > 0 && (
            <div className="bg-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-blue-400 mb-2">{t("homework.results.suggestions")}</h3>
              <ul className="space-y-1">
                {feedback.suggestions.map((s, i) => (
                  <li key={i} className="text-sm text-gray-300">• {s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : rawResponse && (
        <div className="mt-8 bg-gray-800 rounded-xl p-4">
          <h2 className="text-lg font-semibold mb-3">{t("homework.results.title")}</h2>
          <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">{rawResponse}</pre>
        </div>
      )}
    </div>
  );
}
