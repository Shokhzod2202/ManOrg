'use client';

import { Fragment, type ReactNode, useEffect, useSyncExternalStore } from 'react';
import { ko } from './i18n/ko';
import { uz } from './i18n/uz';

/**
 * Phase 3 languages: English, Korean and Uzbek. The English text is the key, so a string without a
 * translation shows in English rather than as a code. `{name}` marks a value filled in at run time.
 */
export type Locale = 'en' | 'ko' | 'uz';
export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'ko', label: '한국어' },
  { id: 'uz', label: 'Oʻzbekcha' },
];
const DICTS: Record<Locale, Record<string, string> | null> = { en: null, ko, uz };
const KEY = 'manorg.locale';
/** Intl locale for dates, times and numbers. */
export const INTL: Record<Locale, string> = { en: 'en-GB', ko: 'ko-KR', uz: 'uz-Latn-UZ' };

let current: Locale = 'en';
const listeners = new Set<() => void>();

export const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'ko' || v === 'uz';

export function getLocale(): Locale {
  return current;
}

/** The language chosen in this browser before signing in, if any. */
export function storedLocale(): Locale | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

export function setLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(KEY, locale);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  if (locale === current) return;
  current = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const l of listeners) l();
}

const PICKED = 'manorg.locale.picked';

/** Marks that the language was chosen on the sign-in or register page, so it is saved on sign-in. */
export function markPicked(): void {
  try {
    window.sessionStorage.setItem(PICKED, '1');
  } catch {
    // Storage blocked: the account's language applies.
  }
}

/** Whether the language was chosen before signing in; reading it clears the mark. */
export function takePicked(): boolean {
  try {
    const v = window.sessionStorage.getItem(PICKED) === '1';
    window.sessionStorage.removeItem(PICKED);
    return v;
  } catch {
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Translates English text into the chosen language; `{key}` parts are filled from `vars`. */
export function t(text: string | null | undefined, vars?: Record<string, string | number>): string {
  if (text == null) return '';
  const out = DICTS[current]?.[text] ?? text;
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** A shift red flag in the chosen language; the server's English message is the fallback. */
export function flagText(f: { code: string; minutes?: number | null; message: string }): string {
  const n = f.minutes ?? 0;
  switch (f.code) {
    case 'LATE_START':
      return t('Started {n} minutes late.', { n });
    case 'EARLY_END':
      return t('Ended {n} minutes early.', { n });
    case 'MISSING_PUNCH':
      return t('Planned shift with no punch.');
    case 'UNPLANNED':
      return t('Punched with no planned shift.');
    case 'NOT_ENDED':
      return t('Shift not ended after the planned end.');
    default:
      return t(f.message);
  }
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, () => 'en' as Locale);
}

/**
 * Re-renders the screens in the new language. The first render is English, as on the server, so
 * the page hydrates cleanly; the stored choice applies right after.
 */
export function LocaleRoot({ children }: { children: ReactNode }) {
  const locale = useLocale();
  useEffect(() => {
    const stored = storedLocale();
    if (stored) setLocale(stored);
    else if (navigator.language.startsWith('ko')) setLocale('ko');
    else if (navigator.language.startsWith('uz')) setLocale('uz');
  }, []);
  return <Fragment key={locale}>{children}</Fragment>;
}

/** A compact language picker; `onChange` also saves it to the account when signed in. */
export function LanguagePicker({ onChange }: { onChange?: (l: Locale) => void }) {
  const locale = useLocale();
  return (
    <label className="row" style={{ gap: 6 }}>
      <span className="sr-only">{t('Language')}</span>
      <select
        className="input"
        style={{ width: 'auto' }}
        aria-label={t('Language')}
        value={locale}
        onChange={(e) => {
          const l = e.target.value as Locale;
          setLocale(l);
          if (onChange) onChange(l);
          else markPicked();
        }}
      >
        {LOCALES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
