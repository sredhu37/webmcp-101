import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{server,web}/**/*.test.{ts,tsx}'],
  },
});
