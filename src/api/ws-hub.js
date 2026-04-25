import { WebSocketServer } from 'ws';
import * as EVENTS from '../core/events.js';

const KNOWN_EVENTS = Object.values(EVENTS);

/**
 * Creates a WebSocket hub that routes upgrade requests to the right
 * sub-server by URL path:
 *
 *   /ws/dashboard       → broadcasts bus events
 *   /ws/pty/<ptyId>     → bidirectional bytes for an xterm session
 *
 * @param {import('node:http').Server} server
 * @param {ReturnType<import('../core/event-bus.js').createEventBus>} bus
 * @param {{ ptyHost?: ReturnType<import('../pty/node-pty-host.js').createPtyHost> }} [opts]
 */
export function createWsHub(server, bus, { ptyHost } = {}) {
  const dashboardWss = new WebSocketServer({ noServer: true });
  const ptyWss = new WebSocketServer({ noServer: true });

  /** @type {Set<import('ws').WebSocket>} */
  const dashboardClients = new Set();

  dashboardWss.on('connection', (ws) => {
    dashboardClients.add(ws);
    ws.on('close', () => dashboardClients.delete(ws));
    ws.on('error', () => dashboardClients.delete(ws));
  });

  ptyWss.on('connection', (ws, _req, ptyId) => {
    if (!ptyHost) {
      try { ws.close(1011, 'pty host not available'); } catch {}
      return;
    }
    ptyHost.attach(ptyId, ws);
  });

  // Single upgrade router
  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname === '/ws/dashboard') {
      dashboardWss.handleUpgrade(req, socket, head, (ws) => dashboardWss.emit('connection', ws, req));
      return;
    }
    if (pathname.startsWith('/ws/pty/')) {
      const ptyId = pathname.slice('/ws/pty/'.length);
      if (!ptyId) {
        socket.destroy();
        return;
      }
      ptyWss.handleUpgrade(req, socket, head, (ws) => ptyWss.emit('connection', ws, req, ptyId));
      return;
    }
    socket.destroy();
  });

  function broadcast(event, payload) {
    const message = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
    for (const client of dashboardClients) {
      if (client.readyState === client.OPEN) client.send(message);
    }
  }

  for (const eventName of KNOWN_EVENTS) {
    bus.on(eventName, (payload) => broadcast(eventName, payload));
  }

  return { dashboardWss, ptyWss, broadcast };
}
