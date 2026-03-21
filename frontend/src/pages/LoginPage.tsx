import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getUsers, createUser, type User } from "../api/users";
import { useUser } from "../context/UserContext";

const AVATAR_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16",
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
      setUser(user);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : t("login.createError"));
    } finally {
      setCreating(false);
    }
  };

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
