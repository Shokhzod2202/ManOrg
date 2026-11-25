'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';

type TelegramWebApp = {
  initData: string;
  ready?: () => void;
  expand?: () => void;
  disableVerticalSwipes?: () => void;
  HapticFeedback?: { impactOccurred?: (style: 'light' | 'medium' | 'heavy') => void };
};
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
    TelegramWebviewProxy?: unknown;
  }
}

const FLAG = 'manorg.telegram';

/** Whether the page runs inside the Telegram mini app (Telegram passes tgWebApp… in the hash). */
function inTelegram(): boolean {
  try {
    if (window.location.hash.includes('tgWebApp') || window.TelegramWebviewProxy) {
      window.sessionStorage.setItem(FLAG, '1');
      return true;
    }
    return window.sessionStorage.getItem(FLAG) === '1';
  } catch {
    return Boolean(window.TelegramWebviewProxy);
  }
}

/**
 * Decided 2026-12-01: inside the Telegram mini app, load Telegram's own script so the app opens
 * full height and a vertical drag (reordering products, scrolling lists) does not swipe the mini
 * app closed. Outside Telegram nothing is loaded.
 */
export function TelegramSetup() {
  const [load, setLoad] = useState(false);
  useEffect(() => setLoad(inTelegram()), []);
  if (!load) return null;
  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="afterInteractive"
      onLoad={() => {
        const app = window.Telegram?.WebApp;
        if (!app?.initData) return;
        app.ready?.();
        app.expand?.();
        app.disableVerticalSwipes?.();
      }}
    />
  );
}

/** A small tap of feedback when a row is picked up: Telegram's haptics, or a short vibration. */
export function haptic() {
  try {
    const t = window.Telegram?.WebApp?.HapticFeedback;
    if (t?.impactOccurred) t.impactOccurred('medium');
    else navigator.vibrate?.(15);
  } catch {
    // No feedback available.
  }
}
