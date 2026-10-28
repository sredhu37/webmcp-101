import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { JsonSchema } from './tool.ts';

export type InputCheck = { ok: true } | { ok: false; message: string };

export type InputValidator = (input: unknown) => InputCheck;

const options = { strict: false, allErrors: true, logger: false } as const;

/** Sites write schemas for various drafts; 2020-12 needs its own Ajv class. */
const draft07 = addFormats.default(new Ajv(options));
const draft2020 = addFormats.default(new Ajv2020(options));

/**
 * Compiles a tool's input schema. A schema Ajv cannot compile is not the agent's fault, so its
 * tool still runs with the input unchecked; `schemaError` says why.
 */
export function compileInputSchema(schema: JsonSchema): {
  validate: InputValidator;
  schemaError?: string;
} {
  const draft = typeof schema.$schema === 'string' ? schema.$schema : '';
  const ajv = draft.includes('2020-12') ? draft2020 : draft07;
  let validateFn: ValidateFunction;
  try {
    validateFn = ajv.compile(withoutIdentity(schema));
  } catch (error) {
    return {
      validate: () => ({ ok: true }),
      schemaError: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    validate: (input) =>
      validateFn(input) ? { ok: true } : { ok: false, message: describeErrors(validateFn.errors) },
  };
}

/**
 * Ajv refuses a second schema with an `$id` it has seen, and a `$schema` draft it does not ship
 * (draft-04, for example); neither changes what the input must look like.
 */
function withoutIdentity(schema: JsonSchema): JsonSchema {
  const copy = { ...schema };
  delete copy.$id;
  delete copy.$schema;
  return copy;
}

function describeErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return 'input does not match the schema';
  return errors.map(describeError).join('; ');
}

function describeError(error: ErrorObject): string {
  const where = error.instancePath ? error.instancePath.slice(1).replaceAll('/', '.') : 'input';
  switch (error.keyword) {
    case 'required':
      return `missing required property "${(error.params as { missingProperty: string }).missingProperty}"`;
    case 'additionalProperties':
      return `unknown property "${(error.params as { additionalProperty: string }).additionalProperty}"`;
    case 'enum':
      return `${where} must be one of ${(error.params as { allowedValues: unknown[] }).allowedValues
        .map((value) => JSON.stringify(value))
        .join(', ')}`;
    default:
      return `${where} ${error.message ?? 'is invalid'}`;
  }
}
