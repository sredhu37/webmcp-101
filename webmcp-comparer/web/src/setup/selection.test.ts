import { describe, expect, it } from 'vitest';
import {
  initialSelection,
  reconcileSelection,
  runButtonLabel,
  selectionFrom,
  toggle,
} from './selection.ts';

const IDS = ['a', 'b', 'c', 'd'];

describe('reconcileSelection', () => {
  it('keeps the ticks of ids that are still in the Suite, in Suite order', () => {
    expect(reconcileSelection(IDS, ['c', 'a'], ['d', 'c', 'b', 'a'])).toEqual(['c', 'a']);
  });

  it('drops removed ids and leaves new ids unticked', () => {
    expect(reconcileSelection(IDS, ['a', 'b'], ['a', 'c', 'd', 'e'])).toEqual(['a']);
  });

  it('carries a tick over to a Scenario renamed in place', () => {
    expect(reconcileSelection(IDS, ['b'], ['a', 'b2', 'c', 'd'])).toEqual(['b2']);
    expect(reconcileSelection(IDS, ['a'], ['a', 'b2', 'c', 'd'])).toEqual(['a']);
  });

  it('ticks the first Scenario when every ticked one is gone', () => {
    expect(reconcileSelection(IDS, ['d'], ['a', 'b', 'c'])).toEqual(['a']);
  });

  it('keeps an empty selection that the user chose', () => {
    expect(reconcileSelection(IDS, [], ['a', 'b', 'c', 'e'])).toEqual([]);
  });

  it('treats a first valid Suite as fresh', () => {
    expect(reconcileSelection([], [], ['x', 'y'])).toEqual(['x']);
  });
});

describe('selection helpers', () => {
  it('starts with the first Scenario only', () => {
    expect(initialSelection(IDS)).toEqual(['a']);
    expect(initialSelection([])).toEqual([]);
  });

  it('restores a saved selection, falling back to the first Scenario', () => {
    expect(selectionFrom(IDS, ['d', 'b', 'zz'])).toEqual(['b', 'd']);
    expect(selectionFrom(IDS, ['zz'])).toEqual(['a']);
  });

  it('toggles one Scenario and keeps Suite order', () => {
    expect(toggle(IDS, ['c'], 'a')).toEqual(['a', 'c']);
    expect(toggle(IDS, ['a', 'c'], 'a')).toEqual(['c']);
  });
});

describe('runButtonLabel', () => {
  it('names the action with the Scenario count', () => {
    expect(runButtonLabel(1, 1)).toBe('Run 1 Scenario');
    expect(runButtonLabel(2, 1)).toBe('Run 2 Scenarios');
  });

  it('adds the Attempts when a Scenario repeats', () => {
    expect(runButtonLabel(2, 3)).toBe('Run 2 Scenarios, 3 Attempts each');
  });

  it('falls back to a bare Run when nothing is selected', () => {
    expect(runButtonLabel(0, 1)).toBe('Run');
  });
});
