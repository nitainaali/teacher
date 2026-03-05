import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getProgress } from "../api/progress";
import type { ProgressStats } from "../types";

export function DashboardPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<ProgressStats | null>(null);

  useEffect(() => { getProgress().then(setStats).catch(() => {}); }, []);

  const statCards = stats
    ? [
        { label: t("progress.totalDocuments"), value: stats.total_documents },
        { label: t("progress.totalFlashcards"), value: stats.total_flashcards },
        { label: t("progress.dueFlashcards"), value: stats.due_flashcards },
        { label: t("progress.totalQuizzes"), value: stats.total_quizzes },
      ]
    : [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">{t("dashboard.title")}</h1>
      <p className="text-gray-400 mb-6">{t("dashboard.welcome")}</p>
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">{t("dashboard.quickStats")}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="bg-gray-800 rounded-xl p-4">
            <p className="text-2xl font-bold text-blue-400">{card.value}</p>
            <p className="text-sm text-gray-400 mt-1">{card.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
