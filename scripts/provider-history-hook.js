#!/usr/bin/env node

import process from 'node:process';
import os from 'node:os';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHistoryIngestPayload } from '../src/history/hook-bridge.js';

const HOOK_LOG_PATH = join(os.homedir(), '.agent-office', 'logs', 'provider-hook.log');
const HOOK_LOG_ENABLED = process.env.AGENT_OFFICE_HOOK_DEBUG !== '0';

function logHook(record) {
  if (!HOOK_LOG_ENABLED) return;
  try {
    mkdirSync(join(os.homedir(), '.agent-office', 'logs'), { recursive: true });
    appendFileSync(HOOK_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n');
  } catch {
    // logging is best-effort; never block the hook
  }
}

function resolveApiBase() {
  const explicit = process.env.AGENT_OFFICE_BASE_URL?.trim();
  if (explicit) return explicit;

  const configPath = join(os.homedir(), '.agent-office', 'config.json');
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const port = Number(config?.port);
    if (Number.isInteger(port) && port > 0) {
      return `http://127.0.0.1:${port}`;
    }
  } catch {}

  return 'http://127.0.0.1:3333';
}

function parseArgs(argv) {
  const args = { provider: null, apiBase: resolveApiBase(), notifyJsonArg: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--provider') {
      args.provider = argv[index + 1] ?? null;
      index += 1;
    } else if (token === '--api-base') {
      args.apiBase = argv[index + 1] ?? args.apiBase;
      index += 1;
    } else if (token === '--notify-json-arg') {
      args.notifyJsonArg = true;
    }
  }
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function postPayload(apiBase, payload) {
  const response = await fetch(`${apiBase}/api/history/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`history ingest failed (${response.status}): ${text}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  logHook({ stage: 'invoked', provider: args.provider, apiBase: args.apiBase, notifyJsonArg: args.notifyJsonArg, cwd: process.cwd() });

  if (!args.provider) {
    console.error('Missing required --provider');
    logHook({ stage: 'exit', reason: 'missing_provider' });
    process.stdout.write('{}\n');
    process.exit(0);
  }

  const rawInput = args.notifyJsonArg
    ? process.argv[process.argv.length - 1]
    : await readStdin();
  const input = parseJson(rawInput);
  logHook({
    stage: 'input',
    provider: args.provider,
    rawLength: rawInput?.length ?? 0,
    inputKeys: input ? Object.keys(input) : null,
    parsed: input != null,
  });

  if (!input) {
    logHook({ stage: 'exit', provider: args.provider, reason: 'no_input' });
    process.stdout.write('{}\n');
    process.exit(0);
  }

  const historySessionIdEnv = Number(process.env.AGENT_OFFICE_HISTORY_SESSION_ID);
  const historySessionId = Number.isInteger(historySessionIdEnv) && historySessionIdEnv > 0
    ? historySessionIdEnv
    : null;

  const payload = buildHistoryIngestPayload(args.provider, input, {
    cwd: process.cwd(),
    historySessionId,
  });
  logHook({
    stage: 'payload',
    provider: args.provider,
    built: payload != null,
    historySessionId,
    payloadKeys: payload ? Object.keys(payload) : null,
    summaryFilesEdited: payload?.summary?.filesEdited?.length ?? 0,
    observations: payload?.observations?.length ?? 0,
  });
  if (!payload) {
    logHook({ stage: 'exit', provider: args.provider, reason: 'builder_returned_null' });
    process.stdout.write('{}\n');
    process.exit(0);
  }

  try {
    await postPayload(args.apiBase, payload);
    logHook({ stage: 'exit', provider: args.provider, reason: 'ok' });
  } catch (err) {
    // Hooks should not block the agent on telemetry/history failures.
    console.error(String(err?.message ?? err));
    logHook({ stage: 'exit', provider: args.provider, reason: 'post_failed', error: String(err?.message ?? err) });
  }

  process.stdout.write('{}\n');
}

await main();
