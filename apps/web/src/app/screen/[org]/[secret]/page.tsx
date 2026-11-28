'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { WallFaces, type WallFace, WALL_FACES } from '../../../../components/wall/faces';
import { Icon, Loading } from '../../../../components/ui';
import { formatTime, type Schemas } from '../../../../lib/api';
import { LanguagePicker, t } from '../../../../lib/i18n';

type Screen = Schemas['WallScreen'];
const FACE_KEY = 'manorg.screen.face';

/**
 * Decided 2026-11-28: the wall screen behind a private link. No account: anyone with the link
 * sees the orders due next, refreshed every 30 seconds, and picks how it looks (remembered in this
 * browser). A deleted link shows that it no longer works.
 */
export default function SharedScreenPage() {
  const params = useParams<{ org: string; secret: string }>();
  const [data, setData] = useState<Screen | null>(null);
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [face, setFace] = useState<WallFace>('products');
  const [now, setNow] = useState(new Date().toISOString());

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FACE_KEY) as WallFace | null;
      if (saved && WALL_FACES.some((f) => f.key === saved)) setFace(saved);
    } catch {
      // Storage blocked: start on products.
    }
  }, []);
  function choose(next: WallFace) {
    setFace(next);
    try {
      window.localStorage.setItem(FACE_KEY, next);
    } catch {
      // Not remembered this time.
    }
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/public/wall/${params.org}/${params.secret}`, {
        cache: 'no-store',
      });
      if (res.status === 404) {
        setGone(true);
        setData(null);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Screen);
      setGone(false);
      setFailed(false);
    } catch {
      // Keep showing the last board; say it could not refresh.
      setFailed(true);
    }
  }, [params.org, params.secret]);

  useEffect(() => {
    void load();
    const a = setInterval(() => void load(), 30_000);
    const b = setInterval(() => setNow(new Date().toISOString()), 15_000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [load]);

  if (gone) {
    return (
      <main className="wall wall-gone">
        <img src="/logo.png" alt="" style={{ width: 72, height: 72, objectFit: 'contain' }} />
        <h1>{t('This screen link no longer works.')}</h1>
        <p className="muted">{t('Ask the bakery for a new link.')}</p>
      </main>
    );
  }
  if (!data)
    return failed ? <p className="center muted">{t('Cannot reach the bakery.')}</p> : <Loading />;

  return (
    <main className="wall">
      <header className="wall-head">
        <div className="row">
          <img src="/logo.png" alt="" style={{ width: 56, height: 56, objectFit: 'contain' }} />
          <div>
            <h1 style={{ fontSize: 30, margin: 0 }}>{data.organization.name}</h1>
            <span className="muted small">
              {t('Orders due next')} · {data.link.name}
              {failed ? ` · ${t('could not refresh')}` : ''}
            </span>
          </div>
        </div>
        <div className="row wrap wall-controls">
          <div className="tabs" role="tablist" aria-label={t('How it looks')}>
            {WALL_FACES.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={face === f.key}
                className={face === f.key ? 'on' : ''}
                onClick={() => choose(f.key)}
              >
                <Icon name={f.icon} size={16} />
                {t(f.label)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn ghost small-btn"
            aria-label={t('Full screen')}
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.().catch(() => undefined);
            }}
          >
            ⛶
          </button>
          <LanguagePicker />
          <b className="wall-clock">{formatTime(now)}</b>
        </div>
      </header>
      <WallFaces face={face} data={data} />
    </main>
  );
}
