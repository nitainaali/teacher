import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import client from "../api/client";

interface TopicEntry {
  topic: string;
  avg_score: number;
  event_count: number;
}

export function TopicSummaryPage() {
  const { t } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const [topics, setTopics] = useState<TopicEntry[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [guidance, setGuidance] = useState("");
  const [summary, setSummary] = useState("");
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    if (!courseId) return;
    client
      .get<TopicEntry[]>("/api/progress/topics", { params: { course_id: courseId } })
      .then((r) => setTopics(r.data))
      .catch(() => setTopics([]));
  }, [courseId]);

  const handleSummarize = async () => {
    if (!selectedTopic || streaming) return;
    setSummary(""); setStreaming(true);
    try {
      const response = await fetch(
        (import.meta.env.VITE_API_URL || "") + "/api/learning/topic-summary",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            course_id: courseId,
            topic: selectedTopic,
            guidance: guidance.trim() || undefined,
          }),
        }
      );
      if (!response.ok || !response.body) { setSummary(t("common.error")); return; }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            const text = line.slice(6);
            if (text === "[DONE]") break;
            accumulated += text;
            setSummary(accumulated);
          }
        }
      }
    } catch { setSummary(t("common.error")); }
    finally { setStreaming(false); }
  };
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold text-white">{t("topicSummary.title")}</h2>

      {topics.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl mb-4 select-none">📚</div>
          <p className="text-gray-400 text-sm max-w-sm">{t("topicSummary.noTopics")}</p>
        </div>
      ) : (
        <>
          <div>
            <p className="text-sm text-gray-400 mb-2">{t("topicSummary.selectTopic")}</p>
            <div className="flex flex-wrap gap-2">
              {topics.map((entry) => (
                <button
                  key={entry.topic}
                  onClick={() => { setSelectedTopic(entry.topic); setSummary(""); }}
                  className={[
                    "px-3 py-1 rounded-full text-sm transition-colors",
                    selectedTopic === entry.topic
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  ].join(" ")}
                >
                  {entry.topic}
                </button>
              ))}
            </div>
          </div>

          {selectedTopic && (
            <div className="space-y-3">
              <input
                type="text"
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
                placeholder={t("topicSummary.guidancePlaceholder")}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleSummarize}
                disabled={streaming}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {streaming ? t("topicSummary.summarizing") : t("topicSummary.summarize")}
              </button>
            </div>
          )}

          {(summary || streaming) && (
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <p className="text-white text-sm whitespace-pre-wrap leading-relaxed">
                {summary}
                {streaming && (
                  <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" />
                )}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}