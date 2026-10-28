import { describe, expect, it } from 'vitest';
import { BROWSER_TOOL_NAMES, FINISH_TOOL_NAME } from '../lane/browser-tools.ts';
import { MODEL_TOOL_NAME_PATTERN, ToolNameMap, sanitizeToolName } from './tool-names.ts';

const reserved = [...BROWSER_TOOL_NAMES, FINISH_TOOL_NAME];

describe('sanitizeToolName', () => {
  it.each([
    ['add_to_cart', 'add_to_cart'],
    ['cart.add', 'cart_add'],
    ['search products!', 'search_products_'],
    ['produits/rechercher-été', 'produits_rechercher-_t_'],
    ['...', 'tool'],
    ['', 'tool'],
    ['x'.repeat(80), 'x'.repeat(64)],
  ])('%j becomes %j', (name, expected) => {
    expect(sanitizeToolName(name)).toBe(expected);
    expect(sanitizeToolName(name)).toMatch(MODEL_TOOL_NAME_PATTERN);
  });
});

describe('ToolNameMap', () => {
  it('keeps valid names and reports only the names it changed', () => {
    const names = new ToolNameMap(reserved);
    expect(names.add(['search_products', 'cart.view', 'site_click'])).toEqual([
      { name: 'cart.view', modelName: 'cart_view' },
    ]);
    expect(names.modelName('search_products')).toBe('search_products');
    expect(names.modelName('cart.view')).toBe('cart_view');
    expect(names.laneName('cart_view')).toBe('cart.view');
    expect(names.laneName('unknown')).toBeUndefined();
  });

  it('never gives a sanitized name that a valid tool or a reserved name holds', () => {
    const names = new ToolNameMap(reserved);
    expect(names.add(['cart.view', 'cart_view', 'click!', 'cart view'])).toEqual([
      { name: 'cart.view', modelName: 'cart_view_2' },
      { name: 'click!', modelName: 'click_' },
      { name: 'cart view', modelName: 'cart_view_3' },
    ]);
  });

  it('keeps suffixed names within 64 characters', () => {
    const names = new ToolNameMap();
    const long = 'a'.repeat(70);
    names.add([`${long}.x`]);
    const [rename] = names.add([`${long}.y`]);
    expect(rename!.modelName).toBe(`${'a'.repeat(62)}_2`);
  });

  it('keeps a model name for the whole Attempt, even after the tool went away', () => {
    const names = new ToolNameMap(reserved);
    names.add(['cart.view']);
    expect(names.add(['cart.view', 'cart:view'])).toEqual([
      { name: 'cart:view', modelName: 'cart_view_2' },
    ]);
    expect(names.add([])).toEqual([]);
    expect(names.modelName('cart.view')).toBe('cart_view');
  });

  it('throws for a name it never saw', () => {
    expect(() => new ToolNameMap().modelName('x')).toThrow('Tool x has no model name');
  });
});
