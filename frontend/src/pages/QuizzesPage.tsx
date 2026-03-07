import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import { getQuizzes, generateQuiz } from "../api/quizzes";
import { RecommendationsPanel } from "../components/RecommendationsPanel";
import type { QuizSession } from "../types";

export function QuizzesPage() {
  const { t, i18n } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<QuizSession[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(
    new Set(["multiple_choice", "free_text"])
  );
  const [difficulty, setDifficulty] = useState("medium");
  const [count, setCount] = useState(5);
  const [topic, setTopic] = useState("");
  const [knowledgeMode, setKnowledgeMode] = useState("general");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    if (courseId) {
      getQuizzes(courseId).then(setSessions);
    }
  }, [courseId]);

  const toggleType = (type: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const resolveQuestionType = () => {
    if (selectedTypes.has("multiple_choice") && selectedTypes.has("free_text")) return "mixed";
    if (selectedTypes.has("multiple_choice")) return "multiple_choice";
    return "free_text";
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId) return;
    setGenerating(true);
    setGenError(null);
    try {
      const session = await generateQuiz({
        course_id: courseId,
        topic: topic || undefined,
        count,
        knowledge_mode: knowledgeMode,
        question_type: resolveQuestionType(),
        difficulty,
        language: i18n.language,
      });
      navigate(`/course/${courseId}/learning/quizzes/${session.id}`);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "שגיאה ביצירת הבחן");
    } finally {
      setGenerating(false);
    }
  };

  const qtOptions = [
    { value: "multiple_choice", label: t("quizzes.config.multipleChoice") },
    { value: "free_text", label: t("quizzes.config.freeText") },
  ];

  const diffOptions = [
    { value: "easy", label: t("quizzes.config.easy") },
    { value: "medium", label: t("quizzes.config.medium") },
    { value: "hard", label: t("quizzes.config.hard") },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold">{t("quizzes.title")}</h1>

      {/* Recommendations */}
      {courseId && (
        <RecommendationsPanel
          courseId={courseId}
          onTopicSelect={(rec) => setTopic(rec)}
        />
      )}

      <form onSubmit={handleGenerate} className="bg-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold">{t("quizzes.config.title")}</h2>

        {/* Question types — multi-select checkboxes */}
        <div>
          <p className="text-sm text-gray-400 mb-2">{t("quizzes.config.questionType")}</p>
          <div className="flex gap-2">
            {qtOptions.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => toggleType(value)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedTypes.has(value)
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {selectedTypes.size === 2 && (
            <p className="text-xs text-gray-500 mt-1">→ {t("quizzes.config.mixed")}</p>
          )}
        </div>

        {/* Difficulty */}
        <div>
          <p className="text-sm text-gray-400 mb-2">{t("quizzes.config.difficulty")}</p>
          <div className="flex gap-2">
            {diffOptions.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setDifficulty(value)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  difficulty === value
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t("quizzes.count")}</label>
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t("quizzes.config.topicLabel")}</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t("quizzes.config.topicPlaceholder")}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <p className="text-sm text-gray-400 mb-2">{t("knowledgeMode.label")}</p>
          <div className="flex gap-2">
            {(["general", "course_only"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setKnowledgeMode(mode)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  knowledgeMode === mode
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {t(`knowledgeMode.${mode === "general" ? "general" : "courseOnly"}`)}
              </button>
            ))}
          </div>
        </div>

        {genError && (
          <p className="text-red-400 text-sm">{genError}</p>
        )}
        <button
          type="submit"
          disabled={generating}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {generating ? t("common.loading") : t("quizzes.generate")}
        </button>
      </form>

      {sessions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 mb-3">{t("quizzes.config.history")}</h2>
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => navigate(`/course/${courseId}/learning/quizzes/${s.id}`)}
                className="bg-gray-800 rounded-xl p-4 flex items-center justify-between cursor-pointer hover:bg-gray-700 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium">{new Date(s.created_at).toLocaleDateString()}</p>
                  <p className="text-xs text-gray-400">{s.total_questions} {t("quizzes.questions")} • {s.mode}</p>
                </div>
                {s.score !== null && (
                  <span className="text-blue-400 font-bold">{Math.round(s.score)}%</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
