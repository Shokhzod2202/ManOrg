'use client';

import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';

type Ask = {
  message: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
};

let show: ((ask: Ask) => void) | null = null;

/**
 * Asks the person to confirm inside the page. Browser pop-ups (window.confirm) are not shown
 * reliably in the Telegram mini app, so every confirmation uses this instead.
 */
export function confirmAction(
  message: string,
  options: { detail?: string; confirmLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  const open = show;
  if (!open) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => open({ message, ...options, resolve }));
}

/** Mounted once at the root; renders the confirmation asked for by confirmAction. */
export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    show = (next) =>
      setAsk((current) => {
        current?.resolve(false);
        return next;
      });
    return () => {
      show = null;
    };
  }, []);
  useEffect(() => {
    if (!ask) return;
    yes.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  function answer(ok: boolean) {
    ask?.resolve(ok);
    setAsk(null);
  }
  if (!ask) return null;
  return (
    <div className="confirm-backdrop" onClick={() => answer(false)}>
      <div
        className="confirm-box"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-message"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="confirm-message" className="confirm-message">
          {ask.message}
        </p>
        {ask.detail ? <p className="muted small">{ask.detail}</p> : null}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={() => answer(false)}>
            {t('Cancel')}
          </button>
          <button
            ref={yes}
            type="button"
            className={ask.danger ? 'btn danger' : 'btn'}
            onClick={() => answer(true)}
          >
            {ask.confirmLabel ?? t('Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
