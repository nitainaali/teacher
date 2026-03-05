import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getCourses } from "../api/courses";
import { uploadDocument } from "../api/documents";
import type { Course } from "../types";

const DOC_TYPES = ["lecture", "homework", "exam", "transcript", "reference"] as const;

export function DocumentUploadPage() {
  const { t } = useTranslation();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [docType, setDocType] = useState<string>("lecture");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getCourses().then((cs) => {
      setCourses(cs);
      if (cs.length > 0) setCourseId(cs[0].id);
    });
  }, []);

  const handleFile = (f: File) => setFile(f);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !courseId) return;
    setStatus("uploading");
    try {
      await uploadDocument(file, courseId, docType);
      setStatus("done");
      setFile(null);
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t("documents.title")}</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t("documents.selectCourse")}</label>
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">{t("documents.docType")}</label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          >
            {DOC_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`documents.types.${type}`)}
              </option>
            ))}
          </select>
        </div>

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
            accept=".pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          {file ? (
            <p className="text-blue-400 font-medium">{file.name}</p>
          ) : (
            <p className="text-gray-500 text-sm">{t("documents.dragDrop")}</p>
          )}
        </div>

        {status === "done" && (
          <p className="text-green-400 text-sm">{t("documents.uploadSuccess")}</p>
        )}
        {status === "error" && (
          <p className="text-red-400 text-sm">{t("common.error")}</p>
        )}

        <button
          type="submit"
          disabled={!file || !courseId || status === "uploading"}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {status === "uploading" ? t("common.loading") : t("common.upload")}
        </button>
      </form>
    </div>
  );
}
