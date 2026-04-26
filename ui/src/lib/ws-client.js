/**
 * WebSocket client with exponential-backoff reconnection.
 *
 * Usage:
 *   const client = createWsClient(store);
 *   // later:
 *   client.close();
 */

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws/dashboard`;
}

export function createWsClient(store) {
  let ws = null;
  let attempt = 0;
  let reconnectTimer = null;
  let closed = false;

  function connect() {
    if (closed) return;

    ws = new WebSocket(wsUrl());

    ws.addEventListener('open', () => {
      attempt = 0;
      store.getState().setConnected(true);
    });

    ws.addEventListener('message', (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return; // ignore malformed frames
      }

      const { event, payload } = msg;
      const state = store.getState();

      switch (event) {
        case 'session:started':
          state.onSessionStarted(payload);
          break;
        case 'session:update':
          state.onSessionUpdate(payload);
          break;
        case 'session:idle':
          state.onSessionIdle(payload);
          break;
        case 'session:ended':
          state.onSessionEnded(payload);
          break;
        case 'session:awaiting-outcome':
          state.onSessionAwaitingOutcome?.(payload);
          break;
        case 'session:outcome:updated':
          state.dismissAwaitingOutcome?.(payload?.historySessionId);
          break;
        case 'activity:tick':
          state.onActivityTick(payload);
          break;
        default:
          // unknown event — ignore
          break;
      }
    });

    ws.addEventListener('close', () => {
      store.getState().setConnected(false);
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // 'close' fires right after 'error', so reconnection is handled there
    });
  }

  function scheduleReconnect() {
    if (closed) return;
    const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
    attempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  }

  connect();

  return {
    close() {
      closed = true;
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
        ws = null;
      }
    },
  };
}
