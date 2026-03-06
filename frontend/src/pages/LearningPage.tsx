import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface LearningCard {
  icon: string;
  titleKey: string;
  descKey: string;
  path: string;
}

export function LearningPage() {
  const { t } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();

  const cards: LearningCard[] = [
    {
      icon: "📄",
      titleKey: "learning.summary",
      descKey: "learning.summaryDesc",
      path: "/course/" + courseId + "/learning/summary",
    },
    {
      icon: "🃏",
      titleKey: "learning.flashcards",
      descKey: "learning.flashcardsDesc",
      path: "/course/" + courseId + "/learning/flashcards",
    },
    {
      icon: "❓",
      titleKey: "learning.quizzes",
      descKey: "learning.quizzesDesc",
      path: "/course/" + courseId + "/learning/quizzes",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">{t("learning.title")}</h2>
        <p className="text-sm text-gray-400 mt-1">{t("learning.subtitle")}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((card) => (
          <button
            key={card.titleKey}
            onClick={() => navigate(card.path)}
            className="bg-gray-800 rounded-xl p-6 border border-gray-700 hover:bg-gray-700 hover:border-gray-500 cursor-pointer transition-colors text-left group"
          >
            <div className="text-4xl mb-4 select-none group-hover:scale-110 transition-transform inline-block">
              {card.icon}
            </div>
            <h3 className="text-white font-semibold text-base mb-1">{t(card.titleKey)}</h3>
            <p className="text-gray-400 text-sm leading-relaxed">{t(card.descKey)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}