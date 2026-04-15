import { useEffect, useRef, useState } from 'react';
import { useOfficeStore } from '../stores/office-store.js';

const TYPE_ICONS = {
  bugfix:    { label: 'fix',     color: 'bg-orange-900/60 text-orange-300' },
  feature:   { label: 'feat',    color: 'bg-green-900/60 text-green-300' },
  refactor:  { label: 'refac',   color: 'bg-purple-900/60 text-purple-300' },
  change:    { label: 'change',  color: 'bg-blue-900/60 text-blue-300' },
  discovery: { label: 'find',    color: 'bg-yellow-900/60 text-yellow-300' },
  decision:  { label: 'decide',  color: 'bg-pink-900/60 text-pink-300' },
};

const INITIAL_OBS_VISIBLE = 5;

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

function TypeBadge({ type }) {
  const meta = TYPE_ICONS[type] ?? { label: type ?? '·', color: 'bg-gray-800 text-gray-400' };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide ${meta.color}`}>
      {meta.label}
    </span>
  );
}

/** Truncates a long string to a sentence boundary near `maxLen` chars. */
function truncate(text, maxLen = 140) {
  if (!text || text.length <= maxLen) return { short: text ?? '', truncated: false };
  // Try to break at a sentence end within [maxLen-30, maxLen+30]
  const slice = text.slice(0, maxLen + 30);
  const sentenceEnd = slice.lastIndexOf('. ');
  if (sentenceEnd > maxLen - 30) {
    return { short: slice.slice(0, sentenceEnd + 1), truncated: true };
  }
  return { short: text.slice(0, maxLen).trimEnd() + '…', truncated: true };
}

function ExpandableText({ text, maxLen = 140, className = '' }) {
  const [expanded, setExpanded] = useState(false);
  const { short, truncated } = truncate(text, maxLen);
  if (!truncated) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {expanded ? text : short}
      {' '}
      <button
        type="button"
        className="text-blue-400 hover:text-blue-300 text-xs underline-offset-2 hover:underline"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded ? 'less' : 'more'}
      </button>
    </span>
  );
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
  const [obsVisible, setObsVisible] = useState(INITIAL_OBS_VISIBLE);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') closePreview(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closePreview]);

  // Reset visible count whenever preview reopens
  useEffect(() => {
    if (open) {
      setObsVisible(INITIAL_OBS_VISIBLE);
      setShowPrompt(false);
    }
  }, [open]);

  if (!open) return null;

  async function handleConfirm() {
    if (!data) return;
    try {
      await launchAgent(data.persona.id, data.project.id, {
        providerId: data.launchTarget?.providerId,
        model: data.launchTarget?.model,
      });
      closePreview();
    } catch (err) {
      useOfficeStore.setState({ previewError: err.message ?? 'Launch failed' });
    }
  }

  function handleBackdropClick(e) {
    if (e.target === backdropRef.current) closePreview();
  }

  const observations = data?.personaObservations ?? [];
  const visible = observations.slice(0, obsVisible);
  const hasMore = observations.length > obsVisible;
  const resolvedSkills = data?.resolvedSkills ?? data?.skills ?? [];
  const installedSkills = data?.installedSkills ?? [];
  const recommendedSkills = data?.recommendedSkills ?? [];
  const promptText = data?.systemPrompt ?? '';
  const launchTarget = data?.launchTarget ?? null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={handleBackdropClick}
    >
      <div
        className="relative flex w-full max-w-2xl max-h-[85vh] flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Launch preview"
      >
        {/* Header — fixed */}
        <div className="border-b border-gray-700 px-5 py-3 shrink-0">
          <p className="text-[10px] uppercase tracking-widest text-gray-500">Launch preview</p>
          <p className="mt-0.5 text-base font-bold leading-tight text-gray-100">
            {data?.persona?.label ?? 'Loading…'}
            <span className="text-gray-500 mx-1.5">→</span>
            <span className="text-blue-300">{data?.project?.name ?? project?.name ?? ''}</span>
          </p>
          {launchTarget && (
            <p className="mt-1 text-xs text-gray-400">
              {launchTarget.label} · {launchTarget.model}
            </p>
          )}
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-sm">
          {loading && (
            <div className="flex items-center gap-2 text-gray-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
              Loading context…
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-900/30 px-3 py-2 text-red-300">
              {error}
            </div>
          )}

          {launchTarget && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">
                Launch target
              </h3>
              <div className="rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-blue-950/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
                    {launchTarget.label}
                  </span>
                  <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-300">
                    {launchTarget.model}
                  </span>
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  {launchTarget.command} · prompt is {launchTarget.promptModeLabel}
                </p>
              </div>
            </section>
          )}

          {/* Last session */}
          {data?.lastSession && (
            <section>
              <div className="flex items-baseline justify-between mb-1.5">
                <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                  Last session
                </h3>
                <span className="text-[10px] text-gray-500">
                  {formatRelative(data.lastSession.at)}
                </span>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2.5">
                <ExpandableText
                  text={data.lastSession.completed ?? data.lastSession.title ?? '—'}
                  maxLen={200}
                  className="text-gray-200 leading-relaxed"
                />
                {data.lastSession.nextSteps && (
                  <div className="mt-2 pt-2 border-t border-gray-800">
                    <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Next: </span>
                    <ExpandableText
                      text={data.lastSession.nextSteps}
                      maxLen={140}
                      className="text-gray-300 text-sm"
                    />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Recent work */}
          {observations.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">
                Recent work as {data.persona.label}
                <span className="text-gray-600 ml-1.5">({observations.length})</span>
              </h3>
              <ul className="space-y-1.5">
                {visible.map((o) => (
                  <li
                    key={o.id}
                    className="rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 hover:border-gray-700"
                  >
                    <div className="flex items-start gap-2">
                      <TypeBadge type={o.type} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-gray-100 leading-snug truncate">{o.title}</p>
                          <span className="text-[10px] text-gray-500 shrink-0">
                            {formatRelative(o.createdAt)}
                          </span>
                        </div>
                        {o.subtitle && (
                          <p className="text-gray-400 text-xs mt-0.5 leading-snug line-clamp-2">
                            {o.subtitle}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {hasMore && (
                <button
                  type="button"
                  className="mt-2 w-full rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-1.5 text-xs text-blue-400 hover:bg-gray-800 hover:text-blue-300"
                  onClick={() => setObsVisible((v) => v + INITIAL_OBS_VISIBLE)}
                >
                  Show {Math.min(INITIAL_OBS_VISIBLE, observations.length - obsVisible)} more
                </button>
              )}
            </section>
          )}

          {/* Resolved skills */}
          {resolvedSkills.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">
                Resolved skills <span className="text-gray-600 ml-1">({resolvedSkills.length})</span>
              </h3>
              <div className="space-y-2">
                {resolvedSkills.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm text-gray-200">{s.name}</p>
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">
                          {s.source ?? 'unknown'} · {s.domain ?? 'general'}
                        </p>
                        {s.reasons?.length > 0 && (
                          <p className="mt-1 text-xs text-gray-400">
                            {s.reasons.map((reason) => reason.label).join(' · ')}
                          </p>
                        )}
                      </div>
                      <span className="rounded-md border border-blue-800 bg-blue-950/50 px-2 py-1 text-[10px] uppercase tracking-wide text-blue-300">
                        {s.injectionMode ?? 'full'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recommended skills */}
          {recommendedSkills.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">
                Recommended skills <span className="text-gray-600 ml-1">({recommendedSkills.length})</span>
              </h3>
              <div className="space-y-2">
                {recommendedSkills.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm text-gray-200">{s.name}</p>
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">
                          {s.source ?? 'unknown'} · {s.domain ?? 'general'}
                        </p>
                        {s.reasons?.length > 0 && (
                          <p className="mt-1 text-xs text-emerald-200/80">
                            {s.reasons.map((reason) => reason.label).join(' · ')}
                          </p>
                        )}
                      </div>
                      <span className="rounded-md border border-emerald-800 bg-emerald-950/50 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-300">
                        optional
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Installed skills inventory */}
          {(installedSkills.length > 0 || data?.skillRoots?.length > 0) && (
            <section>
              <div className="flex items-baseline justify-between mb-1.5 gap-3">
                <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                  Installed skills
                  <span className="text-gray-600 ml-1">({installedSkills.length})</span>
                </h3>
                {data?.skillRoots?.length > 0 && (
                  <span className="text-[10px] text-gray-500 truncate">
                    {data.skillRoots[0]}
                  </span>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/40">
                {installedSkills.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-gray-500">
                    No installed skills were found in the configured local roots.
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-800">
                    {installedSkills.slice(0, 12).map((s) => (
                      <li key={s.id} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-gray-200">{s.name}</span>
                          <span className="text-[10px] uppercase tracking-wide text-gray-500">
                            {s.source ?? 'unknown'}
                          </span>
                        </div>
                        {s.description && (
                          <p className="mt-0.5 text-xs leading-snug text-gray-400">{s.description}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {installedSkills.length > 12 && (
                <p className="mt-1 text-[10px] text-gray-500">
                  Showing 12 of {installedSkills.length} installed skills.
                </p>
              )}
            </section>
          )}

          {/* Prompt inspector */}
          {data && (
            <section>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div>
                  <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    Prompt inspector
                  </h3>
                  <p className="text-[10px] text-gray-600 mt-0.5">
                    Exact launch prompt that will be passed to the selected CLI at session start.
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-gray-700 px-2 py-1 text-[10px] uppercase tracking-wide text-gray-300 hover:bg-gray-800"
                  onClick={() => setShowPrompt((value) => !value)}
                >
                  {showPrompt ? 'Hide prompt' : 'Show prompt'}
                </button>
              </div>
              {showPrompt ? (
                <pre className="max-h-64 overflow-auto rounded-lg border border-gray-800 bg-black/50 px-3 py-3 text-xs leading-relaxed text-gray-300 whitespace-pre-wrap">
                  {promptText || 'No system prompt available.'}
                </pre>
              ) : (
                <div className="rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2">
                  <p className="text-xs text-gray-400">
                    {promptText
                      ? `Prompt ready · ${promptText.length.toLocaleString()} characters`
                      : 'No system prompt available.'}
                  </p>
                </div>
              )}
            </section>
          )}

          {/* Empty state */}
          {data && observations.length === 0 && !data.lastSession && (
            <div className="rounded-lg border border-dashed border-gray-800 px-4 py-6 text-center">
              <p className="text-gray-500 italic text-sm">
                No prior context for this persona on this project.
              </p>
              <p className="text-gray-600 text-xs mt-1">
                Skills and base prompt will still be injected.
              </p>
            </div>
          )}
        </div>

        {/* Footer — fixed */}
        <div className="border-t border-gray-700 bg-gray-900 px-5 py-3 flex items-center justify-between gap-2 shrink-0 rounded-b-xl">
          <span className="text-[10px] text-gray-500">
            Esc to cancel
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
              onClick={closePreview}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              disabled={loading || !data}
              onClick={handleConfirm}
            >
              {launchTarget ? `Launch ${launchTarget.label}` : 'Launch in iTerm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
