/**
 * Scenario selection across Suite edits.
 *
 * - An id that is still in the Suite keeps its tick.
 * - A new id at the position of an id that disappeared inherits that tick, so renaming a
 *   Scenario while typing does not lose it.
 * - Any other new id starts unticked.
 * - When every ticked Scenario is gone, the first Scenario is ticked. A selection the user
 *   emptied on purpose (Select none) stays empty.
 *
 * The result is in Suite order.
 */
export function reconcileSelection(
  previousIds: readonly string[],
  previousSelected: readonly string[],
  nextIds: readonly string[],
): string[] {
  if (previousIds.length === 0) return initialSelection(nextIds);
  const ticked = new Set(previousSelected);
  const next = new Set(nextIds);
  const selected = nextIds.filter((id, index) => {
    if (previousIds.includes(id)) return ticked.has(id);
    const before = previousIds[index];
    return before !== undefined && !next.has(before) && ticked.has(before);
  });
  return selected.length === 0 && ticked.size > 0 ? initialSelection(nextIds) : selected;
}

/** A fresh Suite starts with only its first Scenario ticked. */
export function initialSelection(ids: readonly string[]): string[] {
  return ids.slice(0, 1);
}

/** Keeps the given ids that exist, in Suite order; falls back to the first Scenario. */
export function selectionFrom(ids: readonly string[], wanted: readonly string[]): string[] {
  const selected = ids.filter((id) => wanted.includes(id));
  return selected.length === 0 ? initialSelection(ids) : selected;
}

export function toggle(ids: readonly string[], selected: readonly string[], id: string): string[] {
  const ticked = new Set(selected);
  if (ticked.has(id)) ticked.delete(id);
  else ticked.add(id);
  return ids.filter((known) => ticked.has(known));
}

/** The Run button names its action: "Run 2 Scenarios", with the Attempts when more than one. */
export function runButtonLabel(scenarios: number, attempts: number): string {
  if (scenarios === 0) return 'Run';
  const base = `Run ${scenarios} ${scenarios === 1 ? 'Scenario' : 'Scenarios'}`;
  return attempts > 1 ? `${base}, ${attempts} Attempts each` : base;
}
