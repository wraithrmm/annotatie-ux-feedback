// App-wide state: who is signed in, their sites, the Attention queue, toasts, and the approval
// undo window (M2). Nothing here decides a message's state: it reads what the server returns.

import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Attention, Message, Person, Preferences, Site } from "@annotatie/core";
import { ApiError, type Api } from "./api";
import type { Auth } from "./auth";

export interface Me {
  user: Person;
  sites: Site[];
  preferences: Preferences;
}

/** A reply that was approved and is inside its 10-second undo window. */
export interface Pending {
  siteId: string;
  itemId: string;
  messageId: string;
  who: string;
  startedAt: number;
  releaseAt: number;
}

export interface Store {
  api: Api;
  auth: Auth;
  me: Me | null;
  meError: string | null;
  attention: Attention | null;
  updatedAt: Date | null;
  /** Bumped by Refresh and after approvals; screens reload when it changes. */
  reloadKey: number;
  refresh: () => Promise<void>;
  refreshQuiet: () => Promise<void>;
  toast: (text: string) => void;
  toastText: string;
  pending: Pending[];
  approve: (p: { siteId: string; itemId: string; messageId: string; who: string; body?: string }) => Promise<Message>;
  undo: (messageId: string) => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("no store");
  return s;
}

export function StoreProvider(props: { api: Api; auth: Auth; children: ComponentChildren }) {
  const { api, auth } = props;
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [attention, setAttention] = useState<Attention | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [toastText, setToastText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const toast = useCallback((text: string) => {
    setToastText(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(""), 3600);
  }, []);

  const refreshQuiet = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([api.me(), api.attention()]);
      setMe(m);
      setAttention(a);
      setUpdatedAt(new Date());
      setMeError(null);
    } catch (e) {
      setMeError(e instanceof ApiError && e.offline ? "No connection. Showing what was loaded last." : (e as Error).message);
    }
  }, [api]);

  const refresh = useCallback(async () => {
    setReloadKey((k) => k + 1);
    await refreshQuiet();
  }, [refreshQuiet]);

  useEffect(() => {
    void refreshQuiet();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refreshQuiet();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshQuiet();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshQuiet]);

  const settle = useCallback(
    (messageId: string) => {
      setPending((ps) => ps.filter((p) => p.messageId !== messageId));
      const t = timers.current.get(messageId);
      if (t) clearTimeout(t);
      timers.current.delete(messageId);
    },
    [],
  );

  const approve = useCallback<Store["approve"]>(
    async ({ siteId, itemId, messageId, who, body }) => {
      const m = await api.approve(siteId, itemId, messageId, body);
      const now = Date.now();
      // The window is the server's (releaseAt - publishedAt), so a skewed phone clock doesn't shorten it.
      const windowMs =
        m.releaseAt && m.publishedAt ? Date.parse(m.releaseAt) - Date.parse(m.publishedAt) : m.releaseAt ? Date.parse(m.releaseAt) - now : 0;
      if (m.autoApproved || !(windowMs > 0)) {
        toast(`Sent to ${who}`);
        setReloadKey((k) => k + 1);
        void refreshQuiet();
        return m;
      }
      const p: Pending = { siteId, itemId, messageId, who, startedAt: now, releaseAt: now + windowMs };
      setPending((ps) => [...ps.filter((x) => x.messageId !== messageId), p]);
      timers.current.set(
        messageId,
        setTimeout(() => {
          settle(messageId);
          toast(`Sent to ${who}`);
          setReloadKey((k) => k + 1);
          void refreshQuiet();
        }, windowMs),
      );
      return m;
    },
    [api, toast, refreshQuiet, settle],
  );

  const undo = useCallback<Store["undo"]>(
    async (messageId) => {
      const p = pending.find((x) => x.messageId === messageId);
      if (!p) return;
      try {
        await api.undo(p.siteId, p.itemId, messageId);
        settle(messageId);
        toast("Not sent. The draft is back.");
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          settle(messageId);
          toast(`Too late: it was already sent to ${p.who}.`);
        } else {
          toast("Couldn't undo: no connection. Try again.");
          return;
        }
      }
      setReloadKey((k) => k + 1);
      void refreshQuiet();
    },
    [api, pending, settle, toast, refreshQuiet],
  );

  const signOut = useCallback(() => {
    try {
      sessionStorage.setItem("annotatie.signedout", "1");
    } catch {
      /* private mode */
    }
    auth.signOut();
  }, [auth]);

  const value = useMemo<Store>(
    () => ({ api, auth, me, meError, attention, updatedAt, reloadKey, refresh, refreshQuiet, toast, toastText, pending, approve, undo, signOut }),
    [api, auth, me, meError, attention, updatedAt, reloadKey, refresh, refreshQuiet, toast, toastText, pending, approve, undo, signOut],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

/** Loads data for a screen; reloads when `deps` or the store's reloadKey change. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: ApiError | null; loading: boolean; reload: () => void; set: (t: T) => void } {
  const { reloadKey } = useStore();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    load().then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (!live) return;
        setError(e instanceof ApiError ? e : new ApiError(0, "error", (e as Error).message));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1), set: setData };
}
