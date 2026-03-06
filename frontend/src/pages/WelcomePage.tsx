import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getCourses, createCourse } from "../api/courses";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export function WelcomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [showForm, setShowForm] = useState(false);
  const [courseName, setCourseName] = useState("");
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getCourses().then((courses) => {
      if (courses.length > 0) {
        navigate(`/course/${courses[0].id}/knowledge`, { replace: true });
      }
    });
  }, [navigate]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseName.trim() || creating) return;
    setCreating(true);
    try {
      const course = await createCourse({ name: courseName.trim(), color: selectedColor });
      navigate(`/course/${course.id}/knowledge`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-lg w-full text-center">
        {/* Icon */}
        <div className="text-7xl mb-6 select-none" aria-hidden="true">
          🎓
        </div>

        {/* Title */}
        <h1 className="text-4xl font-bold text-white mb-3">
          {t("welcome.title")}
        </h1>

        {/* Subtitle */}
        <p className="text-lg text-gray-400 mb-3">
          {t("welcome.subtitle")}
        </p>

        {/* Description */}
        <p className="text-sm text-gray-500 mb-8">
          {t("welcome.description")}
        </p>

        {/* CTA button — only visible when form is hidden */}
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-medium text-base transition-colors"
          >
            {t("welcome.createFirst")}
          </button>
        )}

        {/* Inline create course form */}
        {showForm && (
          <form
            onSubmit={handleCreate}
            className="mt-6 bg-gray-800 rounded-2xl p-6 text-left border border-gray-700"
          >
            {/* Course name */}
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {t("tabs.courseName")}
            </label>
            <input
              type="text"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              placeholder={t("tabs.namePlaceholder")}
              autoFocus
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-4"
            />

            {/* Color picker */}
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t("tabs.courseColor")}
            </label>
            <div className="flex gap-3 mb-6">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className="w-8 h-8 rounded-full transition-transform focus:outline-none"
                  style={{
                    backgroundColor: color,
                    transform: selectedColor === color ? "scale(1.25)" : "scale(1)",
                    boxShadow:
                      selectedColor === color ? `0 0 0 3px rgba(255,255,255,0.4)` : "none",
                  }}
                  aria-label={color}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={!courseName.trim() || creating}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg font-medium text-sm transition-colors"
              >
                {creating ? t("common.loading") : t("common.create")}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setCourseName(""); setSelectedColor(COLORS[0]); }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
