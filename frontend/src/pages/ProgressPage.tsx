import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getProgress, getTopicPerformance } from "../api/progress";
import type { ProgressStats } from "../types";

export function ProgressPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [topics, setTopics] = useState<Array<{ topic: string; avg_score: number; event_count: number }>>([]);

  useEffect(() => {
    getProgress().then(setStats).catch(() => {});
    getTopicPerformance().then(setTopics).catch(() => {});
  }, []);

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t("progress.title")}</h1>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          {[
            { label: t("progress.totalDocuments"), value: stats.total_documents },
            { label: t("progress.totalFlashcards"), value: stats.total_flashcards },
            { label: t("progress.dueFlashcards"), value: stats.due_flashcards },
            { label: t("progress.totalQuizzes"), value: stats.total_quizzes },
            {
              label: t("progress.avgScore"),
              value: stats.average_quiz_score !== null ? `${Math.round(stats.average_quiz_score)}%` : "—",
            },
          ].map((card) => (
            <div key={card.label} className="bg-gray-800 rounded-xl p-4">
              <p className="text-2xl font-bold text-blue-400">{card.value}</p>
              <p className="text-sm text-gray-400 mt-1">{card.label}</p>
            </div>
          ))}
        </div>
      )}

      {topics.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            {t("progress.topicBreakdown")}
          </h2>
          <div className="space-y-2">
            {topics.map((topic) => (
              <div key={topic.topic} className="bg-gray-800 rounded-xl p-3 flex items-center justify-between">
                <span className="text-sm">{topic.topic}</span>
                <span className="text-xs text-gray-400">{topic.event_count} events</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!stats && <p className="text-gray-500">{t("progress.noData")}</p>}
    </div>
  );
}
