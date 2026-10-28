import { runPricesCheck } from './official-pages.ts';

process.exitCode = await runPricesCheck();
