import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import { getQuizzes, generateQuiz, updateQuiz, deleteQuiz } from "../api/quizzes";
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
  const [generating, setGenerating] = useState(false);
  const [genPct, setGenPct] = useState(0);
  const genTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const genStartTimeRef = useRef<number | null>(null);
  const QUIZ_GEN_KEY = "quiz_pending_generation";
  const [genError, setGenError] = useState<string | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTopic, setEditTopic] = useState("");
  const [editDifficulty, setEditDifficulty] = useState("medium");

  const fetchSessions = () => {
    if (courseId) getQuizzes(courseId).then(setSessions);
  };

  useEffect(() => {
    fetchSessions();
  }, [courseId]);

  // Restore generation state from localStorage on mount (e.g. user navigated away mid-generation)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(QUIZ_GEN_KEY) || "null");
      if (saved?.courseId === courseId && saved?.startTime
          && Date.now() - saved.startTime < 5 * 60 * 1000) {
        genStartTimeRef.current = saved.startTime;
        setGenerating(true);
      }
    } catch {}
  }, [courseId]);

  useEffect(() => {
    if (!generating) {
      if (genTimerRef.current) clearInterval(genTimerRef.current);
      setGenPct(0);
      return;
    }
    const startTime = genStartTimeRef.current ?? Date.now();
    const estimatedMs = Math.max(15000, count * 4000);
    const tick = () => {
      setGenPct(Math.min(Math.round((Date.now() - startTime) / estimatedMs * 100), 98));
    };
    tick();
    genTimerRef.current = setInterval(tick, 1000);
    return () => { if (genTimerRef.current) clearInterval(genTimerRef.current); };
  }, [generating, count]);

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
    genStartTimeRef.current = Date.now();
    localStorage.setItem(QUIZ_GEN_KEY, JSON.stringify({ courseId, startTime: genStartTimeRef.current, count }));
    setGenerating(true);
    setGenError(null);
    try {
      const session = await generateQuiz({
        course_id: courseId,
        topic: topic || undefined,
        count,
        knowledge_mode: "course_only",
        question_type: resolveQuestionType(),
        difficulty,
        language: i18n.language,
      });
      navigate(`/course/${courseId}/learning/quizzes/${session.id}`);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      genStartTimeRef.current = null;
      localStorage.removeItem(QUIZ_GEN_KEY);
      setGenerating(false);
    }
  };

  const startEdit = (s: QuizSession) => {
    setEditingId(s.id);
    setEditTopic(s.topic || "");
    setEditDifficulty(s.difficulty || "medium");
  };

  const handleSaveEdit = async (id: string) => {
    try {
      await updateQuiz(id, { topic: editTopic || undefined, difficulty: editDifficulty });
      setEditingId(null);
      fetchSessions();
    } catch {
      // silently ignore
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteQuiz(id);
      fetchSessions();
    } catch {
      // silently ignore
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

        {/* Question types */}
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

        {genError && <p className="text-red-400 text-sm">{genError}</p>}
        <button
          type="submit"
          disabled={generating}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {generating ? t("common.loading") : t("quizzes.generate")}
        </button>
        {generating && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 text-center">
              {t("quizzes.generatingPct", { pct: genPct })}
            </p>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${genPct}%` }}
              />
            </div>
          </div>
        )}
      </form>

      {/* History */}
      {sessions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 mb-3">{t("quizzes.config.history")}</h2>
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="bg-gray-800 rounded-xl p-4 border border-gray-700"
              >
                {editingId === s.id ? (
                  <div className="space-y-2">
                    <input
                      value={editTopic}
                      onChange={(e) => setEditTopic(e.target.value)}
                      placeholder={t("quizzes.config.topicPlaceholder")}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                    <select
                      value={editDifficulty}
                      onChange={(e) => setEditDifficulty(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                    >
                      {["easy", "medium", "hard"].map((d) => (
                        <option key={d} value={d}>{t(`quizzes.config.${d}`)}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveEdit(s.id)}
                        className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {t("common.save")}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs text-gray-400 hover:text-white transition-colors"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-start gap-2">
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => navigate(`/course/${courseId}/learning/quizzes/${s.id}`)}
                    >
                      <p className="font-medium text-white truncate">
                        {s.topic || t("quizzes.unnamed")}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {s.total_questions} {t("quizzes.questions")}
                        {s.difficulty ? ` • ${t(`quizzes.config.${s.difficulty}`)}` : ""}
                        {` • ${new Date(s.created_at).toLocaleDateString(i18n.language)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {s.score !== null ? (
                        <span className="text-blue-400 font-bold text-sm">
                          {Math.round(s.score)}%
                        </span>
                      ) : (
                        <span className="text-xs text-yellow-400">{t("quizzes.notCompleted")}</span>
                      )}
                      <button
                        onClick={() => navigate(`/course/${courseId}/learning/quizzes/${s.id}`)}
                        className="text-gray-400 hover:text-white text-sm px-1 transition-colors"
                        title="Open"
                      >
                        ▶
                      </button>
                      <button
                        onClick={() => startEdit(s)}
                        className="text-gray-400 hover:text-blue-400 text-sm px-1 transition-colors"
                        title={t("quizzes.editMeta")}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="text-gray-400 hover:text-red-400 text-sm px-1 transition-colors"
                        title={t("quizzes.delete")}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
