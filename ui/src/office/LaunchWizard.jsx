import { useEffect, useMemo, useRef, useState } from 'react';
import { useOfficeStore } from '../stores/office-store.js';
import {
  DEFAULT_LAUNCH_PROVIDER_ID,
  getLaunchProviderById,
  LAUNCH_PROVIDERS,
} from '../lib/launch-options.js';
import { fetchJSON, fetchJSONWithQuery } from '../lib/api.js';
import { isSessionLive, useSessionClock } from '../lib/session-status.js';

const STEPS = [
  { id: 1, label: 'Project' },
  { id: 2, label: 'Agent' },
  { id: 3, label: 'Memory' },
  { id: 4, label: 'Launch' },
];

const BADGE_COLORS = {
  node: 'bg-blue-900 text-blue-300',
  nodejs: 'bg-blue-900 text-blue-300',
  react: 'bg-blue-800 text-blue-200',
  typescript: 'bg-blue-700 text-blue-100',
  ts: 'bg-blue-700 text-blue-100',
  vite: 'bg-blue-600 text-blue-100',
  python: 'bg-amber-900 text-amber-300',
  rust: 'bg-orange-800 text-orange-200',
  go: 'bg-cyan-900 text-cyan-300',
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

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function StepIndicator({ step }) {
  return (
    <ol className="flex items-center gap-1 text-[11px]">
      {STEPS.map((s, i) => {
        const state = s.id < step ? 'done' : s.id === step ? 'active' : 'pending';
        return (
          <li key={s.id} className="flex items-center gap-1">
            <span
              className={[
                'inline-flex h-5 min-w-5 px-1.5 items-center justify-center rounded-full font-semibold',
                state === 'done' && 'bg-blue-700 text-blue-100',
                state === 'active' && 'bg-blue-500 text-white',
                state === 'pending' && 'bg-gray-800 text-gray-500',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {s.id}
            </span>
            <span
              className={[
                'uppercase tracking-wider',
                state === 'pending' ? 'text-gray-600' : 'text-gray-300',
              ].join(' ')}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="text-gray-700 mx-1">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

function formatRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  const days = Math.floor(diff / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  const mins = Math.floor(diff / 60_000);
  return mins < 1 ? 'just now' : `${mins}m ago`;
}

export default function LaunchWizard() {
  const pickerOpen = useOfficeStore((s) => s.pickerOpen);
  const selectedPersonaId = useOfficeStore((s) => s.selectedPersona);
  const personas = useOfficeStore((s) => s.personas);
  const projects = useOfficeStore((s) => s.projects);
  const sessions = useOfficeStore((s) => s.sessions);
  const pinnedProjectIds = useOfficeStore((s) => s.pinnedProjectIds);
  const recentProjectIds = useOfficeStore((s) => s.recentProjectIds);
  const closePicker = useOfficeStore((s) => s.closePicker);
  const markProjectUsed = useOfficeStore((s) => s.markProjectUsed);
  const launchAgent = useOfficeStore((s) => s.launchAgent);

  const now = useSessionClock();
  const persona = personas.find((p) => p.id === selectedPersonaId) ?? null;

  const [step, setStep] = useState(1);
  const [error, setError] = useState(null);

  // Step 1
  const [search, setSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState(null);
  const [memQuery, setMemQuery] = useState('');
  const [memHits, setMemHits] = useState([]);
  const [memSearching, setMemSearching] = useState(false);
  const searchRef = useRef(null);

  // Step 2
  const [providerId, setProviderId] = useState(DEFAULT_LAUNCH_PROVIDER_ID);
  const [model, setModel] = useState(getLaunchProviderById(DEFAULT_LAUNCH_PROVIDER_ID).defaultModel);

  // Step 3
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [customInstructions, setCustomInstructions] = useState('');

  // Step 4
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [launching, setLaunching] = useState(false);

  // Reset when opened
  useEffect(() => {
    if (!pickerOpen) return;
    setStep(1);
    setSearch('');
    setSelectedProject(null);
    setMemQuery('');
    setMemHits([]);
    setProviderId(DEFAULT_LAUNCH_PROVIDER_ID);
    setModel(getLaunchProviderById(DEFAULT_LAUNCH_PROVIDER_ID).defaultModel);
    setCandidates([]);
    setSelectedIds(new Set());
    setCustomInstructions('');
    setPreview(null);
    setError(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [pickerOpen]);

  // Esc closes
  useEffect(() => {
    if (!pickerOpen) return undefined;
    function handleKey(e) {
      if (e.key === 'Escape') closePicker();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [pickerOpen, closePicker]);

  // Step 3 entry: load candidates
  useEffect(() => {
    if (step !== 3 || !selectedProject || !persona) return;
    let cancelled = false;
    setCandidatesLoading(true);
    fetchJSONWithQuery('/api/office/memory-candidates', {
      personaId: persona.id,
      projectId: selectedProject.id,
      limit: 10,
    })
      .then((data) => {
        if (cancelled) return;
        setCandidates(data?.candidates ?? []);
        setSelectedIds(new Set(data?.defaultSelectedIds ?? []));
        setCandidatesLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message ?? 'Failed to load memory candidates');
        setCandidatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, selectedProject, persona]);

  // Step 4 entry: load preview with selected overrides
  useEffect(() => {
    if (step !== 4 || !selectedProject || !persona) return;
    let cancelled = false;
    setPreviewLoading(true);
    const params = {
      personaId: persona.id,
      projectId: selectedProject.id,
      providerId,
      model,
    };
    if (selectedIds.size > 0) params.selectedObservationIds = [...selectedIds].join(',');
    if (customInstructions.trim()) params.customInstructions = customInstructions.trim();
    fetchJSONWithQuery('/api/office/preview', params)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        setPreviewLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message ?? 'Failed to build preview');
        setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, selectedProject, persona, providerId, model, selectedIds, customInstructions]);

  // Project list ordering
  const { activeProjects, pinnedProjects, recentProjects, otherProjects } = useMemo(() => {
    const liveProjectIds = new Set();
    for (const session of Object.values(sessions)) {
      if (isSessionLive(session, now) && session.projectId != null) {
        liveProjectIds.add(session.projectId);
      }
    }
    const pinned = new Set(pinnedProjectIds);
    const recent = new Set(recentProjectIds);
    const needle = search.trim().toLowerCase();

    const filtered = projects.filter((p) => {
      if (!needle) return true;
      const hay = `${p.name ?? ''} ${p.path ?? ''} ${(p.techStack ?? []).join(' ')}`.toLowerCase();
      return hay.includes(needle);
    });

    return {
      activeProjects: filtered.filter((p) => liveProjectIds.has(p.id)),
      pinnedProjects: filtered.filter((p) => !liveProjectIds.has(p.id) && pinned.has(p.id)),
      recentProjects: filtered.filter((p) => !liveProjectIds.has(p.id) && !pinned.has(p.id) && recent.has(p.id)),
      otherProjects: filtered.filter(
        (p) => !liveProjectIds.has(p.id) && !pinned.has(p.id) && !recent.has(p.id),
      ),
    };
  }, [projects, sessions, now, pinnedProjectIds, recentProjectIds, search]);

  if (!pickerOpen) return null;

  const canNext =
    (step === 1 && selectedProject) ||
    (step === 2 && providerId && model) ||
    step === 3 ||
    step === 4;

  async function handleMemSearch() {
    const q = memQuery.trim();
    if (!q || !selectedProject) {
      setMemHits([]);
      return;
    }
    setMemSearching(true);
    try {
      const params = new URLSearchParams({ q, projectId: String(selectedProject.id), k: '5' });
      if (persona?.id != null) params.set('personaId', String(persona.id));
      const data = await fetchJSON(`/api/memory/search?${params.toString()}`);
      setMemHits(data?.hits ?? []);
    } catch {
      setMemHits([]);
    } finally {
      setMemSearching(false);
    }
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleLaunch() {
    if (!selectedProject || !persona) return;
    setLaunching(true);
    setError(null);
    try {
      markProjectUsed(selectedProject.id);
      await launchAgent(persona.id, selectedProject.id, {
        providerId,
        model,
        selectedObservationIds: [...selectedIds],
        customInstructions: customInstructions.trim() || null,
      });
      closePicker();
    } catch (err) {
      setError(err.message ?? 'Launch failed');
    } finally {
      setLaunching(false);
    }
  }

  const provider = getLaunchProviderById(providerId);
  const brief = preview?.brief ?? null;
  const systemPromptTokens = estimateTokens(preview?.systemPrompt ?? '');
  const customTokens = estimateTokens(customInstructions);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => e.target === e.currentTarget && closePicker()}
    >
      <div
        className="relative flex w-full max-w-3xl max-h-[88vh] flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="border-b border-gray-700 px-5 py-3 shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-500">Launch agent</p>
              <p className="mt-0.5 text-base font-bold text-gray-100">
                {persona?.label ?? 'Loading…'}
                {selectedProject && (
                  <>
                    <span className="text-gray-500 mx-1.5">→</span>
                    <span className="text-blue-300">{selectedProject.name}</span>
                  </>
                )}
              </p>
            </div>
            <StepIndicator step={step} />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
          {error && (
            <div className="mb-3 rounded-lg border border-red-800 bg-red-900/30 px-3 py-2 text-red-300">
              {error}
            </div>
          )}

          {step === 1 && (
            <Step1Project
              search={search}
              setSearch={setSearch}
              searchRef={searchRef}
              active={activeProjects}
              pinned={pinnedProjects}
              recent={recentProjects}
              other={otherProjects}
              selectedProject={selectedProject}
              setSelectedProject={setSelectedProject}
              memQuery={memQuery}
              setMemQuery={setMemQuery}
              memHits={memHits}
              memSearching={memSearching}
              onMemSearch={handleMemSearch}
            />
          )}

          {step === 2 && (
            <Step2Provider
              provider={provider}
              providerId={providerId}
              setProviderId={setProviderId}
              model={model}
              setModel={setModel}
            />
          )}

          {step === 3 && (
            <Step3Memory
              loading={candidatesLoading}
              candidates={candidates}
              selectedIds={selectedIds}
              toggle={toggleSelected}
              customInstructions={customInstructions}
              setCustomInstructions={setCustomInstructions}
              persona={persona}
            />
          )}

          {step === 4 && (
            <Step4Preview
              loading={previewLoading}
              preview={preview}
              persona={persona}
              project={selectedProject}
              provider={provider}
              model={model}
              brief={brief}
              customInstructions={customInstructions}
              customTokens={customTokens}
              systemPromptTokens={systemPromptTokens}
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-700 bg-gray-900 px-5 py-3 flex items-center justify-between shrink-0 rounded-b-xl">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800"
            onClick={closePicker}
          >
            Cancel
          </button>
          <div className="flex gap-2">
            {step > 1 && (
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
                onClick={() => setStep((s) => s - 1)}
              >
                Back
              </button>
            )}
            {step < 4 ? (
              <button
                type="button"
                disabled={!canNext}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setStep((s) => s + 1)}
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                disabled={!preview || launching}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleLaunch}
              >
                {launching ? 'Launching…' : `Launch ${provider.label}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectGroup({ label, projects, selectedId, onSelect }) {
  if (projects.length === 0) return null;
  return (
    <section className="mb-4">
      <p className="mb-2 text-[10px] uppercase tracking-widest text-gray-500">
        {label}
        <span className="ml-1 text-gray-600">({projects.length})</span>
      </p>
      <ul className="space-y-1.5">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(p)}
              className={[
                'w-full text-left rounded-lg border px-3 py-2.5 transition',
                selectedId === p.id
                  ? 'border-blue-500 bg-blue-950/40'
                  : 'border-gray-800 bg-gray-950/40 hover:border-gray-700',
              ].join(' ')}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-gray-100">{p.name}</span>
                {p.memoryStats?.observationCount > 0 && (
                  <span className="text-[10px] text-gray-500 shrink-0">
                    {p.memoryStats.observationCount} obs
                    {p.memoryStats.providerCount > 1 && ` · ${p.memoryStats.providerCount} providers`}
                  </span>
                )}
              </div>
              {Array.isArray(p.techStack) && p.techStack.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {p.techStack.map((tech) => (
                    <span
                      key={tech}
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${techBadgeClass(tech)}`}
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              )}
              {p.path && (
                <p className="mt-1 font-mono text-[11px] text-gray-500" title={p.path}>
                  {truncatePath(p.path, 60)}
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Step1Project({
  search,
  setSearch,
  searchRef,
  active,
  pinned,
  recent,
  other,
  selectedProject,
  setSelectedProject,
  memQuery,
  setMemQuery,
  memHits,
  memSearching,
  onMemSearch,
}) {
  return (
    <>
      <input
        ref={searchRef}
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter projects by name, path, tech…"
        className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
      />
      <ProjectGroup label="Active" projects={active} selectedId={selectedProject?.id} onSelect={setSelectedProject} />
      <ProjectGroup label="Pinned" projects={pinned} selectedId={selectedProject?.id} onSelect={setSelectedProject} />
      <ProjectGroup label="Recent" projects={recent} selectedId={selectedProject?.id} onSelect={setSelectedProject} />
      <ProjectGroup label="All projects" projects={other} selectedId={selectedProject?.id} onSelect={setSelectedProject} />

      {selectedProject && (
        <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
          <label className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-gray-500 shrink-0">
              Search memory
            </span>
            <input
              type="text"
              value={memQuery}
              onChange={(e) => setMemQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onMemSearch()}
              placeholder='"auth rewrite", "sqlite-vec bug"…'
              className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100 outline-none focus:border-blue-500"
            />
            {memSearching && (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
            )}
          </label>
          {memHits.length > 0 && (
            <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto">
              {memHits.map((hit) => (
                <li key={hit.id} className="rounded border border-gray-800 bg-gray-900/60 px-2 py-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-semibold text-gray-200 truncate">{hit.title}</span>
                    <span className="text-[9px] uppercase text-gray-500 shrink-0">{hit.providerId}</span>
                  </div>
                  {hit.subtitle && <p className="text-[10px] text-gray-400 line-clamp-1">{hit.subtitle}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function Step2Provider({ provider, providerId, setProviderId, model, setModel }) {
  function handleProviderChange(e) {
    const id = e.target.value;
    setProviderId(id);
    setModel(getLaunchProviderById(id).defaultModel);
  }
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
          CLI agent
        </h3>
        <div className="grid gap-2 md:grid-cols-3">
          {LAUNCH_PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleProviderChange({ target: { value: p.id } })}
              className={[
                'rounded-lg border px-3 py-3 text-left transition',
                providerId === p.id
                  ? 'border-blue-500 bg-blue-950/40'
                  : 'border-gray-800 bg-gray-950/40 hover:border-gray-700',
              ].join(' ')}
            >
              <p className="text-sm font-semibold text-gray-100">{p.label}</p>
              <p className="mt-0.5 text-[11px] font-mono text-gray-500">{p.command}</p>
              <p className="mt-1 text-[10px] text-gray-500">{p.promptModeLabel}</p>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
          Model
        </h3>
        <input
          type="text"
          list="wizard-models"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
        />
        <datalist id="wizard-models">
          {provider.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <p className="mt-1 text-[10px] text-gray-500">
          {provider.command} · prompt is {provider.promptModeLabel}
        </p>
      </section>
    </div>
  );
}

function Step3Memory({
  loading,
  candidates,
  selectedIds,
  toggle,
  customInstructions,
  setCustomInstructions,
  persona,
}) {
  return (
    <div className="space-y-4">
      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            Recent work as {persona?.label} <span className="text-gray-600 ml-1">({candidates.length})</span>
          </h3>
          <span className="text-[10px] text-gray-500">
            {selectedIds.size} of {candidates.length} selected
          </span>
        </div>
        {loading && <p className="text-gray-500 text-xs">Loading…</p>}
        {!loading && candidates.length === 0 && (
          <p className="text-gray-500 italic text-xs">
            No prior observations for this persona on this project.
          </p>
        )}
        <ul className="space-y-1.5">
          {candidates.map((obs) => {
            const checked = selectedIds.has(obs.id);
            return (
              <li key={obs.id}>
                <label
                  className={[
                    'flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition',
                    checked
                      ? 'border-blue-600 bg-blue-950/30'
                      : 'border-gray-800 bg-gray-950/40 hover:border-gray-700',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(obs.id)}
                    className="mt-0.5 accent-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-gray-100 truncate">{obs.title}</span>
                      <span className="text-[10px] text-gray-500 shrink-0">
                        {obs.providerId} · {formatRelative(obs.createdAt)}
                      </span>
                    </div>
                    {obs.subtitle && (
                      <p className="mt-0.5 text-xs text-gray-400 line-clamp-2">{obs.subtitle}</p>
                    )}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
          Custom instructions <span className="text-gray-600 normal-case">(optional)</span>
        </h3>
        <textarea
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          rows={4}
          placeholder="Anything specific for this session? e.g. &quot;Continue the migration started yesterday, focus on the quota preflight edge case.&quot;"
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
        />
        <p className="mt-1 text-[10px] text-gray-500">
          Injected as <code className="text-gray-400">## User intent</code> after the brief.
        </p>
      </section>
    </div>
  );
}

function Step4Preview({
  loading,
  preview,
  persona,
  project,
  provider,
  model,
  brief,
  customInstructions,
  customTokens,
  systemPromptTokens,
}) {
  if (loading || !preview) {
    return <p className="text-gray-500 text-xs">Building preview…</p>;
  }
  const briefPct = brief?.budgetTokens
    ? Math.min(100, Math.round((brief.usedTokens / brief.budgetTokens) * 100))
    : 0;
  return (
    <div className="space-y-4">
      <section className="grid gap-2 md:grid-cols-2">
        <SummaryRow label="Persona" value={persona?.label} />
        <SummaryRow label="Project" value={project?.name} />
        <SummaryRow label="Agent" value={provider.label} />
        <SummaryRow label="Model" value={model} />
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-1.5">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            Project brief{brief?.manual ? ' (manual selection)' : ''}
            {brief?.sourceCount != null && (
              <span className="text-gray-600 ml-1.5">({brief.sourceCount})</span>
            )}
          </h3>
          {brief && (
            <span className="text-[10px] text-gray-400">
              {brief.usedTokens}/{brief.budgetTokens} tok · {briefPct}%
            </span>
          )}
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2.5 max-h-48 overflow-y-auto">
          <pre className="whitespace-pre-wrap text-xs leading-relaxed text-gray-200 font-sans">
            {brief?.markdown || '(no brief)'}
          </pre>
        </div>
      </section>

      {customInstructions.trim() && (
        <section>
          <div className="flex items-baseline justify-between mb-1.5">
            <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              User intent
            </h3>
            <span className="text-[10px] text-gray-400">{customTokens} tok</span>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2.5">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-200">
              {customInstructions.trim()}
            </p>
          </div>
        </section>
      )}

      <section>
        <div className="flex items-baseline justify-between mb-1.5">
          <h3 className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            Full system prompt
          </h3>
          <span className="text-[10px] text-gray-400">~{systemPromptTokens} tok</span>
        </div>
        <details className="rounded-lg border border-gray-800 bg-gray-950/60">
          <summary className="cursor-pointer px-3 py-2 text-xs text-gray-400 hover:text-gray-200">
            Show full prompt
          </summary>
          <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-gray-300 font-mono px-3 pb-3 max-h-60 overflow-y-auto">
            {preview.systemPrompt}
          </pre>
        </details>
      </section>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-gray-100 truncate">{value ?? '—'}</p>
    </div>
  );
}
