import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getFlashcards, reviewFlashcard } from "../api/flashcards";
import type { Flashcard } from "../types";

export function FlashcardsPage() {
  const { t } = useTranslation();
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    getFlashcards(undefined, true)
      .then((cs) => { setCards(cs); setIndex(0); setFlipped(false); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const current = cards[index];

  const handleReview = async (quality: number) => {
    if (!current) return;
    await reviewFlashcard(current.id, quality);
    if (index + 1 < cards.length) {
      setIndex(index + 1);
      setFlipped(false);
    } else {
      load();
    }
  };

  if (loading) return <p className="text-gray-500">{t("common.loading")}</p>;

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t("flashcards.title")}</h1>
      {cards.length === 0 ? (
        <p className="text-gray-500">{t("flashcards.empty")}</p>
      ) : (
        <div>
          <p className="text-sm text-gray-400 mb-4">{index + 1} / {cards.length} — {t("flashcards.due")}</p>
          <div
            className="bg-gray-800 rounded-xl p-8 min-h-48 flex items-center justify-center cursor-pointer border border-gray-700 hover:border-gray-600 transition-colors"
            onClick={() => setFlipped(!flipped)}
          >
            <p className="text-center text-lg">{flipped ? current.back : current.front}</p>
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
