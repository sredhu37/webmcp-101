import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  type Document,
  type Node,
} from 'yaml';
import { CHECK_KINDS, isCheckKind, type Check } from './checks.ts';

export interface Scenario {
  id: string;
  prompt: string;
  path?: string;
  success?: Check[];
}

export interface Suite {
  scenarios: Scenario[];
}

/** A Suite error located in the source, 1-based, end exclusive, as editor markers expect. */
export interface SuiteError {
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export type ParseResult = { ok: true; suite: Suite } | { ok: false; errors: SuiteError[] };

const SCENARIO_FIELDS = ['id', 'prompt', 'path', 'success'] as const;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_MAX_LENGTH = 64;

/**
 * Parses and validates a Suite. Every scalar is read as a string (YAML failsafe
 * schema), so `answerContains: 19.90` keeps its exact text.
 */
export function parseSuite(source: string): ParseResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, {
    schema: 'failsafe',
    lineCounter,
    prettyErrors: false,
  });
  const errors: SuiteError[] = [];
  const at: Report = (range, message) => {
    const start = lineCounter.linePos(range[0]);
    const end = lineCounter.linePos(Math.max(range[1], range[0]));
    errors.push({
      message,
      line: start.line,
      column: start.col,
      endLine: end.line,
      endColumn: end.col,
    });
  };

  for (const error of doc.errors) {
    at(error.pos, firstLine(error.message));
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const suite = new Validator(doc, lineCounter, at, source.length).suite();
  return errors.length > 0 || !suite ? { ok: false, errors } : { ok: true, suite };
}

type Report = (range: readonly [number, number], message: string) => void;

class Validator {
  private readonly doc: Document;
  private readonly lineCounter: LineCounter;
  private readonly report: Report;
  private readonly sourceLength: number;

  constructor(doc: Document, lineCounter: LineCounter, report: Report, sourceLength: number) {
    this.doc = doc;
    this.lineCounter = lineCounter;
    this.report = report;
    this.sourceLength = sourceLength;
  }

  suite(): Suite | undefined {
    const root = this.resolve(this.doc.contents);
    if (!root || (isScalar(root) && root.value === '')) {
      this.report([0, this.sourceLength], 'Suite is empty: it must contain `scenarios`');
      return undefined;
    }
    if (!isMap(root)) {
      this.report(rangeOf(root), 'Suite must be a mapping with a `scenarios` list');
      return undefined;
    }

    let scenarios: Scenario[] | undefined;
    for (const pair of root.items) {
      const key = this.keyName(pair.key);
      if (key === undefined) continue;
      if (key === 'scenarios') {
        scenarios = this.scenarios(this.resolve(pair.value as Node | null), rangeOf(pair.key));
      } else {
        this.report(
          rangeOf(pair.key),
          `Unknown field \`${key}\`: a Suite contains only \`scenarios\``,
        );
      }
    }
    if (!root.items.some((pair) => this.keyName(pair.key) === 'scenarios')) {
      this.report(rangeOf(root), 'Missing `scenarios`');
    }
    return scenarios && { scenarios };
  }

  private scenarios(node: Node | undefined, keyRange: [number, number]): Scenario[] | undefined {
    if (!isSeq(node)) {
      this.report(node ? rangeOf(node) : keyRange, '`scenarios` must be a list of Scenarios');
      return undefined;
    }
    if (node.items.length === 0) {
      this.report(rangeOf(node), '`scenarios` must list at least one Scenario');
      return undefined;
    }

    const firstIdLine = new Map<string, number>();
    const scenarios: Scenario[] = [];
    for (const item of node.items) {
      const scenario = this.scenario(this.resolve(item as Node | null), firstIdLine);
      if (scenario) scenarios.push(scenario);
    }
    return scenarios.length === node.items.length ? scenarios : undefined;
  }

  private scenario(node: Node | undefined, firstIdLine: Map<string, number>): Scenario | undefined {
    if (!isMap(node)) {
      this.report(
        node ? rangeOf(node) : [0, 0],
        'Each Scenario must be a mapping with `id` and `prompt`',
      );
      return undefined;
    }

    const fields = new Map<string, Node | undefined>();
    let valid = true;
    for (const pair of node.items) {
      const key = this.keyName(pair.key);
      if (key === undefined) {
        valid = false;
        continue;
      }
      if (!(SCENARIO_FIELDS as readonly string[]).includes(key)) {
        this.report(
          rangeOf(pair.key),
          `Unknown field \`${key}\`: a Scenario has ${SCENARIO_FIELDS.map((f) => `\`${f}\``).join(', ')}`,
        );
        valid = false;
        continue;
      }
      fields.set(key, this.resolve(pair.value as Node | null) ?? (pair.key as Node));
    }

    const headRange = rangeOf(node.items[0]?.key ?? node);
    const id = this.idField(fields.get('id'), headRange, firstIdLine);
    const prompt = this.requiredText(fields.get('prompt'), 'prompt', headRange);
    const path = fields.has('path') ? this.pathField(fields.get('path')) : undefined;
    const success = fields.has('success') ? this.checks(fields.get('success')) : undefined;

    if (!valid || id === undefined || prompt === undefined) return undefined;
    if (fields.has('path') && path === undefined) return undefined;
    if (fields.has('success') && success === undefined) return undefined;

    const scenario: Scenario = { id, prompt };
    if (path !== undefined) scenario.path = path;
    if (success !== undefined) scenario.success = success;
    return scenario;
  }

  private idField(
    node: Node | undefined,
    headRange: [number, number],
    firstIdLine: Map<string, number>,
  ): string | undefined {
    const id = this.requiredText(node, 'id', headRange);
    if (id === undefined || !node) return undefined;
    if (!ID_PATTERN.test(id) || id.length > ID_MAX_LENGTH) {
      this.report(
        rangeOf(node),
        `Invalid id \`${id}\`: use lowercase letters, digits and single dashes, at most ${ID_MAX_LENGTH} characters`,
      );
      return undefined;
    }
    const line = this.lineOf(node);
    const first = firstIdLine.get(id);
    if (first !== undefined) {
      this.report(rangeOf(node), `Duplicate id \`${id}\`: already used on line ${first}`);
      return undefined;
    }
    firstIdLine.set(id, line);
    return id;
  }

  private pathField(node: Node | undefined): string | undefined {
    const path = this.text(node, 'path');
    if (path === undefined || !node) return undefined;
    if (!path.startsWith('/') || /\s/.test(path)) {
      this.report(
        rangeOf(node),
        '`path` must be a path on the Site URL starting with `/`, for example `/products/red-shirt`',
      );
      return undefined;
    }
    return path;
  }

  private checks(node: Node | undefined): Check[] | undefined {
    if (!isSeq(node)) {
      this.report(rangeOf(node), '`success` must be a list of Success checks');
      return undefined;
    }
    if (node.items.length === 0) {
      this.report(
        rangeOf(node),
        '`success` must list at least one Success check; leave it out to let the agent decide',
      );
      return undefined;
    }
    const checks: Check[] = [];
    for (const item of node.items) {
      const check = this.check(this.resolve(item as Node | null) ?? node);
      if (check) checks.push(check);
    }
    return checks.length === node.items.length ? checks : undefined;
  }

  private check(node: Node): Check | undefined {
    const usage = `A Success check is one of ${CHECK_KINDS.map((k) => `\`${k}\``).join(', ')}, followed by its text`;
    if (!isMap(node) || node.items.length !== 1) {
      this.report(rangeOf(node), `Invalid check. ${usage}`);
      return undefined;
    }
    const pair = node.items[0]!;
    const kind = this.keyName(pair.key);
    if (kind === undefined) return undefined;
    if (!isCheckKind(kind)) {
      this.report(rangeOf(pair.key), `Unknown check \`${kind}\`. ${usage}`);
      return undefined;
    }
    const valueNode = this.resolve(pair.value as Node | null) ?? (pair.key as Node);
    const value = this.text(valueNode, kind);
    if (value === undefined) return undefined;
    if (value.trim() === '') {
      this.report(rangeOf(valueNode), `\`${kind}\` must not be empty`);
      return undefined;
    }
    return { [kind]: value } as Check;
  }

  private requiredText(
    node: Node | undefined,
    field: string,
    headRange: [number, number],
  ): string | undefined {
    if (!node) {
      this.report(headRange, `Missing \`${field}\``);
      return undefined;
    }
    const value = this.text(node, field);
    if (value !== undefined && value.trim() === '') {
      this.report(rangeOf(node), `\`${field}\` must not be empty`);
      return undefined;
    }
    return value;
  }

  private text(node: Node | undefined, field: string): string | undefined {
    if (isScalar(node) && typeof node.value === 'string') return node.value;
    this.report(rangeOf(node), `\`${field}\` must be text`);
    return undefined;
  }

  private keyName(key: unknown): string | undefined {
    const node = this.resolve(key as Node | null);
    if (isScalar(node) && typeof node.value === 'string') return node.value;
    this.report(rangeOf(node), 'Field names must be plain text');
    return undefined;
  }

  private resolve(node: Node | null | undefined): Node | undefined {
    if (isAlias(node)) return node.resolve(this.doc) ?? undefined;
    return node ?? undefined;
  }

  private lineOf(node: Node): number {
    return this.lineCounter.linePos(rangeOf(node)[0]).line;
  }
}

function rangeOf(node: unknown): [number, number] {
  const range = (node as Node | undefined)?.range;
  return range ? [range[0], range[1]] : [0, 0];
}

function firstLine(message: string): string {
  return message.split('\n', 1)[0]!.replace(/ at line \d+, column \d+:?$/, '');
}
