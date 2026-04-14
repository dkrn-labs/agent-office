import { useEffect, useRef } from 'react';
import { useOfficeStore } from '../stores/office-store.js';

function formatRelative(isoOrDate) {
  if (!isoOrDate) return '';
  const then = new Date(isoOrDate).getTime();
  if (Number.isNaN(then)) return String(isoOrDate);
  const deltaSec = Math.max(0, (Date.now() - then) / 1000);
  if (deltaSec < 60)        return 'just now';
  if (deltaSec < 3600)      return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400)     return `${Math.floor(deltaSec / 3600)}h ago`;
  if (deltaSec < 604800)    return `${Math.floor(deltaSec / 86400)}d ago`;
  return new Date(isoOrDate).toLocaleDateString();
}

export default function LaunchPreview() {
  const open       = useOfficeStore((s) => s.previewOpen);
  const loading    = useOfficeStore((s) => s.previewLoading);
  const data       = useOfficeStore((s) => s.previewData);
  const error      = useOfficeStore((s) => s.previewError);
  const project    = useOfficeStore((s) => s.previewProject);
  const launchAgent = useOfficeStore((s) => s.launchAgent);
  const closePreview = useOfficeStore((s) => s.closePreview);

  const backdropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') closePreview(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closePreview]);

  if (!open) return null;

  async function handleConfirm() {
    if (!data) return;
    try {
      await launchAgent(data.persona.id, data.project.id);
      closePreview();
    } catch (err) {
      // keep preview open; show error inline
      useOfficeStore.setState({ previewError: err.message ?? 'Launch failed' });
    }
  }

  function handleBackdropClick(e) {
    if (e.target === backdropRef.current) closePreview();
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      <div
        className="relative w-full max-w-xl rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Launch preview"
      >
        {/* Header */}
        <div className="border-b border-gray-700 px-5 py-4">
          <p className="text-xs uppercase tracking-widest text-gray-500">Launch preview</p>
          <p className="mt-0.5 text-lg font-bold leading-tight text-gray-100">
            {data?.persona?.label ?? 'Loading…'}
            {' → '}
            {data?.project?.name ?? project?.name ?? ''}
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 text-sm">
          {loading && (
            <p className="text-gray-400">Loading context…</p>
          )}

          {error && (
            <div className="rounded-lg bg-red-900/40 px-3 py-2 text-red-300">{error}</div>
          )}

          {data?.lastSession && (
            <section>
              <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-1">Last session</h3>
              <p className="text-gray-200">
                {data.lastSession.completed ?? data.lastSession.title ?? '—'}
                <span className="ml-2 text-gray-500">
                  {formatRelative(data.lastSession.at)}
                </span>
              </p>
              {data.lastSession.nextSteps && (
                <p className="text-gray-400 mt-1">
                  <span className="text-gray-500">Next:</span> {data.lastSession.nextSteps}
                </p>
              )}
            </section>
          )}

          {data && data.personaObservations?.length > 0 && (
            <section>
              <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                Recent work as {data.persona.label} ({data.personaObservations.length})
              </h3>
              <ul className="space-y-1 text-gray-200">
                {data.personaObservations.map((o) => (
                  <li key={o.id} className="leading-snug">
                    <span className="text-gray-100">{o.title}</span>
                    {o.subtitle && <span className="text-gray-400"> — {o.subtitle}</span>}
                    <span className="ml-2 text-gray-500 text-xs">
                      {formatRelative(o.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data && data.skills?.length > 0 && (
            <section>
              <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-1">
                Skills ({data.skills.length})
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {data.skills.map((s) => (
                  <span
                    key={s.id}
                    className="inline-block rounded-full bg-gray-800 border border-gray-700 px-2 py-0.5 text-xs text-gray-300"
                  >
                    {s.name}
                  </span>
                ))}
              </div>
            </section>
          )}

          {data && data.personaObservations?.length === 0 && !data.lastSession && (
            <p className="text-gray-500 italic">No prior context for this persona on this project.</p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-700 px-5 py-3 flex justify-end gap-2">
          <button
            className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
            onClick={closePreview}
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            disabled={loading || !data}
            onClick={handleConfirm}
          >
            Launch in iTerm
          </button>
        </div>
      </div>
    </div>
  );
}
