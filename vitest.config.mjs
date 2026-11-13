import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: { ROOM_SECRET: 'test-secret-not-for-production', ALLOWED_ORIGINS: 'http://localhost:8787', PBKDF2_ITERATIONS: '1000' }
      }
    })
  ],
  test: { include: ['tests/server/**/*.test.js'] }
});
