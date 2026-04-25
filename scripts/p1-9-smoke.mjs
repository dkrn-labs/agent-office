import { WebSocket } from 'ws';

const PTY_ID = process.argv[2];
if (!PTY_ID) {
  console.error('usage: node p1-9-smoke.mjs <ptyId>');
  process.exit(2);
}

const ws = new WebSocket(`ws://127.0.0.1:3334/ws/pty/${PTY_ID}`);
let bytesIn = 0;
let firstChunk = null;

ws.on('open', () => {
  console.log('[ws open]');
  // Send initial size
  ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
  // Send a command
  setTimeout(() => ws.send('echo p1-9-smoke-OK && exit\r'), 200);
});

ws.on('message', (data) => {
  bytesIn += data.length;
  if (!firstChunk) firstChunk = data.toString('utf8').slice(0, 60);
});

ws.on('close', (code) => {
  console.log(`[ws close code=${code}] received ${bytesIn} bytes`);
  console.log('first chunk:', JSON.stringify(firstChunk));
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[ws error]', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('[smoke timeout]');
  process.exit(1);
}, 8000);
