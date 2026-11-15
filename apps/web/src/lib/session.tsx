'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { get, patch, post, type Schemas, session } from './api';

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
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!session.tokens()) {
      setMe(null);
      setReady(true);
      return;
    }
    try {
      const data = await get<Me>('/me', { org: null });
      setMe(data);
      const active = data.memberships.filter((m) => m.status === 'active');
      const stored = session.org();
      const chosen = active.find((m) => m.organization.id === stored) ?? active[0];
      setOrgId(chosen?.organization.id ?? null);
      session.setOrg(chosen?.organization.id ?? null);
    } catch {
      session.setTokens(null);
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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
        const res = await post<Schemas['AuthResult']>(
          '/auth/login',
          { email, password },
          { org: null },
        );
        session.setTokens(res.tokens);
        await reload();
      },
      register: async (name, email, password) => {
        const res = await post<Schemas['AuthResult']>(
          '/auth/register',
          { name, email, password },
          { org: null },
        );
        session.setTokens(res.tokens);
        await reload();
      },
      signOut: () => {
        session.setTokens(null);
        session.setOrg(null);
        setMe(null);
        setOrgId(null);
      },
      chooseOrg: (id) => {
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
    };
  }, [ready, me, orgId, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
