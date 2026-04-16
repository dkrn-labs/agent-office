#!/usr/bin/env node

import process from 'node:process';
import { buildHistoryIngestPayload } from '../src/history/hook-bridge.js';

function parseArgs(argv) {
  const args = { provider: null, apiBase: process.env.AGENT_OFFICE_BASE_URL ?? 'http://127.0.0.1:3333', notifyJsonArg: false };
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
  if (!args.provider) {
    console.error('Missing required --provider');
    process.stdout.write('{}\n');
    process.exit(0);
  }

  const rawInput = args.notifyJsonArg
    ? process.argv[process.argv.length - 1]
    : await readStdin();
  const input = parseJson(rawInput);

  if (!input) {
    process.stdout.write('{}\n');
    process.exit(0);
  }

  const payload = buildHistoryIngestPayload(args.provider, input, { cwd: process.cwd() });
  if (!payload) {
    process.stdout.write('{}\n');
    process.exit(0);
  }

  try {
    await postPayload(args.apiBase, payload);
  } catch (err) {
    // Hooks should not block the agent on telemetry/history failures.
    console.error(String(err?.message ?? err));
  }

  process.stdout.write('{}\n');
}

await main();
