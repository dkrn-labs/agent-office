import { WebSocketServer } from 'ws';
import * as EVENTS from '../core/events.js';

// All known event name constants from events.js
const KNOWN_EVENTS = Object.values(EVENTS);

/**
 * Creates a WebSocket hub that broadcasts bus events to all connected clients.
 *
 * @param {import('node:http').Server} server  The underlying HTTP server.
 * @param {ReturnType<import('../core/event-bus.js').createEventBus>} bus
 * @returns {{ wss: WebSocketServer, broadcast: (event: string, payload: any) => void }}
 */
export function createWsHub(server, bus) {
  const wss = new WebSocketServer({ server, path: '/ws/dashboard' });

  /** @type {Set<import('ws').WebSocket>} */
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  /**
   * Broadcast a message to all open clients.
   * @param {string} event
   * @param {*} payload
   */
  function broadcast(event, payload) {
    const message = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    }
  }

  // Subscribe to every known event and forward to clients
  for (const eventName of KNOWN_EVENTS) {
    bus.on(eventName, (payload) => broadcast(eventName, payload));
  }

  return { wss, broadcast };
}
