import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { ImageAddon } from 'xterm-addon-image';
import 'xterm/css/xterm.css';
import { installClipboardImagePaste, blobToBase64 } from '../lib/clipboard-image-paste.js';

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
    // P4-B2 — inline image OUTPUT (SIXEL + iTerm protocol). Image
    // *input* (clipboard paste) is handled by installClipboardImagePaste
    // below.
    term.loadAddon(new ImageAddon());

    term.open(containerRef.current);
    fit.fit();

    // P4-B4 — clipboard image paste end-to-end:
    //   1. Browser paste handler picks up the image blob.
    //   2. POST to /api/paste/image saves it under ~/.agent-office/paste/<uuid>.<ext>.
    //   3. The returned absolute path is "typed" at the cursor as a string,
    //      so Claude Code / Codex can attach it natively from the prompt.
    const pasteDispose = installClipboardImagePaste(containerRef.current, {
      onImage: async (blob, mime) => {
        try {
          const dataBase64 = await blobToBase64(blob);
          const proto = window.location.protocol === 'https:' ? 'https' : 'http';
          const host = window.location.hostname;
          const apiPort = window.location.port === '5174' || window.location.port === '5173' ? '3334' : window.location.port;
          const res = await fetch(`${proto}://${host}:${apiPort}/api/paste/image`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mime, dataBase64 }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            term.write(`\r\n\x1b[31m[paste: ${err.error ?? `HTTP ${res.status}`}]\x1b[0m\r\n`);
            return;
          }
          const { data } = await res.json();
          // Type the path at the cursor (with trailing space) so the CLI
          // sees it like the user typed it. paste() preserves bracketed-
          // paste semantics where the terminal supports them.
          term.paste(`${data.path} `);
        } catch (err) {
          term.write(`\r\n\x1b[31m[paste failed: ${err?.message ?? err}]\x1b[0m\r\n`);
        }
      },
    });

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
      try { pasteDispose(); } catch {}
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
