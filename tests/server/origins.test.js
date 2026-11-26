import { describe, it, expect } from 'vitest';
import { isOriginAllowed } from '../../server/src/origins.js';

const production = 'https://deep-work-timer.gregoryrichens.workers.dev';
const previews = 'https://*-deep-work-timer.gregoryrichens.workers.dev';

describe('allowed origins', () => {
  it('preserves exact production and local origin matching', () => {
    expect(isOriginAllowed(production, production)).toBe(true);
    expect(isOriginAllowed('http://localhost:8787', 'http://localhost:8787')).toBe(true);
    expect(isOriginAllowed('https://branch-deep-work-timer.gregoryrichens.workers.dev', production)).toBe(false);
    expect(isOriginAllowed(production, '')).toBe(false);
    expect(isOriginAllowed(null, previews)).toBe(false);
    expect(isOriginAllowed('null', previews)).toBe(false);
  });

  it('allows different branch names and deployment ids with one preview pattern', () => {
    for (const prefix of ['feature-room-infra', 'fix-123', 'a', 'a1b2c3d4']) {
      expect(isOriginAllowed(`https://${prefix}-deep-work-timer.gregoryrichens.workers.dev`, previews)).toBe(true);
    }
    expect(isOriginAllowed(production, `${previews}, ${production}`)).toBe(true);
  });

  it.each([
    production,
    'http://branch-deep-work-timer.gregoryrichens.workers.dev',
    'https://branch-deep-work-timer.gregoryrichens.workers.dev:8443',
    'https://branch-deep-work-timer.someone-else.workers.dev',
    'https://branch-another-worker.gregoryrichens.workers.dev',
    'https://branch-deep-work-timer.gregoryrichens.workers.dev.evil.example',
    'https://evil.example/branch-deep-work-timer.gregoryrichens.workers.dev',
    'https://nested.branch-deep-work-timer.gregoryrichens.workers.dev',
    'https://user@branch-deep-work-timer.gregoryrichens.workers.dev',
    'https://branch-deep-work-timer.gregoryrichens.workers.dev/',
    'https://branch-deep-work-timer.gregoryrichens.workers.dev?x=1',
    'https://-deep-work-timer.gregoryrichens.workers.dev',
    'https://-branch-deep-work-timer.gregoryrichens.workers.dev',
    'not a URL'
  ])('rejects an origin outside the preview pattern: %s', (origin) => {
    expect(isOriginAllowed(origin, previews)).toBe(false);
  });

  it.each(['*', 'https://*', 'https://*.workers.dev', 'https://*.gregoryrichens.workers.dev'])('rejects a broader wildcard: %s', (pattern) => {
    expect(isOriginAllowed('https://branch-deep-work-timer.gregoryrichens.workers.dev', pattern)).toBe(false);
  });
});
