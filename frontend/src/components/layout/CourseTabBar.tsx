import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getCourses, createCourse, updateCourse, reorderCourses, deleteCourse } from "../../api/courses";
import { getUsers, deleteMyUser, deleteUser, type User } from "../../api/users";
import { getStorageStats, cleanupStorage, type StorageStats } from "../../api/admin";
import type { Course } from "../../types";
import { setLanguage } from "../../i18n";
import { useUser } from "../../context/UserContext";

const AVATAR_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899",
];

function avatarColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

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
  const { currentUser, clearUser } = useUser();

  const [courses, setCourses] = useState<Course[]>([]);
  const coursesRef = useRef<Course[]>([]); // mirror for use inside async closures
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

  // Delete course confirmation
  const [showDeleteCourseId, setShowDeleteCourseId] = useState<string | null>(null);
  const [deletingCourse, setDeletingCourse] = useState(false);

  // Delete self confirmation
  const [showDeleteSelf, setShowDeleteSelf] = useState(false);
  const [deletingSelf, setDeletingSelf] = useState(false);

  // Admin: manage users modal
  const [showManageUsers, setShowManageUsers] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  // Admin: storage management
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [cleaningStorage, setCleaningStorage] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (attempt = 1) => {
      try {
        const data = await getCourses();
        if (!cancelled) {
          setCourses(data);
          coursesRef.current = data;
          setLoadingCourses(false);
        }
      } catch {
        if (!cancelled && attempt < 4) {
          setTimeout(() => load(attempt + 1), 1500);
        } else if (!cancelled) {
          setLoadingCourses(false); // give up on this round, show "+" button
          // If we still have no courses (backend may be restarting), keep probing every 5 s
          // so the tab bar recovers automatically once the backend comes back up.
          if (coursesRef.current.length === 0) {
            setTimeout(() => {
              if (!cancelled) {
                setLoadingCourses(true);
                load(1);
              }
            }, 5000);
          }
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

  const handleDeleteCourseConfirm = async () => {
    if (!showDeleteCourseId || deletingCourse) return;
    setDeletingCourse(true);
    try {
      await deleteCourse(showDeleteCourseId);
      const remaining = courses.filter((c) => c.id !== showDeleteCourseId);
      setCourses(remaining);
      setShowDeleteCourseId(null);
      setEditingId(null);
      if (remaining.length > 0) {
        navigate(`/course/${remaining[0].id}/knowledge`);
      } else {
        navigate("/");
      }
    } catch {
      /* silently fail */
    } finally {
      setDeletingCourse(false);
    }
  };

  const handleDeleteSelfConfirm = async () => {
    if (deletingSelf) return;
    setDeletingSelf(true);
    try {
      await deleteMyUser();
      clearUser();
    } catch {
      /* silently fail */
    } finally {
      setDeletingSelf(false);
      setShowDeleteSelf(false);
    }
  };

  const handleOpenManageUsers = async () => {
    setShowManageUsers(true);
    setCleanupMsg(null);
    setLoadingUsers(true);
    setLoadingStorage(true);
    try {
      const [users, stats] = await Promise.all([getUsers(), getStorageStats()]);
      setAllUsers(users);
      setStorageStats(stats);
    } catch {
      /* silently fail */
    } finally {
      setLoadingUsers(false);
      setLoadingStorage(false);
    }
  };

  const handleCleanupStorage = async () => {
    setCleaningStorage(true);
    setCleanupMsg(null);
    try {
      const result = await cleanupStorage();
      const stats = await getStorageStats();
      setStorageStats(stats);
      setCleanupMsg(t("admin.cleanupDone", { files: result.deleted_files, mb: result.freed_mb.toFixed(1) }));
    } catch {
      setCleanupMsg(t("admin.cleanupError"));
    } finally {
      setCleaningStorage(false);
    }
  };

  const handleDeleteUserConfirm = async (userId: string) => {
    if (deletingUserId) return;
    setDeletingUserId(userId);
    try {
      await deleteUser(userId);
      setAllUsers((prev) => prev.filter((u) => u.id !== userId));
      // If admin deleted themselves, log out
      if (userId === currentUser?.id) {
        clearUser();
      }
    } catch {
      /* silently fail */
    } finally {
      setDeletingUserId(null);
    }
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

  const courseToDelete = showDeleteCourseId ? courses.find((c) => c.id === showDeleteCourseId) : null;

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

                  {/* Delete course button — only visible in edit mode */}
                  {editingId === course.id && (
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault(); // prevent onBlur on the input from firing first
                        e.stopPropagation();
                        setEditingId(null);
                        setShowDeleteCourseId(course.id);
                      }}
                      title={t("tabs.deleteCourse")}
                      className="w-5 h-5 flex items-center justify-center text-gray-500 hover:text-red-400 shrink-0 text-xs transition-colors"
                    >
                      🗑
                    </button>
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

        {/* Right side: user avatar + manage users (admin) + delete self + logout + language toggle */}
        <div className="shrink-0 flex items-center gap-1.5 mx-2">
          {currentUser && (
            <>
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: avatarColor(currentUser.username) }}
              >
                {currentUser.username.trim().charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-gray-400 max-w-[5rem] truncate hidden sm:block">
                {currentUser.username}
              </span>
              {/* Admin: manage users */}
              {currentUser.is_admin && (
                <button
                  onClick={handleOpenManageUsers}
                  title={t("auth.manageUsers")}
                  className="text-xs text-gray-500 hover:text-white border border-gray-600 rounded px-1.5 py-0.5 transition-colors"
                >
                  👥
                </button>
              )}
              {/* Delete own account */}
              <button
                onClick={() => setShowDeleteSelf(true)}
                title={t("auth.deleteAccount")}
                className="text-xs text-gray-500 hover:text-red-400 border border-gray-600 rounded px-1.5 py-0.5 transition-colors"
              >
                🗑
              </button>
              <button
                onClick={clearUser}
                title={t("auth.logout")}
                className="text-xs text-gray-500 hover:text-white border border-gray-600 rounded px-1.5 py-0.5 transition-colors"
              >
                ↩
              </button>
            </>
          )}
          <button
            onClick={toggleLanguage}
            className="text-xs text-gray-400 hover:text-white border border-gray-600 rounded px-2 py-0.5 transition-colors"
          >
            {i18n.language === "he" ? "EN" : "עב"}
          </button>
        </div>
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

      {/* Delete Course Confirmation Modal */}
      {showDeleteCourseId && courseToDelete && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
          onClick={() => setShowDeleteCourseId(null)}
        >
          <div
            className="bg-gray-800 rounded-xl p-6 w-80 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-white font-semibold text-base mb-3">
              {t("tabs.deleteCourse")}
            </h2>
            <p className="text-gray-300 text-sm mb-5">
              {t("tabs.deleteCourseConfirm", { name: courseToDelete.name })}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteCourseId(null)}
                className="text-sm text-gray-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDeleteCourseConfirm}
                disabled={deletingCourse}
                className="text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                {deletingCourse ? "…" : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Self Confirmation Modal */}
      {showDeleteSelf && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
          onClick={() => setShowDeleteSelf(false)}
        >
          <div
            className="bg-gray-800 rounded-xl p-6 w-80 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-white font-semibold text-base mb-3">
              {t("auth.deleteAccount")}
            </h2>
            <p className="text-gray-300 text-sm mb-5">
              {t("auth.deleteAccountConfirm")}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteSelf(false)}
                className="text-sm text-gray-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDeleteSelfConfirm}
                disabled={deletingSelf}
                className="text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                {deletingSelf ? "…" : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin: Manage Users Modal */}
      {showManageUsers && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
          onClick={() => setShowManageUsers(false)}
        >
          <div
            className="bg-gray-800 rounded-xl p-6 w-80 shadow-2xl max-h-96 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold text-base">
                {t("auth.manageUsers")}
              </h2>
              <button
                onClick={() => setShowManageUsers(false)}
                className="text-gray-400 hover:text-white text-lg leading-none"
              >
                ×
              </button>
            </div>

            {loadingUsers ? (
              <p className="text-gray-400 text-sm text-center py-4">{t("common.loading")}</p>
            ) : (
              <div className="overflow-y-auto flex-1 space-y-2">
                {allUsers.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 bg-gray-700/50 rounded-lg px-3 py-2"
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ backgroundColor: avatarColor(user.username) }}
                    >
                      {user.username.trim().charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm truncate">{user.username}</div>
                      {user.is_admin && (
                        <div className="text-xs text-blue-400">{t("login.admin")}</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteUserConfirm(user.id)}
                      disabled={deletingUserId === user.id}
                      title={t("auth.deleteUser")}
                      className="text-gray-500 hover:text-red-400 disabled:opacity-50 text-sm transition-colors shrink-0"
                    >
                      {deletingUserId === user.id ? "…" : "×"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Storage management section */}
            <div className="mt-4 pt-4 border-t border-gray-700">
              <div className="text-gray-400 text-xs font-medium mb-2 uppercase tracking-wide">
                {t("admin.storage")}
              </div>
              {loadingStorage ? (
                <p className="text-gray-500 text-xs">{t("common.loading")}</p>
              ) : storageStats ? (
                <div className="space-y-1 text-xs text-gray-400">
                  <div className="flex justify-between">
                    <span>{t("admin.totalFiles")}</span>
                    <span className="text-white">{storageStats.total_files} ({storageStats.total_size_mb} MB)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t("admin.orphanedFiles")}</span>
                    <span className={
                      (storageStats.orphaned_personal + storageStats.orphaned_shared) > 0
                        ? "text-yellow-400 font-medium"
                        : "text-green-400"
                    }>
                      {storageStats.orphaned_personal + storageStats.orphaned_shared} ({(storageStats.orphaned_personal_size_mb + storageStats.orphaned_shared_size_mb).toFixed(1)} MB)
                    </span>
                  </div>
                </div>
              ) : null}

              <button
                onClick={handleCleanupStorage}
                disabled={cleaningStorage || loadingStorage}
                className="mt-2 w-full text-xs bg-red-900/40 hover:bg-red-800/50 text-red-300 hover:text-red-200 disabled:opacity-50 rounded-lg px-3 py-1.5 transition-colors"
              >
                {cleaningStorage ? "…" : t("admin.cleanupBtn")}
              </button>

              {cleanupMsg && (
                <p className="mt-1.5 text-xs text-center text-green-400">{cleanupMsg}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
