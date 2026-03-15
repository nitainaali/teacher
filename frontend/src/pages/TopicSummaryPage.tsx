import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import client from "../api/client";
import { MarkdownContent } from "../components/MarkdownContent";
import { getTopicSummaries, deleteTopicSummary } from "../api/learning";
import { getDocuments } from "../api/documents";
import type { TopicSummary } from "../types";

interface TopicEntry {
  topic: string;
  avg_score: number;
  event_count: number;
}

const API_BASE = import.meta.env.VITE_API_URL || "";

export function TopicSummaryPage() {
  const { t, i18n } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();

  const [topics, setTopics] = useState<TopicEntry[]>([]);
  const [allSummaries, setAllSummaries] = useState<TopicSummary[]>([]);
  const [hasDocuments, setHasDocuments] = useState<boolean | null>(null); // null = loading
  const [topicInput, setTopicInput] = useState("");
  const [guidance, setGuidance] = useState("");
  const [summary, setSummary] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTopicName, setSelectedTopicName] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      return new Set<string>(
        JSON.parse(localStorage.getItem(`dismissedTopicSuggestions_${courseId}`) || "[]")
      );
    } catch {
      return new Set<string>();
    }
  });

  const fetchAllSummaries = () => {
    if (!courseId) return;
    getTopicSummaries(courseId)
      .then(setAllSummaries)
      .catch(() => setAllSummaries([]));
  };

  useEffect(() => {
    if (!courseId) return;
    client
      .get<TopicEntry[]>("/api/progress/topics", { params: { course_id: courseId } })
      .then((r) => setTopics(r.data))
      .catch(() => setTopics([]));
    fetchAllSummaries();
    // Check if there are any uploaded course documents
    getDocuments(courseId, "knowledge")
      .then((docs) => setHasDocuments(docs.length > 0))
      .catch(() => setHasDocuments(false));
  }, [courseId]);

  // Group summaries by topic (ordered desc by created_at from API)
  const summariesByTopic: Record<string, TopicSummary[]> = {};
  for (const s of allSummaries) {
    if (!summariesByTopic[s.topic]) summariesByTopic[s.topic] = [];
    summariesByTopic[s.topic].push(s);
  }

  // Topics that have at least one saved summary
  const topicsWithSummaries = Object.keys(summariesByTopic);

  // Topics from progress that don't yet have a summary (and haven't been dismissed)
  const topicsWithoutSummaries = topics
    .map((e) => e.topic)
    .filter((t) => !summariesByTopic[t] && !dismissed.has(t));

  const selectTopic = (topicName: string) => {
    setSelectedTopicName(topicName);
    setTopicInput(topicName);
    setSummary("");
    setError(null);
    const saved = summariesByTopic[topicName];
    if (saved && saved.length > 0) {
      setSummary(saved[0].content);
      setGuidance(saved[0].guidance || "");
    } else {
      setGuidance("");
    }
  };

  const handleSelectSummaryItem = (item: TopicSummary) => {
    setSummary(item.content);
    setGuidance(item.guidance || "");
  };

  const handleDeleteSummary = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteTopicSummary(id);
      const deleted = allSummaries.find((s) => s.id === id);
      if (deleted && summary === deleted.content) setSummary("");
      fetchAllSummaries();
    } catch {
      // silently ignore
    }
  };

  const handleDeleteTopic = async (topicName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const toDelete = summariesByTopic[topicName] || [];
    await Promise.all(toDelete.map((s) => deleteTopicSummary(s.id)));
    if (toDelete.some((s) => s.content === summary)) setSummary("");
    if (selectedTopicName === topicName) {
      setSelectedTopicName(null);
      setTopicInput("");
    }
    fetchAllSummaries();
  };

  const handleDismissSuggestion = (topicName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(dismissed);
    next.add(topicName);
    setDismissed(next);
    try {
      localStorage.setItem(
        `dismissedTopicSuggestions_${courseId}`,
        JSON.stringify([...next])
      );
    } catch {}
    if (selectedTopicName === topicName) {
      setSelectedTopicName(null);
      setTopicInput("");
    }
  };

  const handleSummarize = async () => {
    const topic = topicInput.trim();
    if (!topic || streaming || hasDocuments === false) return;
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

      if (!response.ok || !response.body) throw new Error(t("common.error"));

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
            if (text.startsWith("[ERROR:")) throw new Error(text.slice(7, -1));
            if (text) {
              accumulated += text;
            }
          }
        }
      }

      // Load the DB-saved version (authoritative, no SSE corruption) and display that.
      // Falls back to the streamed `accumulated` if the API call fails.
      const fresh = await getTopicSummaries(courseId!).catch(() => [] as typeof allSummaries);
      setAllSummaries(fresh);
      const saved = fresh
        .filter((s) => s.topic === topic)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setSummary(saved.length > 0 ? saved[0].content : accumulated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex gap-4 h-full">
      {/* ── Left column: topic list ────────────────────────────────────── */}
      <div className="w-52 shrink-0 bg-gray-800 rounded-xl border border-gray-700 overflow-y-auto max-h-[calc(100vh-8rem)]">
        {topicsWithSummaries.length === 0 && topicsWithoutSummaries.length === 0 ? (
          <p className="text-xs text-gray-500 p-3">{t("topicSummary.noTopics")}</p>
        ) : (
          <>
            {/* ── Ready Summaries ─────────────────────────────────── */}
            {topicsWithSummaries.length > 0 && (
              <>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2.5 pt-2.5 pb-1 border-b border-gray-700">
                  {t("topicSummary.readySummaries")}
                </p>
                <div className="p-1.5 space-y-0.5">
                  {topicsWithSummaries.map((topicName) => {
                    const isSelected = selectedTopicName === topicName;
                    const saved = summariesByTopic[topicName] || [];
                    return (
                      <div key={topicName}>
                        <div className="group flex items-center gap-0.5">
                          <button
                            onClick={() => selectTopic(topicName)}
                            className={[
                              "flex-1 min-w-0 text-left px-2.5 py-2 rounded-lg text-sm transition-colors",
                              isSelected
                                ? "bg-blue-600/20 text-blue-300 border border-blue-700/50"
                                : "text-gray-300 hover:bg-gray-700",
                            ].join(" ")}
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="text-xs opacity-60">{isSelected ? "▸" : "•"}</span>
                              <span className="truncate">{topicName}</span>
                            </span>
                          </button>
                          <button
                            onClick={(e) => handleDeleteTopic(topicName, e)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-red-400 p-1 rounded shrink-0 text-xs"
                            title={t("topicSummary.deleteTopic")}
                          >
                            🗑
                          </button>
                        </div>

                        {isSelected && saved.length > 0 && (
                          <div className="ml-3 mt-0.5 mb-1 space-y-0.5">
                            {saved.map((item) => (
                              <div
                                key={item.id}
                                onClick={() => handleSelectSummaryItem(item)}
                                className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-gray-700/50 hover:bg-gray-700 cursor-pointer group"
                              >
                                <span className="text-xs text-gray-500 shrink-0">📄</span>
                                <span className="text-xs text-gray-300 flex-1 min-w-0 truncate">
                                  {new Date(item.created_at).toLocaleDateString(i18n.language, {
                                    day: "numeric",
                                    month: "short",
                                  })}
                                  {item.guidance ? ` — ${item.guidance.slice(0, 12)}` : ""}
                                </span>
                                <button
                                  onClick={(e) => handleDeleteSummary(item.id, e)}
                                  className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
                                  title={t("topicSummary.deleteSummary")}
                                >
                                  🗑
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ── Summary Suggestions ──────────────────────────────── */}
            {topicsWithoutSummaries.length > 0 && (
              <>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2.5 pt-2.5 pb-1 border-b border-gray-700">
                  {t("topicSummary.summarySuggestions")}
                </p>
                <div className="p-1.5 space-y-0.5">
                  {topicsWithoutSummaries.map((topicName) => {
                    const isSelected = selectedTopicName === topicName;
                    return (
                      <div key={topicName} className="group flex items-center gap-0.5">
                        <button
                          onClick={() => selectTopic(topicName)}
                          className={[
                            "flex-1 min-w-0 text-left px-2.5 py-2 rounded-lg text-sm transition-colors",
                            isSelected
                              ? "bg-blue-600/20 text-blue-300 border border-blue-700/50"
                              : "text-gray-300 hover:bg-gray-700",
                          ].join(" ")}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="text-xs opacity-60">{isSelected ? "▸" : "•"}</span>
                            <span className="truncate">{topicName}</span>
                          </span>
                        </button>
                        <button
                          onClick={(e) => handleDismissSuggestion(topicName, e)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-red-400 p-1 rounded shrink-0 text-xs"
                          title={t("topicSummary.dismissSuggestion")}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Right column: input + result ────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">
        <h2 className="text-xl font-bold text-white">{t("topicSummary.title")}</h2>

        {/* No documents warning */}
        {hasDocuments === false && (
          <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl px-4 py-3 text-sm text-yellow-300">
            {t("topicSummary.noDocuments")}
          </div>
        )}

        <div className="space-y-2.5">
          <input
            type="text"
            value={topicInput}
            onChange={(e) => {
              setTopicInput(e.target.value);
              setSummary("");
              setError(null);
              setSelectedTopicName(e.target.value.trim() || null);
            }}
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
          <div className="flex items-center gap-3">
            <button
              onClick={handleSummarize}
              disabled={!topicInput.trim() || streaming || hasDocuments === false}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {streaming ? t("topicSummary.summarizing") : t("topicSummary.summarize")}
            </button>
            {summary && !streaming && (
              <button
                onClick={() => { setSummary(""); setGuidance(""); }}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                {t("topicSummary.regenerate")}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-700/50 rounded-xl px-4 py-3 text-sm text-red-300">
            ⚠ {error}
          </div>
        )}

        {streaming && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 flex items-center gap-3 text-gray-400">
            <svg className="animate-spin h-5 w-5 text-blue-400 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm">{t("topicSummary.summarizing")}</span>
          </div>
        )}

        {summary && !streaming && (
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <MarkdownContent content={summary} />
          </div>
        )}

        {!summary && !streaming && !topicInput && topicsWithSummaries.length === 0 && topicsWithoutSummaries.length === 0 && hasDocuments !== false && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-5xl mb-4 select-none">📚</div>
            <p className="text-gray-400 text-sm max-w-sm">{t("topicSummary.noTopics")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
