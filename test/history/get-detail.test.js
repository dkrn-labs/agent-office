import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from '../helpers/test-context.js';

test('historyStore.getDetail returns enriched shape matching legacy getSessionDetail', async (t) => {
  const ctx = await createTestContext();
  t.after(() => ctx.cleanup());
  const { repo, projectHistory } = ctx;

  const projectId = Number(repo.createProject({ name: 'demo', path: '/tmp/demo', techStack: [] }));
  const personaId = Number(repo.createPersona({ label: 'engineer', domain: 'code' }));
  const startedAt = new Date().toISOString();

  const { historySessionId } = projectHistory.createLaunch({
    projectId,
    personaId,
    providerId: 'claude-code',
    startedAt,
    model: 'claude-opus-4-7',
    systemPrompt: 'sp',
  });

  repo.upsertHistorySessionMetrics(historySessionId, {
    tokensIn: 10,
    tokensOut: 20,
    tokensCacheRead: 5,
    tokensCacheWrite: 2,
    costUsd: 0.05,
    lastModel: 'claude-opus-4-7',
  });

  const detail = projectHistory.getDetail(historySessionId);

  assert.equal(detail.sessionId, historySessionId);
  assert.equal(detail.providerId, 'claude-code');
  assert.equal(detail.projectId, projectId);
  assert.equal(detail.personaId, personaId);
  assert.equal(detail.projectName, 'demo');
  assert.equal(detail.projectPath, '/tmp/demo');
  assert.equal(detail.personaLabel, 'engineer');
  assert.equal(detail.personaDomain, 'code');
  assert.equal(detail.startedAt, startedAt);
  assert.equal(detail.tokensIn, 10);
  assert.equal(detail.tokensOut, 20);
  assert.equal(detail.tokensCacheRead, 5);
  assert.equal(detail.tokensCacheWrite, 2);
  assert.equal(detail.totalTokens, 37);
  assert.equal(detail.costUsd, 0.05);
  assert.equal(detail.lastModel, 'claude-opus-4-7');
});

test('historyStore.getDetail returns null for unknown id', async (t) => {
  const ctx = await createTestContext();
  t.after(() => ctx.cleanup());
  assert.equal(ctx.projectHistory.getDetail(99999), null);
});
