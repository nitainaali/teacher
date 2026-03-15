import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import client from "../api/client";

interface DiagnosisStats {
  flashcards_studied: number;
  quizzes_completed: number;
  homework_submitted: number;
  exams_submitted: number;
}

interface TopicKnowledge {
  topic: string;
  knowledge_level: number | null;
  has_sufficient_data: boolean;
  total_interactions: number;
}

interface ExamTopicWeight {
  topic: string;
  exam_count: number;
  weight: number;
}

interface DiagnosisData {
  stats: DiagnosisStats;
  topics: TopicKnowledge[];
  exam_topics: ExamTopicWeight[] | null;
  exam_doc_count: number;
}

function KnowledgeBar({ level }: { level: number }) {
  const pct = Math.round(level * 100);
  const color =
    level >= 0.7
      ? "bg-green-500"
      : level >= 0.4
      ? "bg-yellow-500"
      : "bg-red-500";
  return (
    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} rounded-full transition-all`}
        style={{ width: pct + "%" }}
      />
    </div>
  );
}

export function DiagnosisPage() {
  const { t } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const [data, setData] = useState<DiagnosisData | null>(null);
  const [loading, setLoading] = useState(true);

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

  const hasData =
    data !== null &&
    (data.stats.flashcards_studied > 0 ||
      data.stats.quizzes_completed > 0 ||
      data.stats.homework_submitted > 0 ||
      data.stats.exams_submitted > 0 ||
      data.topics.length > 0);

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

  const { stats, topics, exam_topics, exam_doc_count } = data!;

  const statCards = [
    { label: t("diagnosis.flashcardsStudied"), value: stats.flashcards_studied, icon: "🗂" },
    { label: t("diagnosis.quizzesCompleted"),  value: stats.quizzes_completed,  icon: "📝" },
    { label: t("diagnosis.homeworkSubmitted"), value: stats.homework_submitted, icon: "📋" },
    { label: t("diagnosis.examsSubmitted"),    value: stats.exams_submitted,    icon: "📊" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">{t("diagnosis.title")}</h2>
        <p className="text-sm text-gray-400 mt-1">{t("diagnosis.subtitle")}</p>
      </div>

      {/* ── Section 1: Stats ──────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
          {t("diagnosis.stats")}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statCards.map((card) => (
            <div
              key={card.label}
              className="bg-gray-800 rounded-xl p-4 border border-gray-700 text-center"
            >
              <div className="text-2xl mb-1">{card.icon}</div>
              <p className="text-2xl font-bold text-white">{card.value}</p>
              <p className="text-xs text-gray-400 mt-1">{card.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 2: Topic knowledge level ─────────────────────────────── */}
      {topics.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
              {t("diagnosis.topicBreakdown")}
            </h3>
            <span className="text-xs text-gray-500">{t("diagnosis.estimatedLabel")}</span>
          </div>
          <div className="space-y-2">
            {topics.map((entry) => (
              <div
                key={entry.topic}
                className="bg-gray-800 rounded-lg p-3 border border-gray-700"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-white font-medium truncate flex-1">
                    {entry.topic}
                  </span>
                  <span className="text-xs text-gray-500 ml-2 shrink-0">
                    {entry.total_interactions} {t("diagnosis.interactions")}
                  </span>
                </div>
                {entry.has_sufficient_data ? (
                  <KnowledgeBar level={entry.knowledge_level!} />
                ) : (
                  <p className="text-xs text-gray-500 italic">{t("diagnosis.insufficientData")}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Section 3: Exam topics ranking ───────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
          {t("diagnosis.examTopicsTitle")}
        </h3>
        {exam_topics === null ? (
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <p className="text-sm text-gray-500">
              {t("diagnosis.examTopicsInsufficient", { needed: 3, have: exam_doc_count })}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {exam_topics.map((entry, idx) => (
              <div
                key={entry.topic}
                className="bg-gray-800 rounded-lg p-3 border border-gray-700"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs text-gray-500 shrink-0 w-5 text-right">
                      {idx + 1}.
                    </span>
                    <span className="text-sm text-white font-medium truncate">
                      {entry.topic}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500 ml-2 shrink-0">
                    {t("diagnosis.examTopicsAppearances", { n: entry.exam_count })}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all"
                    style={{ width: Math.round(entry.weight * 100) + "%" }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
