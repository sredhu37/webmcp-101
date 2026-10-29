import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { LaneId } from '../lane/browser.ts';
import { LANES, type Results } from './results.ts';

export const RESULTS_FILE = 'results.json';

/** `2026-10-15_14-30-05`, with `-2`, `-3` ... when a folder of that second already exists. */
export const RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+)?$/;

/** Agent screenshot names: `NNN-<scenario-id>-attempt-<n>.jpg`. */
const SCREENSHOT_PATTERN = /^\d{3,}-[a-z0-9]+(?:-[a-z0-9]+)*-attempt-\d+\.jpg$/;

export function isRunId(id: string): boolean {
  return RUN_ID_PATTERN.test(id);
}

/** The Run folder name for a start time, in local time. */
export function runIdFor(date: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}_` +
    `${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}`
  );
}

/** Creates `runs/<start-time>/` and returns its id and path. */
export async function createRunFolder(
  runsDir: string,
  startedAt: Date,
): Promise<{ id: string; dir: string }> {
  await mkdir(runsDir, { recursive: true });
  const base = runIdFor(startedAt);
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
    const dir = join(runsDir, id);
    try {
      await mkdir(dir);
      return { id, dir };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** Writes results.json through a temporary file, so readers never see half a file. */
export async function writeResults(dir: string, results: Results): Promise<void> {
  const path = join(dir, RESULTS_FILE);
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(results, null, 2)}\n`);
  await rename(temporary, path);
}

export async function readResults(runsDir: string, id: string): Promise<Results | null> {
  if (!isRunId(id)) return null;
  try {
    return JSON.parse(await readFile(join(runsDir, id, RESULTS_FILE), 'utf8')) as Results;
  } catch {
    return null;
  }
}

export function runFolder(runsDir: string, id: string): string | null {
  if (!isRunId(id)) return null;
  const dir = join(runsDir, id);
  return existsSync(dir) ? dir : null;
}

/** One entry of the Past Runs list. */
export interface RunListItem {
  id: string;
  startedAt: string;
  endedAt: string | null;
  siteUrl: string;
  provider: string;
  model: string;
  attempts: number;
  scenarioIds: string[];
  pass: Record<LaneId, { pass: number; fail: number }>;
  stoppedByUser: boolean;
  /** True for the Run in progress. */
  running: boolean;
}

/** Runs with a readable results.json, newest first. */
export async function listRuns(runsDir: string, runningId: string | null): Promise<RunListItem[]> {
  let names: string[];
  try {
    names = await readdir(runsDir);
  } catch {
    return [];
  }
  const items: RunListItem[] = [];
  for (const id of names.filter(isRunId)) {
    const results = await readResults(runsDir, id);
    if (!results?.run) continue;
    const { run, summary } = results;
    items.push({
      id,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      siteUrl: run.siteUrl,
      provider: run.provider,
      model: run.model,
      attempts: run.attempts,
      scenarioIds: run.scenarioIds,
      pass: Object.fromEntries(
        LANES.map((lane) => [
          lane,
          { pass: summary?.[lane]?.pass ?? 0, fail: summary?.[lane]?.fail ?? 0 },
        ]),
      ) as RunListItem['pass'],
      stoppedByUser: run.stoppedByUser,
      running: id === runningId,
    });
  }
  return items.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
}

/** Path of an agent screenshot in a Run folder, or null for anything else. */
export function screenshotPath(
  runsDir: string,
  id: string,
  lane: string,
  file: string,
): string | null {
  if (!isRunId(id) || !(LANES as readonly string[]).includes(lane)) return null;
  if (!SCREENSHOT_PATTERN.test(file)) return null;
  const path = join(runsDir, id, lane, 'screenshots', file);
  return existsSync(path) ? path : null;
}

export function readStream(path: string): Readable {
  return createReadStream(path);
}

/**
 * The Run folder as a zip stream, entries under `<id>/`. JPEG screenshots are stored as they
 * are (already compressed); text files are deflated. Files are read one at a time.
 */
export function zipRunFolder(dir: string, id: string): Readable {
  const out = new PassThrough();
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      out.destroy(error);
      return;
    }
    out.write(chunk);
    if (final) out.end();
  });

  void (async () => {
    for (const path of await filesUnder(dir)) {
      const name = `${id}/${relative(dir, path).split(sep).join('/')}`;
      const entry = path.endsWith('.jpg') ? new ZipPassThrough(name) : new ZipDeflate(name);
      entry.mtime = (await stat(path)).mtime;
      zip.add(entry);
      entry.push(await readFile(path), true);
    }
    zip.end();
  })().catch((error: unknown) => {
    zip.terminate();
    out.destroy(error instanceof Error ? error : new Error(String(error)));
  });
  return out;
}

/** Every file below `dir`, sorted, without temporary files. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.endsWith('.tmp'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}
