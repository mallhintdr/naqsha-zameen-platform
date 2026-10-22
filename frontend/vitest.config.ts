import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  define: { __BUILD_META__: JSON.stringify({ version: 'test', buildDate: 0 }) },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
