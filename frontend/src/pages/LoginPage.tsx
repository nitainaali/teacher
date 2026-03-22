import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getUsers, createUser, type User } from "../api/users";
import { useUser } from "../context/UserContext";
import { createCourse } from "../api/courses";
import { setCurrentUserId } from "../api/client";

const AVATAR_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16",
];

const COLOR_OPTIONS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

function avatarColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function avatarInitial(username: string): string {
  return username.trim().charAt(0).toUpperCase();
}

export function LoginPage() {
  const { t } = useTranslation();
  const { setUser } = useUser();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // First-course step
  const [pendingNewUser, setPendingNewUser] = useState<User | null>(null);
  const [firstCourseName, setFirstCourseName] = useState("");
  const [firstCourseColor, setFirstCourseColor] = useState(COLOR_OPTIONS[0]);
  const [creatingCourse, setCreatingCourse] = useState(false);

  useEffect(() => {
    setLoading(true);
    getUsers()
      .then(setUsers)
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (user: User) => {
    setUser(user);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newUsername.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const user = await createUser(name);
      setUsers((prev) => [...prev, user]);
      setShowNewUser(false);
      setNewUsername("");
      // Set the API header so we can create the first course
      setCurrentUserId(user.id);
      // Show first-course naming step instead of logging in immediately
      setPendingNewUser(user);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : t("login.createError"));
    } finally {
      setCreating(false);
    }
  };

  const handleCreateFirstCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = firstCourseName.trim();
    if (!name || !pendingNewUser || creatingCourse) return;
    setCreatingCourse(true);
    try {
      await createCourse({ name, color: firstCourseColor });
      setUser(pendingNewUser);
    } catch {
      // Even if course creation fails, log the user in — they can create a course later
      setUser(pendingNewUser);
    } finally {
      setCreatingCourse(false);
    }
  };

  const handleCancelFirstCourse = () => {
    setPendingNewUser(null);
    setFirstCourseName("");
    setFirstCourseColor(COLOR_OPTIONS[0]);
    setCurrentUserId(null);
  };

  // First-course naming screen
  if (pendingNewUser) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">📚</div>
            <h1 className="text-2xl font-bold text-white mb-2">
              {t("login.nameFirstCourse")}
            </h1>
            <p className="text-gray-400 text-sm">
              {pendingNewUser.username}
            </p>
          </div>

          <form onSubmit={handleCreateFirstCourse} className="bg-gray-800 rounded-xl px-5 py-5 space-y-4">
            <input
              autoFocus
              type="text"
              value={firstCourseName}
              onChange={(e) => setFirstCourseName(e.target.value)}
              placeholder={t("login.firstCoursePlaceholder")}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
              maxLength={80}
            />

            <div>
              <p className="text-xs text-gray-400 mb-2">{t("tabs.courseColor")}</p>
              <div className="flex gap-2">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setFirstCourseColor(color)}
                    className={`w-7 h-7 rounded-full transition-transform ${
                      firstCourseColor === color
                        ? "scale-125 ring-2 ring-white ring-offset-2 ring-offset-gray-800"
                        : "hover:scale-110"
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={creatingCourse || !firstCourseName.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-3 py-2.5 text-sm font-medium"
              >
                {creatingCourse ? t("common.loading") : t("login.createAndEnter")}
              </button>
              <button
                type="button"
                onClick={handleCancelFirstCourse}
                className="px-3 py-2.5 text-sm text-gray-400 hover:text-white"
              >
                {t("login.backToLogin")}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🎓</div>
          <h1 className="text-3xl font-bold text-white mb-2">{t("app.title")}</h1>
          <p className="text-gray-400">{t("login.subtitle")}</p>
        </div>

        {loading ? (
          <div className="text-center text-gray-400">{t("common.loading")}</div>
        ) : (
          <div className="space-y-3">
            {users.map((user) => (
              <button
                key={user.id}
                onClick={() => handleSelect(user)}
                className="w-full flex items-center gap-4 bg-gray-800 hover:bg-gray-700 rounded-xl px-4 py-3 transition-colors text-left"
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                  style={{ backgroundColor: avatarColor(user.username) }}
                >
                  {avatarInitial(user.username)}
                </div>
                <div>
                  <div className="text-white font-medium">{user.username}</div>
                  {user.is_admin && (
                    <div className="text-xs text-blue-400">{t("login.admin")}</div>
                  )}
                </div>
              </button>
            ))}

            {showNewUser ? (
              <form onSubmit={handleCreate} className="bg-gray-800 rounded-xl px-4 py-3 space-y-3">
                <input
                  autoFocus
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder={t("login.usernamePlaceholder")}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  maxLength={50}
                />
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={creating || !newUsername.trim()}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-sm font-medium"
                  >
                    {creating ? t("common.loading") : t("common.create")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowNewUser(false); setError(null); setNewUsername(""); }}
                    className="px-3 py-2 text-sm text-gray-400 hover:text-white"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setShowNewUser(true)}
                className="w-full flex items-center gap-4 border-2 border-dashed border-gray-600 hover:border-gray-400 rounded-xl px-4 py-3 transition-colors text-gray-400 hover:text-gray-200"
              >
                <div className="w-10 h-10 rounded-full border-2 border-current flex items-center justify-center text-xl">
                  +
                </div>
                <span>{t("login.newUser")}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
