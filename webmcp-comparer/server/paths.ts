import { fileURLToPath } from 'node:url';

const fromRoot = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));

export const viteConfigFile = fromRoot('vite.config.ts');
export const webRoot = fromRoot('web');
export const webDist = fromRoot('dist/web');
export const runsDir = fromRoot('runs');
export const envFile = fromRoot('.env');
/** The default Suite in Setup: the scenarios for the shop in ../app (the webmcp-101 monorepo). */
export const defaultSuiteFile = fromRoot('../app/suite.yaml');
