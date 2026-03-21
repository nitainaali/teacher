import React, { createContext, useContext, useState, useCallback } from "react";
import { setCurrentUserId } from "../api/client";
import type { User } from "../api/users";

interface UserContextValue {
  currentUser: User | null;
  setUser: (user: User) => void;
  clearUser: () => void;
}

const STORAGE_KEY = "tutor_user";

function loadStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const stored = loadStoredUser();
    if (stored) setCurrentUserId(stored.id); // restore axios header immediately
    return stored;
  });

  const setUser = useCallback((user: User) => {
    setCurrentUserId(user.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    setCurrentUser(user);
  }, []);

  const clearUser = useCallback(() => {
    setCurrentUserId(null);
    localStorage.removeItem(STORAGE_KEY);
    setCurrentUser(null);
  }, []);

  return (
    <UserContext.Provider value={{ currentUser, setUser, clearUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used inside UserProvider");
  return ctx;
}
