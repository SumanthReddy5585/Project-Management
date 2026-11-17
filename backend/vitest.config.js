import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    env: { NODE_ENV: 'test' },
    setupFiles: ['./test/setup-env.js'],
    testTimeout: 20000,
  },
});
