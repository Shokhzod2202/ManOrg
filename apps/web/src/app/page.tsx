'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Loading } from '../components/ui';
import { useSession } from '../lib/session';

export default function Index() {
  const s = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!s.ready) return;
    router.replace(!s.me ? '/login' : s.membership ? '/app' : '/start');
  }, [s.ready, s.me, s.membership, router]);
  return <Loading />;
}
