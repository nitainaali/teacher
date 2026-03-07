import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import client from "../api/client";
import { MarkdownContent } from "../components/MarkdownContent";

interface TopicEntry {
  topic: string;
  avg_score: number;
  event_count: number;
}

interface SavedSummary {
  id: string;
  topic: string;
  content: string;
  guidance?: string;
  language: string;
  created_at: string;
}

const API_BASE = import.meta.env.VITE_API_URL || "";

export function TopicSummaryPage() {
  const { t, i18n } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();

  // Suggested topics from learning history
  const [topics, setTopics] = useState<TopicEntry[]>([]);
  // Free-text topic input (can be selected from chips or typed)
  const [topicInput, setTopicInput] = useState("");
  const [guidance, setGuidance] = useState("");
  // Currently streaming summary
  const [summary, setSummary] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // History of saved summaries for the current topic
  const [history, setHistory] = useState<SavedSummary[]>([]);
  const [historyTopic, setHistoryTopic] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    client
      .get<TopicEntry[]>("/api/progress/topics", { params: { course_id: courseId } })
      .then((r) => setTopics(r.data))
      .catch(() => setTopics([]));
  }, [courseId]);

  // Load history when topicInput changes
  useEffect(() => {
    const topic = topicInput.trim();
    if (!topic || !courseId || topic === historyTopic) return;
    setHistoryTopic(topic);
    setHistory([]);
    client
      .get<SavedSummary[]>("/api/learning/topic-summaries", {
        params: { course_id: courseId, topic },
      })
      .then((r) => setHistory(r.data))
      .catch(() => setHistory([]));
  }, [topicInput, courseId]);

  const selectChip = (topic: string) => {
    setTopicInput(topic);
    setSummary("");
    setError(null);
  };

  const handleSummarize = async () => {
    const topic = topicInput.trim();
    if (!topic || streaming) return;
    setSummary("");
    setError(null);
    setStreaming(true);

    try {
      const response = await fetch(`${API_BASE}/api/learning/topic-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: courseId,
          topic,
          guidance: guidance.trim() || undefined,
          language: i18n.language,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(t("common.error"));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const text = line.slice(6);
            if (text === "[DONE]") break;
            if (text.startsWith("[ERROR:")) {
              throw new Error(text.slice(7, -1));
            }
            if (text) {
              accumulated += text;
              setSummary(accumulated);
            }
          }
        }
      }

      // Reload history after save
      if (courseId && topic) {
        client
          .get<SavedSummary[]>("/api/learning/topic-summaries", {
            params: { course_id: courseId, topic },
          })
          .then((r) => setHistory(r.data))
          .catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold text-white">{t("topicSummary.title")}</h2>

      {/* Suggested topics chips */}
      {topics.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-2">{t("topicSummary.suggestedTopics")}</p>
          <div className="flex flex-wrap gap-2">
            {topics.map((entry) => (
              <button
                key={entry.topic}
                onClick={() => selectChip(entry.topic)}
                className={[
                  "px-3 py-1 rounded-full text-sm transition-colors",
                  topicInput === entry.topic
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600",
                ].join(" ")}
              >
                {entry.topic}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Free-text topic input */}
      <div className="space-y-3">
        <input
          type="text"
          value={topicInput}
          onChange={(e) => { setTopicInput(e.target.value); setSummary(""); setError(null); }}
          placeholder={t("topicSummary.topicPlaceholder")}
          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <input
          type="text"
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          placeholder={t("topicSummary.guidancePlaceholder")}
          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={handleSummarize}
          disabled={!topicInput.trim() || streaming}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {streaming ? t("topicSummary.summarizing") : t("topicSummary.summarize")}
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Streaming output */}
      {(summary || streaming) && (
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <MarkdownContent content={summary} />
          {streaming && (
            <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" />
          )}
        </div>
      )}

      {/* History panel */}
      {history.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
            {t("topicSummary.history")}
          </p>
          {history.map((item) => (
            <div key={item.id} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
              <button
                onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-700 transition-colors"
              >
                <div>
                  <span className="text-sm text-gray-200">
                    {new Date(item.created_at).toLocaleDateString(i18n.language, {
                      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                  {item.guidance && (
                    <span className="ml-2 text-xs text-gray-500 italic">({item.guidance})</span>
                  )}
                </div>
                <span className="text-gray-500 text-xs">{expandedId === item.id ? "▲" : "▼"}</span>
              </button>
              {expandedId === item.id && (
                <div className="px-4 pb-4 border-t border-gray-700 pt-3">
                  <MarkdownContent content={item.content} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {topics.length === 0 && !topicInput && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl mb-4 select-none">📚</div>
          <p className="text-gray-400 text-sm max-w-sm">{t("topicSummary.noTopics")}</p>
        </div>
      )}
    </div>
  );
}