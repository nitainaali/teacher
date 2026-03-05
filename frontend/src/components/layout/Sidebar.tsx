import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

const navItems = [
  { key: "nav.dashboard", to: "/" },
  { key: "nav.courses", to: "/courses" },
  { key: "nav.documents", to: "/documents/upload" },
  { key: "nav.homework", to: "/homework" },
  { key: "nav.flashcards", to: "/flashcards" },
  { key: "nav.quizzes", to: "/quizzes" },
  { key: "nav.exams", to: "/exams" },
  { key: "nav.transcripts", to: "/transcripts" },
  { key: "nav.progress", to: "/progress" },
  { key: "nav.chat", to: "/chat" },
  { key: "nav.settings", to: "/settings" },
  { key: "nav.schedule", to: "/schedule" },
];

export function Sidebar() {
  const { t } = useTranslation();

  return (
    <aside className="w-56 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col h-screen sticky top-0">
      <div className="px-4 py-5 border-b border-gray-800">
        <span className="text-blue-500 font-bold text-lg">{t("app.title")}</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-3">
        {navItems.map(({ key, to }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `block px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? "bg-blue-600/20 text-blue-400 font-medium"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`
            }
          >
            {t(key)}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
