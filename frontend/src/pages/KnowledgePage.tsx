import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getDocuments, uploadDocument, deleteDocument } from "../api/documents";
import { getCourse, updateActiveSharedCourses } from "../api/courses";
import { getSharedCourses } from "../api/sharedKnowledge";
import { Toast } from "../components/Toast";
import type { Document } from "../types";
import type { SharedCourse } from "../api/sharedKnowledge";

const DOC_TYPES = ["lecture", "summary", "exam", "transcript", "reference"] as const;
type DocType = typeof DOC_TYPES[number];

const TYPE_BADGE_COLORS: Record<DocType, string> = {
  lecture: "bg-blue-600/20 text-blue-400 border-blue-600/30",
  summary: "bg-green-600/20 text-green-400 border-green-600/30",
  exam: "bg-red-600/20 text-red-400 border-red-600/30",
  transcript: "bg-yellow-600/20 text-yellow-400 border-yellow-600/30",
  reference: "bg-gray-600/20 text-gray-400 border-gray-600/30",
};

const STATUS_BADGE_COLORS: Record<string, string> = {
  pending: "bg-gray-700 text-gray-400",
  processing: "bg-yellow-700/30 text-yellow-400",
  done: "bg-green-700/30 text-green-400",
  error: "bg-red-700/30 text-red-400",
};

type UploadStatus = "pending" | "uploading" | "done" | "error" | "duplicate";

interface FileEntry {
  file: File;
  status: UploadStatus;
  error?: string;
}

function isImage(filename: string) {
  return /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(filename);
}

export function KnowledgePage() {
  const { t } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const [docs, setDocs] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadAllDone, setUploadAllDone] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileEntry[]>([]);
  const [docType, setDocType] = useState<DocType>("lecture");
  const [dragging, setDragging] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shared courses
  const [sharedCourses, setSharedCourses] = useState<SharedCourse[]>([]);
  const [activeSharedIds, setActiveSharedIds] = useState<string[]>([]);
  const [sharedPanelOpen, setSharedPanelOpen] = useState(false);

  const fetchDocs = () => {
    if (!courseId) return;
    getDocuments(courseId, "knowledge").then(setDocs);
  };

  useEffect(() => { fetchDocs(); }, [courseId]);

  useEffect(() => {
    getSharedCourses().then(setSharedCourses).catch(() => setSharedCourses([]));
  }, []);

  useEffect(() => {
    if (!courseId) return;
    getCourse(courseId)
      .then((c) => setActiveSharedIds(c.active_shared_course_ids ?? []))
      .catch(() => setActiveSharedIds([]));
  }, [courseId]);

  const toggleSharedCourse = async (id: string) => {
    if (!courseId) return;
    const next = activeSharedIds.includes(id)
      ? activeSharedIds.filter((x) => x !== id)
      : [...activeSharedIds, id];
    setActiveSharedIds(next);
    try {
      await updateActiveSharedCourses(courseId, next);
    } catch {
      // revert on error
      setActiveSharedIds(activeSharedIds);
    }
  };

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setUploadAllDone(false);
    setSelectedFiles((prev) => {
      const names = new Set(prev.map((e) => e.file.name));
      const newOnes: FileEntry[] = Array.from(incoming)
        .filter((f) => !names.has(f.name))
        .map((f) => ({ file: f, status: "pending" }));
      return [...prev, ...newOnes];
    });
  };

  const removeFile = (name: string) =>
    setSelectedFiles((prev) => prev.filter((e) => e.file.name !== name));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const updateFileStatus = (name: string, status: UploadStatus, error?: string) =>
    setSelectedFiles((prev) =>
      prev.map((e) => e.file.name === name ? { ...e, status, error } : e)
    );

  const handleUpload = async () => {
    const pendingFiles = selectedFiles.filter((e) => e.status === "pending");
    if (pendingFiles.length === 0 || !courseId || uploading) return;
    setUploading(true);
    setUploadAllDone(false);

    for (const entry of pendingFiles) {
      updateFileStatus(entry.file.name, "uploading");
      try {
        await uploadDocument(entry.file, courseId, docType);
        updateFileStatus(entry.file.name, "done");
      } catch (err: any) {
        if (err?.response?.status === 409) {
          updateFileStatus(entry.file.name, "duplicate");
          const dupName = err?.response?.data?.detail?.name || entry.file.name;
          setToast(t("knowledge.duplicate", { name: dupName }));
        } else {
          updateFileStatus(entry.file.name, "error");
        }
      }
    }

    setUploading(false);
    setUploadAllDone(true);
    fetchDocs();
    setTimeout(() => {
      setSelectedFiles([]);
      setUploadAllDone(false);
    }, 3000);
  };

  const handleDelete = async (id: string) => {
    setDeleteError(null);
    try {
      await deleteDocument(id);
      fetchDocs();
    } catch {
      setDeleteError(t("knowledge.deleteError"));
    }
  };

  const pendingCount = selectedFiles.filter((e) => e.status === "pending").length;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-white">{t("knowledge.title")}</h2>

      {deleteError && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-sm text-red-400">
          {deleteError}
        </div>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      {/* Split layout: upload left, file list right */}
      <div className="flex gap-5 items-start">
        {/* Left panel — Upload */}
        <div className="w-72 shrink-0 bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-4">
          <h3 className="text-sm font-semibold text-gray-300">{t("knowledge.addFile")}</h3>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={[
              "border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors select-none",
              dragging ? "border-blue-500 bg-blue-600/10" : "border-gray-600 hover:border-gray-500 hover:bg-gray-700/30",
            ].join(" ")}
          >
            <div className="text-2xl mb-1">📁</div>
            <p className="text-xs text-gray-400">{t("knowledge.dragDrop")}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
          </div>

          {/* Selected files list */}
          {selectedFiles.length > 0 && (
            <div className="space-y-1.5">
              {selectedFiles.map((entry) => {
                const statusColors: Record<UploadStatus, string> = {
                  pending: "text-gray-300",
                  uploading: "text-blue-400 animate-pulse",
                  done: "text-green-400",
                  error: "text-red-400",
                  duplicate: "text-yellow-400",
                };
                const statusIcons: Record<UploadStatus, string> = {
                  pending: "○",
                  uploading: "↑",
                  done: "✓",
                  error: "✗",
                  duplicate: "⚠",
                };
                return (
                  <div
                    key={entry.file.name}
                    className="flex items-center justify-between bg-gray-700/50 rounded-lg px-2.5 py-1.5 gap-2"
                  >
                    <span className={`text-xs shrink-0 ${statusColors[entry.status]}`}>
                      {statusIcons[entry.status]}
                    </span>
                    <span className="text-xs text-gray-300 truncate flex-1">{entry.file.name}</span>
                    {entry.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => removeFile(entry.file.name)}
                        className="text-gray-500 hover:text-red-400 text-xs shrink-0"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Content category */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">
              {t("knowledge.contentCategory")}
            </label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocType)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            >
              {DOC_TYPES.map((type) => (
                <option key={type} value={type}>{t("knowledge.types." + type)}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleUpload}
            disabled={pendingCount === 0 || uploading || uploadAllDone}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {uploading
              ? t("knowledge.uploading")
              : uploadAllDone
              ? "✓ " + t("knowledge.uploadSuccess")
              : pendingCount > 0
              ? `${t("common.upload")} (${pendingCount})`
              : t("common.upload")}
          </button>

          {/* Shared knowledge sources */}
          {sharedCourses.length > 0 && (
            <div className="border-t border-gray-700 pt-3">
              <button
                onClick={() => setSharedPanelOpen((v) => !v)}
                className="w-full flex items-center justify-between text-xs font-semibold text-gray-400 hover:text-gray-200 transition-colors mb-1"
              >
                <span className="flex items-center gap-1.5">
                  <span>🔗</span>
                  <span>{t("sharedKnowledge.activeSources")}</span>
                  {activeSharedIds.length > 0 && (
                    <span className="bg-blue-600/30 text-blue-400 rounded-full px-1.5 py-0.5">
                      {activeSharedIds.length}
                    </span>
                  )}
                </span>
                <span>{sharedPanelOpen ? "▾" : "▸"}</span>
              </button>
              {sharedPanelOpen && (
                <div className="space-y-1.5">
                  <p className="text-xs text-gray-500">{t("sharedKnowledge.activeSourcesHint")}</p>
                  {sharedCourses.map((sc) => (
                    <label key={sc.id} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={activeSharedIds.includes(sc.id)}
                        onChange={() => toggleSharedCourse(sc.id)}
                        className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 accent-blue-500"
                      />
                      <span className="text-xs text-gray-300 group-hover:text-white transition-colors truncate">
                        {sc.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right panel — Uploaded file list */}
        <div className="flex-1 min-w-0">
          {docs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-3 select-none">📂</div>
              <p className="text-white font-semibold mb-1">{t("knowledge.empty")}</p>
              <p className="text-sm text-gray-500 max-w-sm">{t("knowledge.emptyHint")}</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {docs.map((doc) => {
                const type = doc.doc_type as DocType;
                const badgeColor = TYPE_BADGE_COLORS[type] ?? TYPE_BADGE_COLORS.reference;
                const statusColor = STATUS_BADGE_COLORS[doc.processing_status] ?? STATUS_BADGE_COLORS.pending;
                const imgFile = isImage(doc.original_name);
                return (
                  <div
                    key={doc.id}
                    className="bg-gray-800 rounded-xl px-3 py-2.5 border border-gray-700 flex items-center gap-3 hover:border-gray-600 transition-colors"
                  >
                    {/* Small icon */}
                    <span className="text-sm select-none shrink-0">{imgFile ? "🖼️" : "📄"}</span>

                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{doc.original_name}</p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className={"inline-flex items-center px-1.5 py-0.5 rounded-full text-xs border font-medium " + badgeColor}>
                          {t("knowledge.types." + type) || type}
                        </span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs border border-gray-600 bg-gray-700/50 text-gray-400">
                          {imgFile ? t("knowledge.formats.image") : t("knowledge.formats.pdf")}
                        </span>
                        <span className={"inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium " + statusColor}>
                          {t("knowledge.status." + doc.processing_status)}
                        </span>
                        {doc.processing_status === "done" &&
                         doc.metadata_?.scan_quality != null &&
                         doc.metadata_.scan_quality !== "good" && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border bg-orange-900/30 text-orange-400 border-orange-700/30"
                            title={t("knowledge.scanWarningTooltip")}
                          >
                            ⚠ {t("knowledge.scanWarning")}
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleDelete(doc.id)}
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
      </div>
    </div>
  );
}
