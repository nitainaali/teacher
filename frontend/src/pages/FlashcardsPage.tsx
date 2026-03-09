import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import {
  getDecks,
  getDeckCards,
  generateFlashcards,
  reviewFlashcard,
  renameDeck,
  deleteDeck,
} from "../api/flashcards";
import type { FlashcardDeck } from "../api/flashcards";
import { MarkdownContent } from "../components/MarkdownContent";
import { RecommendationsPanel } from "../components/RecommendationsPanel";
import type { Flashcard } from "../types";

type Mode = "config" | "review";
type CountPreset = "short" | "medium" | "long";
type Difficulty = "easy" | "medium" | "hard";

const ALL_CARD_TYPES = [
  "comprehension",
  "memorization",
  "application",
  "tricks",
  "confusion",
] as const;
type CardType = (typeof ALL_CARD_TYPES)[number];

const COUNT_PRESETS: Record<CountPreset, number> = {
  short: 25,
  medium: 60,
  long: 100,
};

export function FlashcardsPage() {
  const { t, i18n } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();

  const [mode, setMode] = useState<Mode>("config");
  const [activeDeck, setActiveDeck] = useState<FlashcardDeck | null>(null);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Deck list
  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [loadingDecks, setLoadingDecks] = useState(false);

  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Generate config
  const [countPreset, setCountPreset] = useState<CountPreset>("medium");
  const [genCount, setGenCount] = useState(60);
  const [genDifficulty, setGenDifficulty] = useState<Difficulty>("medium");
  const [genCardTypes, setGenCardTypes] = useState<Set<CardType>>(new Set(ALL_CARD_TYPES));
  const [genTopic, setGenTopic] = useState("");
  const [genGuidance, setGenGuidance] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const fetchDecks = () => {
    if (!courseId) return;
    setLoadingDecks(true);
    getDecks(courseId)
      .then(setDecks)
      .catch(() => {})
      .finally(() => setLoadingDecks(false));
  };

  useEffect(() => {
    fetchDecks();
  }, [courseId]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleSetPreset = (preset: CountPreset) => {
    setCountPreset(preset);
    setGenCount(COUNT_PRESETS[preset]);
  };

  const handleCountInput = (val: number) => {
    const clamped = Math.max(5, Math.min(200, val));
    setGenCount(clamped);
    if (clamped <= 40) setCountPreset("short");
    else if (clamped <= 80) setCountPreset("medium");
    else setCountPreset("long");
  };

  const toggleCardType = (type: CardType) => {
    setGenCardTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type) && next.size > 1) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleGenerate = async () => {
    if (!courseId) return;
    setGenerating(true);
    setGenError(null);
    try {
      const cardTypeParam =
        genCardTypes.size === 1 ? Array.from(genCardTypes)[0] : "mixed";
      const deck = await generateFlashcards(
        courseId,
        genCount,
        cardTypeParam as string,
        genDifficulty,
        genTopic.trim() || undefined,
        genGuidance.trim() || undefined,
        i18n.language,
      );
      setDecks((prev) => [deck, ...prev]);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setGenError(
        typeof detail === "string"
          ? detail
          : err instanceof Error
          ? err.message
          : t("common.error"),
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleStartDeck = async (deck: FlashcardDeck) => {
    try {
      const deckCards = await getDeckCards(deck.id);
      setCards(deckCards);
      setActiveDeck(deck);
      setIndex(0);
      setFlipped(false);
      setMode("review");
    } catch {
      /* silently fail */
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

  const handleRenameStart = (deck: FlashcardDeck) => {
    setRenamingId(deck.id);
    setRenameValue(deck.name);
  };

  const handleRenameSave = async (deckId: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      try {
        const updated = await renameDeck(deckId, trimmed);
        setDecks((prev) => prev.map((d) => (d.id === deckId ? updated : d)));
      } catch {
        /* silently fail */
      }
    }
    setRenamingId(null);
  };

  const handleDeleteDeck = async (deckId: string) => {
    try {
      await deleteDeck(deckId);
      setDecks((prev) => prev.filter((d) => d.id !== deckId));
    } catch {
      /* silently fail */
    }
  };

  const backToConfig = () => {
    setMode("config");
    setCards([]);
    setActiveDeck(null);
    setIndex(0);
    setFlipped(false);
  };

  // ── Review mode ──────────────────────────────────────────────────────────────
  if (mode === "review") {
    const done = index >= cards.length;
    const current = cards[index];

    return (
      <div className="max-w-xl mx-auto">
        <button
          onClick={backToConfig}
          className="text-sm text-gray-400 hover:text-white mb-4 flex items-center gap-1 transition-colors"
        >
          ← {t("common.back")}
        </button>

        {activeDeck && (
          <p className="text-xs text-gray-500 mb-4">
            {activeDeck.name} · {t("flashcards.deckCards", { n: activeDeck.card_count })}
          </p>
        )}

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
              {index + 1} / {cards.length}
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

  // ── Config mode ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Recommendations */}
      {courseId && (
        <RecommendationsPanel
          courseId={courseId}
          onTopicSelect={(topic) => setGenTopic(topic)}
        />
      )}

      {/* Generate config card */}
      <div className="bg-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold">{t("flashcards.config.generateTitle")}</h2>

        {/* Count presets */}
        <div>
          <p className="text-sm text-gray-400 mb-2">{t("flashcards.config.count")}</p>
          <div className="flex gap-2 mb-2">
            {(["short", "medium", "long"] as CountPreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleSetPreset(preset)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  countPreset === preset
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {t(`flashcards.${preset}`)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{t("flashcards.exactCount")}:</span>
            <input
              type="number"
              min={5}
              max={200}
              value={genCount}
              onChange={(e) => handleCountInput(Number(e.target.value))}
              className="w-20 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500 text-center"
            />
          </div>
        </div>

        {/* Difficulty */}
        <div>
          <p className="text-sm text-gray-400 mb-2">{t("flashcards.difficulty")}</p>
          <div className="flex gap-2">
            {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setGenDifficulty(d)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  genDifficulty === d
                    ? d === "easy"
                      ? "bg-green-700 text-white"
                      : d === "hard"
                      ? "bg-red-700 text-white"
                      : "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {t(`flashcards.${d}`)}
              </button>
            ))}
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

        {/* Topic */}
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

        {genError && <p className="text-red-400 text-sm">{genError}</p>}

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {generating ? t("common.loading") : t("flashcards.config.generate")}
        </button>
      </div>

      {/* Deck History */}
      <div>
        <h2 className="text-base font-semibold mb-3">{t("flashcards.deckHistory")}</h2>
        {loadingDecks ? (
          <p className="text-sm text-gray-500">{t("common.loading")}</p>
        ) : decks.length === 0 ? (
          <p className="text-sm text-gray-500">{t("flashcards.empty")}</p>
        ) : (
          <div className="space-y-2">
            {decks.map((deck) => (
              <div
                key={deck.id}
                className="bg-gray-800 rounded-xl px-4 py-3 border border-gray-700 flex items-center gap-3 hover:border-gray-600 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  {renamingId === deck.id ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => handleRenameSave(deck.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameSave(deck.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="bg-gray-700 text-white text-sm rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-blue-400 w-full"
                    />
                  ) : (
                    <p className="text-white text-sm font-medium truncate">{deck.name}</p>
                  )}
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-gray-500">
                    <span>{t("flashcards.deckCards", { n: deck.card_count })}</span>
                    {deck.topic && <span>· {deck.topic}</span>}
                    <span>·</span>
                    <span
                      className={
                        deck.difficulty === "easy"
                          ? "text-green-500"
                          : deck.difficulty === "hard"
                          ? "text-red-400"
                          : "text-blue-400"
                      }
                    >
                      {t(`flashcards.${deck.difficulty}`)}
                    </span>
                    <span>· {new Date(deck.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleStartDeck(deck)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg font-medium transition-colors"
                  >
                    {t("flashcards.startDeck")}
                  </button>
                  <button
                    onClick={() => handleRenameStart(deck)}
                    className="p-1.5 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700"
                    title={t("flashcards.renameDeck")}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => handleDeleteDeck(deck.id)}
                    className="p-1.5 text-gray-500 hover:text-red-400 transition-colors rounded-lg hover:bg-gray-700"
                    title={t("flashcards.deleteDeck")}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
