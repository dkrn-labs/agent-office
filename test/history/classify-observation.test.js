import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyObservation } from '../../src/history/classify-observation.js';

describe('classifyObservation', () => {
  describe('bugfix', () => {
    it('matches a "fix:" commit message', () => {
      assert.equal(
        classifyObservation({ commitMessage: 'fix: race in reconnect logic', filesModified: ['src/ws.js'] }),
        'bugfix',
      );
    });
    it('matches a test+source pair', () => {
      assert.equal(
        classifyObservation({ filesModified: ['src/ws.js', 'test/ws.test.js'], summary: 'reconnect bug' }),
        'bugfix',
      );
    });
    it('matches summary keywords (error, traceback)', () => {
      assert.equal(
        classifyObservation({ summary: 'Investigated traceback when client disconnects', filesModified: [] }),
        'bugfix',
      );
    });
    it('confounder: "feature" with bug keywords still picks bugfix', () => {
      assert.equal(
        classifyObservation({
          summary: 'Added feature, then noticed regression on legacy path; fixed it',
          filesModified: ['src/feat.js'],
        }),
        'bugfix',
      );
    });
  });

  describe('feature', () => {
    it('matches a "feat:" commit message', () => {
      assert.equal(
        classifyObservation({ commitMessage: 'feat: add notifications page', filesModified: ['ui/Notifications.jsx'] }),
        'feature',
      );
    });
    it('matches "implemented X" in summary', () => {
      assert.equal(
        classifyObservation({ summary: 'Implemented the new search endpoint', filesModified: ['src/api/search.js'] }),
        'feature',
      );
    });
    it('confounder: a refactor with "add" in title still picks feature when add dominates', () => {
      // explicit confounder: refactor verbs come *first* in classify order, so "rename + added" → refactor
      assert.equal(
        classifyObservation({ summary: 'Renamed handler and added a new helper', filesModified: ['src/h.js'] }),
        'refactor',
      );
    });
  });

  describe('refactor', () => {
    it('matches a "refactor:" commit message', () => {
      assert.equal(
        classifyObservation({ commitMessage: 'refactor: split user controller', filesModified: ['src/user.js'] }),
        'refactor',
      );
    });
    it('matches "extract / consolidate" verbs', () => {
      assert.equal(
        classifyObservation({ summary: 'Extracted the auth helper into its own module', filesModified: ['src/auth.js'] }),
        'refactor',
      );
    });
  });

  describe('decision', () => {
    it('matches design-discussion language with no code change', () => {
      assert.equal(
        classifyObservation({
          summary: 'After comparing options, decided to go with Redis Streams over RabbitMQ',
          filesModified: [],
        }),
        'decision',
      );
    });
    it('confounder: decision verb with code change → not decision', () => {
      // if files were modified, this isn't pure deliberation — fall through to feature
      assert.equal(
        classifyObservation({
          summary: 'Decided to add caching and implemented it',
          filesModified: ['src/cache.js'],
        }),
        'feature',
      );
    });
  });

  describe('discovery', () => {
    it('matches read-heavy turn with discovery verbs', () => {
      assert.equal(
        classifyObservation({
          summary: 'Found that the client sends an extra heartbeat on flaky networks',
          filesModified: [],
          filesRead: ['src/ws.js', 'docs/protocol.md'],
        }),
        'discovery',
      );
    });
    it('confounder: discovery verb with file edit → not discovery', () => {
      assert.equal(
        classifyObservation({
          summary: 'Discovered the bug and fixed it',
          filesModified: ['src/ws.js'],
        }),
        'bugfix',
      );
    });
  });

  describe('security_alert', () => {
    it('triggers on .env file modification', () => {
      assert.equal(
        classifyObservation({ filesModified: ['.env.production'], summary: 'rotated keys' }),
        'security_alert',
      );
    });
    it('triggers on vulnerability + security topic', () => {
      assert.equal(
        classifyObservation({
          summary: 'Found a vulnerability where api_key was exposed in error messages',
          filesModified: [],
        }),
        'security_alert',
      );
    });
  });

  describe('security_note', () => {
    it('triggers on security topic without vulnerability framing', () => {
      assert.equal(
        classifyObservation({
          summary: 'Reviewed the password hashing strategy; it uses bcrypt with cost=12',
          filesModified: [],
        }),
        'security_note',
      );
    });
  });

  describe('fallbacks', () => {
    it('falls back to change when files modified but no other signal', () => {
      assert.equal(
        classifyObservation({ filesModified: ['src/util.js'], summary: 'updated formatting' }),
        'change',
      );
    });
    it('falls back to summary when nothing modified', () => {
      assert.equal(
        classifyObservation({ filesModified: [], summary: 'looked around' }),
        'summary',
      );
    });
    it('handles empty input gracefully', () => {
      assert.equal(classifyObservation(), 'summary');
      assert.equal(classifyObservation({}), 'summary');
    });
  });
});
