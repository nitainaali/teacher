import React, { createContext, useContext, useState, useCallback } from "react";
import { setCurrentUserId } from "../api/client";
import type { User } from "../api/users";

interface UserContextValue {
  currentUser: User | null;
  setUser: (user: User) => void;
  clearUser: () => void;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const setUser = useCallback((user: User) => {
    setCurrentUserId(user.id);
    setCurrentUser(user);
  }, []);

  const clearUser = useCallback(() => {
    setCurrentUserId(null);
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
