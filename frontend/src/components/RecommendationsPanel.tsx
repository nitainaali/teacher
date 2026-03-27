import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRecommendations, dismissRecommendation } from "../api/learning";
import { MarkdownContent } from "./MarkdownContent";
import { getCurrentUserId } from "../api/client";
import type { Recommendation } from "../types";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface RecommendationsPanelProps {
  courseId: string;
  language?: string;
  onTopicSelect?: (topic: string) => void;
}

const urgencyConfig = {
  high: { color: "bg-red-900/40 border-red-700 text-red-300", dot: "bg-red-500" },
  medium: { color: "bg-yellow-900/40 border-yellow-700 text-yellow-300", dot: "bg-yellow-500" },
  low: { color: "bg-blue-900/40 border-blue-700 text-blue-300", dot: "bg-blue-500" },
};

export function RecommendationsPanel({ courseId, language = "en", onTopicSelect }: RecommendationsPanelProps) {
  const { t } = useTranslation();
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const storageKey = `recs-open-${courseId}`;
  const [isOpen, setIsOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) === "true"; }
    catch { return false; }
  });

  // Explanation modal state
  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);
  const [explanation, setExplanation] = useState("");
  const [explanationLoading, setExplanationLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setLoading(true);
    getRecommendations(courseId, 4)
      .then(setRecs)
      .finally(() => setLoading(false));
  }, [courseId]);

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    try { localStorage.setItem(storageKey, String(next)); } catch {}
  };

  const openExplanation = async (rec: Recommendation) => {
    setSelectedRec(rec);
    setExplanation("");
    setExplanationLoading(true);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const userId = getCurrentUserId();
      const response = await fetch(`${API_BASE}/api/learning/recommendation-explanation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(userId ? { "X-User-Id": userId } : {}),
        },
        body: JSON.stringify({
          course_id: courseId,
          topic: rec.topic,
          strength: rec.strength,
          importance: rec.importance,
          urgency_level: rec.urgency_level,
          language,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok || !response.body) throw new Error();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const chunk = line.slice(6);
            if (chunk === "[DONE]") break;
            if (chunk.startsWith("[ERROR:")) continue;
            if (chunk) {
              accumulated += chunk;
              setExplanation(accumulated);
            }
          }
        }
      }
    } catch {
      // aborted or network error — leave explanation as-is
    } finally {
      setExplanationLoading(false);
    }
  };

  const handleDismiss = async (topic: string) => {
    setRecs((prev) => prev.filter((r) => r.topic !== topic));
    await dismissRecommendation(courseId, topic).catch(() => {});
  };

  const closeModal = () => {
    abortRef.current?.abort();
    setSelectedRec(null);
    setExplanation("");
    setExplanationLoading(false);
  };

  if (loading) return null;

  // Collapsed state
  if (!isOpen) {
    return (
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors"
      >
        <span>💡</span>
        <span>{t("recommendations.title")}{recs.length > 0 ? ` (${recs.length})` : ""}</span>
      </button>
    );
  }

  // Expanded state
  return (
    <>
      <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300">{t("recommendations.title")}</h3>
          <button onClick={toggle} className="text-gray-500 hover:text-gray-300 text-xs transition-colors">
            ✕
          </button>
        </div>
        {recs.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-2">{t("recommendations.noRecs")}</p>
        )}
        <div className="space-y-2">
          {recs.map((rec) => {
            const cfg = urgencyConfig[rec.urgency_level] ?? urgencyConfig.low;
            return (
              <div
                key={rec.topic}
                onClick={() => {
                  onTopicSelect?.(rec.topic);
                  openExplanation(rec);
                }}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-xs cursor-pointer hover:opacity-80 transition-opacity ${cfg.color}`}
              >
                <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                <div className="min-w-0">
                  <p className="font-medium truncate">{rec.topic}</p>
                  <p className="opacity-70 mt-0.5 truncate">{rec.reason}</p>
                </div>
                <span className="shrink-0 opacity-60">
                  {t(`recommendations.urgency.${rec.urgency_level}`)}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDismiss(rec.topic); }}
                  className="shrink-0 text-gray-500 hover:text-red-400 transition-colors px-1"
                  title={t("common.delete")}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Explanation modal */}
      {selectedRec && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${urgencyConfig[selectedRec.urgency_level]?.dot ?? "bg-blue-500"}`} />
                <h3 className="text-sm font-semibold text-white truncate">{selectedRec.topic}</h3>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {t(`recommendations.urgency.${selectedRec.urgency_level}`)}
                </span>
              </div>
              <button onClick={closeModal} className="text-gray-500 hover:text-gray-300 transition-colors ml-3 flex-shrink-0">
                ✕
              </button>
            </div>

            {/* Modal body */}
            <div className="p-5 overflow-y-auto flex-1">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
                {t("recommendations.whyStudyThis")}
              </p>
              {explanationLoading && !explanation && (
                <p className="text-sm text-gray-400 animate-pulse">{t("recommendations.loadingExplanation")}</p>
              )}
              {explanation && (
                <div className="text-sm text-gray-200">
                  <MarkdownContent content={explanation} />
                  {explanationLoading && (
                    <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" />
                  )}
                </div>
              )}

              {/* Stats summary */}
              <div className="mt-4 flex gap-3">
                <div className="flex-1 bg-gray-700/50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-white">{Math.round(selectedRec.strength * 100)}%</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t("recommendations.knowledgeLevel")}</p>
                </div>
                <div className="flex-1 bg-gray-700/50 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-white">{Math.round(selectedRec.importance * 100)}%</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t("recommendations.examImportance")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
