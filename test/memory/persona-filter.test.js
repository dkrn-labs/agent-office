import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterObservationsForPersona } from '../../src/memory/persona-filter.js';

const obs = (id, type, files) => ({
  id,
  title: `obs ${id}`,
  subtitle: null,
  narrative: '',
  type,
  filesModified: files,
  createdAt: `2026-04-${10 + id}`,
});

describe('filterObservationsForPersona', () => {
  it('filters frontend by ui/ and .jsx paths', () => {
    const observations = [
      obs(1, 'feature', ['ui/src/App.jsx']),
      obs(2, 'bugfix', ['src/api/routes/users.js']),
      obs(3, 'feature', ['ui/src/components/Button.tsx']),
    ];
    const result = filterObservationsForPersona(observations, { domain: 'frontend' });
    assert.deepEqual(result.map((o) => o.id), [3, 1]);
  });

  it('filters backend by /api/, /db/, /src/ (non-ui)', () => {
    const observations = [
      obs(1, 'feature', ['src/api/routes/users.js']),
      obs(2, 'feature', ['ui/src/App.jsx']),
      obs(3, 'bugfix', ['src/db/migrations/001.js']),
    ];
    const result = filterObservationsForPersona(observations, { domain: 'backend' });
    assert.deepEqual(result.map((o) => o.id).sort(), [1, 3]);
  });

  it('filters debug by type=bugfix regardless of files', () => {
    const observations = [
      obs(1, 'feature', ['ui/src/App.jsx']),
      obs(2, 'bugfix', ['src/api/routes/users.js']),
      obs(3, 'bugfix', ['ui/src/thing.jsx']),
    ];
    const result = filterObservationsForPersona(observations, { domain: 'debug' });
    assert.equal(result.length, 2);
    assert.ok(result.every((o) => o.type === 'bugfix'));
  });

  it('filters review by type=refactor', () => {
    const observations = [
      obs(1, 'feature', ['ui/src/App.jsx']),
      obs(2, 'refactor', ['src/api/routes/users.js']),
    ];
    const result = filterObservationsForPersona(observations, { domain: 'review' });
    assert.deepEqual(result.map((o) => o.id), [2]);
  });

  it('filters devops by docker/ci/yaml/deploy patterns', () => {
    const observations = [
      obs(1, 'feature', ['ui/src/App.jsx']),
      obs(2, 'feature', ['.github/workflows/ci.yml']),
      obs(3, 'feature', ['docker-compose.yml']),
    ];
    const result = filterObservationsForPersona(observations, { domain: 'devops' });
    assert.deepEqual(result.map((o) => o.id).sort(), [2, 3]);
  });

  it('returns at most limit items', () => {
    const observations = Array.from({ length: 20 }, (_, i) =>
      obs(i + 1, 'feature', ['ui/src/App.jsx']),
    );
    const result = filterObservationsForPersona(observations, { domain: 'frontend' }, { limit: 5 });
    assert.equal(result.length, 5);
  });

  it('unknown domain returns empty', () => {
    const observations = [obs(1, 'feature', ['anywhere'])];
    const result = filterObservationsForPersona(observations, { domain: 'nonsense' });
    assert.deepEqual(result, []);
  });
});
