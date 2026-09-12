/**
 * Chat state, backed by the server-side Gemini proxy.
 *
 * Replaces a browser-side client that read `VITE_GEMINI_API_KEY`. Vite inlines
 * anything VITE_-prefixed into the bundle, so that key was readable by anyone
 * who opened devtools, and spendable against the project quota. The key now
 * lives only on the server and the browser calls POST /api/chat.
 *
 * The old client also faked token-by-token streaming from seven canned strings
 * whenever the API failed, so a user could not tell a real answer from a stub.
 * A failure is now surfaced as a failure.
 *
 * The server reports `grounded` on every reply -- whether the answer was built
 * against the user own stored assessment or answered generally -- and that flag
 * is carried through to the UI rather than dropped here.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import apiService from '../services/apiService.jsx';

const STORAGE_KEY = 'niyantrana_chat_history_v2';
const HISTORY_TURNS = 12;
const PERSISTED_TURNS = 40;

const ChatContext = createContext(null);

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used inside a ChatProvider');
  return context;
};

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A private window, cleared site data, or a quota error. An empty
    // conversation is the correct fallback; it invents nothing.
    return [];
  }
}

export const ChatProvider = ({ children }) => {
  const [messages, setMessages] = useState(loadHistory);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState(null);

  const persist = useCallback((next) => {
    setMessages(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-PERSISTED_TURNS)));
    } catch { /* quota or blocked storage; the in-memory conversation still works */ }
  }, []);

  const send = useCallback(async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || isSending) return;

    setError(null);
    setIsSending(true);
    const withUser = [...messages, { role: 'user', text: trimmed }];
    persist(withUser);

    try {
      const body = await apiService.chat.send(trimmed, withUser.slice(-HISTORY_TURNS, -1));
      persist([...withUser, {
        role: 'model',
        text: body.reply,
        grounded: body.grounded,
        source: body.source,
      }]);
    } catch (requestError) {
      // Surfaced, not papered over with a canned reply.
      setError(requestError.message || 'The assistant is unavailable right now.');
    } finally {
      setIsSending(false);
    }
  }, [messages, isSending, persist]);

  const clear = useCallback(() => {
    persist([]);
    setError(null);
  }, [persist]);

  const value = useMemo(
    () => ({ messages, isSending, error, send, clear }),
    [messages, isSending, error, send, clear],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export default ChatContext;
