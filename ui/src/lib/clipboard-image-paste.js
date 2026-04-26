/**
 * installClipboardImagePaste(hostElement, { onImage })
 *
 * Listens for `paste` on the xterm.js host element. If the clipboard
 * carries an image blob, calls `onImage(blob, mime)` and prevents the
 * default paste so xterm.js doesn't pipe binary garbage through the
 * PTY. If the clipboard is text-only, falls through unchanged.
 *
 * Returns a teardown fn for React `useEffect`.
 *
 * Pure DOM — no React, no xterm.js imports — so it can be unit-tested
 * with a synthesized ClipboardEvent.
 */
export function installClipboardImagePaste(hostElement, { onImage } = {}) {
  if (!hostElement || typeof hostElement.addEventListener !== 'function') {
    throw new Error('installClipboardImagePaste: hostElement must be a DOM element');
  }
  if (typeof onImage !== 'function') {
    throw new Error('installClipboardImagePaste: onImage callback is required');
  }

  function handlePaste(ev) {
    const items = ev.clipboardData?.items;
    if (!items || items.length === 0) return;
    let imageItem = null;
    for (const it of items) {
      if (it?.kind === 'file' && typeof it.type === 'string' && it.type.startsWith('image/')) {
        imageItem = it;
        break;
      }
    }
    if (!imageItem) return; // text/html paste — let the default handler run.
    ev.preventDefault();
    ev.stopPropagation();
    const blob = imageItem.getAsFile();
    if (!blob) return;
    Promise.resolve(onImage(blob, imageItem.type)).catch(() => {
      // Swallow — caller is responsible for surfacing errors via UI state.
    });
  }

  hostElement.addEventListener('paste', handlePaste, { capture: true });
  return () => hostElement.removeEventListener('paste', handlePaste, { capture: true });
}

/**
 * Convert a Blob to a base64 string (without the data: prefix).
 * Useful for the POST /api/paste/image body.
 */
export async function blobToBase64(blob) {
  if (typeof FileReader === 'undefined') {
    // Node fallback — not used in browser, but keeps the helper test-friendly.
    const buf = Buffer.from(await blob.arrayBuffer());
    return buf.toString('base64');
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const dataUrl = String(r.result ?? '');
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    r.readAsDataURL(blob);
  });
}
