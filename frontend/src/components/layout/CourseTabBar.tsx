import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getCourses, createCourse } from "../../api/courses";
import type { Course } from "../../types";
import { setLanguage } from "../../i18n";

const COLOR_OPTIONS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

export function CourseTabBar() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { courseId } = useParams<{ courseId: string }>();

  const [courses, setCourses] = useState<Course[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLOR_OPTIONS[0]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getCourses()
      .then(setCourses)
      .catch(() => {});
  }, []);

  const handleTabClick = (id: string) => {
    navigate(`/course/${id}/knowledge`);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const course = await createCourse({ name: newName.trim(), color: newColor });
      setCourses((prev) => [...prev, course]);
      setShowModal(false);
      setNewName("");
      setNewColor(COLOR_OPTIONS[0]);
      navigate(`/course/${course.id}/knowledge`);
    } catch {
      // silently fail; user can retry
    } finally {
      setCreating(false);
    }
  };

  const handleModalClose = () => {
    setShowModal(false);
    setNewName("");
    setNewColor(COLOR_OPTIONS[0]);
  };

  const toggleLanguage = () => {
    setLanguage(i18n.language === "he" ? "en" : "he");
  };

  return (
    <>
      <div className="bg-gray-800 border-b border-gray-700 flex items-center shrink-0 h-10 overflow-hidden">
        {/* Tabs — horizontally scrollable, never wrap */}
        <div className="flex items-end h-full overflow-x-auto flex-1 min-w-0 scrollbar-hide">
          {courses.map((course) => {
            const isActive = course.id === courseId;
            return (
              <button
                key={course.id}
                onClick={() => handleTabClick(course.id)}
                className={`flex items-center gap-1.5 px-3 h-full text-sm whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                  isActive
                    ? "bg-gray-700 text-white border-blue-500"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white border-transparent"
                }`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: course.color ?? "#3b82f6" }}
                />
                <span className="max-w-[140px] truncate">{course.name}</span>
              </button>
            );
          })}

          {/* New course "+" button */}
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center justify-center px-3 h-full text-gray-400 hover:text-white hover:bg-gray-700 shrink-0 text-lg leading-none transition-colors border-b-2 border-transparent"
            title={t("tabs.newCourse")}
          >
            +
          </button>
        </div>

        {/* Language toggle — always on the far right */}
        <button
          onClick={toggleLanguage}
          className="shrink-0 text-xs text-gray-400 hover:text-white border border-gray-600 rounded px-2 py-0.5 mx-2 transition-colors"
        >
          {i18n.language === "he" ? "EN" : "עב"}
        </button>
      </div>

      {/* New Course Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
          onClick={handleModalClose}
        >
          <div
            className="bg-gray-800 rounded-xl p-6 w-80 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-white font-semibold text-base mb-4">
              {t("tabs.newCourse")}
            </h2>

            {/* Course name */}
            <label className="block text-xs text-gray-400 mb-1">
              {t("tabs.courseName")}
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") handleModalClose();
              }}
              placeholder={t("tabs.namePlaceholder")}
              autoFocus
              className="w-full bg-gray-700 text-white text-sm rounded-lg px-3 py-2 mb-4 outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            />

            {/* Color picker */}
            <label className="block text-xs text-gray-400 mb-2">
              {t("tabs.courseColor")}
            </label>
            <div className="flex gap-2 mb-5">
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  onClick={() => setNewColor(color)}
                  className={`w-7 h-7 rounded-full transition-transform ${
                    newColor === color
                      ? "scale-125 ring-2 ring-white ring-offset-2 ring-offset-gray-800"
                      : "hover:scale-110"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleModalClose}
                className="text-sm text-gray-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                {t("common.create")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
