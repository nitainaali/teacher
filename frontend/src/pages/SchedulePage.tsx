import { useTranslation } from "react-i18next";

export function SchedulePage() {
  const { t } = useTranslation();
  return (
    <div className="max-w-xl mx-auto text-center pt-20">
      <h1 className="text-2xl font-bold mb-4">{t("schedule.title")}</h1>
      <p className="text-gray-400">{t("schedule.comingSoon")}</p>
      <p className="text-gray-600 text-sm mt-2">{t("common.notImplemented")}</p>
    </div>
  );
}
