import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Decided 2026-11-26 (product owner): the app is tested with real data, so migrations only add.
 * None may drop a column, table or type, empty a table, delete rows or change a column's type;
 * an unused column simply stays. A migration may do so only with the product owner's approval,
 * written in it as the line "-- destructive: approved by the product owner on <date>".
 */
const DIR = join(__dirname, '..', 'prisma', 'migrations');
/** Migrations from here on are checked (older ones were applied before live testing). */
const FROM = '20261124';
const DESTRUCTIVE = [
  /\bDROP\s+(COLUMN|TABLE|TYPE|SCHEMA)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i,
];
const APPROVED = /^--\s*destructive:\s*approved by the product owner on \d{4}-\d{2}-\d{2}/im;

describe('migrations never destroy data (decided 2026-11-26)', () => {
  const names = readdirSync(DIR).filter((n) => /^\d{14}_/.test(n) && n >= FROM);

  it('checks the recent migrations', () => {
    expect(names.length).toBeGreaterThan(5);
  });

  for (const name of names) {
    it(name, () => {
      const sql = readFileSync(join(DIR, name, 'migration.sql'), 'utf8')
        // Comments may mention what is not done.
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      const found = DESTRUCTIVE.filter((re) => re.test(sql)).map((re) => re.source);
      if (found.length) {
        const raw = readFileSync(join(DIR, name, 'migration.sql'), 'utf8');
        expect(APPROVED.test(raw), `${name} is destructive: ${found.join(', ')}`).toBe(true);
      }
    });
  }
});
