import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getCourses, createCourse, deleteCourse } from "../api/courses";
import type { Course } from "../types";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export function CoursesPage() {
  const { t } = useTranslation();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    getCourses()
      .then(setCourses)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createCourse({ name, description, color });
      setName(""); setDescription(""); setColor(COLORS[0]); setShowForm(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteCourse(id);
    load();
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("courses.title")}</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {t("courses.create")}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-gray-800 rounded-xl p-5 mb-6 space-y-4"
        >
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t("courses.name")}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("courses.namePlaceholder")}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t("courses.description")}</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("courses.descriptionPlaceholder")}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">{t("courses.color")}</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform ${color === c ? "scale-125 ring-2 ring-white" : ""}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {saving ? t("common.loading") : t("common.create")}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-gray-500">{t("common.loading")}</p>
      ) : courses.length === 0 ? (
        <p className="text-gray-500">{t("courses.empty")}</p>
      ) : (
        <div className="space-y-3">
          {courses.map((course) => (
            <div
              key={course.id}
              className="bg-gray-800 rounded-xl p-4 flex items-center justify-between border border-gray-700 hover:border-gray-600 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: course.color || "#3b82f6" }}
                />
                <div>
                  <p className="font-medium">{course.name}</p>
                  {course.description && (
                    <p className="text-sm text-gray-400">{course.description}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleDelete(course.id)}
                className="text-gray-500 hover:text-red-400 text-sm transition-colors"
              >
                {t("common.delete")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
