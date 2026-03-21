import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  getSharedCourses,
  createSharedCourse,
  deleteSharedCourse,
  getSharedDocuments,
  uploadToSharedCourse,
  deleteSharedDocument,
} from "../api/sharedKnowledge";
import type { SharedCourse, SharedDocument } from "../api/sharedKnowledge";

const STATUS_BADGE_COLORS: Record<string, string> = {
  pending: "bg-gray-700 text-gray-400",
  processing: "bg-yellow-700/30 text-yellow-400",
  done: "bg-green-700/30 text-green-400",
  error: "bg-red-700/30 text-red-400",
};

export function SharedKnowledgePage() {
  const { t } = useTranslation();
  const [courses, setCourses] = useState<SharedCourse[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<SharedDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // New course form
  const [showNewCourse, setShowNewCourse] = useState(false);
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseDesc, setNewCourseDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Upload
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);

  const fetchCourses = async () => {
    try {
      const data = await getSharedCourses();
      setCourses(data);
    } catch {
      setError(t("sharedKnowledge.loadError"));
    }
  };

  const fetchDocs = async (courseId: string) => {
    setLoadingDocs(true);
    try {
      const data = await getSharedDocuments(courseId);
      setDocuments(data);
    } catch {
      setDocuments([]);
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  useEffect(() => {
    if (selectedCourseId) {
      fetchDocs(selectedCourseId);
    } else {
      setDocuments([]);
    }
  }, [selectedCourseId]);

  const handleCreateCourse = async () => {
    if (!newCourseName.trim()) return;
    setCreating(true);
    try {
      const course = await createSharedCourse({
        name: newCourseName.trim(),
        description: newCourseDesc.trim() || undefined,
      });
      setCourses((prev) => [...prev, course]);
      setSelectedCourseId(course.id);
      setShowNewCourse(false);
      setNewCourseName("");
      setNewCourseDesc("");
    } catch {
      setError(t("sharedKnowledge.createError"));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteCourse = async (id: string) => {
    try {
      await deleteSharedCourse(id);
      setCourses((prev) => prev.filter((c) => c.id !== id));
      if (selectedCourseId === id) setSelectedCourseId(null);
    } catch {
      setError(t("sharedKnowledge.deleteError"));
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || !selectedCourseId || uploading) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadToSharedCourse(selectedCourseId, file);
      }
      await fetchDocs(selectedCourseId);
    } catch {
      setError(t("sharedKnowledge.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!selectedCourseId) return;
    try {
      await deleteSharedDocument(selectedCourseId, docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch {
      setError(t("sharedKnowledge.deleteError"));
    }
  };

  const selectedCourse = courses.find((c) => c.id === selectedCourseId);

  return (
    <div className="flex gap-4 h-full">
      {/* Left: course list */}
      <div className="w-56 shrink-0 bg-gray-800 rounded-xl border border-gray-700 overflow-y-auto max-h-[calc(100vh-8rem)]">
        <div className="px-3 pt-3 pb-2 border-b border-gray-700 flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            {t("sharedKnowledge.libraries")}
          </p>
          <button
            onClick={() => setShowNewCourse(true)}
            className="text-gray-400 hover:text-white text-lg leading-none"
            title={t("sharedKnowledge.newLibrary")}
          >
            +
          </button>
        </div>

        <div className="p-1.5 space-y-0.5">
          {courses.length === 0 && (
            <p className="text-xs text-gray-500 px-2 py-2">{t("sharedKnowledge.noLibraries")}</p>
          )}
          {courses.map((course) => (
            <div key={course.id} className="group flex items-center gap-0.5">
              <button
                onClick={() => setSelectedCourseId(course.id)}
                className={[
                  "flex-1 min-w-0 text-left px-2.5 py-2 rounded-lg text-sm transition-colors",
                  selectedCourseId === course.id
                    ? "bg-blue-600/20 text-blue-300 border border-blue-700/50"
                    : "text-gray-300 hover:bg-gray-700",
                ].join(" ")}
              >
                <span className="truncate block">{course.name}</span>
                {course.description && (
                  <span className="text-xs text-gray-500 truncate block">{course.description}</span>
                )}
              </button>
              <button
                onClick={() => handleDeleteCourse(course.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-red-400 p-1 rounded shrink-0 text-xs"
                title={t("sharedKnowledge.deleteLibrary")}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Right: documents */}
      <div className="flex-1 min-w-0 space-y-4">
        <h2 className="text-xl font-bold text-white">{t("sharedKnowledge.title")}</h2>

        {error && (
          <div className="bg-red-900/20 border border-red-700/50 rounded-xl px-4 py-3 text-sm text-red-300">
            ⚠ {error}
            <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-200">✕</button>
          </div>
        )}

        {/* New course form */}
        {showNewCourse && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-3">
            <p className="text-sm font-semibold text-white">{t("sharedKnowledge.newLibrary")}</p>
            <input
              type="text"
              value={newCourseName}
              onChange={(e) => setNewCourseName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateCourse(); if (e.key === "Escape") setShowNewCourse(false); }}
              placeholder={t("sharedKnowledge.libraryName")}
              autoFocus
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <input
              type="text"
              value={newCourseDesc}
              onChange={(e) => setNewCourseDesc(e.target.value)}
              placeholder={t("sharedKnowledge.libraryDescription")}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreateCourse}
                disabled={!newCourseName.trim() || creating}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
              >
                {creating ? t("common.loading") : t("common.create")}
              </button>
              <button
                onClick={() => { setShowNewCourse(false); setNewCourseName(""); setNewCourseDesc(""); }}
                className="text-gray-400 hover:text-white px-4 py-1.5 rounded-lg text-sm transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}

        {!selectedCourse && !showNewCourse && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-5xl mb-4 select-none">📚</div>
            <p className="text-gray-400 text-sm">{t("sharedKnowledge.selectLibrary")}</p>
          </div>
        )}

        {selectedCourse && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">{selectedCourse.name}</h3>
                {selectedCourse.description && (
                  <p className="text-sm text-gray-400">{selectedCourse.description}</p>
                )}
              </div>
              {/* Upload button */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleUpload(e.target.files)}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  {uploading ? t("knowledge.uploading") : t("sharedKnowledge.uploadDoc")}
                </button>
              </div>
            </div>

            {loadingDocs ? (
              <p className="text-sm text-gray-500 animate-pulse">{t("common.loading")}</p>
            ) : documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="text-4xl mb-3 select-none">📂</div>
                <p className="text-gray-400 text-sm">{t("sharedKnowledge.noDocs")}</p>
              </div>
            ) : (
              <div className="grid gap-2">
                {documents.map((doc) => {
                  const statusColor = STATUS_BADGE_COLORS[doc.processing_status] ?? STATUS_BADGE_COLORS.pending;
                  return (
                    <div
                      key={doc.id}
                      className="bg-gray-800 rounded-xl px-3 py-2.5 border border-gray-700 flex items-center gap-3"
                    >
                      <span className="text-sm select-none shrink-0">📄</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{doc.original_name}</p>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium mt-1 ${statusColor}`}>
                          {t("knowledge.status." + doc.processing_status)}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDeleteDoc(doc.id)}
                        className="text-gray-500 hover:text-red-400 transition-colors p-1 rounded text-lg leading-none flex-shrink-0"
                        title={t("common.delete")}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
