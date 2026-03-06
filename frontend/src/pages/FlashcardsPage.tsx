import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { getFlashcards, generateFlashcards, reviewFlashcard } from "../api/flashcards";
import { getDocuments } from "../api/documents";
import type { Flashcard } from "../types";
import type { Document } from "../types";

type Mode = "config" | "review";
type CardType = "mixed" | "comprehension" | "memorization" | "application";
type SessionLength = 5 | 10 | 20 | "all";

export function FlashcardsPage() {
  const { t } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();

  const [mode, setMode] = useState<Mode>("config");
  const [cardType, setCardType] = useState<CardType>("mixed");
  const [sessionLength, setSessionLength] = useState<SessionLength>(10);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [docs, setDocs] = useState<Document[]>([]);
  const [genDocId, setGenDocId] = useState("");
  const [genCount, setGenCount] = useState(10);
  const [genCardType, setGenCardType] = useState<CardType>("mixed");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (courseId) {
      getDocuments(courseId).then((ds) => {
        setDocs(ds);
        if (ds.length > 0) setGenDocId(ds[0].id);
      });
    }
  }, [courseId]);

  const startSession = async () => {
    if (!courseId) return;
    setReviewLoading(true);
    try {
      const all = await getFlashcards(courseId, true);
      const limited = sessionLength === "all" ? all : all.slice(0, sessionLength as number);
      setCards(limited);
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
    if (!courseId || !genDocId) return;
    setGenerating(true);
    try {
      await generateFlashcards(genDocId, courseId, genCount, genCardType);
    } finally {
      setGenerating(false);
    }
  };

  const backToConfig = () => {
    setMode("config");
    setCards([]);
    setIndex(0);
    setFlipped(false);
  };

  const cardTypeOptions: { value: CardType; label: string }[] = [
    { value: "mixed", label: t("flashcards.config.mixed") },
    { value: "comprehension", label: t("flashcards.config.comprehension") },
    { value: "memorization", label: t("flashcards.config.memorization") },
    { value: "application", label: t("flashcards.config.application") },
  ];

  const sessionLengthOptions: { value: SessionLength; label: string }[] = [
    { value: 5, label: t("flashcards.config.cards5") },
    { value: 10, label: t("flashcards.config.cards10") },
    { value: 20, label: t("flashcards.config.cards20") },
    { value: "all", label: t("flashcards.config.cardsAll") },
  ];

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
            </p>
            <div
              className="bg-gray-800 rounded-xl p-8 min-h-48 flex items-center justify-center cursor-pointer border border-gray-700 hover:border-gray-600 transition-colors"
              onClick={() => setFlipped(!flipped)}
            >
              <p className="text-center text-lg">
                {flipped ? current.back : current.front}
              </p>
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
                  { quality: 2, label: t("flashcards.quality.hard"), color: "bg-orange-700 hover:bg-orange-600" },
                  { quality: 4, label: t("flashcards.quality.good"), color: "bg-green-700 hover:bg-green-600" },
                  { quality: 5, label: t("flashcards.quality.easy"), color: "bg-blue-700 hover:bg-blue-600" },
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

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t("flashcards.config.title")}</h1>

      <div className="space-y-4 mb-6">
        <div>
          <p className="text-sm text-gray-400 mb-2">{t("flashcards.config.cardType")}</p>
          <div className="flex flex-wrap gap-2">
            {cardTypeOptions.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setCardType(value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  cardType === value
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm text-gray-400 mb-2">{t("flashcards.config.sessionLength")}</p>
          <div className="flex gap-2">
            {sessionLengthOptions.map(({ value, label }) => (
              <button
                key={String(value)}
                onClick={() => setSessionLength(value)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  sessionLength === value
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={startSession}
          disabled={reviewLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {reviewLoading ? t("common.loading") : t("flashcards.config.startSession")}
        </button>
      </div>

      <div className="bg-gray-800 rounded-xl p-4 space-y-4">
        <h2 className="text-base font-semibold">{t("flashcards.config.generateTitle")}</h2>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            {t("flashcards.config.document")}
          </label>
          <select
            value={genDocId}
            onChange={(e) => setGenDocId(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            {docs.length === 0 && (
              <option value="">{t("flashcards.config.noDocs")}</option>
            )}
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.original_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            {t("flashcards.config.count")}
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={genCount}
            onChange={(e) => setGenCount(Number(e.target.value))}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <p className="text-sm text-gray-400 mb-2">{t("flashcards.config.cardType")}</p>
          <div className="flex flex-wrap gap-2">
            {cardTypeOptions.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setGenCardType(value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  genCardType === value
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating || !genDocId}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {generating ? t("common.loading") : t("flashcards.config.generate")}
        </button>
      </div>
    </div>
  );
}
