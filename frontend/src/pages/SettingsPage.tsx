import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getProfile, upsertProfile } from "../api/profile";
import type { StudentProfile } from "../types";

const TEACHING_STYLES = ["direct", "balanced", "supportive"] as const;
type TeachingStyle = typeof TEACHING_STYLES[number];

export function SettingsPage() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<Partial<StudentProfile>>({ teaching_style: "balanced" });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getProfile()
      .then((p) => setProfile(p))
      .catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await upsertProfile(profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">{t("settings.title")}</h1>

      <form onSubmit={handleSave} className="space-y-5">
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t("settings.fieldOfStudy")}</label>
          <input
            value={profile.field_of_study || ""}
            onChange={(e) => setProfile({ ...profile, field_of_study: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t("settings.institution")}</label>
          <input
            value={profile.institution || ""}
            onChange={(e) => setProfile({ ...profile, institution: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t("settings.yearOfStudy")}</label>
          <input
            type="number"
            min={1}
            max={6}
            value={profile.year_of_study || ""}
            onChange={(e) => setProfile({ ...profile, year_of_study: Number(e.target.value) })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Teaching Style */}
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-3">
          <div>
            <p className="text-sm font-medium text-gray-300">{t("settings.teachingStyle")}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t("settings.teachingStyleHint")}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {TEACHING_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setProfile({ ...profile, teaching_style: style })}
                className={`py-2.5 px-3 rounded-lg text-sm font-medium transition-colors text-center ${
                  (profile.teaching_style || "balanced") === style
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                }`}
              >
                <div>{t(`settings.styles.${style}`)}</div>
                <div className="text-xs font-normal opacity-70 mt-0.5 leading-tight">
                  {t(`settings.styles.${style}Desc`)}
                </div>
              </button>
            ))}
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t("settings.styleNotes")}</label>
            <textarea
              rows={2}
              value={profile.style_notes || ""}
              onChange={(e) => setProfile({ ...profile, style_notes: e.target.value })}
              placeholder={t("settings.styleNotesPlaceholder")}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600 resize-none"
            />
          </div>
        </div>

        {saved && <p className="text-green-400 text-sm">{t("settings.saved")}</p>}

        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
        >
          {saving ? t("common.loading") : t("common.save")}
        </button>
      </form>
    </div>
  );
}
