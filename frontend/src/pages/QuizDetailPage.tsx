import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getQuiz, submitQuiz } from "../api/quizzes";
import { MarkdownContent } from "../components/MarkdownContent";
import type { QuizSessionDetail, QuizQuestion } from "../types";

export function QuizDetailPage() {
  const { id, courseId } = useParams<{ id: string; courseId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [quiz, setQuiz] = useState<QuizSessionDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (id) getQuiz(id).then(setQuiz);
  }, [id]);

  const handleSubmit = async () => {
    if (!quiz || !id) return;
    setSubmitting(true);
    try {
      const answerList = quiz.questions.map((q) => ({
        question_id: q.id,
        answer: answers[q.id] || "",
      }));
      const result = await submitQuiz(id, answerList);
      setQuiz(result);
    } finally {
      setSubmitting(false);
    }
  };

  if (!quiz) return <p className="text-gray-500">{t("common.loading")}</p>;

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={() => navigate(`/course/${courseId}/learning/quizzes`)}
        className="text-sm text-gray-400 hover:text-white mb-4 flex items-center gap-1"
      >
        ← {t("common.back")}
      </button>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("quizzes.title")}</h1>
        {quiz.score !== null && (
          <span className="text-2xl font-bold text-blue-400">{Math.round(quiz.score)}%</span>
        )}
      </div>

      <div className="space-y-6">
        {quiz.questions.map((q, i) => (
          <QuizQuestionCard
            key={q.id}
            question={q}
            index={i}
            answer={answers[q.id] || ""}
            onAnswer={(val) => setAnswers((prev) => ({ ...prev, [q.id]: val }))}
            submitted={!!quiz.completed_at}
            t={t}
          />
        ))}
      </div>

      {!quiz.completed_at && (
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="mt-6 w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {submitting ? t("common.loading") : t("quizzes.submit")}
        </button>
      )}
    </div>
  );
}

function QuizQuestionCard({
  question, index, answer, onAnswer, submitted, t,
}: {
  question: QuizQuestion;
  index: number;
  answer: string;
  onAnswer: (val: string) => void;
  submitted: boolean;
  t: (key: string) => string;
}) {
  return (
    <div className="bg-gray-800 rounded-xl p-5">
      <p className="text-sm text-gray-400 mb-1">{t("quizzes.question")} {index + 1}</p>
      <div className="font-medium mb-4"><MarkdownContent content={question.question_text} /></div>

      {question.question_type === "multiple_choice" && question.options ? (
        <div className="space-y-2">
          {question.options.map((opt) => (
            <label
              key={opt.value}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                answer === opt.value
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-gray-700 hover:border-gray-500"
              }`}
            >
              <input
                type="radio"
                name={question.id}
                value={opt.value}
                checked={answer === opt.value}
                onChange={() => !submitted && onAnswer(opt.value)}
                disabled={submitted}
                className="accent-blue-500"
              />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      ) : (
        <textarea
          value={answer}
          onChange={(e) => !submitted && onAnswer(e.target.value)}
          disabled={submitted}
          rows={3}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-60"
          placeholder={t("quizzes.yourAnswer")}
        />
      )}

      {submitted && question.ai_feedback && (
        <div className="mt-3 p-3 bg-gray-700 rounded-lg">
          <p className="text-xs text-gray-400 mb-1">{t("quizzes.feedback")}</p>
          <div className="text-sm text-gray-200"><MarkdownContent content={question.ai_feedback} /></div>
          {question.points_earned !== null && (
            <p className="text-xs text-blue-400 mt-1">{question.points_earned} / {question.points_possible}</p>
          )}
        </div>
      )}
    </div>
  );
}
