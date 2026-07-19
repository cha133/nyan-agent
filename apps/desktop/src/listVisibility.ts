export const INITIAL_VISIBLE_ITEMS = 5;
export const VISIBLE_ITEMS_STEP = 10;

export function visibleLimit(limits: Readonly<Record<string, number>>, key: string): number {
  return limits[key] ?? INITIAL_VISIBLE_ITEMS;
}

export function nextVisibleLimit(currentLimit: number, total: number): number {
  if (total <= currentLimit) return INITIAL_VISIBLE_ITEMS;
  return Math.min(currentLimit + VISIBLE_ITEMS_STEP, total);
}

export function visibleItems<T>(items: readonly T[], limit: number): T[] {
  return items.slice(0, limit);
}

export function resetVisibleLimits(
  limits: Readonly<Record<string, number>>,
  key: string,
  descendantPrefix?: string,
): Record<string, number> {
  const reset: Record<string, number> = { ...limits, [key]: INITIAL_VISIBLE_ITEMS };
  if (!descendantPrefix) return reset;

  for (const candidate of Object.keys(reset)) {
    if (candidate.startsWith(descendantPrefix)) reset[candidate] = INITIAL_VISIBLE_ITEMS;
  }
  return reset;
}
