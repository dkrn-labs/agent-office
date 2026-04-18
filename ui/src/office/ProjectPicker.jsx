import { useEffect, useRef, useState } from 'react';
import { useOfficeStore } from '../stores/office-store.js';
import { DEFAULT_LAUNCH_PROVIDER_ID, getLaunchProviderById, LAUNCH_PROVIDERS } from '../lib/launch-options.js';
import { isSessionLive, useSessionClock } from '../lib/session-status.js';
import { fetchJSON } from '../lib/api.js';

const BADGE_COLORS = {
  node: 'bg-blue-900 text-blue-300',
  nodejs: 'bg-blue-900 text-blue-300',
  react: 'bg-blue-800 text-blue-200',
  typescript: 'bg-blue-700 text-blue-100',
  ts: 'bg-blue-700 text-blue-100',
  vite: 'bg-blue-600 text-blue-100',
  python: 'bg-amber-900 text-amber-300',
  flask: 'bg-amber-800 text-amber-200',
  django: 'bg-amber-700 text-amber-100',
  rust: 'bg-orange-800 text-orange-200',
  go: 'bg-cyan-900 text-cyan-300',
  golang: 'bg-cyan-900 text-cyan-300',
  ruby: 'bg-red-900 text-red-300',
  rails: 'bg-red-900 text-red-300',
  java: 'bg-red-800 text-orange-200',
  spring: 'bg-red-800 text-orange-200',
};

function techBadgeClass(tech) {
  const key = tech.toLowerCase().replace(/[^a-z]/g, '');
  return BADGE_COLORS[key] ?? 'bg-gray-700 text-gray-300';
}

function truncatePath(path, maxLen = 52) {
  if (!path || path.length <= maxLen) return path ?? '';
  const half = Math.floor((maxLen - 3) / 2);
  return path.slice(0, half) + '…' + path.slice(-half);
}

function SectionHeading({ label, count }) {
  return (
    <p className="mb-2 text-[10px] uppercase tracking-widest text-gray-500">
      {label}
      {typeof count === 'number' && <span className="ml-1 text-gray-600">({count})</span>}
    </p>
  );
}

export default function ProjectPicker() {
  const {
    pickerOpen,
    selectedPersona: selectedPersonaId,
    personas,
    projects,
    sessions,
    pinnedProjectIds,
    recentProjectIds,
    previewLaunch,
    markProjectUsed,
    togglePinnedProject,
    closePicker,
  } = useOfficeStore();

  const [search, setSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedProviderId, setSelectedProviderId] = useState(DEFAULT_LAUNCH_PROVIDER_ID);
  const [selectedModel, setSelectedModel] = useState(getLaunchProviderById(DEFAULT_LAUNCH_PROVIDER_ID).defaultModel);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [personaStats, setPersonaStats] = useState(null);
  const [memQuery, setMemQuery] = useState('');
  const [memHits, setMemHits] = useState([]);
  const [memSearching, setMemSearching] = useState(false);
  const searchRef = useRef(null);
  const backdropRef = useRef(null);
  const now = useSessionClock();

  const persona = personas.find((item) => item.id === selectedPersonaId) ?? null;
  const searchNeedle = search.trim().toLowerCase();
  const selectedProvider = getLaunchProviderById(selectedProviderId);

  const activeProjectIds = [];
  for (const session of Object.values(sessions)) {
    if (!isSessionLive(session, now) || session.projectId == null || activeProjectIds.includes(session.projectId)) {
      continue;
    }
    activeProjectIds.push(session.projectId);
  }

  const activeProjectIdSet = new Set(activeProjectIds);
  const pinnedProjectIdSet = new Set(pinnedProjectIds);
  const recentProjectIdSet = new Set(recentProjectIds);

  const filteredProjects = projects.filter((project) => {
    if (!searchNeedle) return true;
    const haystack = `${project.name ?? ''} ${project.path ?? ''} ${(project.techStack ?? []).join(' ')}`
      .toLowerCase();
    return haystack.includes(searchNeedle);
  });

  const sortedProjects = [...filteredProjects].sort((a, b) => {
    const aActive = activeProjectIdSet.has(a.id) ? activeProjectIds.indexOf(a.id) : Number.POSITIVE_INFINITY;
    const bActive = activeProjectIdSet.has(b.id) ? activeProjectIds.indexOf(b.id) : Number.POSITIVE_INFINITY;
    if (aActive !== bActive) return aActive - bActive;

    const aPinned = pinnedProjectIdSet.has(a.id) ? pinnedProjectIds.indexOf(a.id) : Number.POSITIVE_INFINITY;
    const bPinned = pinnedProjectIdSet.has(b.id) ? pinnedProjectIds.indexOf(b.id) : Number.POSITIVE_INFINITY;
    if (aPinned !== bPinned) return aPinned - bPinned;

    const aRecent = recentProjectIdSet.has(a.id) ? recentProjectIds.indexOf(a.id) : Number.POSITIVE_INFINITY;
    const bRecent = recentProjectIdSet.has(b.id) ? recentProjectIds.indexOf(b.id) : Number.POSITIVE_INFINITY;
    if (aRecent !== bRecent) return aRecent - bRecent;

    return (a.name ?? '').localeCompare(b.name ?? '');
  });

  const activeProjects = sortedProjects.filter((project) => activeProjectIdSet.has(project.id));
  const pinnedProjects = sortedProjects.filter(
    (project) => !activeProjectIdSet.has(project.id) && pinnedProjectIdSet.has(project.id),
  );
  const recentProjects = sortedProjects.filter(
    (project) =>
      !activeProjectIdSet.has(project.id) &&
      !pinnedProjectIdSet.has(project.id) &&
      recentProjectIdSet.has(project.id),
  );
  const otherProjects = sortedProjects.filter(
    (project) =>
      !activeProjectIdSet.has(project.id) &&
      !pinnedProjectIdSet.has(project.id) &&
      !recentProjectIdSet.has(project.id),
  );

  useEffect(() => {
    if (pickerOpen) {
      setSearch('');
      setSelectedProject(null);
      setSelectedProviderId(DEFAULT_LAUNCH_PROVIDER_ID);
      setSelectedModel(getLaunchProviderById(DEFAULT_LAUNCH_PROVIDER_ID).defaultModel);
      setLoading(false);
      setError(null);
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    function handleKey(event) {
      if (event.key === 'Escape') closePicker();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [pickerOpen, closePicker]);

  useEffect(() => {
    setMemQuery('');
    setMemHits([]);
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      setPersonaStats(null);
      return undefined;
    }
    let cancelled = false;
    fetchJSON(`/api/projects/${selectedProject.id}/personas/memory-stats`)
      .then((data) => {
        if (!cancelled) setPersonaStats(data);
      })
      .catch(() => {
        if (!cancelled) setPersonaStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProject]);

  if (!pickerOpen) return null;

  function handleSelectProject(project) {
    setSelectedProject(project);
    setError(null);
  }

  async function handleContinue() {
    if (loading || !selectedProject) return;
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const model = selectedModel.trim() || selectedProvider.defaultModel;
      markProjectUsed(selectedProject.id);
      await previewLaunch(selectedPersonaId, selectedProject, {
        providerId: selectedProvider.id,
        model,
      });
      closePicker();
    } catch (err) {
      setError(err.message ?? 'Preview failed');
      setLoading(false);
    }
  }

  function handleBackdropClick(event) {
    if (event.target === backdropRef.current) closePicker();
  }

  function handleTogglePin(event, projectId) {
    event.preventDefault();
    event.stopPropagation();
    togglePinnedProject(projectId);
  }

  function handleProviderChange(event) {
    const nextProvider = getLaunchProviderById(event.target.value);
    setSelectedProviderId(nextProvider.id);
    setSelectedModel(nextProvider.defaultModel);
  }

  function ProjectRow({ project, active = false, accent = false }) {
    const pinned = pinnedProjectIdSet.has(project.id);
    const recent = recentProjectIdSet.has(project.id);
    const selected = selectedProject?.id === project.id;

    return (
      <div
        className={[
          'rounded-lg border px-4 py-3 transition-colors',
          selected
            ? 'border-blue-500 bg-blue-950/30'
            : accent
              ? 'border-blue-900/70 bg-blue-950/20'
              : 'border-gray-700 bg-transparent',
          loading ? 'opacity-50' : 'hover:bg-gray-800 hover:border-gray-600',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => handleSelectProject(project)}
            className="min-w-0 flex-1 text-left focus:outline-none focus:ring-1 focus:ring-blue-500 rounded-md"
          >
            <p className="font-semibold text-gray-100 text-sm leading-snug">
              {project.name}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {active && (
                <span className="inline-block rounded-full bg-emerald-950/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                  Active now
                </span>
              )}
              {pinned && (
                <span className="inline-block rounded-full bg-amber-950/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                  Pinned
                </span>
              )}
              {!active && !pinned && recent && (
                <span className="inline-block rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                  Recent
                </span>
              )}
            </div>

            {Array.isArray(project.techStack) && project.techStack.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {project.techStack.map((tech) => (
                  <span
                    key={tech}
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${techBadgeClass(tech)}`}
                  >
                    {tech}
                  </span>
                ))}
              </div>
            )}

            {project.path && (
              <p className="mt-1 font-mono text-xs text-gray-500" title={project.path}>
                {truncatePath(project.path)}
              </p>
            )}

            {project.memoryStats?.observationCount > 0 && (
              <p
                className="mt-1 text-[10px] text-gray-500"
                title="Unified memory across Claude, Codex, Gemini — all embedded for semantic retrieval"
              >
                <span className="text-gray-400">
                  {project.memoryStats.observationCount}
                </span>{' '}
                observation{project.memoryStats.observationCount === 1 ? '' : 's'}
                {project.memoryStats.providerCount > 1 && (
                  <> · {project.memoryStats.providerCount} providers</>
                )}
                {project.memoryStats.embeddedCount < project.memoryStats.observationCount && (
                  <>
                    {' '}
                    · <span className="text-amber-400">
                      {project.memoryStats.observationCount - project.memoryStats.embeddedCount} unindexed
                    </span>
                  </>
                )}
              </p>
            )}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={(event) => handleTogglePin(event, project.id)}
            className={[
              'shrink-0 rounded-md border px-2 py-1 text-[10px] uppercase tracking-wide',
              pinned
                ? 'border-amber-800 bg-amber-950/60 text-amber-300'
                : 'border-gray-700 bg-gray-900 text-gray-400 hover:text-gray-200',
            ].join(' ')}
            aria-label={pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
          >
            {pinned ? 'Unpin' : 'Pin'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      <div
        className="relative w-full max-w-3xl rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Pick a project"
      >
        <div className="border-b border-gray-700 px-5 py-4">
          {persona ? (
            <>
              <p className="text-xs uppercase tracking-widest text-gray-500">Launching persona</p>
              <p className="mt-0.5 text-lg font-bold leading-tight text-gray-100">
                {persona.label}
              </p>
              {persona.domain && <p className="mt-0.5 text-sm text-gray-400">{persona.domain}</p>}
            </>
          ) : (
            <p className="text-sm text-gray-400">Select a project</p>
          )}
        </div>

        <div className="px-5 pb-2 pt-4">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects, paths, or stack…"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div className="mx-5 mb-2 rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="max-h-80 space-y-4 overflow-y-auto px-5 pb-5 pt-1">
          {!persona && (
            <div className="rounded-lg border border-gray-800 bg-gray-950/40 px-4 py-3 text-sm text-gray-400">
              Pick a persona from the office first, then choose the project to launch into.
            </div>
          )}

          {sortedProjects.length === 0 && (
            <div className="py-6 text-center text-sm text-gray-500">
              {searchNeedle
                ? 'No projects match your search. Try a repo name, path fragment, or stack keyword.'
                : 'No active projects found. Scan or reactivate a project first.'}
            </div>
          )}

          {!searchNeedle &&
            activeProjects.length === 0 &&
            pinnedProjects.length === 0 &&
            recentProjects.length === 0 &&
            sortedProjects.length > 0 && (
              <div className="rounded-lg border border-gray-800 bg-gray-950/40 px-4 py-3 text-sm text-gray-400">
                Nothing is pinned yet. Pin the projects you launch often so they stay at the top.
              </div>
            )}

          {activeProjects.length > 0 && (
            <section>
              <SectionHeading label="Active sessions" count={activeProjects.length} />
              <ul className="space-y-2">
                {activeProjects.map((project) => (
                  <li key={project.id}>
                    <ProjectRow project={project} active accent />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {pinnedProjects.length > 0 && (
            <section>
              <SectionHeading label="Pinned" count={pinnedProjects.length} />
              <ul className="space-y-2">
                {pinnedProjects.map((project) => (
                  <li key={project.id}>
                    <ProjectRow project={project} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {recentProjects.length > 0 && (
            <section>
              <SectionHeading label="Recent" count={recentProjects.length} />
              <ul className="space-y-2">
                {recentProjects.map((project) => (
                  <li key={project.id}>
                    <ProjectRow project={project} accent />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {otherProjects.length > 0 && (
            <section>
              {(activeProjects.length > 0 || pinnedProjects.length > 0 || recentProjects.length > 0) && (
                <SectionHeading label={searchNeedle ? 'Search results' : 'All projects'} count={otherProjects.length} />
              )}
              <ul className="space-y-2">
                {otherProjects.map((project) => (
                  <li key={project.id}>
                    <ProjectRow project={project} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="border-t border-gray-700 bg-gray-900/95 px-5 py-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_220px] md:items-end">
            <div className="rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-3">
              <p className="text-[10px] uppercase tracking-widest text-gray-500">Selected project</p>
              {selectedProject ? (
                <>
                  <p className="mt-1 text-sm font-semibold text-gray-100">{selectedProject.name}</p>
                  <p className="mt-1 font-mono text-xs text-gray-500" title={selectedProject.path}>
                    {truncatePath(selectedProject.path, 68)}
                  </p>
                  {persona && (() => {
                    const stat = personaStats?.stats?.find((s) => s.personaId === persona.id);
                    const count = stat?.observationCount ?? 0;
                    return (
                      <p className="mt-1.5 text-[10px] text-gray-500">
                        <span className="text-gray-400">{persona.label}</span> has{' '}
                        <span className="text-gray-300">{count}</span> observation{count === 1 ? '' : 's'} on this project
                        {stat?.providerCount > 1 && <> across {stat.providerCount} providers</>}
                      </p>
                    );
                  })()}
                </>
              ) : (
                <p className="mt-1 text-sm text-gray-400">
                  Pick a project above, then choose the CLI agent and model before preview.
                </p>
              )}
            </div>

            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-gray-500">CLI agent</span>
              <select
                value={selectedProviderId}
                onChange={handleProviderChange}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                {LAUNCH_PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-gray-500">Model</span>
              <input
                list={`launch-models-${selectedProvider.id}`}
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                placeholder={selectedProvider.defaultModel}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <datalist id={`launch-models-${selectedProvider.id}`}>
                {selectedProvider.models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>
          </div>

          {selectedProject && (
            <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2">
              <label className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest text-gray-500 shrink-0">
                  Search memory
                </span>
                <input
                  type="text"
                  value={memQuery}
                  onChange={(e) => setMemQuery(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key !== 'Enter') return;
                    const q = memQuery.trim();
                    if (!q) {
                      setMemHits([]);
                      return;
                    }
                    setMemSearching(true);
                    try {
                      const params = new URLSearchParams({
                        q,
                        projectId: String(selectedProject.id),
                        k: '5',
                      });
                      if (persona?.id != null) params.set('personaId', String(persona.id));
                      const data = await fetchJSON(`/api/memory/search?${params.toString()}`);
                      setMemHits(data?.hits ?? []);
                    } catch {
                      setMemHits([]);
                    } finally {
                      setMemSearching(false);
                    }
                  }}
                  placeholder='"auth middleware rewrite", "that sqlite-vec bug"…'
                  className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100 outline-none focus:border-blue-500"
                />
                {memSearching && (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
                )}
              </label>
              {memHits.length > 0 && (
                <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {memHits.map((hit) => (
                    <li key={hit.id} className="rounded border border-gray-800 bg-gray-900/60 px-2 py-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] font-semibold text-gray-200 truncate">{hit.title}</span>
                        <span className="text-[9px] uppercase text-gray-500 shrink-0">{hit.providerId}</span>
                      </div>
                      {hit.subtitle && (
                        <p className="text-[10px] text-gray-400 line-clamp-1">{hit.subtitle}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              {selectedProvider.command} · {selectedProvider.promptModeLabel}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
                onClick={closePicker}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!selectedProject || loading || !persona}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleContinue}
              >
                Continue to preview
              </button>
            </div>
          </div>
        </div>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-gray-900/80">
            <div className="flex flex-col items-center gap-3">
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
              <p className="text-sm text-gray-400">Building preview…</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
