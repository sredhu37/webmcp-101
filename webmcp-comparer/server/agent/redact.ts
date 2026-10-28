export const REDACTED = '[redacted]';

/** Key shapes redacted even when the key is not known to the Run. */
const KEY_PATTERNS = [
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g,
];

/** Secrets shorter than this are ignored, so an empty or placeholder value cannot blank out text. */
const MIN_SECRET_LENGTH = 8;

export type Redactor = (text: string) => string;

/** Replaces every known key, and anything shaped like a provider key, with `[redacted]`. */
export function createRedactor(secrets: Iterable<string | undefined>): Redactor {
  const known = [
    ...new Set([...secrets].filter((s): s is string => !!s && s.length >= MIN_SECRET_LENGTH)),
  ].sort((a, b) => b.length - a.length);
  return (text) => {
    let result = text;
    for (const secret of known) result = result.split(secret).join(REDACTED);
    for (const pattern of KEY_PATTERNS) result = result.replace(pattern, REDACTED);
    return result;
  };
}

/** Applies the redactor to every string in a JSON-like value, keys included. */
export function redactValue<T>(value: T, redact: Redactor): T {
  return walk(value, redact) as T;
}

function walk(value: unknown, redact: Redactor): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, redact));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [redact(key), walk(item, redact)]),
    );
  }
  return value;
}
