'use client';

import { t } from './i18n';
import { useSession } from './session';

/**
 * Decided 2026-11-30: three ways to sort product lists, chosen by each person and kept on their
 * account. Custom is the admin's own order (dragged on Products); A to Z by name; by type puts
 * types A to Z with similar products together, in the custom order inside each type.
 */
export type ProductSort = 'custom' | 'name' | 'type';

export interface Sortable {
  name: string;
  sortOrder: number;
  typeName: string | null;
}

const byName = (a: Sortable, b: Sortable) => a.name.localeCompare(b.name);
const byCustom = (a: Sortable, b: Sortable) => a.sortOrder - b.sortOrder || byName(a, b);

export function sortProducts<T>(items: T[], mode: ProductSort, key: (x: T) => Sortable): T[] {
  const list = [...items];
  if (mode === 'name') return list.sort((a, b) => byName(key(a), key(b)));
  if (mode === 'custom') return list.sort((a, b) => byCustom(key(a), key(b)));
  return list.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    // Products without a type come last.
    if (ka.typeName !== kb.typeName) {
      if (ka.typeName === null) return 1;
      if (kb.typeName === null) return -1;
      return ka.typeName.localeCompare(kb.typeName);
    }
    return byCustom(ka, kb);
  });
}

/** The sorted list cut into runs of the same type, for headings in "by type". */
export function groupByType<T>(sorted: T[], key: (x: T) => Sortable) {
  const groups: { type: string | null; items: T[] }[] = [];
  for (const item of sorted) {
    const type = key(item).typeName;
    const last = groups.at(-1);
    if (last && last.type === type) last.items.push(item);
    else groups.push({ type, items: [item] });
  }
  return groups;
}

export function useProductSort(): [ProductSort, (mode: ProductSort) => void] {
  const s = useSession();
  const mode = (s.me?.preferences?.productSort ?? 'custom') as ProductSort;
  return [mode, (m) => void s.setProductSort(m).catch(() => undefined)];
}

export function SortPicker() {
  const [mode, setMode] = useProductSort();
  const options: [ProductSort, string][] = [
    ['custom', t('Custom order')],
    ['name', t('A to Z')],
    ['type', t('By type')],
  ];
  return (
    <div className="tabs" role="tablist" aria-label={t('Sort products')}>
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          className={mode === value ? 'on' : ''}
          onClick={() => setMode(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
