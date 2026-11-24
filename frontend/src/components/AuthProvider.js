"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  clearToken,
  fetchCurrentUser,
  getToken,
  logoutUser,
  setToken as storeToken
} from "../lib/api";

const AuthContext = createContext({
  user: null,
  token: null,
  loading: true,
  isAuthenticated: false,
  setSession: () => {},
  refreshUser: async () => null,
  logout: () => {}
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setTokenState] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async (overrideToken) => {
    const activeToken = overrideToken ?? getToken();
    if (!activeToken) {
      setTokenState(null);
      setUser(null);
      setLoading(false);
      return null;
    }

    try {
      const data = await fetchCurrentUser({ token: activeToken });
      setTokenState(activeToken);
      setUser(data?.user ?? null);
      setLoading(false);
      return data?.user ?? null;
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        clearToken();
        setTokenState(null);
        setUser(null);
      }
      setLoading(false);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const setSession = useCallback(({ user: nextUser, token: nextToken }) => {
    if (nextToken) {
      storeToken(nextToken);
      setTokenState(nextToken);
    }
    if (nextUser !== undefined) {
      setUser(nextUser);
    }
    setLoading(false);
  }, []);

  const logout = useCallback(() => {
    logoutUser();
    setTokenState(null);
    setUser(null);
    setLoading(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: Boolean(user && token),
        setSession,
        refreshUser,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
