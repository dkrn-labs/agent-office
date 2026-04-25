import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import XTermPane from '../term/XTermPane.jsx';

// ─── Mock data ─────────────────────────────────────────────────────────────

const PERSONAS = [
  { id: 'frontdesk', label: 'Frontdesk', sprite: '🛎️', domain: 'router' },
  { id: 'debug', label: 'Debug Specialist', sprite: '🐛', domain: 'debug' },
  { id: 'backend', label: 'Backend Engineer', sprite: '🔧', domain: 'backend' },
  { id: 'frontend', label: 'Frontend Engineer', sprite: '🎨', domain: 'frontend' },
  { id: 'review', label: 'Senior Reviewer', sprite: '🔍', domain: 'review' },
  { id: 'devops', label: 'DevOps', sprite: '🚀', domain: 'devops' },
];

const QUOTA = {
  claude: { h5: 0.96, d7: 0.96, h5Reset: '4h 37m', d7Reset: '6d 16h' },
  codex: { h5: 0.97, d7: 0.76, h5Reset: 'now', d7Reset: '3d 21h' },
  totalToday: '19.8M',
  rate: '0/min',
};

const SAVINGS = {
  today: { saved: 412_000, baseline: 580_000, optimized: 168_000, dollars: 1.24, sessions: 9 },
  d7: { saved: 4_180_000, baseline: 5_720_000, optimized: 1_540_000, dollars: 12.54, sessions: 71 },
  d30: { saved: 18_900_000, baseline: 26_100_000, optimized: 7_200_000, dollars: 56.70, sessions: 312 },
};

// Project activity (github + local git, abtop-fed)
const PROJECT_ACTIVITY = [
  { id: 'agent-office', name: 'agent-office', branch: 'main', ahead: 7, behind: 0, modified: 9, commitsToday: 4, prsOpen: 1, issuesOpen: 3, lastCommit: '23m ago', live: true },
  { id: 'ai-4-society', name: 'ai-4-society', branch: 'main', ahead: 2, behind: 0, modified: 2, commitsToday: 1, prsOpen: 0, issuesOpen: 1, lastCommit: '3h ago', live: true },
  { id: 'lens', name: 'lens', branch: 'dev', ahead: 9, behind: 0, modified: 1, commitsToday: 6, prsOpen: 2, issuesOpen: 0, lastCommit: '14m ago', live: true },
  { id: 'narron-io', name: 'narron.io', branch: 'main', ahead: 0, behind: 1, modified: 0, commitsToday: 0, prsOpen: 1, issuesOpen: 5, lastCommit: '2d ago', live: false },
  { id: 'gridlands', name: 'gridlands', branch: 'feat/sockets', ahead: 3, behind: 2, modified: 4, commitsToday: 0, prsOpen: 1, issuesOpen: 2, lastCommit: '1d ago', live: false },
];

const LIVE_SESSIONS = [
  {
    id: '5fac46de', pid: 1724, persona: 'Debug Specialist', personaSprite: '🐛',
    project: 'agent-office', branch: 'main +7 ~9', provider: 'claude-code',
    model: 'opus-4.7[1m]', status: 'wait', summary: 'CLI Wrapper Project Exploration',
    sub: 'waiting for input', contextPct: 0.41,
    tokens: { total: 2.3e6, input: 6500, output: 54600, cacheR: 2.0e6, cacheW: 173400 },
    memoryMB: 402, turn: 35, ports: [{ port: 50929, label: 'lens' }], burnRate: 'mid',
  },
  {
    id: '1f6fefc4', pid: 4384, persona: 'Backend Engineer', personaSprite: '🔧',
    project: 'ai-4-society', branch: 'main +2 ~2', provider: 'claude-code',
    model: 'opus-4.7[1m]', status: 'wait', summary: 'Caveman Mode Skill Setup',
    sub: 'waiting for input', contextPct: 0.34,
    tokens: { total: 2.3e6, input: 4100, output: 31800, cacheR: 1.7e6, cacheW: 110200 },
    memoryMB: 232, turn: 43, ports: [], burnRate: 'low',
  },
  {
    id: '786dd1a2', pid: 47589, persona: '— (unattended)', personaSprite: '👻',
    project: 'lens', branch: 'dev +9 ~1', provider: 'claude-code',
    model: 'opus-4.7[1m]', status: 'wait', summary: 'Caveman Mode Activation Request',
    sub: 'waiting for input', contextPct: 0.79, contextWarn: true,
    tokens: { total: 15.2e6, input: 18900, output: 142100, cacheR: 13.8e6, cacheW: 1.1e6 },
    memoryMB: 421, turn: 148, ports: [], burnRate: 'high',
  },
];

const SESSION_DETAIL = {
  '5fac46de': {
    children: [
      { pid: 1745, cmd: 'npm exec @playwright/mcp@l…', mem: 47 },
      { pid: 1839, cmd: 'node /Users/dehakuran/.npm…', mem: 39 },
      { pid: 1741, cmd: 'npm exec @upstash/context7…', mem: 47 },
      { pid: 1858, cmd: 'node /Users/dehakuran/.npm…', mem: 40 },
      { pid: 1742, cmd: 'npm exec firebase-tools@la…', mem: 47 },
      { pid: 1877, cmd: 'node /Users/dehakuran/.npm…', mem: 44 },
    ],
    subagents: [
      { name: 'Audit onboarding wizard + persona filter', tokens: 2.4e6, ok: true },
      { name: 'Audit unified history DB ingestion', tokens: 3.0e6, ok: true },
    ],
    timeline: [
      { kind: 'Agent', label: 'Agent', dur: '37.9s', bar: 0.95 },
      { kind: 'Agent', label: 'Agent', dur: '37.9s', bar: 0.95 },
      { kind: 'Bash', label: 'ls /Users/dehakuran…', dur: '43ms', bar: 0.04 },
      { kind: 'Read', label: 'src/App.jsx', dur: '6ms', bar: 0.02 },
      { kind: 'Read', label: 'src/main.jsx', dur: '16ms', bar: 0.03 },
      { kind: 'Read', label: 'ui/package.json', dur: '11ms', bar: 0.02 },
      { kind: 'Write', label: 'mockups/LightV2.jsx', dur: '18ms', bar: 0.03 },
      { kind: 'Edit', label: 'src/App.jsx', dur: '9ms', bar: 0.02 },
      { kind: 'Bash', label: 'lsof -i :5173 -i :5…', dur: '86ms', bar: 0.06 },
      { kind: 'Bash', label: 'abtop --help 2>&1 |…', dur: '1m34s *', bar: 0.85, warn: true },
    ],
    callsCount: 14, elapsed: '2m 50s',
  },
};

const PROJECTS_PICKER = [
  { id: 'agent-office', label: 'agent-office', stack: 'node·react', group: 'pinned', activity: 'live · 3 sessions' },
  { id: 'lens', label: 'lens', stack: 'next·ts', group: 'pinned', activity: 'live · 1 session' },
  { id: 'ai-4-society', label: 'ai-4-society', stack: 'python·fastapi', group: 'recent', activity: '3h ago' },
  { id: 'narron-io', label: 'narron.io', stack: 'next·ts', group: 'recent', activity: '1d ago' },
  { id: 'gridlands', label: 'gridlands', stack: 'turbo·pnpm', group: 'recent', activity: '2d ago' },
  { id: 'kasboek-ai', label: 'kasboek-ai', stack: 'vite·react', group: 'all', activity: '6d ago' },
];

const FRONTDESK_PROPOSAL = {
  persona: 'Debug Specialist',
  project: 'agent-office',
  model: 'sonnet-4.6',
  provider: 'claude-code',
  confidence: 0.91,
  reasoning: '"gemini hook" + "AfterAgent" → ingestion bug → debug domain. Project resolved by name match.',
};

const HISTORY_CANDIDATES = [
  { id: 'h1', title: 'Fixed AfterAgent watcher race', file: 'gemini-watcher.js', age: '2d ago', tokens: 480, type: 'bugfix', on: true, score: 0.94 },
  { id: 'h2', title: 'Forwarded createdAt → started_at', file: 'hook-bridge.js', age: '4d ago', tokens: 510, type: 'bugfix', on: true, score: 0.91 },
  { id: 'h3', title: 'Classifier emits bugfix type', file: 'transcript-extractors.js', age: '6d ago', tokens: 620, type: 'bugfix', on: true, score: 0.82 },
  { id: 'h4', title: 'Live tracker session:expired event', file: 'live-session-tracker.js', age: '9d ago', tokens: 410, type: 'bugfix', on: true, score: 0.78 },
  { id: 'h5', title: 'Codex polling cadence tuned', file: 'codex-watcher.js', age: '12d ago', tokens: 380, type: 'bugfix', on: false, score: 0.61 },
  { id: 'h6', title: 'Unattended session createUnattended()', file: 'server.js', age: '14d ago', tokens: 440, type: 'bugfix', on: true, score: 0.74 },
];

const SKILL_CANDIDATES = [
  { id: 'sk1', label: 'systematic-debugging', tokens: 3400, on: true },
  { id: 'sk2', label: 'verification-before-completion', tokens: 1100, on: true },
  { id: 'sk3', label: 'test-driven-development', tokens: 2900, on: false },
  { id: 'sk4', label: 'receiving-code-review', tokens: 1400, on: false },
];

const RECENT_SESSIONS = [
  { id: 'r1', persona: 'Frontend Engineer', project: 'agent-office', provider: 'claude-code', finishedAt: '14m ago', tokens: 41200, baselineTokens: 118400, cost: 0.62, outcome: 'accepted', summary: 'Two-pane HistoryView' },
  { id: 'r2', persona: 'Debug Specialist', project: 'narron.io', provider: 'codex', finishedAt: '1h ago', tokens: 18800, baselineTokens: 92300, cost: 0.27, outcome: 'partial', summary: 'Webhook race repro' },
  { id: 'r3', persona: 'Senior Reviewer', project: 'gridlands', provider: 'claude-code', finishedAt: '3h ago', tokens: 22500, baselineTokens: 76800, cost: 0.34, outcome: 'accepted', summary: 'Reviewed PR #142' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

const providerColor = {
  'claude-code': 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  codex: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  'gemini-cli': 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
};
const outcomeColor = {
  accepted: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  partial: 'bg-amber-950 text-amber-300 border-amber-800',
  rejected: 'bg-red-950 text-red-300 border-red-800',
};
const burnColor = { high: 'text-red-400', mid: 'text-amber-400', low: 'text-emerald-400' };

function fmt(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function Pill({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-[2px] text-[9px] uppercase tracking-wider ${className}`}>
      {children}
    </span>
  );
}

function Bar({ pct, color = 'bg-emerald-500', warn }) {
  const w = Math.max(2, Math.round(pct * 100));
  const c = warn ? 'bg-red-500' : color;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full ${c}`} style={{ width: `${w}%` }} />
    </div>
  );
}

// ─── Header + ambient ──────────────────────────────────────────────────────

function Header() {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-2">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm font-bold tracking-[0.18em]">DKCC</span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">agent-office · light/v2</span>
        <Pill className="border-slate-700 bg-slate-900 text-slate-400">abtop v0.3.5</Pill>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          {PERSONAS.map((p) => {
            const live = LIVE_SESSIONS.some((s) => s.persona.includes(p.label.split(' ')[0]));
            return (
              <span
                key={p.id}
                title={`${p.label} · ${live ? 'busy' : 'ready'}`}
                className={`inline-flex h-6 w-6 items-center justify-center rounded text-sm transition ${
                  live ? 'bg-emerald-900/40 ring-1 ring-emerald-500/40' : 'opacity-60'
                }`}
              >
                <span className={live ? 'animate-pulse' : ''}>{p.sprite}</span>
              </span>
            );
          })}
        </div>
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> connected
        </span>
        <a href="/legacy" className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500 hover:text-slate-300">
          ↗ legacy
        </a>
      </div>
    </div>
  );
}

// ─── Telemetry zone ────────────────────────────────────────────────────────

function QuotaCell({ label, ago, h5, d7, h5Reset, d7Reset }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-1.5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
        {label} <span className="text-slate-600">· {ago}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-slate-400">5h</span>
          <div className="w-24"><Bar pct={h5} color={h5 > 0.9 ? 'bg-amber-500' : 'bg-emerald-500'} /></div>
          <span className="font-mono text-[10px] text-slate-300">{Math.round(h5 * 100)}%</span>
          <span className="font-mono text-[9px] text-slate-600">↻ {h5Reset}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-slate-400">7d</span>
          <div className="w-24"><Bar pct={d7} color={d7 > 0.9 ? 'bg-amber-500' : 'bg-emerald-500'} /></div>
          <span className="font-mono text-[10px] text-slate-300">{Math.round(d7 * 100)}%</span>
          <span className="font-mono text-[9px] text-slate-600">↻ {d7Reset}</span>
        </div>
      </div>
    </div>
  );
}

function SavingsPill() {
  const [range, setRange] = useState('today');
  const [data, setData] = useState({ today: null, d7: null, d30: null });
  const [loadingRange, setLoadingRange] = useState(null);

  // Fetch on mount: pull all three ranges in parallel.
  useEffect(() => {
    let cancelled = false;
    Promise.all(['today', 'd7', 'd30'].map((r) =>
      fetch(`/api/savings?range=${r}`)
        .then((res) => res.ok ? res.json() : null)
        .then((j) => [r, j?.data ?? null])
        .catch(() => [r, null]),
    )).then((entries) => {
      if (cancelled) return;
      setData(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, []);

  // Refetch a single range on toggle so numbers stay live.
  const onRangeClick = (r) => {
    setRange(r);
    setLoadingRange(r);
    fetch(`/api/savings?range=${r}`)
      .then((res) => res.ok ? res.json() : null)
      .then((j) => setData((prev) => ({ ...prev, [r]: j?.data ?? prev[r] })))
      .catch(() => {})
      .finally(() => setLoadingRange(null));
  };

  // Live data > seeded mock fallback (lets the page still render w/o backend).
  const live = data[range];
  const fallback = SAVINGS[range];
  const s = live
    ? { saved: live.savedTokens, baseline: live.baselineTokens, optimized: live.optimizedTokens, dollars: live.costDollars, sessions: live.sessions, pct: live.savedPct }
    : { saved: fallback.saved, baseline: fallback.baseline, optimized: fallback.optimized, dollars: fallback.dollars, sessions: fallback.sessions, pct: Math.round((fallback.saved / fallback.baseline) * 100) };

  return (
    <div
      title={live
        ? `${fmt(s.saved)} tokens saved · $${(s.dollars ?? 0).toFixed(2)} cost avoided · ${s.sessions} sessions (live)`
        : `${fmt(s.saved)} (mock — backend unreachable)`}
      className={`flex items-center gap-2 rounded-full border px-2 py-1 ${
        live
          ? 'border-emerald-500/30 bg-emerald-500/10'
          : 'border-amber-500/30 bg-amber-500/10'
      }`}
    >
      <span className={`font-mono text-[9px] uppercase tracking-wider ${live ? 'text-emerald-400/80' : 'text-amber-400/80'}`}>
        {live ? 'saved' : 'saved · mock'}
      </span>
      <span className={`font-mono text-[11px] font-bold ${live ? 'text-emerald-300' : 'text-amber-300'}`}>{fmt(s.saved)}</span>
      <span className={`font-mono text-[10px] ${live ? 'text-emerald-400' : 'text-amber-400'}`}>${(s.dollars ?? 0).toFixed(2)}</span>
      <span className={`font-mono text-[10px] ${live ? 'text-emerald-300/80' : 'text-amber-300/80'}`}>−{s.pct}%</span>
      <span className={`mx-1 h-3 w-px ${live ? 'bg-emerald-500/30' : 'bg-amber-500/30'}`} />
      <div className="flex items-center gap-0.5">
        {[['today', 'D'], ['d7', '7D'], ['d30', '30D']].map(([id, label]) => (
          <button key={id} onClick={() => onRangeClick(id)}
            className={`rounded px-1 py-[1px] font-mono text-[9px] ${
              range === id
                ? (live ? 'bg-emerald-500/25 text-emerald-200' : 'bg-amber-500/25 text-amber-200')
                : 'text-slate-500 hover:text-slate-300'
            }`}>
            {loadingRange === id ? '·' : label}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuotaRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-600">
        quota <span className="ml-1 text-slate-700">· abtop</span>
      </span>
      <QuotaCell label="Claude" ago="3m ago" h5={QUOTA.claude.h5} d7={QUOTA.claude.d7} h5Reset={QUOTA.claude.h5Reset} d7Reset={QUOTA.claude.d7Reset} />
      <QuotaCell label="Codex" ago="1d ago" h5={QUOTA.codex.h5} d7={QUOTA.codex.d7} h5Reset={QUOTA.codex.h5Reset} d7Reset={QUOTA.codex.d7Reset} />
      <div className="ml-auto flex items-center gap-4 font-mono text-[10px] text-slate-500">
        <span>rate <span className="text-slate-300">{QUOTA.rate}</span></span>
        <span>today <span className="text-slate-300">{QUOTA.totalToday}</span></span>
        <SavingsPill />
      </div>
    </div>
  );
}

function ProjectActivityRow() {
  const items = [...PROJECT_ACTIVITY, ...PROJECT_ACTIVITY]; // duplicate for seamless loop
  return (
    <div className="relative flex items-center gap-3 overflow-hidden border-t border-slate-900/60 px-4 py-1.5">
      <span className="z-10 flex-shrink-0 bg-slate-950 pr-2 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-600">
        projects <span className="text-slate-700">· git</span>
      </span>
      <div className="ticker-mask flex min-w-0 flex-1 overflow-hidden">
        <div className="ticker-track flex flex-shrink-0 items-center gap-8 whitespace-nowrap pr-8">
          {items.map((p, i) => (
            <span key={i} className="flex items-center gap-2 font-mono text-[11px]">
              {p.live && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" />}
              <span className={p.live ? 'font-semibold text-emerald-300' : 'font-semibold text-slate-200'}>{p.name}</span>
              <span className="text-slate-500">{p.branch}</span>
              {p.ahead > 0 && <span className="text-emerald-400">+{p.ahead}</span>}
              {p.behind > 0 && <span className="text-red-400">−{p.behind}</span>}
              {p.modified > 0 && <span className="text-amber-400">~{p.modified}</span>}
              <span className="text-slate-600">↑{p.commitsToday}</span>
              <span className="text-slate-600">PR {p.prsOpen}</span>
              <span className="text-slate-600">iss {p.issuesOpen}</span>
              <span className="text-slate-700">{p.lastCommit}</span>
            </span>
          ))}
        </div>
      </div>
      <span className="z-10 flex-shrink-0 bg-slate-950 pl-2 font-mono text-[10px] text-slate-500">
        <span className="text-slate-300">11</span> today ·
        <span className="ml-1 text-slate-300">5</span> PRs ·
        <span className="ml-1 text-slate-300">11</span> iss
      </span>
      <style>{`
        .ticker-track { animation: ao-ticker 80s linear infinite; }
        .ticker-mask:hover .ticker-track { animation-play-state: paused; }
        @keyframes ao-ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

function TelemetryZone() {
  return (
    <div className="border-b border-slate-800 bg-slate-950">
      <QuotaRow />
      <ProjectActivityRow />
    </div>
  );
}

// ─── Live Ops left rail (compact cards + slide-over drawer) ────────────────

function RailCard({ s, expanded, onExpand }) {
  return (
    <button
      onClick={onExpand}
      className={`group flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition ${
        expanded
          ? 'border-sky-500/60 bg-sky-500/10 ring-1 ring-sky-500/30'
          : 'border-slate-800 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-900/60'
      }`}
    >
      <span className="text-lg">{s.personaSprite}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-[12px] font-semibold text-slate-100">{s.persona}</span>
          <Pill className="flex-shrink-0 border-slate-700 bg-slate-900 text-slate-400">⊙ {s.status}</Pill>
        </div>
        <div className="truncate font-mono text-[10px] text-sky-400">
          {s.project} <span className="text-slate-600">· {s.branch}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className={`flex-shrink-0 rounded border px-1.5 py-[1px] font-mono text-[9px] ${providerColor[s.provider]}`}>
            {s.provider}
          </span>
          <span className="truncate font-mono text-[9px] text-slate-500">{s.model}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <Bar pct={s.contextPct} warn={s.contextWarn} color={s.contextPct > 0.7 ? 'bg-amber-500' : 'bg-sky-500'} />
          <span className={`flex-shrink-0 font-mono text-[9px] ${s.contextWarn ? 'text-red-400' : 'text-slate-500'}`}>
            {Math.round(s.contextPct * 100)}%{s.contextWarn ? '!' : ''}
          </span>
        </div>
      </div>
      <span className={`ml-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded font-mono text-sm transition ${
        expanded ? 'bg-sky-500/20 text-sky-200' : 'text-slate-600 group-hover:bg-slate-800 group-hover:text-slate-300'
      }`}>›</span>
    </button>
  );
}

function adaptLiveSession(api, personasById, projectsById) {
  const persona = personasById.get(api.personaId);
  const project = projectsById.get(api.projectId);
  // Best-effort burn-rate tag (no abtop yet → derive from token totals)
  const t = api.totals?.total ?? 0;
  const burnRate = t > 1e6 ? 'high' : t > 1e5 ? 'mid' : 'low';
  return {
    id: api.sessionId,
    pid: null,                                  // abtop-only (P4)
    persona: persona?.label ?? '— (unattended)',
    personaSprite: persona ? '🤖' : '👻',
    project: project?.name ?? api.projectPath?.split('/').pop() ?? '?',
    branch: '—',                                 // abtop-only (P4)
    provider: api.providerId ?? '?',
    model: api.lastModel ?? '?',
    status: api.working ? 'working' : 'idle',
    summary: '',
    sub: '',
    contextPct: 0,                               // abtop-only (P4)
    contextWarn: false,
    tokens: {
      total: api.totals?.total ?? 0,
      input: api.totals?.tokensIn ?? 0,
      output: api.totals?.tokensOut ?? 0,
      cacheR: api.totals?.cacheRead ?? 0,
      cacheW: api.totals?.cacheWrite ?? 0,
    },
    memoryMB: 0,                                 // abtop-only (P4)
    turn: 0,                                     // abtop-only (P4)
    ports: [],                                   // abtop-only (P4)
    burnRate,
    _live: true,
  };
}

function LiveOpsRail({ expandedId, setExpandedId }) {
  const [showRecent, setShowRecent] = useState(false);
  const [liveSessions, setLiveSessions] = useState(null); // null = loading, [] = empty, [...] = data
  const [personasById, setPersonasById] = useState(new Map());
  const [projectsById, setProjectsById] = useState(new Map());

  // Hydrate persona/project lookups once
  useEffect(() => {
    Promise.all([
      fetch('/api/personas').then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch('/api/projects').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([personas, projects]) => {
      setPersonasById(new Map((personas ?? []).map((p) => [p.id, p])));
      setProjectsById(new Map((projects ?? []).map((p) => [p.id, p])));
    });
  }, []);

  // Poll active sessions every 5s
  useEffect(() => {
    let cancelled = false;
    const fetchActive = async () => {
      try {
        const res = await fetch('/api/sessions/active');
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setLiveSessions(Array.isArray(json) ? json : []);
      } catch {
        if (!cancelled) setLiveSessions([]);
      }
    };
    fetchActive();
    const id = setInterval(fetchActive, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Decide what to render: live data (even empty) > mock fallback when truly offline
  const displaySessions = liveSessions == null
    ? LIVE_SESSIONS                              // still loading, show mock
    : liveSessions.length > 0
      ? liveSessions.map((s) => adaptLiveSession(s, personasById, projectsById))
      : [];                                       // backend up but no sessions

  const isLive = liveSessions != null;
  const isEmpty = isLive && displaySessions.length === 0;

  return (
    <aside className="flex w-[280px] flex-shrink-0 flex-col border-r border-slate-800 bg-slate-950/60">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Live ops</span>
          <Pill className={isLive
            ? 'border-emerald-500/40 bg-emerald-950 text-emerald-300'
            : 'border-amber-500/40 bg-amber-950 text-amber-300'
          }>
            {displaySessions.length} {isLive ? 'sessions' : 'sessions · mock'}
          </Pill>
        </div>
        <span className="font-mono text-[9px] text-slate-600">› expand</span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {isEmpty ? (
          <div className="rounded-md border border-dashed border-slate-800 bg-slate-900/20 px-3 py-6 text-center">
            <div className="mb-1 text-2xl opacity-40">💤</div>
            <div className="font-mono text-[11px] text-slate-400">No active agents</div>
            <div className="mt-1 font-mono text-[9px] text-slate-600">Launch one via the Pre-fill button below</div>
          </div>
        ) : displaySessions.map((s) => (
          <RailCard
            key={s.id}
            s={s}
            expanded={expandedId === s.id}
            onExpand={() => setExpandedId(expandedId === s.id ? null : s.id)}
          />
        ))}
      </div>
      <div className="border-t border-slate-800">
        <button
          onClick={() => setShowRecent((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500 hover:text-slate-300"
        >
          <span>recently finished · {RECENT_SESSIONS.length}</span>
          <span>{showRecent ? '▾' : '▸'}</span>
        </button>
        {showRecent && (
          <div className="flex flex-col gap-1 px-2 pb-2">
            {RECENT_SESSIONS.map((r) => {
              const savedPct = Math.round(((r.baselineTokens - r.tokens) / r.baselineTokens) * 100);
              return (
                <div key={r.id} className="rounded border border-slate-900 bg-slate-950/40 px-2 py-1.5 font-mono text-[10px]">
                  <div className="flex items-center justify-between">
                    <Pill className={outcomeColor[r.outcome]}>{r.outcome}</Pill>
                    <span className="text-slate-500">{r.finishedAt}</span>
                  </div>
                  <div className="mt-1 truncate text-slate-200">{r.persona}</div>
                  <div className="truncate text-sky-400">{r.project}</div>
                  <div className="mt-0.5 flex items-center justify-between">
                    <span className="text-slate-500">{fmt(r.tokens)} · ${r.cost.toFixed(2)}</span>
                    <span className="text-emerald-300">−{savedPct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}


// ─── Launcher panel (above terminal) ───────────────────────────────────────

function LauncherPanel({
  task, setTask, focused, setFocused,
  selectedPersona, setSelectedPersona,
  selectedProject, setSelectedProject,
  history, toggleHistory,
  skills, toggleSkill,
  onLaunch, launching, launchError,
  proposal, setProposal,
}) {
  // Budget calc
  const totals = useMemo(() => {
    const skillTokens = skills.filter((s) => s.on).reduce((a, b) => a + b.tokens, 0);
    const histTokens = history.filter((h) => h.on).reduce((a, b) => a + b.tokens, 0);
    const personaTokens = 1200;
    const memoryTokens = 660;
    const total = skillTokens + histTokens + personaTokens + memoryTokens;
    return { skillTokens, histTokens, personaTokens, memoryTokens, total };
  }, [skills, history]);
  const baseline = 38000;
  const savedPct = Math.round(((baseline - totals.total) / baseline) * 100);

  // P1-7 — live frontdesk routing (proposal is lifted to the page so onLaunch
  // can read pick.persona.id / pick.provider.id directly).
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState(null);

  const onPrefill = async () => {
    if (!task.trim()) return;
    setRouting(true);
    setRouteError(null);
    try {
      const res = await fetch('/api/frontdesk/route', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task }),
      });
      const json = await res.json();
      if (json.error) {
        setRouteError(json.error);
        setProposal(null);
        return;
      }
      const data = json.data;
      setProposal(data);
      // Apply the pick to the wizard state when not blocked
      const blocked = data.candidates?.constraints?.blockedReason;
      if (!blocked && data.pick?.persona) {
        // Map to mockup persona ids (best-effort by domain)
        const domainToId = { debug: 'debug', backend: 'backend', frontend: 'frontend', review: 'review', devops: 'devops' };
        const mappedId = domainToId[data.pick.persona.domain];
        if (mappedId) setSelectedPersona(mappedId);
      }
    } catch (err) {
      setRouteError(err.message);
    } finally {
      setRouting(false);
    }
  };

  const blocked = proposal?.candidates?.constraints?.blockedReason;
  const proposalLabel = proposal?.pick?.persona?.label;
  const rulesApplied = proposal?.candidates?.rulesApplied ?? [];

  return (
    <div className="flex flex-col border-t border-slate-800 bg-slate-950/80">
      {/* Command bar — Frontdesk is the entry point */}
      <div className="flex items-center gap-2 border-b border-slate-900 px-4 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-600">launcher</span>
        <div className={`flex flex-1 items-center gap-2 rounded-md border px-2 py-1.5 transition ${
          focused ? 'border-sky-500/50 bg-slate-900/80 ring-1 ring-sky-500/20' : 'border-slate-800 bg-slate-900/40'
        }`}>
          <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-[1px] font-mono text-[10px] text-slate-400">⌘K</kbd>
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="describe a task — frontdesk pre-fills the wizard…"
            className="flex-1 bg-transparent font-mono text-[12px] text-slate-100 placeholder-slate-600 outline-none"
          />
        </div>
        {/* Frontdesk pre-fill button — highlighted as the starting point */}
        <button
          onClick={onPrefill}
          disabled={routing || !task.trim()}
          className={`group flex items-center gap-2 rounded-md border-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition ${
            blocked
              ? 'border-red-500/60 bg-red-500/10 text-red-200'
              : proposal
                ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
                : 'border-amber-400/60 bg-amber-400/10 text-amber-200 shadow-[0_0_20px_rgba(251,191,36,0.15)] hover:bg-amber-400/20 disabled:opacity-50'
          }`}
        >
          <span className={`text-base ${routing ? 'animate-spin' : 'group-hover:animate-bounce'}`}>🛎️</span>
          <span className="flex flex-col items-start leading-tight">
            <span>{routing ? 'Routing…' : proposal ? 'Re-route' : 'Pre-fill'}</span>
            <span className="font-mono text-[8px] normal-case tracking-normal opacity-70">
              {blocked ? 'blocked · see msg' :
                proposal ? `→ ${proposalLabel} · rules: ${rulesApplied.join(',')}` :
                'frontdesk · rules-only'}
            </span>
          </span>
        </button>
      </div>

      {/* Frontdesk message strip — shows blocked reason or rule trace when present */}
      {(blocked || routeError) && (
        <div className="border-b border-red-900/40 bg-red-950/30 px-4 py-1.5 font-mono text-[10px] text-red-300">
          🛎️ {blocked || routeError}
        </div>
      )}

      <WizardRow
        selectedPersona={selectedPersona} setSelectedPersona={setSelectedPersona}
        selectedProject={selectedProject} setSelectedProject={setSelectedProject}
        history={history} toggleHistory={toggleHistory}
        skills={skills} toggleSkill={toggleSkill}
        totals={totals} savedPct={savedPct}
        onLaunch={onLaunch}
        launching={launching} launchError={launchError}
      />
    </div>
  );
}

function ComboTrigger({ step, label, value, hint, accent, open, onClick, flex = 1 }) {
  return (
    <button
      onClick={onClick}
      style={{ flex }}
      className={`flex h-9 min-w-0 items-center gap-2 rounded-md border px-2.5 transition ${
        open
          ? 'border-sky-500/60 bg-sky-500/10 ring-1 ring-sky-500/30'
          : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
      }`}
    >
      <span className="flex-shrink-0 font-mono text-[9px] uppercase tracking-wider text-slate-500">
        {step} · {label}
      </span>
      <span className="flex-1 truncate text-left font-mono text-[12px] text-slate-100">{value}</span>
      {hint && <span className="flex-shrink-0 font-mono text-[9px] text-slate-500">{hint}</span>}
      {accent && <span className="flex-shrink-0 font-mono text-[10px] text-amber-400">🛎️</span>}
      <span className="flex-shrink-0 text-slate-500">{open ? '▴' : '▾'}</span>
    </button>
  );
}

function WizardRow({
  selectedPersona, setSelectedPersona,
  selectedProject, setSelectedProject,
  history, toggleHistory,
  skills, toggleSkill,
  totals, savedPct, onLaunch,
  launching, launchError,
}) {
  const [openCombo, setOpenCombo] = useState(null);
  const close = () => setOpenCombo(null);
  const persona = PERSONAS.find((p) => p.id === selectedPersona);
  const project = PROJECTS_PICKER.find((p) => p.id === selectedProject);
  const histOn = history.filter((h) => h.on).length;
  const skillsOn = skills.filter((s) => s.on).length;

  return (
    <div className="relative flex items-center gap-2 px-4 py-2">
      {/* click-outside backdrop */}
      {openCombo && <div onClick={close} className="fixed inset-0 z-20" />}

      {/* 1 · Persona */}
      <div className="relative" style={{ flex: 1.6 }}>
        <ComboTrigger
          step="1" label="persona" accent
          value={persona ? `${persona.sprite}  ${persona.label}` : 'pick…'}
          open={openCombo === 'persona'}
          onClick={() => setOpenCombo(openCombo === 'persona' ? null : 'persona')}
        />
        {openCombo === 'persona' && (
          <div className="absolute left-0 top-full z-30 mt-1 w-[260px] rounded-md border border-slate-700 bg-slate-950 p-2 shadow-xl">
            <div className="grid grid-cols-3 gap-1">
              {PERSONAS.filter((p) => p.id !== 'frontdesk').map((p) => (
                <button key={p.id}
                  onClick={() => { setSelectedPersona(p.id); close(); }}
                  className={`flex flex-col items-center gap-1 rounded border py-2 ${
                    selectedPersona === p.id ? 'border-sky-500/60 bg-sky-500/10' : 'border-slate-800 hover:border-slate-700'
                  }`}>
                  <span className="text-lg">{p.sprite}</span>
                  <span className="font-mono text-[10px] text-slate-300">{p.label.split(' ')[0]}</span>
                  <span className="font-mono text-[8px] uppercase tracking-wider text-slate-500">{p.domain}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2 · Project */}
      <div className="relative" style={{ flex: 1.6 }}>
        <ComboTrigger
          step="2" label="project"
          value={project ? project.label : 'pick…'}
          hint={project?.activity}
          open={openCombo === 'project'}
          onClick={() => setOpenCombo(openCombo === 'project' ? null : 'project')}
        />
        {openCombo === 'project' && (
          <div className="absolute left-0 top-full z-30 mt-1 w-[300px] max-h-[280px] overflow-y-auto rounded-md border border-slate-700 bg-slate-950 p-1 shadow-xl">
            {PROJECTS_PICKER.map((p) => (
              <button key={p.id}
                onClick={() => { setSelectedProject(p.id); close(); }}
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left ${
                  selectedProject === p.id ? 'bg-sky-500/15 ring-1 ring-sky-500/40' : 'hover:bg-slate-900'
                }`}>
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12px] text-slate-100">{p.label}</div>
                  <div className="font-mono text-[10px] text-slate-500">{p.stack} · {p.activity}</div>
                </div>
                {p.group === 'pinned' && <span className="font-mono text-[10px] text-amber-400">★</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 3 · History */}
      <div className="relative" style={{ flex: 2 }}>
        <ComboTrigger
          step="3" label="history"
          value={`${histOn}/${history.length} items`}
          hint={`${fmt(totals.histTokens)} tok`}
          open={openCombo === 'history'}
          onClick={() => setOpenCombo(openCombo === 'history' ? null : 'history')}
        />
        {openCombo === 'history' && (
          <div className="absolute left-0 top-full z-30 mt-1 w-[460px] max-h-[280px] overflow-y-auto rounded-md border border-slate-700 bg-slate-950 p-1 shadow-xl">
            {history.map((h) => (
              <label key={h.id}
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 ${
                  h.on ? 'bg-slate-900/60' : 'hover:bg-slate-900/40'
                }`}>
                <input type="checkbox" checked={h.on} onChange={() => toggleHistory(h.id)}
                  className="h-3 w-3 accent-emerald-500" />
                <span className="flex-1 truncate font-mono text-[11px] text-slate-200" title={h.title}>{h.title}</span>
                <span className="font-mono text-[9px] text-slate-500">{h.file}</span>
                <span className="font-mono text-[9px] text-slate-600">{h.age}</span>
                <span className="font-mono text-[9px] text-emerald-400">{Math.round(h.score * 100)}%</span>
                <span className="font-mono text-[9px] text-slate-500">{fmt(h.tokens)}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* 4 · Skills */}
      <div className="relative" style={{ flex: 1.6 }}>
        <ComboTrigger
          step="4" label="skills" accent
          value={`${skillsOn}/${skills.length} on`}
          hint={`${fmt(totals.skillTokens)} tok`}
          open={openCombo === 'skills'}
          onClick={() => setOpenCombo(openCombo === 'skills' ? null : 'skills')}
        />
        {openCombo === 'skills' && (
          <div className="absolute left-0 top-full z-30 mt-1 w-[320px] max-h-[280px] overflow-y-auto rounded-md border border-slate-700 bg-slate-950 p-1 shadow-xl">
            {skills.map((sk) => (
              <label key={sk.id}
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 ${
                  sk.on ? 'bg-slate-900/60' : 'hover:bg-slate-900/40'
                }`}>
                <input type="checkbox" checked={sk.on} onChange={() => toggleSkill(sk.id)}
                  className="h-3 w-3 accent-emerald-500" />
                <span className="flex-1 truncate font-mono text-[11px] text-slate-200">{sk.label}</span>
                <span className="font-mono text-[9px] text-slate-500">{fmt(sk.tokens)}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* 5 · Launch */}
      <button
        onClick={onLaunch}
        disabled={launching}
        title={launchError ?? undefined}
        className={`flex h-9 flex-shrink-0 items-center gap-2 rounded-md border-2 px-3 font-mono shadow-[0_0_20px_rgba(56,189,248,0.15)] transition ${
          launchError
            ? 'border-red-500/60 bg-red-500/10 text-red-200 hover:bg-red-500/20'
            : 'border-sky-500/50 bg-gradient-to-b from-sky-500/15 to-sky-500/5 text-sky-200 hover:from-sky-500/25 hover:to-sky-500/10'
        } disabled:opacity-50`}
      >
        <span className={`text-base leading-none ${launching ? 'animate-spin' : ''}`}>{launching ? '◴' : '↵'}</span>
        <span className="text-[12px] font-bold uppercase tracking-wider">{launching ? 'Launching…' : 'Launch'}</span>
        <span className="text-[9px] text-sky-300/70">{fmt(totals.total)} · −{savedPct}%</span>
      </button>
    </div>
  );
}

// ─── Terminal dock + expand drawer overlay ─────────────────────────────────

function FakeTerminal({ session }) {
  const [lines, setLines] = useState([
    `\x1b agent-office · session ${session.id} (${session.persona})`,
    `model: ${session.model} · context ${Math.round(session.contextPct * 100)}% · turn ${session.turn}`,
    '',
    '> task: explore agent-office, audit unified history DB',
    '',
    '⏺ Read ui/src/App.jsx (40 lines)',
    '⏺ Read ui/src/main.jsx (7 lines)',
    '⏺ Write ui/src/mockups/LightV2.jsx (700+ lines)',
    '⏺ Edit ui/src/App.jsx',
    '✓ Mockup live at http://localhost:5174/light/v2',
    '',
    'waiting for input ▌',
  ]);
  const [input, setInput] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [lines]);

  const submit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    setLines((l) => [...l.slice(0, -1), `> ${input}`, '', '⏺ thinking…', 'waiting for input ▌']);
    setInput('');
  };

  return (
    <div className="flex h-full flex-col bg-black">
      <div ref={ref} className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-[1.5] text-slate-300">
        {lines.map((l, i) => (
          <div key={i} className={
            l.startsWith('>') ? 'text-emerald-400' :
            l.startsWith('✓') ? 'text-emerald-300' :
            l.startsWith('⏺') ? 'text-sky-300' : 'text-slate-300'
          }>{l || ' '}</div>
        ))}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 border-t border-slate-900 bg-slate-950 px-3 py-2">
        <span className="font-mono text-[11px] text-emerald-400">›</span>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="prompt this agent…"
          className="flex-1 bg-transparent font-mono text-[12px] text-slate-100 placeholder-slate-600 outline-none" />
        <span className="font-mono text-[10px] text-slate-600">↵ send · ⌘K dispatch new</span>
      </form>
    </div>
  );
}

function ExpandDrawer({ session, onClose }) {
  const detail = SESSION_DETAIL[session.id] || SESSION_DETAIL['5fac46de'];
  // ESC closes
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      {/* Click-outside backdrop */}
      <div onClick={onClose} className="absolute inset-0 z-10 bg-slate-950/40 backdrop-blur-[1px]" />
      {/* Slide-over panel from left */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-y-0 left-0 z-20 flex w-[68%] max-w-[900px] flex-col border-r-2 border-sky-500/50 bg-slate-950/98 shadow-[12px_0_40px_rgba(2,6,23,0.55)] backdrop-blur-md"
      >
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-base">{session.personaSprite}</span>
          <span className="font-mono text-[12px] font-semibold text-slate-100">{session.persona}</span>
          <span className="font-mono text-[11px] text-sky-400">{session.project}</span>
          <Pill className="border-slate-700 bg-slate-900 text-slate-400">{session.id}</Pill>
          <Pill className="border-sky-500/40 bg-sky-950 text-sky-300">drawer · slide-over</Pill>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-wider text-slate-600">esc · click outside</span>
          <button onClick={onClose}
            className="rounded border border-slate-800 bg-slate-900 px-2 py-1 font-mono text-[10px] text-slate-400 hover:border-slate-600 hover:text-slate-200">
            close ✕
          </button>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-3 gap-3 overflow-auto p-3 font-mono text-[11px] text-slate-300">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wider text-slate-500">Children</span>
            <span className="text-[9px] text-slate-600">{detail.children.length} procs</span>
          </div>
          <ul className="space-y-1">
            {detail.children.map((c) => (
              <li key={c.pid} className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/40 px-2 py-1">
                <span className="w-12 text-slate-500">{c.pid}</span>
                <span className="flex-1 truncate text-slate-300" title={c.cmd}>{c.cmd}</span>
                <span className="text-slate-500">{c.mem}M</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wider text-slate-500">Subagents</span>
            <span className="text-[9px] text-slate-600">{detail.subagents.length} dispatched</span>
          </div>
          <ul className="space-y-1">
            {detail.subagents.map((s, i) => (
              <li key={i} className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/40 px-2 py-1">
                <span className={s.ok ? 'text-emerald-400' : 'text-amber-400'}>{s.ok ? '✓' : '⋯'}</span>
                <span className="flex-1 truncate" title={s.name}>{s.name}</span>
                <span className="text-slate-500">{fmt(s.tokens)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wider text-slate-500">Timeline</span>
            <span className="text-[9px] text-slate-600">{detail.callsCount} calls · {detail.elapsed}</span>
          </div>
          <ul className="space-y-[2px]">
            {detail.timeline.map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={`w-12 truncate text-[10px] ${
                  t.kind === 'Agent' ? 'text-violet-300' :
                  t.kind === 'Bash' ? 'text-amber-300' :
                  t.kind === 'Read' ? 'text-slate-400' :
                  t.kind === 'Edit' || t.kind === 'Write' ? 'text-emerald-300' : 'text-slate-400'
                }`}>{t.kind}</span>
                <span className="w-32 truncate text-[10px] text-slate-500" title={t.label}>{t.label}</span>
                <div className="relative flex-1">
                  <div className="h-2 overflow-hidden rounded-sm bg-slate-900">
                    <div className={`h-full ${t.warn ? 'bg-red-500/70' : t.kind === 'Agent' ? 'bg-violet-500/70' : 'bg-slate-500/70'}`}
                      style={{ width: `${Math.max(2, t.bar * 100)}%` }} />
                  </div>
                </div>
                <span className={`w-14 text-right text-[10px] ${t.warn ? 'text-red-400' : 'text-slate-500'}`}>{t.dur}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      </div>
    </>
  );
}

const TerminalDock = forwardRef(function TerminalDock({ height, expandedSession, onCloseExpand }, ref) {
  // P1-9: real PTY tabs. Each tab is { ptyId, label }; null ptyId means
  // "use the FakeTerminal placeholder for one of the mock LIVE_SESSIONS".
  const [tabs, setTabs] = useState(() => LIVE_SESSIONS.map((s) => ({ ptyId: null, label: s.project, sprite: s.personaSprite, mockSession: s, contextWarn: s.contextWarn })));
  const [activeIdx, setActiveIdx] = useState(0);
  const [spawning, setSpawning] = useState(false);
  const [spawnError, setSpawnError] = useState(null);
  const style = height == null ? { height: '100%' } : { height };

  const activeTab = tabs[activeIdx] ?? null;

  const newShellTab = async () => {
    setSpawning(true);
    setSpawnError(null);
    try {
      const res = await fetch('/api/pty', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shell: true }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'spawn failed');
      const next = { ptyId: json.data.ptyId, label: 'shell', sprite: '$', contextWarn: false };
      setTabs((t) => {
        const newTabs = [...t, next];
        setActiveIdx(newTabs.length - 1);
        return newTabs;
      });
    } catch (err) {
      setSpawnError(err.message);
    } finally {
      setSpawning(false);
    }
  };

  const closeTab = (idx) => {
    setTabs((t) => {
      const tab = t[idx];
      if (tab?.ptyId) {
        // Best-effort kill on the backend
        fetch(`/api/pty/${tab.ptyId}`, { method: 'DELETE' }).catch(() => {});
      }
      const next = t.filter((_, i) => i !== idx);
      if (activeIdx >= next.length) setActiveIdx(Math.max(0, next.length - 1));
      return next.length === 0 ? t : next; // never let it go fully empty
    });
  };

  useImperativeHandle(ref, () => ({
    addPtyTab({ ptyId, label, sprite }) {
      const next = { ptyId, label: label ?? 'agent', sprite: sprite ?? '🤖', contextWarn: false };
      setTabs((t) => {
        const newTabs = [...t, next];
        setActiveIdx(newTabs.length - 1);
        return newTabs;
      });
    },
  }), []);

  return (
    <div className="relative flex h-full flex-col border-t-2 border-slate-700" style={style}>
      <div className="flex items-center gap-1 border-b border-slate-900 bg-slate-950 px-2 py-1">
        <span className="mr-2 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-600">terminal</span>
        {tabs.map((tab, idx) => (
          <button key={tab.ptyId ?? `mock-${idx}`} onClick={() => setActiveIdx(idx)}
            className={`group flex items-center gap-2 rounded-t border-b-2 px-3 py-1 font-mono text-[10px] transition ${
              idx === activeIdx
                ? 'border-sky-500 bg-slate-900 text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${
              tab.ptyId ? 'bg-emerald-500' : tab.contextWarn ? 'bg-red-500' : 'bg-amber-500'
            }`} />
            <span>{tab.sprite}</span>
            <span>{tab.label}</span>
            {!tab.ptyId && <span className="font-mono text-[8px] uppercase tracking-wider text-amber-500/70">mock</span>}
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); closeTab(idx); }}
              className="text-slate-700 hover:text-slate-300"
            >×</span>
          </button>
        ))}
        <button onClick={newShellTab} disabled={spawning}
          className="ml-1 rounded border border-dashed border-slate-700 px-2 py-[2px] font-mono text-[10px] text-slate-500 hover:border-slate-500 disabled:opacity-50">
          {spawning ? 'spawning…' : '+ shell'}
        </button>
        {spawnError && <span className="ml-2 font-mono text-[10px] text-red-400" title={spawnError}>spawn failed</span>}
        <div className="ml-auto font-mono text-[10px] text-slate-600">
          {activeTab?.ptyId ? 'xterm.js · pty live' : 'xterm.js · pty bridge'}
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">
        {activeTab?.ptyId ? (
          <XTermPane ptyId={activeTab.ptyId} />
        ) : (
          <FakeTerminal session={activeTab?.mockSession ?? LIVE_SESSIONS[0]} />
        )}
        {expandedSession && <ExpandDrawer session={expandedSession} onClose={onCloseExpand} />}
      </div>
    </div>
  );
});

// ─── Page ──────────────────────────────────────────────────────────────────

export default function LightV2() {
  const [task, setTask] = useState('fix the gemini hook so AfterAgent fires and writes observations');
  const [focused, setFocused] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState('debug');
  const [selectedProject, setSelectedProject] = useState('agent-office');
  const [history, setHistory] = useState(HISTORY_CANDIDATES);
  const [skills, setSkills] = useState(SKILL_CANDIDATES);
  const [expandedId, setExpandedId] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState(null);
  const [personasByDomain, setPersonasByDomain] = useState(new Map());
  const [projectsByName, setProjectsByName] = useState(new Map());
  const dockRef = useRef(null);

  // P1-12 — load real personas + projects so the wizard can map UI selections
  // to backend numeric IDs.
  useEffect(() => {
    Promise.all([
      fetch('/api/personas').then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch('/api/projects').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([personas, projects]) => {
      const personaList = Array.isArray(personas) ? personas : (personas?.data ?? []);
      const projectList = Array.isArray(projects) ? projects : (projects?.data ?? []);
      const pMap = new Map();
      for (const p of personaList) {
        if (p?.domain) pMap.set(p.domain, p);
      }
      setPersonasByDomain(pMap);
      const projMap = new Map();
      for (const p of projectList) {
        if (p?.name) projMap.set(p.name, p);
      }
      setProjectsByName(projMap);
    });
  }, []);

  const toggleHistory = (id) => setHistory((h) => h.map((x) => x.id === id ? { ...x, on: !x.on } : x));
  const toggleSkill = (id) => setSkills((s) => s.map((x) => x.id === id ? { ...x, on: !x.on } : x));

  const onLaunch = async () => {
    setLaunchError(null);
    // Resolve persona/project to numeric IDs. Prefer the frontdesk pick when
    // present (richest provider info); otherwise look up by selected codes.
    const pickedPersona = proposal?.pick?.persona ?? personasByDomain.get(selectedPersona) ?? null;
    const project = projectsByName.get(selectedProject) ?? null;
    if (!pickedPersona?.id) {
      setLaunchError(`persona "${selectedPersona}" not found in backend`);
      return;
    }
    if (!project?.id) {
      setLaunchError(`project "${selectedProject}" not found in backend`);
      return;
    }
    const provider = proposal?.pick?.provider ?? null;
    setLaunching(true);
    try {
      const res = await fetch('/api/office/launch-pty', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          personaId: pickedPersona.id,
          projectId: project.id,
          providerId: provider?.id ?? undefined,
          model: provider?.defaultModel ?? undefined,
          customInstructions: task || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `launch failed (${res.status})`);
      const sprite = pickedPersona.sprite ?? '🤖';
      const label = `${pickedPersona.label ?? pickedPersona.domain ?? 'agent'} · ${project.name}`;
      dockRef.current?.addPtyTab({ ptyId: json.ptyId, label, sprite });
    } catch (err) {
      setLaunchError(err.message);
    } finally {
      setLaunching(false);
    }
  };

  const expandedSession = LIVE_SESSIONS.find((s) => s.id === expandedId) || null;

  return (
    <div className="flex h-screen flex-col bg-slate-950 font-sans text-slate-100">
      <Header />
      <TelemetryZone />
      <div className="flex flex-1 overflow-hidden">
        {/* Left rail: live ops */}
        <LiveOpsRail expandedId={expandedId} setExpandedId={setExpandedId} />

        {/* Right column: launcher above, terminal fills the rest; drawer slides over terminal */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <LauncherPanel
            task={task} setTask={setTask}
            focused={focused} setFocused={setFocused}
            selectedPersona={selectedPersona} setSelectedPersona={setSelectedPersona}
            selectedProject={selectedProject} setSelectedProject={setSelectedProject}
            history={history} toggleHistory={toggleHistory}
            skills={skills} toggleSkill={toggleSkill}
            onLaunch={onLaunch}
            launching={launching}
            launchError={launchError}
            proposal={proposal} setProposal={setProposal}
          />
          <div className="flex-1 overflow-hidden">
            <TerminalDock
              ref={dockRef}
              height={null}
              setHeight={() => {}}
              expandedSession={expandedSession}
              onCloseExpand={() => setExpandedId(null)}
            />
          </div>
        </div>
      </div>
      <div className="border-t border-slate-800 bg-slate-950 px-4 py-1 font-mono text-[10px] text-slate-600">
        v2 · telemetry → [rail · launcher+terminal] · › slide-over drawer (esc / click-outside) · abtop-fed
      </div>
    </div>
  );
}
