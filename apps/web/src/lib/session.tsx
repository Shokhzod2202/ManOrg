'use client';

import { isLocale, type Locale, markPicked, setLocale, storedLocale, takePicked } from './i18n';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ACCESS_CHANGED, get, patch, refresh, type Schemas, session, sessionCall } from './api';
import { linkPhoneApp, phoneAppOrg, phoneAppSignedOut } from './native';

type Me = Schemas['Me'];
type Membership = Me['memberships'][number];
export type Actor = 'employee' | 'org_admin' | 'contractor_admin';

interface SessionValue {
  ready: boolean;
  me: Me | null;
  /** The active membership in the chosen organization, if any. */
  membership: Membership | null;
  actor: Actor | null;
  orgId: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => void;
  reload: () => Promise<void>;
  chooseOrg: (id: string) => void;
  setOrdersView: (view: 'list' | 'matrix' | 'products') => Promise<void>;
  /** Changes the language here and, when signed in, on the account (phase 3). */
  setLanguage: (locale: Locale) => void;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // Tokens written by older versions of this app are removed from browser storage.
    try {
      window.localStorage.removeItem('manorg.tokens');
    } catch {
      // Storage blocked: nothing to clean up.
    }
    if (!session.access() && !(await refresh())) {
      setMe(null);
      setReady(true);
      return;
    }
    try {
      let data = await get<Me>('/me', { org: null });
      // A language chosen on the sign-in or register page is saved to the account; otherwise the
      // account's language applies on this device.
      const picked = takePicked() ? storedLocale() : null;
      if (picked && picked !== data.locale) {
        data = await patch<Me>('/me', { locale: picked }, { org: null }).catch(() => data);
      } else if (isLocale(data.locale)) setLocale(data.locale);
      setMe(data);
      const active = data.memberships.filter((m) => m.status === 'active');
      const stored = session.org();
      const chosen = active.find((m) => m.organization.id === stored) ?? active[0];
      setOrgId(chosen?.organization.id ?? null);
      session.setOrg(chosen?.organization.id ?? null);
      void linkPhoneApp(data.id, chosen?.organization.id ?? null);
    } catch {
      session.setAccess(null);
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Decided 2026-11-26: roles change while the app is open (an admin is made an employee, or
  // removed). Re-read the account when the person comes back to the app, every minute while it is
  // open, and right after the server refuses something, so menus match what the server allows.
  const recheck = useCallback(async () => {
    if (!session.access()) return;
    try {
      setMe(await get<Me>('/me', { org: null }));
    } catch {
      // Offline or signed out: the next call handles it.
    }
  }, []);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void recheck();
    };
    const onRefused = () => void recheck();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener(ACCESS_CHANGED, onRefused);
    const timer = setInterval(() => void recheck(), 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener(ACCESS_CHANGED, onRefused);
      clearInterval(timer);
    };
  }, [recheck]);

  const value = useMemo<SessionValue>(() => {
    const membership =
      me?.memberships.find((m) => m.status === 'active' && m.organization.id === orgId) ?? null;
    const actor: Actor | null = membership
      ? membership.organization.type === 'contractor'
        ? 'contractor_admin'
        : membership.role === 'admin'
          ? 'org_admin'
          : 'employee'
      : null;
    return {
      ready,
      me,
      membership,
      actor,
      orgId,
      reload,
      signIn: async (email, password) => {
        await sessionCall('login', { email, password });
        await reload();
      },
      register: async (name, email, password) => {
        await sessionCall('register', { name, email, password });
        // A new account starts in the language this browser shows.
        markPicked();
        await reload();
      },
      signOut: () => {
        phoneAppSignedOut();
        void sessionCall('logout');
        session.setOrg(null);
        setMe(null);
        setOrgId(null);
      },
      chooseOrg: (id) => {
        phoneAppOrg(id);
        session.setOrg(id);
        setOrgId(id);
      },
      setOrdersView: async (view) => {
        const updated = await patch<Me>(
          '/me',
          { preferences: { ordersView: view } },
          { org: null },
        );
        setMe(updated);
      },
      setLanguage: (locale) => {
        setLocale(locale);
        if (me)
          void patch<Me>('/me', { locale }, { org: null })
            .then(setMe)
            .catch(() => undefined);
      },
    };
  }, [ready, me, orgId, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
