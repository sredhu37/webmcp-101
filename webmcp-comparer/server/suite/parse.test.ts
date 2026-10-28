import { describe, expect, it } from 'vitest';
import { parseSuite, type SuiteError } from './parse.ts';

const SAMPLE_SUITE = `scenarios:
  - id: cheapest-red-shirt-price
    prompt: What does the cheapest red shirt cost?
    success:
      - answerContains: "19.99"
  - id: add-red-shirt-to-cart
    prompt: Add the cheapest red shirt in size M to the cart.
    success:
      - script: "shop.cart().some(i => i.productId === 'red-shirt-basic' && i.size === 'M')"
  - id: add-from-product-page
    path: /products/blue-sneakers
    prompt: Add these sneakers in size 42 to the cart.
    success:
      - script: "shop.cart().some(i => i.productId === 'blue-sneakers' && i.size === '42')"
  - id: full-checkout
    prompt: Buy one black hat and check out as Jane Doe, jane@example.com, Hauptstr. 1, Düsseldorf.
    success:
      - script: "shop.lastOrder()?.items.some(i => i.productId === 'black-hat')"
`;

function errorsOf(source: string): SuiteError[] {
  const result = parseSuite(source);
  if (result.ok) throw new Error('expected the Suite to be invalid');
  return result.errors;
}

function onlyError(source: string): SuiteError {
  const errors = errorsOf(source);
  expect(errors).toHaveLength(1);
  return errors[0]!;
}

describe('parseSuite', () => {
  it('parses a sample Suite', () => {
    const result = parseSuite(SAMPLE_SUITE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suite.scenarios.map((s) => s.id)).toEqual([
      'cheapest-red-shirt-price',
      'add-red-shirt-to-cart',
      'add-from-product-page',
      'full-checkout',
    ]);
    expect(result.suite.scenarios[0]).toEqual({
      id: 'cheapest-red-shirt-price',
      prompt: 'What does the cheapest red shirt cost?',
      success: [{ answerContains: '19.99' }],
    });
    expect(result.suite.scenarios[2]).toMatchObject({ path: '/products/blue-sneakers' });
    expect(result.suite.scenarios[3]?.prompt).toContain('Düsseldorf');
  });

  it('accepts every check kind and keeps unquoted values as written', () => {
    const result = parseSuite(`scenarios:
  - id: all-checks
    prompt: |
      Do everything.
      Then stop.
    success:
      - urlContains: /cart
      - textVisible: Order placed
      - elementExists: "#cart .item"
      - script: window.done === true
      - answerContains: 19.90
`);
    expect(result).toEqual({
      ok: true,
      suite: {
        scenarios: [
          {
            id: 'all-checks',
            prompt: 'Do everything.\nThen stop.\n',
            success: [
              { urlContains: '/cart' },
              { textVisible: 'Order placed' },
              { elementExists: '#cart .item' },
              { script: 'window.done === true' },
              { answerContains: '19.90' },
            ],
          },
        ],
      },
    });
  });

  describe('errors carry line numbers', () => {
    it('reports YAML syntax errors', () => {
      expect(onlyError('scenarios:\n  - id: a\n    prompt: a: b\n')).toEqual({
        message: 'Nested mappings are not allowed in compact mappings',
        line: 3,
        column: 13,
        endLine: 3,
        endColumn: 14,
      });
      expect(onlyError('scenarios:\n  - id: a\n\tprompt: p\n')).toMatchObject({
        message: 'Tabs are not allowed as indentation',
        line: 3,
      });
    });

    it('reports duplicate keys from the YAML parser', () => {
      const error = onlyError('scenarios:\n  - id: a\n    prompt: p\n    id: b\n');
      expect(error).toMatchObject({ line: 4, column: 5 });
      expect(error.message).toMatch(/unique/i);
    });

    it('rejects more than one YAML document', () => {
      expect(errorsOf('scenarios: []\n---\nscenarios: []\n')[0]?.line).toBe(2);
    });

    it('rejects an empty Suite', () => {
      expect(onlyError('').message).toMatch(/empty/);
      expect(onlyError('# nothing here\n').message).toMatch(/empty/);
    });

    it('rejects a Suite that is not a mapping', () => {
      expect(onlyError('- id: a\n').message).toMatch(/mapping/);
    });

    it('rejects a Suite without scenarios', () => {
      const errors = errorsOf('name: shop\n');
      expect(errors.map((e) => [e.line, e.message])).toEqual([
        [1, 'Unknown field `name`: a Suite contains only `scenarios`'],
        [1, 'Missing `scenarios`'],
      ]);
    });

    it('rejects unknown top-level fields', () => {
      const error = onlyError('scenarios:\n  - id: a\n    prompt: p\nsiteUrl: http://x\n');
      expect(error).toMatchObject({ line: 4, column: 1, endLine: 4, endColumn: 8 });
      expect(error.message).toContain('`siteUrl`');
    });

    it('rejects scenarios that are not a list', () => {
      expect(onlyError('scenarios: one\n')).toMatchObject({ line: 1, column: 12 });
      expect(onlyError('scenarios:\n').message).toMatch(/must be a list/);
    });

    it('rejects an empty scenarios list', () => {
      expect(onlyError('scenarios: []\n').message).toMatch(/at least one Scenario/);
    });

    it('rejects a Scenario that is not a mapping', () => {
      const error = onlyError('scenarios:\n  - id: a\n    prompt: p\n  - just text\n');
      expect(error).toMatchObject({ line: 4, column: 5 });
    });

    it('reports a missing id on the Scenario', () => {
      const error = onlyError('scenarios:\n  - id: a\n    prompt: p\n  - prompt: q\n');
      expect(error).toMatchObject({ message: 'Missing `id`', line: 4, column: 5 });
    });

    it('reports a missing prompt on the Scenario', () => {
      const error = onlyError('scenarios:\n  - id: a\n    path: /x\n');
      expect(error).toMatchObject({ message: 'Missing `prompt`', line: 2, column: 5 });
    });

    it('rejects an empty prompt', () => {
      const error = onlyError('scenarios:\n  - id: a\n    prompt:\n');
      expect(error.message).toBe('`prompt` must not be empty');
      expect(error.line).toBe(3);
    });

    it('rejects a prompt that is not text', () => {
      const error = onlyError('scenarios:\n  - id: a\n    prompt:\n      - one\n');
      expect(error).toMatchObject({ message: '`prompt` must be text', line: 4 });
    });

    it.each(['Find-Shirt', 'find_shirt', 'find shirt', '-find', 'find--shirt', 'a'.repeat(65)])(
      'rejects the invalid id %s',
      (id) => {
        const error = onlyError(`scenarios:\n  - id: "${id}"\n    prompt: p\n`);
        expect(error.line).toBe(2);
        expect(error.message).toMatch(/^Invalid id/);
      },
    );

    it('rejects a duplicate id and names the first use', () => {
      const error = onlyError(
        'scenarios:\n  - id: same\n    prompt: p\n  - id: other\n    prompt: q\n  - id: same\n    prompt: r\n',
      );
      expect(error).toMatchObject({
        message: 'Duplicate id `same`: already used on line 2',
        line: 6,
        column: 9,
        endLine: 6,
        endColumn: 13,
      });
    });

    it('rejects unknown Scenario fields', () => {
      const error = onlyError('scenarios:\n  - id: a\n    prompt: p\n    name: A\n');
      expect(error).toMatchObject({ line: 4, column: 5 });
      expect(error.message).toMatch(/^Unknown field `name`/);
    });

    it.each(['products/x', 'http://other.site/x', '/a b'])('rejects the path %s', (path) => {
      const error = onlyError(`scenarios:\n  - id: a\n    prompt: p\n    path: ${path}\n`);
      expect(error.line).toBe(4);
      expect(error.message).toMatch(/^`path` must be a path/);
    });

    it('rejects success that is not a list', () => {
      const error = onlyError(
        'scenarios:\n  - id: a\n    prompt: p\n    success:\n      urlContains: /x\n',
      );
      expect(error).toMatchObject({
        message: '`success` must be a list of Success checks',
        line: 5,
      });
    });

    it('rejects an empty success list', () => {
      const error = onlyError('scenarios:\n  - id: a\n    prompt: p\n    success: []\n');
      expect(error.message).toMatch(/at least one Success check/);
    });

    it('rejects an unknown check', () => {
      const error = onlyError(
        'scenarios:\n  - id: a\n    prompt: p\n    success:\n      - urlContains: /x\n      - titleIs: Cart\n',
      );
      expect(error).toMatchObject({ line: 6, column: 9 });
      expect(error.message).toMatch(/^Unknown check `titleIs`/);
    });

    it('rejects a check with more than one kind', () => {
      const error = onlyError(
        'scenarios:\n  - id: a\n    prompt: p\n    success:\n      - urlContains: /x\n        textVisible: y\n',
      );
      expect(error).toMatchObject({ line: 5, column: 9 });
      expect(error.message).toMatch(/^Invalid check/);
    });

    it('rejects a check that is plain text', () => {
      const error = onlyError(
        'scenarios:\n  - id: a\n    prompt: p\n    success:\n      - urlContains\n',
      );
      expect(error.message).toMatch(/^Invalid check/);
    });

    it('rejects a check with empty or non-text value', () => {
      expect(
        onlyError('scenarios:\n  - id: a\n    prompt: p\n    success:\n      - textVisible: ""\n'),
      ).toMatchObject({ message: '`textVisible` must not be empty', line: 5 });
      expect(
        onlyError(
          'scenarios:\n  - id: a\n    prompt: p\n    success:\n      - script:\n          a: b\n',
        ),
      ).toMatchObject({ message: '`script` must be text', line: 6 });
    });

    it('reports every error at once', () => {
      const errors = errorsOf(`scenarios:
  - id: Bad
    prompt: p
  - id: ok
    extra: 1
  - id: ok
    prompt: q
    success:
      - nope: x
`);
      expect(errors.map((e) => [e.line, e.message.split(':')[0]])).toEqual([
        [2, 'Invalid id `Bad`'],
        [5, 'Unknown field `extra`'],
        [4, 'Missing `prompt`'],
        [6, 'Duplicate id `ok`'],
        [
          9,
          'Unknown check `nope`. A Success check is one of `urlContains`, `textVisible`, `elementExists`, `script`, `answerContains`, followed by its text',
        ],
      ]);
    });
  });
});
