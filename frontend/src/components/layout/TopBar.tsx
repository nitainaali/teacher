import { useTranslation } from "react-i18next";
import { setLanguage } from "../../i18n";

export function TopBar() {
  const { i18n } = useTranslation();
  const current = i18n.language;

  const toggle = () => {
    setLanguage(current === "he" ? "en" : "he");
  };

  return (
    <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-end px-6 shrink-0">
      <button
        onClick={toggle}
        className="text-sm text-gray-400 hover:text-white border border-gray-700 rounded px-3 py-1 transition-colors"
      >
        {current === "he" ? "EN" : "עב"}
      </button>
    </header>
  );
}
