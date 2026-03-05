import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { getCourses } from "../api/courses";
import { getQuizzes, generateQuiz } from "../api/quizzes";
import type { Course, QuizSession } from "../types";

export function QuizzesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<QuizSession[]>([]);
  const [courseId, setCourseId] = useState("");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [knowledgeMode, setKnowledgeMode] = useState("general");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    getCourses().then((cs) => { setCourses(cs); if (cs.length) setCourseId(cs[0].id); });
    getQuizzes().then(setSessions);
  }, []);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId) return;
    setGenerating(true);
    try {
      const session = await generateQuiz({ course_id: courseId, topic: topic || undefined, count, knowledge_mode: knowledgeMode });
      navigate(`/quizzes/${session.id}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t("quizzes.title")}</h1>

      <form onSubmit={handleGenerate} className="bg-gray-800 rounded-xl p-5 space-y-4 mb-8">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t("courses.title")}</label>
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t("quizzes.count")}</label>
            <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t("quizzes.topic")}</label>
          <input value={topic} onChange={(e) => setTopic(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
        </div>
        <div className="flex gap-2">
          {(["general", "course_only"] as const).map((mode) => (
            <button key={mode} type="button" onClick={() => setKnowledgeMode(mode)}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${knowledgeMode === mode ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}>
              {t(`knowledgeMode.${mode === "general" ? "general" : "courseOnly"}`)}
            </button>
          ))}
        </div>
        <button type="submit" disabled={!courseId || generating}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors">
          {generating ? t("common.loading") : t("quizzes.generate")}
        </button>
      </form>

      {sessions.length > 0 && (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} onClick={() => navigate(`/quizzes/${s.id}`)}
              className="bg-gray-800 rounded-xl p-4 flex items-center justify-between cursor-pointer hover:bg-gray-700 transition-colors">
              <div>
                <p className="text-sm font-medium">{new Date(s.created_at).toLocaleDateString()}</p>
                <p className="text-xs text-gray-400">{s.total_questions} questions • {s.mode}</p>
              </div>
              {s.score !== null && (
                <span className="text-blue-400 font-bold">{Math.round(s.score)}%</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
