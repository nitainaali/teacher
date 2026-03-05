import { useTranslation } from "react-i18next";

export function ExamsPage() {
  const { t } = useTranslation();
  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">{t("exams.title")}</h1>
      <p className="text-gray-500">{t("exams.empty")}</p>
    </div>
  );
}
