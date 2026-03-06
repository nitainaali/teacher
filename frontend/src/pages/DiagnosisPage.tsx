import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import client from "../api/client";
import type { ProgressStats } from "../types";

interface TopicEntry {
  topic: string;
  avg_score: number;
  event_count: number;
}

interface StatCard {
  labelKey: string;
  value: string | number;
}

export function DiagnosisPage() {
  const { t } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [topics, setTopics] = useState<TopicEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!courseId) return;
    const params = { course_id: courseId };
    Promise.all([
      client.get<ProgressStats>("/api/progress", { params }),
      client.get<TopicEntry[]>("/api/progress/topics", { params }),
    ])
      .then(([statsRes, topicsRes]) => {
        setStats(statsRes.data);
        setTopics(topicsRes.data);
      })
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

  const hasData = stats !== null && (stats.total_documents > 0 || topics.length > 0);

  if (!hasData) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-white">{t("diagnosis.title")}</h2>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-5xl mb-4 select-none">📊</div>
          <p className="text-gray-400 text-sm max-w-sm">{t("diagnosis.noData")}</p>
        </div>
      </div>
    );
  }
  const maxEvents = Math.max(...topics.map((tp) => tp.event_count), 1);

  const statCards: StatCard[] = [
    { labelKey: "diagnosis.documents", value: stats?.total_documents ?? 0 },
    { labelKey: "diagnosis.flashcards", value: stats?.total_flashcards ?? 0 },
    { labelKey: "diagnosis.dueFlashcards", value: stats?.due_flashcards ?? 0 },
    { labelKey: "diagnosis.quizzes", value: stats?.total_quizzes ?? 0 },
    {
      labelKey: "diagnosis.avgScore",
      value: stats?.average_quiz_score != null
        ? Math.round(stats.average_quiz_score * 100) + "%"
        : "—",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">{t("diagnosis.title")}</h2>
        <p className="text-sm text-gray-400 mt-1">{t("diagnosis.subtitle")}</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
          {t("diagnosis.stats")}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {statCards.map((card) => (
            <div key={card.labelKey} className="bg-gray-800 rounded-xl p-4 border border-gray-700 text-center">
              <p className="text-2xl font-bold text-white mb-1">{card.value}</p>
              <p className="text-xs text-gray-400">{t(card.labelKey)}</p>
            </div>
          ))}
        </div>
      </div>

      {topics.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
            {t("diagnosis.topicBreakdown")}
          </h3>
          <div className="space-y-2">
            {topics.map((entry) => {
              const barWidth = Math.round((entry.event_count / maxEvents) * 100);
              return (
                <div key={entry.topic} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-white font-medium truncate">{entry.topic}</span>
                    <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                      {entry.event_count} {t("diagnosis.eventCount").toLowerCase()}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: barWidth + "%" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}