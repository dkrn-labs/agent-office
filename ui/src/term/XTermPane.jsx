import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';

/**
 * Real xterm.js pane bound to a node-pty session over WebSocket.
 *
 * Props:
 *   ptyId    — required; identifies the backend PTY session.
 *
 * Connects to ws://<host>/ws/pty/<ptyId>. Server-side replay buffer
 * means a reload during a live session still resumes with recent output.
 */
export default function XTermPane({ ptyId }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !ptyId) return undefined;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"SF Mono", Menlo, ui-monospace, monospace',
      fontSize: 12,
      theme: {
        background: '#000000',
        foreground: '#cbd5e1',
        cursor: '#7dd3fc',
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Open WS — relative URL works through Vite proxy in dev and same-origin
    // in prod. In dev we must hit the backend port directly because Vite's
    // default proxy doesn't upgrade arbitrary WS paths.
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.hostname;
    const port = window.location.port === '5174' || window.location.port === '5173' ? '3334' : window.location.port;
    const wsUrl = `${proto}://${host}:${port}/ws/pty/${ptyId}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    const decoder = new TextDecoder();
    ws.onopen = () => {
      // Send initial size
      try {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      } catch {}
    };
    ws.onmessage = (e) => {
      const data = typeof e.data === 'string' ? e.data : decoder.decode(new Uint8Array(e.data));
      term.write(data);
    };
    ws.onerror = () => {
      term.write('\r\n\x1b[31m[xterm: ws error]\x1b[0m\r\n');
    };
    ws.onclose = (ev) => {
      term.write(`\r\n\x1b[2m[ws closed code=${ev.code}]\x1b[0m\r\n`);
    };

    const dataDispose = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const resizeDispose = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'resize', cols, rows })); } catch {}
      }
    });

    const onWindowResize = () => {
      try { fit.fit(); } catch {}
    };
    window.addEventListener('resize', onWindowResize);
    const fitInterval = setInterval(onWindowResize, 1000);

    return () => {
      clearInterval(fitInterval);
      window.removeEventListener('resize', onWindowResize);
      dataDispose.dispose();
      resizeDispose.dispose();
      try { ws.close(); } catch {}
      try { term.dispose(); } catch {}
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [ptyId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden bg-black"
      style={{ minHeight: 0 }}
    />
  );
}
