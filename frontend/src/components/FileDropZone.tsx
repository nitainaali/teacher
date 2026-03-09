import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";

interface FileDropZoneProps {
  file: File | null;
  onFile: (f: File) => void;
  label: string;
  hint: string;
  emoji?: string;
  accept?: string;
}

export function FileDropZone({
  file,
  onFile,
  label,
  hint,
  emoji = "📝",
  accept = ".pdf,image/*",
}: FileDropZoneProps) {
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
          e.preventDefault();
          setDragging(false);
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
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </div>
    </div>
  );
}
