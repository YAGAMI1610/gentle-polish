/**
 * Tiny pure grouping helpers for the batched (N+1-free) list loaders
 * (build-prompt §16 / LIMITATIONS item 6).
 *
 * A batch repository fetches every related row for a SET of goals in one query
 * (`where: { goalId: { in: ids } }`) and then splits the flat result per goal in
 * memory with these. Both PRESERVE the order rows arrive in, so a query that is
 * already sorted (milestones by `orderIndex`, verification records newest-first)
 * stays sorted within each group — the list loader gets exactly what the per-goal
 * query would have returned, just without the per-goal round-trips. Pure and
 * side-effect free, so they are unit-tested with no database.
 */

/** Group rows into a Map keyed by `key(row)`, preserving input order within each bucket. */
export function groupByKey<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) {
      bucket.push(row);
    } else {
      out.set(k, [row]);
    }
  }
  return out;
}

/**
 * Index rows by `key(row)` for a one-per-key relation (a goal has at most one
 * strategy / commitment). The FIRST row seen for a key wins, so a caller that has
 * sorted the query gets the row it expects and any later duplicate is ignored
 * rather than silently clobbering the first.
 */
export function indexByKey<T>(rows: readonly T[], key: (row: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  for (const row of rows) {
    const k = key(row);
    if (!out.has(k)) {
      out.set(k, row);
    }
  }
  return out;
}
