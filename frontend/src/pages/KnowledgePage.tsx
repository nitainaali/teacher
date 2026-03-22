import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getDocuments, uploadDocument, deleteDocument, importFromShared, updateDocument, retryDocument } from "../api/documents";
import {
  getSharedCourses,
  getSharedDocuments,
  uploadToSharedCourse,
  createSharedCourse,
  deleteSharedCourse,
  copyDocumentToSharedCourse,
  updateSharedDocument,
  retrySharedDocument,
  deleteSharedDocument,
} from "../api/sharedKnowledge";
import { Toast } from "../components/Toast";
import { useUser } from "../context/UserContext";
import type { Document } from "../types";
import type { SharedCourse, SharedDocument } from "../api/sharedKnowledge";

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

interface SharedCourseWithDocs extends SharedCourse {
  docs?: SharedDocument[];
  docsLoaded?: boolean;
  docsOpen?: boolean;
}

export function KnowledgePage() {
  const { t } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const { currentUser } = useUser();
  const isAdmin = currentUser?.is_admin ?? false;

  const [docs, setDocs] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadAllDone, setUploadAllDone] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileEntry[]>([]);
  const [docType, setDocType] = useState<DocType>("lecture");
  const [dragging, setDragging] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Shared courses state
  const [sharedCourses, setSharedCourses] = useState<SharedCourseWithDocs[]>([]);
  const [sharedPanelOpen, setSharedPanelOpen] = useState(false);

  // "Also share new uploads" state
  const [shareNewFiles, setShareNewFiles] = useState(false);
  const [shareTarget, setShareTarget] = useState<string>("");

  // Copy existing doc to shared library
  const [copyingDocId, setCopyingDocId] = useState<string | null>(null);
  const [copyTargets, setCopyTargets] = useState<Record<string, string>>({});

  // Admin: create new shared library
  const [showCreateLib, setShowCreateLib] = useState(false);
  const [newLibName, setNewLibName] = useState("");
  const [newLibDesc, setNewLibDesc] = useState("");
  const [creatingLib, setCreatingLib] = useState(false);

  // Import shared doc + per-doc actions
  const [deletingSharedDocId, setDeletingSharedDocId] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importingAllId, setImportingAllId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // Shared doc edit: docId → {name, docType}
  const [editingDoc, setEditingDoc] = useState<Record<string, {name: string; docType: string} | null>>({});
  // Personal doc edit: docId → {name, docType}
  const [editingPersonal, setEditingPersonal] = useState<Record<string, {name: string; docType: string} | null>>({});
  const [retryingPersonalId, setRetryingPersonalId] = useState<string | null>(null);

  // File input for shared library uploads
  const sharedFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingToSharedId, setUploadingToSharedId] = useState<string | null>(null);

  const fetchDocs = () => {
    if (!courseId) return;
    getDocuments(courseId, "knowledge").then(setDocs);
  };

  const fetchSharedCourses = () => {
    getSharedCourses()
      .then((courses) => setSharedCourses(courses.map((c) => ({ ...c }))))
      .catch(() => setSharedCourses([]));
  };

  useEffect(() => { fetchDocs(); }, [courseId]);
  useEffect(() => { fetchSharedCourses(); }, []);

  const toggleDocsOpen = async (scId: string) => {
    const sc = sharedCourses.find((s) => s.id === scId);
    const willOpen = !sc?.docsOpen;
    setSharedCourses((prev) =>
      prev.map((s) => s.id === scId ? { ...s, docsOpen: willOpen } : s)
    );
    if (willOpen && !sc?.docsLoaded) {
      try {
        const loaded = await getSharedDocuments(scId);
        setSharedCourses((prev) =>
          prev.map((s) => s.id === scId ? { ...s, docs: loaded, docsLoaded: true } : s)
        );
      } catch { /* silently fail */ }
    }
  };

  const refreshSharedDocs = async (scId: string) => {
    try {
      const loaded = await getSharedDocuments(scId);
      setSharedCourses((prev) =>
        prev.map((s) => s.id === scId ? { ...s, docs: loaded, docsLoaded: true } : s)
      );
    } catch { /* silently fail */ }
  };

  const handleSharedUpload = async (scId: string, files: FileList | null) => {
    if (!files) return;
    setUploadingToSharedId(scId);
    for (const file of Array.from(files)) {
      try {
        await uploadToSharedCourse(scId, file);
      } catch { /* silently fail per-file */ }
    }
    await refreshSharedDocs(scId);
    setUploadingToSharedId(null);
  };

  const handleCreateLib = async () => {
    if (!newLibName.trim()) return;
    setCreatingLib(true);
    try {
      const created = await createSharedCourse({
        name: newLibName.trim(),
        description: newLibDesc.trim() || undefined,
      });
      setSharedCourses((prev) => [...prev, { ...created }]);
      setShowCreateLib(false);
      setNewLibName("");
      setNewLibDesc("");
    } catch { /* silently fail */ }
    finally { setCreatingLib(false); }
  };

  const handleDeleteLib = async (scId: string) => {
    try {
      await deleteSharedCourse(scId);
      setSharedCourses((prev) => prev.filter((s) => s.id !== scId));
    } catch { /* silently fail */ }
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
        // Also share to shared library if requested
        if (shareNewFiles && shareTarget) {
          try {
            await uploadToSharedCourse(shareTarget, entry.file);
            setSharedCourses((prev) =>
              prev.map((s) => s.id === shareTarget ? { ...s, docsLoaded: false } : s)
            );
          } catch { /* ignore sharing failure */ }
        }
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

  const handleCopyToShared = async (docId: string) => {
    const targetId = copyTargets[docId];
    if (!targetId) return;
    setCopyingDocId(docId);
    try {
      await copyDocumentToSharedCourse(targetId, docId);
      setToast(t("sharedKnowledge.copiedSuccess"));
      setSharedCourses((prev) =>
        prev.map((s) => s.id === targetId ? { ...s, docsLoaded: false } : s)
      );
      setCopyTargets((prev) => { const n = { ...prev }; delete n[docId]; return n; });
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setToast(t("knowledge.duplicate", { name: docs.find((d) => d.id === docId)?.original_name || "" }));
      } else {
        setToast(t("sharedKnowledge.copyError"));
      }
    } finally {
      setCopyingDocId(null);
    }
  };

  const handleImportFromShared = async (sharedDocId: string, sharedCourseId: string) => {
    if (!courseId) return;
    setImportingId(sharedDocId);
    try {
      await importFromShared(sharedDocId, courseId);
      setToast(t("sharedKnowledge.importedSuccess"));
      fetchDocs();
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setToast(t("knowledge.duplicate", { name: "" }));
      } else {
        setToast(t("sharedKnowledge.importError"));
      }
    } finally {
      setImportingId(null);
    }
  };

  const handleRetrySharedDoc = async (sharedCourseId: string, docId: string) => {
    setRetryingId(docId);
    try {
      const updated = await retrySharedDocument(sharedCourseId, docId);
      setSharedCourses((prev) =>
        prev.map((sc) =>
          sc.id === sharedCourseId
            ? { ...sc, docs: (sc.docs ?? []).map((d) => (d.id === docId ? updated : d)) }
            : sc
        )
      );
    } catch { /* silently fail */ }
    finally { setRetryingId(null); }
  };

  const handleSaveEditDoc = async (sharedCourseId: string, docId: string) => {
    const edit = editingDoc[docId];
    if (!edit) return;
    try {
      const updated = await updateSharedDocument(sharedCourseId, docId, {
        original_name: edit.name,
        doc_type: edit.docType,
      });
      setSharedCourses((prev) =>
        prev.map((sc) =>
          sc.id === sharedCourseId
            ? { ...sc, docs: (sc.docs ?? []).map((d) => (d.id === docId ? updated : d)) }
            : sc
        )
      );
      setEditingDoc((prev) => { const n = { ...prev }; delete n[docId]; return n; });
    } catch { /* silently fail */ }
  };

  const handleDeleteSharedDoc = async (sharedCourseId: string, docId: string) => {
    setDeletingSharedDocId(docId);
    try {
      await deleteSharedDocument(sharedCourseId, docId);
      setSharedCourses((prev) =>
        prev.map((sc) =>
          sc.id === sharedCourseId
            ? { ...sc, docs: (sc.docs ?? []).filter((d) => d.id !== docId) }
            : sc
        )
      );
    } catch { /* silently fail */ }
    finally { setDeletingSharedDocId(null); }
  };

  const handleImportAllFromShared = async (sc: SharedCourseWithDocs) => {
    if (!courseId) return;
    setImportingAllId(sc.id);
    let imported = 0;
    for (const d of sc.docs ?? []) {
      try {
        await importFromShared(d.id, courseId);
        imported++;
      } catch { /* skip duplicates/errors */ }
    }
    if (imported > 0) {
      fetchDocs();
      setToast(t("sharedKnowledge.importedAllSuccess", { count: imported }));
    } else {
      setToast(t("sharedKnowledge.importedAllDuplicate"));
    }
    setImportingAllId(null);
  };

  const handleSavePersonalDoc = async (docId: string) => {
    const edit = editingPersonal[docId];
    if (!edit) return;
    try {
      const updated = await updateDocument(docId, { original_name: edit.name, doc_type: edit.docType });
      setDocs((prev) => prev.map((d) => d.id === docId ? updated : d));
      setEditingPersonal((prev) => { const n = { ...prev }; delete n[docId]; return n; });
    } catch { /* silently fail */ }
  };

  const handleRetryPersonalDoc = async (docId: string) => {
    setRetryingPersonalId(docId);
    try {
      const updated = await retryDocument(docId);
      setDocs((prev) => prev.map((d) => d.id === docId ? updated : d));
    } catch { /* silently fail */ }
    finally { setRetryingPersonalId(null); }
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

      <div className="flex gap-4 items-start">
        {/* ── Right panel (upload + shared library) — flex-1 so it fills remaining space ── */}
        <div className="flex-1 min-w-0 bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-4">
          <h3 className="text-sm font-semibold text-gray-300">{t("knowledge.addFile")}</h3>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={[
              "border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors select-none",
              dragging
                ? "border-blue-500 bg-blue-600/10"
                : "border-gray-600 hover:border-gray-500 hover:bg-gray-700/30",
            ].join(" ")}
          >
            <div className="text-4xl mb-2">📁</div>
            <p className="text-sm text-gray-400">{t("knowledge.dragDrop")}</p>
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
                  pending: "○", uploading: "↑", done: "✓", error: "✗", duplicate: "⚠",
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
                      >×</button>
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

          {/* "Also share to library" — shown only when files selected + shared courses exist */}
          {selectedFiles.length > 0 && sharedCourses.length > 0 && (
            <div className="space-y-1.5 bg-gray-700/30 rounded-lg p-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shareNewFiles}
                  onChange={(e) => setShareNewFiles(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-blue-500"
                />
                <span className="text-xs text-gray-300">{t("sharedKnowledge.alsoShareTo")}</span>
              </label>
              {shareNewFiles && (
                <select
                  value={shareTarget}
                  onChange={(e) => setShareTarget(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-blue-500"
                >
                  <option value="">{t("sharedKnowledge.selectLibrary")}</option>
                  {sharedCourses.map((sc) => (
                    <option key={sc.id} value={sc.id}>{sc.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          <button
            onClick={handleUpload}
            disabled={pendingCount === 0 || uploading || uploadAllDone}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg text-base font-semibold transition-colors"
          >
            {uploading
              ? t("knowledge.uploading")
              : uploadAllDone
              ? "✓ " + t("knowledge.uploadSuccess")
              : pendingCount > 0
              ? `${t("common.upload")} (${pendingCount})`
              : t("common.upload")}
          </button>

          {/* ── Shared Libraries panel ── */}
          <div className="border-t border-gray-700 pt-3">
            <button
              onClick={() => setSharedPanelOpen((v) => !v)}
              className="w-full flex items-center justify-between text-xs font-semibold text-gray-400 hover:text-gray-200 transition-colors mb-1"
            >
              <span className="flex items-center gap-1.5">
                <span>🔗</span>
                <span>{t("sharedKnowledge.sharedLibraries")}</span>
                {sharedCourses.length > 0 && (
                  <span className="bg-blue-600/30 text-blue-400 rounded-full px-1.5 py-0.5 text-[10px]">
                    {sharedCourses.length}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1">
                {isAdmin && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setSharedPanelOpen(true);
                      setShowCreateLib((v) => !v);
                    }}
                    className="w-4 h-4 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-gray-600 transition-colors leading-none"
                    title={t("sharedKnowledge.newLib")}
                  >+</span>
                )}
                {sharedPanelOpen ? "▾" : "▸"}
              </span>
            </button>

            {sharedPanelOpen && (
              <div className="space-y-2">
                {/* Admin: create library inline form */}
                {isAdmin && showCreateLib && (
                  <div className="bg-gray-700/50 rounded-lg p-2 space-y-1.5">
                    <input
                      autoFocus
                      type="text"
                      value={newLibName}
                      onChange={(e) => setNewLibName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateLib();
                        if (e.key === "Escape") { setShowCreateLib(false); setNewLibName(""); setNewLibDesc(""); }
                      }}
                      placeholder={t("sharedKnowledge.libraryName")}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500 placeholder-gray-500"
                    />
                    <input
                      type="text"
                      value={newLibDesc}
                      onChange={(e) => setNewLibDesc(e.target.value)}
                      placeholder={t("sharedKnowledge.libraryDescription")}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500 placeholder-gray-500"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={handleCreateLib}
                        disabled={!newLibName.trim() || creatingLib}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-2 py-1 text-xs font-medium"
                      >
                        {creatingLib ? "…" : t("common.create")}
                      </button>
                      <button
                        onClick={() => { setShowCreateLib(false); setNewLibName(""); setNewLibDesc(""); }}
                        className="text-gray-400 hover:text-white px-2 py-1 text-xs"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                )}

                {sharedCourses.length === 0 && (
                  <p className="text-xs text-gray-500">{t("sharedKnowledge.noLibraries")}</p>
                )}

                {/* Hidden file input for per-library uploads */}
                <input
                  ref={sharedFileInputRef}
                  type="file"
                  accept=".pdf,image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (uploadingToSharedId) handleSharedUpload(uploadingToSharedId, e.target.files);
                    e.target.value = "";
                  }}
                />

                {sharedCourses.map((sc) => (
                  <div key={sc.id} className="bg-gray-700/40 rounded-lg overflow-hidden">
                    {/* Course header row */}
                    <div className="flex items-center gap-1 px-2 py-1.5">
                      <button
                        onClick={() => toggleDocsOpen(sc.id)}
                        className="flex-1 text-left text-sm text-gray-300 hover:text-white transition-colors flex items-center gap-1 min-w-0"
                      >
                        <span className="truncate font-medium">{sc.name}</span>
                        {sc.docs != null && (
                          <span className="text-xs text-gray-500 shrink-0">({sc.docs.length})</span>
                        )}
                        <span className="text-gray-600 shrink-0">{sc.docsOpen ? "▾" : "▸"}</span>
                      </button>
                      {/* Import all docs from this library */}
                      {sc.docsLoaded && (sc.docs?.length ?? 0) > 0 && (
                        <button
                          onClick={() => handleImportAllFromShared(sc)}
                          disabled={importingAllId === sc.id}
                          title={t("sharedKnowledge.importAll")}
                          className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-600 text-gray-400 hover:text-green-400 transition-colors shrink-0 disabled:opacity-50 text-sm"
                        >
                          {importingAllId === sc.id ? "…" : "⤓"}
                        </button>
                      )}
                      {/* Upload to this library */}
                      <button
                        onClick={() => {
                          setUploadingToSharedId(sc.id);
                          sharedFileInputRef.current?.click();
                        }}
                        disabled={uploadingToSharedId === sc.id}
                        title={t("sharedKnowledge.uploadDoc")}
                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-600 text-gray-400 hover:text-blue-400 transition-colors shrink-0 disabled:opacity-50 text-sm"
                      >
                        {uploadingToSharedId === sc.id ? "…" : "↑"}
                      </button>
                      {/* Admin: delete library */}
                      {isAdmin && (
                        <button
                          onClick={() => handleDeleteLib(sc.id)}
                          title={t("sharedKnowledge.deleteLibrary")}
                          className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-600 text-gray-500 hover:text-red-400 transition-colors shrink-0 text-sm"
                        >×</button>
                      )}
                    </div>

                    {/* Expanded docs list */}
                    {sc.docsOpen && (
                      <div className="border-t border-gray-600/50 px-2 py-1.5 space-y-1">
                        {!sc.docsLoaded ? (
                          <p className="text-xs text-gray-500 animate-pulse">{t("common.loading")}</p>
                        ) : sc.docs?.length === 0 ? (
                          <p className="text-xs text-gray-500">{t("sharedKnowledge.noDocs")}</p>
                        ) : (
                          <div className="max-h-56 overflow-y-auto space-y-1 pr-0.5">
                            {(sc.docs ?? []).map((d) => (
                              <div key={d.id}>
                                {editingDoc[d.id] ? (
                                  /* Inline edit form */
                                  <div className="bg-gray-700/60 rounded p-1.5 space-y-1.5">
                                    <input
                                      autoFocus
                                      type="text"
                                      value={editingDoc[d.id]!.name}
                                      onChange={(e) =>
                                        setEditingDoc((prev) => ({
                                          ...prev,
                                          [d.id]: { ...prev[d.id]!, name: e.target.value },
                                        }))
                                      }
                                      className="w-full bg-gray-700 border border-gray-600 rounded px-1.5 py-1 text-white text-xs focus:outline-none focus:border-blue-500"
                                    />
                                    <select
                                      value={editingDoc[d.id]!.docType}
                                      onChange={(e) =>
                                        setEditingDoc((prev) => ({
                                          ...prev,
                                          [d.id]: { ...prev[d.id]!, docType: e.target.value },
                                        }))
                                      }
                                      className="w-full bg-gray-700 border border-gray-600 rounded px-1.5 py-1 text-white text-xs focus:outline-none focus:border-blue-500"
                                    >
                                      {DOC_TYPES.map((dt) => (
                                        <option key={dt} value={dt}>{t("knowledge.types." + dt)}</option>
                                      ))}
                                    </select>
                                    <div className="flex gap-1">
                                      <button
                                        onClick={() => handleSaveEditDoc(sc.id, d.id)}
                                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded px-1.5 py-0.5 text-xs font-medium"
                                      >
                                        {t("common.save")}
                                      </button>
                                      <button
                                        onClick={() =>
                                          setEditingDoc((prev) => {
                                            const n = { ...prev }; delete n[d.id]; return n;
                                          })
                                        }
                                        className="text-gray-400 hover:text-white px-1.5 py-0.5 text-xs"
                                      >
                                        {t("common.cancel")}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  /* Normal doc row */
                                  <div className="flex items-center gap-1">
                                    <span className="text-sm text-gray-500 shrink-0">📄</span>
                                    <span className="text-sm text-gray-400 truncate flex-1">{d.original_name}</span>
                                    <span className={`text-xs px-1 rounded-full shrink-0 ${STATUS_BADGE_COLORS[d.processing_status] ?? STATUS_BADGE_COLORS.pending}`}>
                                      {t("knowledge.status." + d.processing_status)}
                                    </span>
                                    {/* Import to personal course */}
                                    <button
                                      onClick={() => handleImportFromShared(d.id, sc.id)}
                                      disabled={importingId === d.id}
                                      title={t("sharedKnowledge.importToKnowledge")}
                                      className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-600 text-gray-500 hover:text-green-400 transition-colors shrink-0 disabled:opacity-50 text-xs"
                                    >
                                      {importingId === d.id ? "…" : "↓"}
                                    </button>
                                    {/* Admin: edit doc */}
                                    {isAdmin && (
                                      <button
                                        onClick={() =>
                                          setEditingDoc((prev) => ({
                                            ...prev,
                                            [d.id]: { name: d.original_name, docType: d.doc_type },
                                          }))
                                        }
                                        title={t("sharedKnowledge.editDoc")}
                                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-600 text-gray-500 hover:text-white transition-colors shrink-0 text-xs"
                                      >✏</button>
                                    )}
                                    {/* Admin: retry if error or pending */}
                                    {isAdmin && (d.processing_status === "error" || d.processing_status === "pending") && (
                                      <button
                                        onClick={() => handleRetrySharedDoc(sc.id, d.id)}
                                        disabled={retryingId === d.id}
                                        title={t("sharedKnowledge.retryDoc")}
                                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-600 text-gray-500 hover:text-yellow-400 transition-colors shrink-0 disabled:opacity-50 text-xs"
                                      >
                                        {retryingId === d.id ? "…" : "↺"}
                                      </button>
                                    )}
                                    {/* Admin: delete doc */}
                                    {isAdmin && (
                                      <button
                                        onClick={() => handleDeleteSharedDoc(sc.id, d.id)}
                                        disabled={deletingSharedDocId === d.id}
                                        title={t("common.delete")}
                                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-600 text-gray-600 hover:text-red-400 transition-colors shrink-0 disabled:opacity-50 text-xs leading-none"
                                      >×</button>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Left panel — document list ── */}
        <div className="flex-1">
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
                const showCopyRow = doc.id in copyTargets;
                const isEditingPersonal = doc.id in editingPersonal;

                return (
                  <div
                    key={doc.id}
                    className="bg-gray-800 rounded-xl border border-gray-700 hover:border-gray-600 transition-colors"
                  >
                    {isEditingPersonal ? (
                      /* Inline rename form */
                      <div className="px-3 py-2.5 space-y-2">
                        <div className="flex gap-2">
                          <input
                            autoFocus
                            type="text"
                            value={editingPersonal[doc.id]!.name}
                            onChange={(e) =>
                              setEditingPersonal((prev) => ({
                                ...prev,
                                [doc.id]: { ...prev[doc.id]!, name: e.target.value },
                              }))
                            }
                            className="flex-1 bg-gray-700 border border-gray-600 rounded px-2.5 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                          <select
                            value={editingPersonal[doc.id]!.docType}
                            onChange={(e) =>
                              setEditingPersonal((prev) => ({
                                ...prev,
                                [doc.id]: { ...prev[doc.id]!, docType: e.target.value },
                              }))
                            }
                            className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                          >
                            {DOC_TYPES.map((dt) => (
                              <option key={dt} value={dt}>{t("knowledge.types." + dt)}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSavePersonalDoc(doc.id)}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-medium"
                          >{t("common.save")}</button>
                          <button
                            onClick={() =>
                              setEditingPersonal((prev) => { const n = { ...prev }; delete n[doc.id]; return n; })
                            }
                            className="text-gray-400 hover:text-white px-2 py-1 text-xs"
                          >{t("common.cancel")}</button>
                        </div>
                      </div>
                    ) : (
                      /* Normal doc row */
                      <div className="px-3 py-2 flex items-center gap-2">
                        <span className="text-xs select-none shrink-0 text-gray-500">{imgFile ? "🖼️" : "📄"}</span>

                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm truncate">{doc.original_name}</p>
                          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                            <span className={"inline-flex items-center px-1 py-0 rounded-full text-[10px] border font-medium " + badgeColor}>
                              {t("knowledge.types." + type) || type}
                            </span>
                            <span className={"inline-flex items-center px-1 py-0 rounded-full text-[10px] font-medium " + statusColor}>
                              {t("knowledge.status." + doc.processing_status)}
                            </span>
                            {doc.processing_status === "done" &&
                             doc.metadata_?.scan_quality != null &&
                             doc.metadata_.scan_quality !== "good" && (
                              <span
                                className="inline-flex items-center gap-0.5 px-1 py-0 rounded-full text-[10px] border bg-orange-900/30 text-orange-400 border-orange-700/30"
                                title={t("knowledge.scanWarningTooltip")}
                              >
                                ⚠ {t("knowledge.scanWarning")}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Retry for error/pending */}
                        {(doc.processing_status === "error" || doc.processing_status === "pending") && (
                          <button
                            onClick={() => handleRetryPersonalDoc(doc.id)}
                            disabled={retryingPersonalId === doc.id}
                            title={t("knowledge.retryProcessing")}
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-700 text-gray-500 hover:text-yellow-400 transition-colors shrink-0 disabled:opacity-50 text-sm"
                          >
                            {retryingPersonalId === doc.id ? "…" : "↺"}
                          </button>
                        )}

                        {/* Edit (rename) */}
                        <button
                          onClick={() =>
                            setEditingPersonal((prev) => ({
                              ...prev,
                              [doc.id]: { name: doc.original_name, docType: doc.doc_type },
                            }))
                          }
                          title={t("knowledge.editDoc")}
                          className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-700 text-gray-500 hover:text-white transition-colors shrink-0 text-sm"
                        >✏</button>

                        {/* Share to library */}
                        {sharedCourses.length > 0 && (
                          <button
                            onClick={() =>
                              setCopyTargets((prev) => {
                                if (doc.id in prev) {
                                  const n = { ...prev };
                                  delete n[doc.id];
                                  return n;
                                }
                                return { ...prev, [doc.id]: sharedCourses[0]?.id ?? "" };
                              })
                            }
                            title={t("sharedKnowledge.copyToLibrary")}
                            className={`w-7 h-7 flex items-center justify-center rounded hover:bg-gray-700 transition-colors shrink-0 text-sm ${
                              showCopyRow ? "text-blue-400" : "text-gray-500 hover:text-blue-400"
                            }`}
                          >
                            📤
                          </button>
                        )}

                        <button
                          onClick={() => handleDelete(doc.id)}
                          className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-colors shrink-0 text-lg leading-none"
                          title={t("common.delete")}
                        >×</button>
                      </div>
                    )}

                    {/* Inline copy-to-library row */}
                    {showCopyRow && !isEditingPersonal && (
                      <div className="border-t border-gray-700 px-3 py-2 flex items-center gap-2">
                        <span className="text-xs text-gray-400 shrink-0">{t("sharedKnowledge.copyToLibrary")}:</span>
                        <select
                          value={copyTargets[doc.id] ?? ""}
                          onChange={(e) =>
                            setCopyTargets((prev) => ({ ...prev, [doc.id]: e.target.value }))
                          }
                          className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-blue-500"
                        >
                          {sharedCourses.map((sc) => (
                            <option key={sc.id} value={sc.id}>{sc.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleCopyToShared(doc.id)}
                          disabled={!copyTargets[doc.id] || copyingDocId === doc.id}
                          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-2.5 py-1 rounded text-xs font-medium transition-colors shrink-0"
                        >
                          {copyingDocId === doc.id ? "…" : t("common.copy")}
                        </button>
                      </div>
                    )}
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
