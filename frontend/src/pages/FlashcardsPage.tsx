import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { getFlashcards, generateFlashcards, reviewFlashcard } from "../api/flashcards";
import { getDocuments } from "../api/documents";
import { MarkdownContent } from "../components/MarkdownContent";
import { RecommendationsPanel } from "../components/RecommendationsPanel";
import type { Flashcard } from "../types";
import type { Document } from "../types";

type Mode = "config" | "review";

const ALL_CARD_TYPES = [
  "comprehension",
  "memorization",
  "application",
  "tricks",
  "confusion",
] as const;
type CardType = typeof ALL_CARD_TYPES[number];

export function FlashcardsPage() {
  const { t, i18n } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();

  const [mode, setMode] = useState<Mode>("config");
  const [dueCount, setDueCount] = useState<number | null>(null);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);

  // Generate config
  const [docs, setDocs] = useState<Document[]>([]);
  const [genDocIds, setGenDocIds] = useState<Set<string>>(new Set());
  const [genCount, setGenCount] = useState(20);
  const [genCardTypes, setGenCardTypes] = useState<Set<CardType>>(new Set(ALL_CARD_TYPES));
  const [genTopic, setGenTopic] = useState("");
  const [genGuidance, setGenGuidance] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genSuccess, setGenSuccess] = useState(false);

  const refreshDueCount = () => {
    if (courseId) {
      getFlashcards(courseId, true).then((c) => setDueCount(c.length));
    }
  };

  useEffect(() => {
    if (courseId) {
      getDocuments(courseId).then((ds) => {
        setDocs(ds);
        // Select all documents by default
        setGenDocIds(new Set(ds.map((d) => d.id)));
      });
      refreshDueCount();
    }
  }, [courseId]);

  const startSession = async () => {
    if (!courseId) return;
    setReviewLoading(true);
    try {
      const all = await getFlashcards(courseId, true);
      setCards(all);
      setIndex(0);
      setFlipped(false);
      setMode("review");
    } finally {
      setReviewLoading(false);
    }
  };

  const handleReview = async (quality: number) => {
    const current = cards[index];
    if (!current) return;
    await reviewFlashcard(current.id, quality);
    if (index + 1 < cards.length) {
      setIndex(index + 1);
      setFlipped(false);
    } else {
      setIndex(cards.length);
    }
  };

  const handleGenerate = async () => {
    if (!courseId || genDocIds.size === 0) return;
    setGenerating(true);
    setGenError(null);
    setGenSuccess(false);
    try {
      const cardTypeParam =
        genCardTypes.size === 1 ? Array.from(genCardTypes)[0] : "mixed";
      const result = await generateFlashcards(
        Array.from(genDocIds),
        courseId,
        genCount,
        cardTypeParam as string,
        genTopic.trim() || undefined,
        genGuidance.trim() || undefined,
        i18n.language,
      );
      if (result.length === 0) {
        setGenError(t("flashcards.config.noCardsGenerated"));
      } else {
        setGenSuccess(true);
        refreshDueCount();
      }
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "שגיאה ביצירת כרטיסיות");
    } finally {
      setGenerating(false);
    }
  };

  const toggleCardType = (type: CardType) => {
    setGenCardTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const toggleDoc = (id: string) => {
    setGenDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllDocs = () => setGenDocIds(new Set(docs.map((d) => d.id)));
  const deselectAllDocs = () => setGenDocIds(new Set());

  const backToConfig = () => {
    setMode("config");
    setCards([]);
    setIndex(0);
    setFlipped(false);
    refreshDueCount();
  };

  // ── Review mode ─────────────────────────────────────────────────────────────
  if (mode === "review") {
    const done = index >= cards.length;
    const current = cards[index];

    return (
      <div className="max-w-xl mx-auto">
        <button
          onClick={backToConfig}
          className="text-sm text-gray-400 hover:text-white mb-6 flex items-center gap-1 transition-colors"
        >
          ← {t("common.back")}
        </button>

        {done ? (
          <div className="text-center py-16">
            <p className="text-xl font-semibold mb-2">{t("flashcards.complete")}</p>
            <p className="text-gray-400 text-sm mb-6">{t("flashcards.completeSubtitle")}</p>
            <button
              onClick={backToConfig}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
            >
              {t("common.back")}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-400 mb-4">
              {index + 1} / {cards.length} — {t("flashcards.due")}
              {current.topic && (
                <span className="ml-2 text-blue-400">· {current.topic}</span>
              )}
            </p>
            <div
              className="bg-gray-800 rounded-xl p-8 min-h-48 flex items-center justify-center cursor-pointer border border-gray-700 hover:border-gray-600 transition-colors"
              onClick={() => setFlipped(!flipped)}
            >
              <div className="text-center w-full">
                <MarkdownContent content={flipped ? current.back : current.front} />
              </div>
            </div>

            {!flipped ? (
              <button
                onClick={() => setFlipped(true)}
                className="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-lg text-sm transition-colors"
              >
                {t("flashcards.showAnswer")}
              </button>
            ) : (
              <div className="mt-4 grid grid-cols-4 gap-2">
                {[
                  { quality: 0, label: t("flashcards.quality.again"), color: "bg-red-700 hover:bg-red-600" },
                  { quality: 1, label: t("flashcards.quality.hard"), color: "bg-orange-700 hover:bg-orange-600" },
                  { quality: 2, label: t("flashcards.quality.good"), color: "bg-green-700 hover:bg-green-600" },
                  { quality: 3, label: t("flashcards.quality.easy"), color: "bg-blue-700 hover:bg-blue-600" },
                ].map(({ quality, label, color }) => (
                  <button
                    key={quality}
                    onClick={() => handleReview(quality)}
                    className={`${color} text-white py-2 rounded-lg text-sm transition-colors`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Config mode — two-column layout ─────────────────────────────────────────
  return (
    <div className="flex gap-5 items-start">
      {/* Left sidebar: Deck card + Recommendations */}
      <div className="w-44 shrink-0 space-y-4">
        <button
          onClick={startSession}
          disabled={reviewLoading || dueCount === 0}
          className={`w-full text-left bg-gray-800 rounded-xl p-4 border-2 transition-all ${
            dueCount && dueCount > 0
              ? "border-blue-600 hover:border-blue-500 cursor-pointer"
              : "border-gray-700 opacity-60 cursor-not-allowed"
          }`}
        >
          <div className="text-3xl mb-2">🃏</div>
          <p className="text-sm font-semibold text-white leading-tight">
            {t("flashcards.deck.title")}
          </p>
          {reviewLoading || dueCount === null ? (
            <p className="text-xs text-gray-500 mt-1">{t("common.loading")}</p>
          ) : dueCount === 0 ? (
            <p className="text-xs text-gray-500 mt-1">{t("flashcards.deck.empty")}</p>
          ) : (
            <p className="text-xs text-blue-400 mt-1 font-medium">
              {dueCount} {t("flashcards.due")}
            </p>
          )}
        </button>

        {courseId && (
          <RecommendationsPanel
            courseId={courseId}
            onTopicSelect={(topic) => setGenTopic(topic)}
          />
        )}
      </div>

      {/* Right main: Generate form */}
      <div className="flex-1 bg-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold">{t("flashcards.config.generateTitle")}</h2>

        {/* Documents — multi-select checkboxes */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm text-gray-400">
              {t("flashcards.config.document")}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAllDocs}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                {t("flashcards.config.selectAll")}
              </button>
              <span className="text-gray-600 text-xs">·</span>
              <button
                type="button"
                onClick={deselectAllDocs}
                className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
              >
                {t("flashcards.config.deselectAll")}
              </button>
            </div>
          </div>
          {docs.length === 0 ? (
            <p className="text-sm text-gray-500">{t("flashcards.config.noDocs")}</p>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
              {docs.map((d) => (
                <label
                  key={d.id}
                  className="flex items-center gap-2 text-sm cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={genDocIds.has(d.id)}
                    onChange={() => toggleDoc(d.id)}
                    className="accent-blue-500 shrink-0"
                  />
                  <span className="text-gray-300 group-hover:text-white transition-colors truncate">
                    {d.original_name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Count slider */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            {t("flashcards.config.count")}: <span className="text-white font-medium">{genCount}</span>
          </label>
          <input
            type="range"
            min={20}
            max={150}
            step={5}
            value={genCount}
            onChange={(e) => setGenCount(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-0.5">
            <span>20</span>
            <span>150</span>
          </div>
        </div>

        {/* Card types */}
        <div>
          <p className="text-sm text-gray-400 mb-2">{t("flashcards.config.cardType")}</p>
          <div className="flex flex-wrap gap-2">
            {ALL_CARD_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleCardType(type)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  genCardTypes.has(type)
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {t(`flashcards.config.${type}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Topic filter */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t("flashcards.config.topic")}</label>
          <input
            type="text"
            value={genTopic}
            onChange={(e) => setGenTopic(e.target.value)}
            placeholder={t("flashcards.config.topicPlaceholder")}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 placeholder-gray-600"
          />
        </div>

        {/* Guidance */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t("flashcards.config.guidance")}</label>
          <input
            type="text"
            value={genGuidance}
            onChange={(e) => setGenGuidance(e.target.value)}
            placeholder={t("flashcards.config.guidancePlaceholder")}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 placeholder-gray-600"
          />
        </div>

        {genSuccess && (
          <p className="text-green-400 text-sm">{t("flashcards.generateSuccess")}</p>
        )}
        {genError && (
          <p className="text-red-400 text-sm">{genError}</p>
        )}
        <button
          onClick={handleGenerate}
          disabled={generating || genDocIds.size === 0}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {generating ? t("common.loading") : t("flashcards.config.generate")}
        </button>
      </div>
    </div>
  );
}
