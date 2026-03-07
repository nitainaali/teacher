import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getCourses } from "../api/courses";
import { uploadDocument } from "../api/documents";
import type { Course } from "../types";

type FileStatus = "pending" | "uploading" | "done" | "error";
interface FileEntry { file: File; status: FileStatus; }

const DOC_TYPES = ["lecture", "homework", "exam", "transcript", "reference"] as const;

export function DocumentUploadPage() {
  const { t } = useTranslation();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [docType, setDocType] = useState<string>("lecture");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getCourses().then((cs) => {
      setCourses(cs);
      if (cs.length > 0) setCourseId(cs[0].id);
    });
  }, []);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setEntries((prev) => {
      const names = new Set(prev.map((e) => e.file.name));
      const newOnes = Array.from(incoming)
        .filter((f) => !names.has(f.name))
        .map((f): FileEntry => ({ file: f, status: "pending" }));
      return [...prev, ...newOnes];
    });
  };

  const removeEntry = (name: string) =>
    setEntries((prev) => prev.filter((e) => e.file.name !== name));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (entries.length === 0 || !courseId) return;
    setUploading(true);
    for (const entry of entries.filter((en) => en.status === "pending")) {
      setEntries((prev) =>
        prev.map((en) => en.file.name === entry.file.name ? { ...en, status: "uploading" } : en)
      );
      try {
        await uploadDocument(entry.file, courseId, docType);
        setEntries((prev) =>
          prev.map((en) => en.file.name === entry.file.name ? { ...en, status: "done" } : en)
        );
      } catch {
        setEntries((prev) =>
          prev.map((en) => en.file.name === entry.file.name ? { ...en, status: "error" } : en)
        );
      }
    }
    setUploading(false);
  };

  const statusIcon = (s: FileStatus) => {
    if (s === "pending") return <span className="text-gray-500 text-xs">⏳</span>;
    if (s === "uploading") return <span className="text-blue-400 text-xs animate-pulse">↑</span>;
    if (s === "done") return <span className="text-green-400 text-xs">✓</span>;
    return <span className="text-red-400 text-xs">✗</span>;
  };

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t("knowledge.title")}</h1>

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

        {/* Drop zone — multi-file */}
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
            accept=".pdf,image/*"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          <p className="text-gray-500 text-sm">{t("knowledge.dragDrop")}</p>
        </div>

        {/* File list with status indicators */}
        {entries.length > 0 && (
          <div className="space-y-1">
            {entries.map((en) => (
              <div key={en.file.name} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  {statusIcon(en.status)}
                  <span className="text-sm text-gray-200 truncate">{en.file.name}</span>
                </div>
                {en.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => removeEntry(en.file.name)}
                    className="text-gray-500 hover:text-red-400 text-xs ml-2 shrink-0"
                  >✕</button>
                )}
              </div>
            ))}
          </div>
        )}

        <button
          type="submit"
          disabled={entries.length === 0 || !courseId || uploading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {uploading ? t("common.loading") : t("common.upload")}
        </button>
      </form>
    </div>
  );
}
