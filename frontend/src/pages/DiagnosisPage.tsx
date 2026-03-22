import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import client from "../api/client";
import type { DiagnosisData } from "../types";
import { HelpTooltip } from "../components/HelpTooltip";

export function DiagnosisPage() {
  const { t } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const [data, setData] = useState<DiagnosisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);

  const hiddenKey = `hidden_topics_${courseId}`;
  const [hiddenTopics, setHiddenTopics] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(hiddenKey) || "[]"); }
    catch { return []; }
  });

  const hideTopicLocal = (topic: string) => {
    const next = [...hiddenTopics, topic];
    setHiddenTopics(next);
    try { localStorage.setItem(hiddenKey, JSON.stringify(next)); } catch {}
  };

  const restoreAll = () => {
    setHiddenTopics([]);
    try { localStorage.removeItem(hiddenKey); } catch {}
    setShowHidden(false);
  };

  useEffect(() => {
    if (!courseId) return;
    client
      .get<DiagnosisData>("/api/diagnosis/", { params: { course_id: courseId } })
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [courseId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-400 text-sm">{t("common.loading")}</p>
      </div>
    );
  }

  const hasData = data !== null && (data.topics.length > 0 || data.stats.flashcards_studied > 0 || data.stats.quizzes_completed > 0);

  if (!hasData) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-white">{t("diagnosis.title")}</h2>
          <HelpTooltip text={t("help.diagnosis")} />
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-5xl mb-4 select-none">📊</div>
          <p className="text-gray-400 text-sm max-w-sm">{t("diagnosis.noData")}</p>
        </div>
      </div>
    );
  }

  const stats = data!.stats;
  const visibleTopics = showHidden
    ? data!.topics
    : data!.topics.filter((tp) => !hiddenTopics.includes(tp.topic));
  const hiddenCount = hiddenTopics.filter((h) => data!.topics.some((tp) => tp.topic === h)).length;

  const statCards = [
    { labelKey: "diagnosis.flashcards", value: stats.flashcards_studied },
    { labelKey: "diagnosis.quizzes", value: stats.quizzes_completed },
    { labelKey: "diagnosis.homeworkSubmissions", value: stats.homework_submitted },
    { labelKey: "diagnosis.examsAnalyzed", value: stats.exams_submitted },
  ];

  const knowledgeBarColor = (level: number) => {
    if (level >= 0.7) return "bg-green-500";
    if (level >= 0.4) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-white">{t("diagnosis.title")}</h2>
          <HelpTooltip text={t("help.diagnosis")} />
        </div>
        <p className="text-sm text-gray-400 mt-1">{t("diagnosis.subtitle")}</p>
      </div>

      {/* Activity stats */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
          {t("diagnosis.stats")}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statCards.map((card) => (
            <div key={card.labelKey} className="bg-gray-800 rounded-xl p-4 border border-gray-700 text-center">
              <p className="text-2xl font-bold text-white mb-1">{card.value}</p>
              <p className="text-xs text-gray-400">{t(card.labelKey)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Per-topic knowledge */}
      {visibleTopics.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
            {t("diagnosis.topicBreakdown")}
          </h3>
          <div className="space-y-2">
            {visibleTopics.map((entry) => {
              const isHidden = hiddenTopics.includes(entry.topic);
              if (isHidden && !showHidden) return null;
              return (
                <div
                  key={entry.topic}
                  className={`bg-gray-800 rounded-lg p-3 border border-gray-700 flex items-center gap-3 ${isHidden ? "opacity-40" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-white font-medium truncate">{entry.topic}</span>
                      {entry.has_sufficient_data && entry.knowledge_level != null && (
                        <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                          {Math.round(entry.knowledge_level * 100)}%
                        </span>
                      )}
                    </div>
                    {entry.has_sufficient_data && entry.knowledge_level != null ? (
                      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${knowledgeBarColor(entry.knowledge_level)}`}
                          style={{ width: Math.round(entry.knowledge_level * 100) + "%" }}
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 italic">{t("diagnosis.noDataTopic")}</p>
                    )}
                  </div>
                  {!isHidden && (
                    <button
                      onClick={() => hideTopicLocal(entry.topic)}
                      title={t("diagnosis.hideTopic")}
                      className="text-gray-600 hover:text-gray-400 transition-colors text-base flex-shrink-0 leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Hidden topics controls */}
          {hiddenCount > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={() => setShowHidden((v) => !v)}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showHidden
                  ? t("diagnosis.hideHidden")
                  : t("diagnosis.showHidden", { count: hiddenCount })}
              </button>
              {showHidden && (
                <button
                  onClick={restoreAll}
                  className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
                >
                  {t("diagnosis.restoreAll")}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Exam topics by frequency — always shown */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">
          {t("diagnosis.examTopics")}
        </h3>
        {data!.exam_topics && data!.exam_topics.length > 0 ? (
          <>
            <p className="text-xs text-gray-500 mb-3">{t("diagnosis.examTopicsHint")}</p>
            <div className="space-y-2">
              {data!.exam_topics.map((et) => (
                <div
                  key={et.topic}
                  className="bg-gray-800 rounded-lg p-3 border border-gray-700 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-white truncate">{et.topic}</span>
                      <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                        {t("diagnosis.examCount", { count: et.exam_count })}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-purple-500 transition-all"
                        style={{ width: Math.round(et.weight * 100) + "%" }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-500 mt-2 italic">{t("diagnosis.examTopicsInsufficient")}</p>
        )}
      </div>
    </div>
  );
}
