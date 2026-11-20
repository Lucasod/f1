export function resolveDropTarget(
  id: string | number,
  cardColumn: unknown,
  columnKeys: readonly string[]
): string | undefined {
  const target = columnKeys.includes(String(id)) ? String(id) : cardColumn;
  return typeof target === 'string' && columnKeys.includes(target) ? target : undefined;
}
