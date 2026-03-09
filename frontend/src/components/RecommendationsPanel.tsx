import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRecommendations } from "../api/learning";
import type { Recommendation } from "../types";

interface RecommendationsPanelProps {
  courseId: string;
  onTopicSelect?: (topic: string) => void;
}

const urgencyConfig = {
  high: { color: "bg-red-900/40 border-red-700 text-red-300", dot: "bg-red-500" },
  medium: { color: "bg-yellow-900/40 border-yellow-700 text-yellow-300", dot: "bg-yellow-500" },
  low: { color: "bg-blue-900/40 border-blue-700 text-blue-300", dot: "bg-blue-500" },
};

export function RecommendationsPanel({ courseId, onTopicSelect }: RecommendationsPanelProps) {
  const { t } = useTranslation();
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const storageKey = `recs-open-${courseId}`;
  const [isOpen, setIsOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) === "true"; }
    catch { return false; }
  });

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

  if (loading) {
    return null; // don't show anything while loading
  }

  if (recs.length === 0) {
    return null; // no recommendations — don't render
  }

  // Collapsed state: show compact button
  if (!isOpen) {
    return (
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-600 transition-colors"
      >
        <span>💡</span>
        <span>{t("recommendations.title")} ({recs.length})</span>
      </button>
    );
  }

  // Expanded state: full panel
  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300">{t("recommendations.title")}</h3>
        <button
          onClick={toggle}
          className="text-gray-500 hover:text-gray-300 text-xs transition-colors"
        >
          ✕
        </button>
      </div>
      <div className="space-y-2">
        {recs.map((rec) => {
          const cfg = urgencyConfig[rec.urgency_level] ?? urgencyConfig.low;
          return (
            <div
              key={rec.topic}
              onClick={() => onTopicSelect?.(rec.topic)}
              className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-xs ${cfg.color} ${
                onTopicSelect ? "cursor-pointer hover:opacity-80 transition-opacity" : ""
              }`}
            >
              <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
              <div className="min-w-0">
                <p className="font-medium truncate">{rec.topic}</p>
                <p className="opacity-70 mt-0.5 truncate">{rec.reason}</p>
              </div>
              <span className="shrink-0 opacity-60 ml-auto">
                {t(`recommendations.urgency.${rec.urgency_level}`)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
