import { useEffect, useRef, useState } from 'react';
import { useOfficeStore } from '../stores/office-store.js';

// ── Tech-stack badge color map ─────────────────────────────────────────────
const BADGE_COLORS = {
  // Blue family
  node:       'bg-blue-900 text-blue-300',
  nodejs:     'bg-blue-900 text-blue-300',
  react:      'bg-blue-800 text-blue-200',
  typescript: 'bg-blue-700 text-blue-100',
  ts:         'bg-blue-700 text-blue-100',
  vite:       'bg-blue-600 text-blue-100',
  // Yellow / amber family
  python:     'bg-amber-900 text-amber-300',
  flask:      'bg-amber-800 text-amber-200',
  django:     'bg-amber-700 text-amber-100',
  // Orange
  rust:       'bg-orange-800 text-orange-200',
  // Cyan
  go:         'bg-cyan-900 text-cyan-300',
  golang:     'bg-cyan-900 text-cyan-300',
  // Red
  ruby:       'bg-red-900 text-red-300',
  rails:      'bg-red-900 text-red-300',
  // Red-orange
  java:       'bg-red-800 text-orange-200',
  spring:     'bg-red-800 text-orange-200',
};

function techBadgeClass(tech) {
  const key = tech.toLowerCase().replace(/[^a-z]/g, '');
  return BADGE_COLORS[key] ?? 'bg-gray-700 text-gray-300';
}

// ── Helpers ────────────────────────────────────────────────────────────────
function truncatePath(path, maxLen = 52) {
  if (!path || path.length <= maxLen) return path ?? '';
  const half = Math.floor((maxLen - 3) / 2);
  return path.slice(0, half) + '…' + path.slice(-half);
}

// ── Component ──────────────────────────────────────────────────────────────
export default function ProjectPicker() {
  const {
    pickerOpen,
    selectedPersona: selectedPersonaId,
    personas,
    projects,
    launchAgent,
    closePicker,
  } = useOfficeStore();

  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const searchRef               = useRef(null);
  const backdropRef             = useRef(null);

  // Resolve the full persona object from the id stored in state
  const persona = personas.find((p) => p.id === selectedPersonaId) ?? null;

  // Filter projects by search query
  const filtered = projects.filter((p) =>
    p.name?.toLowerCase().includes(search.toLowerCase()),
  );

  // Focus search input when modal opens; reset state on close
  useEffect(() => {
    if (pickerOpen) {
      setSearch('');
      setLoading(false);
      setError(null);
      // Defer focus so the element is visible in the DOM
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [pickerOpen]);

  // Escape key closes the picker
  useEffect(() => {
    if (!pickerOpen) return;
    function handleKey(e) {
      if (e.key === 'Escape') closePicker();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [pickerOpen, closePicker]);

  if (!pickerOpen) return null;

  async function handleSelectProject(project) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await launchAgent(selectedPersonaId, project.id);
      closePicker();
    } catch (err) {
      setError(err.message ?? 'Launch failed');
      setLoading(false);
    }
  }

  function handleBackdropClick(e) {
    if (e.target === backdropRef.current) closePicker();
  }

  return (
    /* Backdrop */
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      {/* Modal card */}
      <div
        className="relative w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Pick a project"
      >
        {/* Header: persona info */}
        <div className="border-b border-gray-700 px-5 py-4">
          {persona ? (
            <>
              <p className="text-xs uppercase tracking-widest text-gray-500">Launching persona</p>
              <p className="mt-0.5 text-lg font-bold leading-tight text-gray-100">
                {persona.label}
              </p>
              {persona.domain && (
                <p className="mt-0.5 text-sm text-gray-400">{persona.domain}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">Select a project</p>
          )}
        </div>

        {/* Search */}
        <div className="px-5 pt-4 pb-2">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-5 mb-2 rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Project list */}
        <ul className="max-h-80 overflow-y-auto px-5 pb-5 pt-1 space-y-2">
          {filtered.length === 0 && (
            <li className="py-6 text-center text-sm text-gray-500">
              {search ? 'No projects match your search.' : 'No active projects found.'}
            </li>
          )}
          {filtered.map((project) => (
            <li key={project.id}>
              <button
                disabled={loading}
                onClick={() => handleSelectProject(project)}
                className={[
                  'w-full rounded-lg border border-gray-700 px-4 py-3 text-left transition-colors',
                  loading
                    ? 'cursor-not-allowed opacity-50'
                    : 'hover:bg-gray-800 hover:border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500',
                ].join(' ')}
              >
                {/* Project name */}
                <p className="font-semibold text-gray-100 text-sm leading-snug">
                  {project.name}
                </p>

                {/* Tech-stack badges */}
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

                {/* Path */}
                {project.path && (
                  <p
                    className="mt-1 text-xs text-gray-500 font-mono"
                    title={project.path}
                  >
                    {truncatePath(project.path)}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-gray-900/80">
            <div className="flex flex-col items-center gap-3">
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-blue-400" />
              <p className="text-sm text-gray-400">Launching…</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
