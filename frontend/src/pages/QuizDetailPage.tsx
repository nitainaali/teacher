import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getQuiz, resetQuiz, replaceQuestion } from "../api/quizzes";
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
  const { t, i18n } = useTranslation();

  const [quiz, setQuiz] = useState<QuizSessionDetail | null>(null);
  const [shuffledQuestions, setShuffledQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<QuizPhase>("taking");
  const [gradingStatus, setGradingStatus] = useState<Record<string, QuestionStatus>>({});
  const [gradingResults, setGradingResults] = useState<Record<string, GradingResult>>({});
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [replacingQuestion, setReplacingQuestion] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (id) getQuiz(id).then(setQuiz);
  }, [id]);

  // Set shuffled question order and populate results if already completed
  useEffect(() => {
    if (!quiz) return;
    if (quiz.completed_at) {
      setShuffledQuestions(quiz.questions);
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
    } else {
      // Shuffle questions for taking mode
      setShuffledQuestions([...quiz.questions].sort(() => Math.random() - 0.5));
    }
  }, [quiz?.id, quiz?.completed_at]);

  const handleSubmit = async () => {
    if (!quiz || !id) return;

    // Initialize all as pending and switch to grading phase
    const initial: Record<string, QuestionStatus> = {};
    shuffledQuestions.forEach((q) => { initial[q.id] = "pending"; });
    setGradingStatus(initial);
    setPhase("grading");

    try {
      const userId = getCurrentUserId();
      const apiBase = import.meta.env.VITE_API_URL || "";
      const resp = await fetch(`${apiBase}/api/quizzes/${id}/grade-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(userId ? { "X-User-Id": userId } : {}),
        },
        body: JSON.stringify({
          answers: shuffledQuestions.map((q) => ({
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

  const handleReplaceQuestion = async (questionId: string) => {
    if (!id) return;
    setReplacingQuestion((prev) => ({ ...prev, [questionId]: true }));
    try {
      const newQ = await replaceQuestion(id, questionId, i18n.language);
      setShuffledQuestions((prev) => prev.map((q) => q.id === questionId ? newQ : q));
      setAnswers((prev) => { const next = { ...prev }; delete next[questionId]; return next; });
    } catch { /* ignore */ } finally {
      setReplacingQuestion((prev) => ({ ...prev, [questionId]: false }));
    }
  };

  const handleRetake = async () => {
    if (!id) return;
    await resetQuiz(id);
    setAnswers({});
    setGradingStatus({});
    setGradingResults({});
    setFinalScore(null);
    setPhase("taking");
    const fresh = await getQuiz(id);
    setQuiz(fresh);
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
            {t("quizzes.score")}: {Math.round(finalScore)}
          </span>
        )}
      </div>

      <div className="space-y-6">
        {shuffledQuestions.map((q, i) => (
          <QuizQuestionCard
            key={q.id}
            question={q}
            index={i}
            answer={answers[q.id] || ""}
            onAnswer={(val) => setAnswers((prev) => ({ ...prev, [q.id]: val }))}
            phase={phase}
            status={gradingStatus[q.id] ?? "pending"}
            gradingResult={gradingResults[q.id] ?? null}
            onReplace={() => handleReplaceQuestion(q.id)}
            replacing={replacingQuestion[q.id] ?? false}
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
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={handleRetake}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-medium transition-colors"
          >
            {t("quizzes.retakeQuiz")}
          </button>
          <button
            onClick={() => navigate(`/course/${courseId}/learning/quizzes`)}
            className="w-full bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-lg font-medium transition-colors"
          >
            {t("quizzes.retake")}
          </button>
        </div>
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
  onReplace,
  replacing,
  t,
}: {
  question: QuizQuestion;
  index: number;
  answer: string;
  onAnswer: (val: string) => void;
  phase: QuizPhase;
  status: QuestionStatus;
  gradingResult: GradingResult | null;
  onReplace: () => void;
  replacing: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [revealAnswer, setRevealAnswer] = useState(false);
  const locked = phase !== "taking";
  const isGraded = status === "graded" && gradingResult !== null;
  const isUnanswered = isGraded && !answer.trim();
  const isCorrect = isGraded && gradingResult.points_earned >= gradingResult.points_possible;
  const isPartial = isGraded && gradingResult.points_earned > 0 && gradingResult.points_earned < gradingResult.points_possible;

  return (
    <div className="bg-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-gray-400">{t("quizzes.question")} {index + 1}</p>
        {/* Replace question button — only in taking mode before answering */}
        {phase === "taking" && !answer.trim() && (
          <button
            onClick={onReplace}
            disabled={replacing}
            className="text-xs text-gray-500 hover:text-blue-400 transition-colors disabled:opacity-40 flex items-center gap-1"
          >
            {replacing
              ? <span className="animate-spin inline-block w-3 h-3 border border-blue-400 border-t-transparent rounded-full" />
              : "↺"}
            {!replacing && t("quizzes.replaceQuestion")}
          </button>
        )}
        {/* Per-question status badge */}
        {status === "checking" && (
          <span className="text-xs text-yellow-400 flex items-center gap-1">
            <span className="animate-spin inline-block w-3 h-3 border border-yellow-400 border-t-transparent rounded-full" />
            {t("quizzes.checking")}
          </span>
        )}
        {isGraded && isUnanswered && !revealAnswer && (
          <span className="text-xs font-medium text-yellow-400">
            {t("quizzes.noAnswerGiven")}
          </span>
        )}
        {isGraded && (!isUnanswered || revealAnswer) && (
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
            const isCorrectOpt = isGraded && (!isUnanswered || revealAnswer) && opt.value === gradingResult?.correct_answer;
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

      {/* Reveal answer button: MC + free-text — unanswered questions */}
      {isUnanswered && !revealAnswer && (
        <button
          onClick={() => setRevealAnswer(true)}
          className="mt-3 text-sm text-blue-400 hover:text-blue-300 underline"
        >
          {t("quizzes.revealAnswer")}
        </button>
      )}

      {/* Reveal answer button: free-text only — wrong or partial answers */}
      {isGraded && !isUnanswered && !isCorrect && question.question_type !== "multiple_choice" && !revealAnswer && (
        <button
          onClick={() => setRevealAnswer(true)}
          className="mt-3 text-sm text-blue-400 hover:text-blue-300 underline"
        >
          {t("quizzes.revealAnswer")}
        </button>
      )}

      {/* Free-text feedback */}
      {isGraded && (!isUnanswered || revealAnswer) && question.question_type !== "multiple_choice" && gradingResult.ai_feedback && (
        <div className="mt-3 p-3 bg-gray-700 rounded-lg">
          <p className="text-xs text-gray-400 mb-1">{t("quizzes.feedback")}</p>
          <div className="text-sm text-gray-200">
            <MarkdownContent content={gradingResult.ai_feedback} />
          </div>
        </div>
      )}

      {/* Model answer revealed for wrong/partial/unanswered free-text */}
      {isGraded && !isCorrect && revealAnswer && question.question_type !== "multiple_choice" && gradingResult.correct_answer && (
        <div className="mt-3 p-3 bg-green-900/30 border border-green-700 rounded-lg">
          <p className="text-xs text-green-400 mb-1">{t("quizzes.correctAnswer")}</p>
          <div className="text-sm text-gray-200">
            <MarkdownContent content={gradingResult.correct_answer} />
          </div>
        </div>
      )}

      {/* MC feedback for wrong answer */}
      {isGraded && (!isUnanswered || revealAnswer) && question.question_type === "multiple_choice" && !isCorrect && gradingResult.ai_feedback && (
        <p className="mt-2 text-xs text-gray-400">
          {gradingResult.ai_feedback}
        </p>
      )}
    </div>
  );
}
