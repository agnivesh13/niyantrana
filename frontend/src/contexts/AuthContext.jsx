/**
 * Authentication state, backed by real server sessions.
 *
 * Auth is Passport **session cookies**, not bearer tokens: the cookie is
 * HttpOnly, so this holds no credential of its own and nothing useful is kept
 * in localStorage. The session is resolved by asking the server, which is also
 * the only party that can answer.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import apiService, { ApiError } from '../services/apiService.jsx';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Resolve the session from the server.
   *
   * The session cookie is HttpOnly, so the browser cannot inspect it; asking
   * the server is the only way to know whether one is valid. A 401 simply means
   * "not signed in" and is not an error worth surfacing.
   */
  const refresh = useCallback(async () => {
    try {
      const response = await apiService.auth.me();
      setUser(response.user ?? null);
      return response.user ?? null;
    } catch (requestError) {
      if (!(requestError instanceof ApiError) || requestError.status !== 401) {
        setError(requestError.message);
      }
      setUser(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email, password) => {
    setError(null);
    try {
      await apiService.auth.login(email, password);
      return { success: true, user: await refresh() };
    } catch (requestError) {
      setError(requestError.message);
      return { success: false, error: requestError.message };
    }
  }, [refresh]);

  const signup = useCallback(async (email, password) => {
    setError(null);
    try {
      await apiService.auth.register(email, password);
      await apiService.auth.login(email, password);
      return { success: true, user: await refresh() };
    } catch (requestError) {
      setError(requestError.message);
      return { success: false, error: requestError.message };
    }
  }, [refresh]);

  /**
   * Sign in with a Google credential.
   *
   * Returns `isNew` so the caller can route a fresh account to onboarding
   * instead of a dashboard that has nothing to show yet. There is no separate
   * Google "sign up": the server creates the account on first sign-in, because
   * asking someone to choose between two identical Google buttons is a choice
   * with no meaning.
   */
  const signInWithGoogle = useCallback(async (credential) => {
    setError(null);
    try {
      const response = await apiService.auth.google(credential);
      return { success: true, user: await refresh(), isNew: response.isNew };
    } catch (requestError) {
      setError(requestError.message);
      return { success: false, error: requestError.message };
    }
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await apiService.auth.logout();
    } finally {
      // Clear locally even if the request failed, so the UI cannot show a
      // signed-in state the server disagrees with.
      setUser(null);
    }
  }, []);

  const saveProfile = useCallback(async (profile) => {
    setError(null);
    try {
      const response = await apiService.user.saveProfile(profile);
      await refresh();
      return { success: true, staticData: response.staticData };
    } catch (requestError) {
      setError(requestError.message);
      return { success: false, error: requestError.message, details: requestError.details };
    }
  }, [refresh]);

  const value = useMemo(() => ({
    user,
    isAuthenticated: Boolean(user),
    isLoading,
    error,
    login,
    signup,
    signInWithGoogle,
    logout,
    saveProfile,
    refresh,
  }), [user, isLoading, error, login, signup, signInWithGoogle, logout, saveProfile, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
