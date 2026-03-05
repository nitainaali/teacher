import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getProfile, upsertProfile } from "../api/profile";
import type { StudentProfile } from "../types";

export function SettingsPage() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<Partial<StudentProfile>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getProfile().then(setProfile).catch(() => {}); }, []);

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
