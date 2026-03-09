import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getCourses, createCourse, updateCourse, reorderCourses } from "../../api/courses";
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
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLOR_OPTIONS[0]);
  const [creating, setCreating] = useState(false);

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Drag-to-reorder
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (attempt = 1) => {
      try {
        const data = await getCourses();
        if (!cancelled) {
          setCourses(data);
          setLoadingCourses(false);
        }
      } catch {
        if (!cancelled && attempt < 4) {
          setTimeout(() => load(attempt + 1), 1500);
        } else if (!cancelled) {
          setLoadingCourses(false); // give up after 3 retries, show "+" button
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Close color picker on outside click
  useEffect(() => {
    if (!showColorPicker) return;
    const handler = () => setShowColorPicker(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showColorPicker]);

  const handleTabClick = (id: string) => {
    if (editingId === id) return;
    if (id === courseId && !editingId) {
      // Click on already-active tab → enter inline edit mode
      const course = courses.find((c) => c.id === id);
      if (course) {
        setEditName(course.name);
        setEditingId(id);
      }
      return;
    }
    navigate(`/course/${id}/knowledge`);
  };

  const handleEditSave = async (id: string) => {
    const trimmed = editName.trim();
    if (trimmed) {
      try {
        const updated = await updateCourse(id, { name: trimmed });
        setCourses((prev) => prev.map((c) => (c.id === id ? { ...c, name: updated.name } : c)));
      } catch {
        /* silently fail */
      }
    }
    setEditingId(null);
  };

  const handleColorChange = async (id: string, color: string) => {
    try {
      const updated = await updateCourse(id, { color });
      setCourses((prev) => prev.map((c) => (c.id === id ? { ...c, color: updated.color } : c)));
    } catch {
      /* silently fail */
    }
    setShowColorPicker(null);
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragSourceId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragSourceId) setDragOverId(id);
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragSourceId || dragSourceId === targetId) {
      setDragSourceId(null);
      setDragOverId(null);
      return;
    }
    const reordered = [...courses];
    const srcIdx = reordered.findIndex((c) => c.id === dragSourceId);
    const tgtIdx = reordered.findIndex((c) => c.id === targetId);
    const [removed] = reordered.splice(srcIdx, 1);
    reordered.splice(tgtIdx, 0, removed);
    setCourses(reordered);
    setDragSourceId(null);
    setDragOverId(null);
    try {
      await reorderCourses(reordered.map((c) => c.id));
    } catch {
      /* silently fail */
    }
  };

  const handleDragEnd = () => {
    setDragSourceId(null);
    setDragOverId(null);
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
      /* silently fail */
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
        {/* Tabs — horizontally scrollable */}
        <div className="flex items-end h-full overflow-x-auto flex-1 min-w-0 scrollbar-hide">
          {loadingCourses && courses.length === 0 && (
            <div className="flex items-center px-3 h-full">
              <span className="text-gray-500 text-xs animate-pulse">···</span>
            </div>
          )}
          {courses.map((course) => {
            const isActive = course.id === courseId;
            const isDragging = dragSourceId === course.id;
            const isOver = dragOverId === course.id;

            return (
              <div
                key={course.id}
                className="relative flex-shrink-0"
                draggable
                onDragStart={(e) => handleDragStart(e, course.id)}
                onDragOver={(e) => handleDragOver(e, course.id)}
                onDrop={(e) => handleDrop(e, course.id)}
                onDragEnd={handleDragEnd}
              >
                <button
                  onClick={() => handleTabClick(course.id)}
                  title={isActive && !editingId ? "Click to edit name" : undefined}
                  className={`flex items-center gap-1.5 px-3 h-10 text-sm whitespace-nowrap transition-colors border-b-2 ${
                    isActive
                      ? "bg-gray-700 text-white border-blue-500"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white border-transparent"
                  } ${isDragging ? "opacity-40" : ""} ${isOver ? "border-l-2 border-l-blue-400" : ""}`}
                >
                  {/* Color dot — click to open color picker (active tab only) */}
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${isActive ? "cursor-pointer hover:ring-2 hover:ring-white/50 hover:ring-offset-1 hover:ring-offset-gray-700" : ""}`}
                    style={{ backgroundColor: course.color ?? "#3b82f6" }}
                    onClick={(e) => {
                      if (isActive) {
                        e.stopPropagation();
                        setShowColorPicker(showColorPicker === course.id ? null : course.id);
                      }
                    }}
                  />

                  {/* Tab name — becomes input in edit mode */}
                  {editingId === course.id ? (
                    <input
                      ref={editInputRef}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => handleEditSave(course.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleEditSave(course.id);
                        if (e.key === "Escape") { setEditingId(null); }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-gray-600 text-white text-sm rounded px-1 py-0 outline-none focus:ring-1 focus:ring-blue-400 w-28 max-w-[140px]"
                    />
                  ) : (
                    <span className="max-w-[140px] truncate">{course.name}</span>
                  )}
                </button>

                {/* Color picker popover */}
                {showColorPicker === course.id && (
                  <div
                    className="absolute top-full left-0 mt-1 bg-gray-700 rounded-lg p-2 flex gap-1.5 shadow-xl z-50 border border-gray-600"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {COLOR_OPTIONS.map((color) => (
                      <button
                        key={color}
                        onClick={() => handleColorChange(course.id, color)}
                        className={`w-5 h-5 rounded-full transition-transform hover:scale-125 ${
                          course.color === color
                            ? "ring-2 ring-white ring-offset-1 ring-offset-gray-700 scale-110"
                            : ""
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                )}
              </div>
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

        {/* Language toggle */}
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
