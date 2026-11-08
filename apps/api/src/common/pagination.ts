import { z } from 'zod';

/** Lists are paginated with limit and cursor (spec section 8). The cursor is the last item's id. */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
});

export type Pagination = z.infer<typeof paginationSchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Prisma arguments for one page; fetches one extra row to know whether another page exists. */
export function pageArgs(p: Pagination) {
  return {
    take: p.limit + 1,
    ...(p.cursor ? { cursor: { id: p.cursor }, skip: 1 } : {}),
  };
}

export function toPage<T extends { id: string }, R>(
  rows: T[],
  p: Pagination,
  map: (row: T) => R,
): Page<R> {
  const hasMore = rows.length > p.limit;
  const items = hasMore ? rows.slice(0, p.limit) : rows;
  return { items: items.map(map), nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
}
