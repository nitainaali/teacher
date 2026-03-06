import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getDocuments, uploadDocument, deleteDocument } from "../api/documents";
import type { Document } from "../types";

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

function isImage(filename: string) {
  return /.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(filename);
}

function FileIcon({ filename }: { filename: string }) {
  return <span className="text-2xl select-none">{isImage(filename) ? "🖼️" : "📄"}</span>;
}
export function KnowledgePage() {
  const { t } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const [docs, setDocs] = useState<Document[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<DocType>("lecture");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocs = () => {
    if (!courseId) return;
    getDocuments(courseId).then(setDocs);
  };

  useEffect(() => { fetchDocs(); }, [courseId]);

  const handleFileSelect = (file: File) => { setSelectedFile(file); setUploadDone(false); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !courseId || uploading) return;
    setUploading(true);
    try {
      await uploadDocument(selectedFile, courseId, docType);
      setUploadDone(true); setSelectedFile(null); setDocType("lecture");
      fetchDocs();
      setTimeout(() => { setShowUpload(false); setUploadDone(false); }, 1200);
    } finally { setUploading(false); }
  };

  const handleDelete = async (id: string) => { await deleteDocument(id); fetchDocs(); };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">{t("knowledge.title")}</h2>
        <button
          onClick={() => { setShowUpload((v) => !v); setSelectedFile(null); setUploadDone(false); }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {showUpload ? t("common.cancel") : t("knowledge.addFile")}
        </button>
      </div>

      {showUpload && (
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={["border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors select-none",
              dragging ? "border-blue-500 bg-blue-600/10" : "border-gray-600 hover:border-gray-500 hover:bg-gray-700/40"
            ].join(" ")}
          >
            <div className="text-3xl mb-2">📁</div>
            {selectedFile ? (
              <p className="text-sm text-blue-400 font-medium">{selectedFile.name}</p>
            ) : (
              <p className="text-sm text-gray-400">{t("knowledge.dragDrop")}</p>
            )}
            <input ref={fileInputRef} type="file" accept=".pdf,image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {t("knowledge.contentCategory")}
            </label>
            <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            >
              {DOC_TYPES.map((type) => (
                <option key={type} value={type}>{t("knowledge.types." + type)}</option>
              ))}
            </select>
          </div>
          <button onClick={handleUpload} disabled={!selectedFile || uploading || uploadDone}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {uploading ? t("knowledge.uploading") : uploadDone ? t("knowledge.uploadSuccess") : t("common.upload")}
          </button>
        </div>
      )}
      {docs.length === 0 && !showUpload ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-5xl mb-4 select-none">📂</div>
          <p className="text-white font-semibold mb-1">{t("knowledge.empty")}</p>
          <p className="text-sm text-gray-500 max-w-sm">{t("knowledge.emptyHint")}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {docs.map((doc) => {
            const type = doc.doc_type as DocType;
            const badgeColor = TYPE_BADGE_COLORS[type] ?? TYPE_BADGE_COLORS.reference;
            const statusColor = STATUS_BADGE_COLORS[doc.processing_status] ?? STATUS_BADGE_COLORS.pending;
            const imgFile = isImage(doc.original_name);
            return (
              <div key={doc.id}
                className="bg-gray-800 rounded-xl p-4 border border-gray-700 flex items-center gap-4 hover:border-gray-600 transition-colors"
              >
                <FileIcon filename={doc.original_name} />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{doc.original_name}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={"inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium " + badgeColor}>
                      {t("knowledge.types." + type) || type}
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border border-gray-600 bg-gray-700/50 text-gray-400 font-medium">
                      {imgFile ? t("knowledge.formats.image") : t("knowledge.formats.pdf")}
                    </span>
                    <span className={"inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " + statusColor}>
                      {t("knowledge.status." + doc.processing_status)}
                    </span>
                  </div>
                </div>
                <button onClick={() => handleDelete(doc.id)}
                  className="text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded text-lg leading-none flex-shrink-0"
                  title={t("common.delete")}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}