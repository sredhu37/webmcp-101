import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SavedScreenshot } from './tool.ts';

/**
 * The screenshots folder of one Lane in a Run. Files are numbered in the order taken across all
 * Scenarios and Attempts: `NNN-<scenario-id>-attempt-<n>.jpg`. Only agent screenshots are saved
 * here, so the counter is also the Lane's screenshot count.
 */
export class ScreenshotFiles {
  readonly dir: string;
  #count = 0;

  constructor(dir: string) {
    this.dir = dir;
  }

  get count(): number {
    return this.#count;
  }

  async save(
    jpeg: Buffer,
    scenarioId: string,
    attempt: number,
    size: { width: number; height: number },
  ): Promise<SavedScreenshot> {
    await mkdir(this.dir, { recursive: true });
    const number = ++this.#count;
    const fileName = screenshotFileName(number, scenarioId, attempt);
    const path = join(this.dir, fileName);
    await writeFile(path, jpeg);
    return { fileName, path, ...size };
  }
}

export function screenshotFileName(number: number, scenarioId: string, attempt: number): string {
  return `${String(number).padStart(3, '0')}-${scenarioId}-attempt-${attempt}.jpg`;
}
