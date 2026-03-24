import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getQuiz } from "../api/quizzes";
import { MarkdownContent } from "../components/MarkdownContent";
import { getCurrentUserId } from "../api/client";
import type { QuizSessionDetail, QuizQuestion } from "../types";

type QuizPhase = "taking" | "grading" | "done";
type QuestionStatus = "pending" | "checking" | "graded";

interface GradingResult {
  points_earned: number;
  points_possible: number;
  ai_feedback: string | null;
  correct_answer: string | null;
}

export function QuizDetailPage() {
  const { id, courseId } = useParams<{ id: string; courseId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [quiz, setQuiz] = useState<QuizSessionDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<QuizPhase>("taking");
  const [gradingStatus, setGradingStatus] = useState<Record<string, QuestionStatus>>({});
  const [gradingResults, setGradingResults] = useState<Record<string, GradingResult>>({});
  const [finalScore, setFinalScore] = useState<number | null>(null);

  useEffect(() => {
    if (id) getQuiz(id).then(setQuiz);
  }, [id]);

  // If quiz is already completed on load, populate results immediately
  useEffect(() => {
    if (!quiz?.completed_at) return;
    const statuses: Record<string, QuestionStatus> = {};
    const results: Record<string, GradingResult> = {};
    quiz.questions.forEach((q) => {
      statuses[q.id] = "graded";
      results[q.id] = {
        points_earned: q.points_earned ?? 0,
        points_possible: q.points_possible,
        ai_feedback: q.ai_feedback,
        correct_answer: q.correct_answer,
      };
    });
    setGradingStatus(statuses);
    setGradingResults(results);
    setFinalScore(quiz.score);
    setPhase("done");
  }, [quiz?.id]);

  const handleSubmit = async () => {
    if (!quiz || !id) return;

    // Initialize all as pending and switch to grading phase
    const initial: Record<string, QuestionStatus> = {};
    quiz.questions.forEach((q) => { initial[q.id] = "pending"; });
    setGradingStatus(initial);
    setPhase("grading");

    try {
      const userId = getCurrentUserId();
      const resp = await fetch(`/api/quizzes/${id}/grade-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(userId ? { "X-User-Id": userId } : {}),
        },
        body: JSON.stringify({
          answers: quiz.questions.map((q) => ({
            question_id: q.id,
            answer: answers[q.id] || "",
          })),
        }),
      });

      if (!resp.ok || !resp.body) throw new Error("Grading failed");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const ev = JSON.parse(raw);
            if (ev.type === "checking") {
              setGradingStatus((p) => ({ ...p, [ev.question_id]: "checking" }));
            } else if (ev.type === "graded") {
              setGradingStatus((p) => ({ ...p, [ev.question_id]: "graded" }));
              setGradingResults((p) => ({
                ...p,
                [ev.question_id]: {
                  points_earned: ev.points_earned,
                  points_possible: ev.points_possible,
                  ai_feedback: ev.ai_feedback,
                  correct_answer: ev.correct_answer,
                },
              }));
            } else if (ev.type === "complete") {
              setFinalScore(ev.score);
              setPhase("done");
            }
          } catch {}
        }
      }
    } catch {
      setPhase("taking");
    }
  };

  if (!quiz) return <p className="text-gray-500">{t("common.loading")}</p>;

  const scoreColor =
    finalScore !== null
      ? finalScore >= 80
        ? "text-green-400"
        : finalScore >= 50
        ? "text-yellow-400"
        : "text-red-400"
      : "";

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={() => navigate(`/course/${courseId}/learning/quizzes`)}
        className="text-sm text-gray-400 hover:text-white mb-4 flex items-center gap-1"
      >
        ← {t("common.back")}
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">
          {phase === "grading" ? t("quizzes.gradingHeader") : t("quizzes.title")}
        </h1>
        {finalScore !== null && (
          <span className={`text-2xl font-bold ${scoreColor}`}>
            {Math.round(finalScore)}%
          </span>
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
            phase={phase}
            status={gradingStatus[q.id] ?? "pending"}
            gradingResult={gradingResults[q.id] ?? null}
            t={t}
          />
        ))}
      </div>

      {phase === "taking" && (
        <button
          onClick={handleSubmit}
          className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {t("quizzes.submit")}
        </button>
      )}

      {phase === "done" && (
        <button
          onClick={() => navigate(`/course/${courseId}/learning/quizzes`)}
          className="mt-6 w-full bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {t("quizzes.retake")}
        </button>
      )}
    </div>
  );
}

function QuizQuestionCard({
  question,
  index,
  answer,
  onAnswer,
  phase,
  status,
  gradingResult,
  t,
}: {
  question: QuizQuestion;
  index: number;
  answer: string;
  onAnswer: (val: string) => void;
  phase: QuizPhase;
  status: QuestionStatus;
  gradingResult: GradingResult | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const locked = phase !== "taking";
  const isGraded = status === "graded" && gradingResult !== null;
  const isCorrect = isGraded && gradingResult.points_earned >= gradingResult.points_possible;
  const isPartial = isGraded && gradingResult.points_earned > 0 && gradingResult.points_earned < gradingResult.points_possible;

  return (
    <div className="bg-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-gray-400">{t("quizzes.question")} {index + 1}</p>
        {/* Per-question status badge */}
        {status === "checking" && (
          <span className="text-xs text-yellow-400 flex items-center gap-1">
            <span className="animate-spin inline-block w-3 h-3 border border-yellow-400 border-t-transparent rounded-full" />
            {t("quizzes.checking")}
          </span>
        )}
        {isGraded && (
          <span className={`text-xs font-medium ${isCorrect ? "text-green-400" : isPartial ? "text-yellow-400" : "text-red-400"}`}>
            {isCorrect ? `✓ ${t("quizzes.correct")}` : isPartial ? `~ ${t("quizzes.partial")}` : `✗ ${t("quizzes.incorrect")}`}
            {" "}
            <span className="opacity-70">
              {gradingResult.points_earned}/{gradingResult.points_possible}
            </span>
          </span>
        )}
      </div>

      <div className="font-medium mb-4">
        <MarkdownContent content={question.question_text} />
      </div>

      {question.question_type === "multiple_choice" && question.options ? (
        <div className="space-y-2">
          {question.options.map((opt) => {
            const isCorrectOpt = isGraded && opt.value === gradingResult?.correct_answer;
            const isWrongStudentChoice = isGraded && opt.value === answer && answer !== gradingResult?.correct_answer;
            return (
              <label
                key={opt.value}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  isCorrectOpt
                    ? "border-green-500 bg-green-500/15"
                    : isWrongStudentChoice
                    ? "border-red-500 bg-red-500/15"
                    : answer === opt.value && !locked
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-gray-700 hover:border-gray-500"
                }`}
              >
                <input
                  type="radio"
                  name={question.id}
                  value={opt.value}
                  checked={answer === opt.value}
                  onChange={() => !locked && onAnswer(opt.value)}
                  disabled={locked}
                  className="accent-blue-500"
                />
                <div className="text-sm leading-snug flex-1 [&_p]:m-0 [&_.katex-display]:my-1">
                  <MarkdownContent content={opt.label} />
                </div>
              </label>
            );
          })}
        </div>
      ) : (
        <textarea
          value={answer}
          onChange={(e) => !locked && onAnswer(e.target.value)}
          disabled={locked}
          rows={3}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-60"
          placeholder={t("quizzes.yourAnswer")}
        />
      )}

      {/* Free-text feedback */}
      {isGraded && question.question_type !== "multiple_choice" && gradingResult.ai_feedback && (
        <div className="mt-3 p-3 bg-gray-700 rounded-lg">
          <p className="text-xs text-gray-400 mb-1">{t("quizzes.feedback")}</p>
          <div className="text-sm text-gray-200">
            <MarkdownContent content={gradingResult.ai_feedback} />
          </div>
        </div>
      )}

      {/* MC feedback for wrong answer */}
      {isGraded && question.question_type === "multiple_choice" && !isCorrect && gradingResult.ai_feedback && (
        <p className="mt-2 text-xs text-gray-400">
          {gradingResult.ai_feedback}
        </p>
      )}
    </div>
  );
}
