import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      './types.js': '/src/types.ts',
      './errors.js': '/src/errors.ts',
      './logger.js': '/src/logger.ts',
      './types.ts': '/src/types.ts',
      './errors.ts': '/src/errors.ts',
      './logger.ts': '/src/logger.ts',
    },
  },
});
