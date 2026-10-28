import { describe, expect, it } from 'vitest';
import { compileInputSchema } from './input-schema.ts';

describe('compileInputSchema', () => {
  const schema = {
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email' },
      count: { type: 'integer', minimum: 1 },
      address: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
    required: ['email'],
  };

  it('accepts matching input and lists every problem with the rest', () => {
    const { validate, schemaError } = compileInputSchema(schema);
    expect(schemaError).toBeUndefined();
    expect(validate({ email: 'jane@example.com', count: 2 })).toEqual({ ok: true });
    expect(validate({ email: 'nope', count: 1.5, address: {} })).toEqual({
      ok: false,
      message:
        'email must match format "email"; count must be integer; missing required property "city"',
    });
  });

  it('handles 2020-12 and older drafts and repeated $id values', () => {
    for (const $schema of [
      'https://json-schema.org/draft/2020-12/schema',
      'http://json-schema.org/draft-07/schema#',
      'http://json-schema.org/draft-04/schema#',
    ]) {
      const { validate, schemaError } = compileInputSchema({ ...schema, $schema, $id: 'tool' });
      expect(schemaError).toBeUndefined();
      expect(validate({}).ok).toBe(false);
      expect(validate({ email: 'jane@example.com' }).ok).toBe(true);
    }
  });

  it('ignores unknown keywords and formats', () => {
    const { validate } = compileInputSchema({
      type: 'object',
      properties: { color: { type: 'string', format: 'colour-name', 'x-widget': 'swatch' } },
    });
    expect(validate({ color: 'red' })).toEqual({ ok: true });
  });

  it('lets input through unchecked when the schema cannot be compiled', () => {
    const { validate, schemaError } = compileInputSchema({ type: 'object', $ref: '#/nowhere' });
    expect(schemaError).toMatch(/nowhere/);
    expect(validate({ anything: true })).toEqual({ ok: true });
  });
});
