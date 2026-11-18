import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ko } from './i18n/ko';
import { uz } from './i18n/uz';
import { setLocale, t } from './i18n';

/** Every t('…') text in the screens, read from the source. */
function sourceKeys(): string[] {
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/\bt\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g)) {
          keys.add((m[1] ?? m[2] ?? '').replace(/\\(['"])/g, '$1'));
        }
      }
    }
  };
  walk(join(__dirname, '..'));
  return [...keys].filter((k) => /[A-Za-z]/.test(k));
}

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('languages (phase 3)', () => {
  it('has Korean and Uzbek for every text on screen', () => {
    const keys = sourceKeys();
    expect(keys.length).toBeGreaterThan(300);
    expect(keys.filter((k) => !(k in ko))).toEqual([]);
    expect(keys.filter((k) => !(k in uz))).toEqual([]);
  });

  it('keeps the same {placeholders} in every translation', () => {
    for (const dict of [ko, uz]) {
      for (const [en, tr] of Object.entries(dict)) expect(holes(tr), en).toEqual(holes(en));
    }
  });

  it('translates and fills values, falling back to English', () => {
    setLocale('ko');
    expect(t('Welcome, {name}', { name: 'Mina' })).toBe('Mina님, 환영합니다');
    setLocale('uz');
    expect(t('Start shift')).toBe('Smenani boshlash');
    expect(t('Not translated yet')).toBe('Not translated yet');
    setLocale('en');
    expect(t('Due {date}', { date: 'Mon 1 Dec' })).toBe('Due Mon 1 Dec');
  });
});
