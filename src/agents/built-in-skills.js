/**
 * Built-in skills for the Agent Office.
 *
 * Each skill has:
 *   name            {string}   — unique, human-readable identifier
 *   domain          {string}   — 'frontend' | 'backend' | 'general' | 'testing' |
 *                                'review' | 'devops' | 'debug'
 *   applicableStacks {string[]} — tech-stack tags this skill applies to;
 *                                 empty array means universal
 *   content         {string}   — 3-8 lines of concise, actionable guidance
 *   source          {string}   — always 'built-in'
 */

export const BUILT_IN_SKILLS = [
  // ── Frontend ─────────────────────────────────────────────────────────────────

  {
    name: 'React Component Patterns',
    domain: 'frontend',
    applicableStacks: ['react'],
    source: 'built-in',
    content: `Prefer function components with hooks over class components.
Keep components small; extract sub-components when JSX exceeds ~50 lines.
Co-locate state as close as possible to where it is consumed.
Use React.memo and useCallback only after profiling confirms a bottleneck.
Avoid prop drilling beyond 2 levels — lift state or use context instead.
Name event handler props onX and the handlers handleX for consistency.`,
  },

  {
    name: 'TypeScript Strict Mode',
    domain: 'general',
    applicableStacks: ['typescript'],
    source: 'built-in',
    content: `Enable "strict": true in tsconfig.json — never disable individual strict flags.
Use unknown instead of any for values whose type is genuinely unknown.
Prefer type aliases for unions/intersections; use interfaces for object shapes.
Use satisfies to validate literals against a type without widening.
Enable noUncheckedIndexedAccess; guard array/object access with null checks.
Avoid non-null assertions (!); narrow types explicitly with guards instead.
Use verbatimModuleSyntax to keep import type separate from value imports.`,
  },

  {
    name: 'Tailwind CSS Conventions',
    domain: 'frontend',
    applicableStacks: ['tailwind'],
    source: 'built-in',
    content: `Use utility classes directly in JSX; avoid writing custom CSS unless unavoidable.
Group classes by category: layout → spacing → typography → color → state.
Extract repeated class sets into a component, not a @apply rule.
Use the cn() / clsx() helper to merge conditional class names safely.
Keep breakpoint prefixes consistent (mobile-first: sm → md → lg → xl).
Use CSS variables via Tailwind's config for brand colors instead of raw hex values.`,
  },

  {
    name: 'Vite Configuration',
    domain: 'general',
    applicableStacks: ['vite'],
    source: 'built-in',
    content: `Keep vite.config.ts minimal; rely on Vite defaults whenever possible.
Use defineConfig() for type-safe configuration.
Prefer import.meta.env.VITE_* for environment variables (never expose secrets).
Use the build.rollupOptions.output.manualChunks only when bundle analysis justifies it.
Enable build.sourcemap in development; disable in production to reduce asset size.
Use vite-plugin-* packages over custom rollup plugins for standard integrations.`,
  },

  // ── Backend ──────────────────────────────────────────────────────────────────

  {
    name: 'Express API Patterns',
    domain: 'backend',
    applicableStacks: ['express'],
    source: 'built-in',
    content: `Use express.Router() to modularise routes — one file per resource.
Always call next(err) for errors; handle them in a single error-handling middleware.
Validate request bodies at the route level before touching business logic.
Use helmet and cors middleware for baseline security on all apps.
Never trust req.params or req.query — parse and validate before use.
Return consistent JSON shapes: { data, error, meta } across all endpoints.`,
  },

  {
    name: 'Fastify API Patterns',
    domain: 'backend',
    applicableStacks: ['fastify'],
    source: 'built-in',
    content: `Define JSON Schema for request/reply on every route for automatic validation and serialisation.
Use fastify plugins (fastify.register) to encapsulate route namespaces.
Leverage fastify.decorate and fastify.decorateRequest for shared dependencies (db, logger).
Prefer async route handlers; return values directly instead of calling reply.send().
Use @fastify/sensible for standard HTTP errors (reply.notFound, reply.badRequest, etc.).
Profile with fastify-plugin + clinic.js before adding custom serializers.`,
  },

  {
    name: 'Flask API Patterns',
    domain: 'backend',
    applicableStacks: ['flask'],
    source: 'built-in',
    content: `Use the Application Factory pattern (create_app()) to support multiple configs.
Register blueprints for each resource group to keep routes modular.
Use flask-sqlalchemy for ORM; never build raw SQL strings with user input.
Handle errors with @app.errorhandler; return JSON responses, not HTML.
Load config from environment variables using python-dotenv; never hardcode secrets.
Enable CORS via flask-cors only on specific origins, not wildcard in production.`,
  },

  {
    name: 'Django Development Patterns',
    domain: 'backend',
    applicableStacks: ['django'],
    source: 'built-in',
    content: `Separate settings into base/dev/prod modules; load secrets from environment, not settings files.
Use Django REST Framework serializers for all API input validation and output.
Use select_related and prefetch_related to avoid N+1 query problems.
Write database migrations for every model change; never edit existing migrations.
Use Django's built-in auth — extend AbstractUser rather than rolling your own.
Run python manage.py check --deploy before every production release.`,
  },

  {
    name: 'Database Patterns (Prisma / Drizzle)',
    domain: 'backend',
    applicableStacks: ['prisma', 'drizzle'],
    source: 'built-in',
    content: `Always use parameterised queries; never interpolate user input into SQL.
Keep migrations under version control and run them as part of CI/CD.
Index foreign keys and columns used in WHERE / ORDER BY clauses.
Use transactions for operations that must succeed or fail together.
Avoid SELECT * in production queries — list only the columns you need.
Test migrations against a copy of production data before applying to live.`,
  },

  // ── Testing ──────────────────────────────────────────────────────────────────

  {
    name: 'Vitest Testing',
    domain: 'testing',
    applicableStacks: ['vitest'],
    source: 'built-in',
    content: `Organise tests with describe blocks and use it() for individual assertions.
Use vi.mock() for module mocking; prefer vi.spyOn for partial mocks.
Leverage in-source testing (import.meta.vitest) only for pure utility functions.
Use @vitest/coverage-v8 for coverage; aim for 80%+ on business-logic modules.
Isolate tests with beforeEach/afterEach; never share mutable state across tests.
Use expect.assertions(n) in async tests to catch missing awaits.`,
  },

  {
    name: 'Jest Testing',
    domain: 'testing',
    applicableStacks: ['jest'],
    source: 'built-in',
    content: `Use jest.config.ts (not .js) and define moduleNameMapper for path aliases.
Prefer jest.spyOn over jest.mock at the module level for finer control.
Wrap each test file's setup/teardown with beforeAll/afterAll to reduce overhead.
Use expect.extend for custom matchers rather than duplicating assertion logic.
Enable --runInBand only for integration tests that must run sequentially.
Never use real timers in unit tests — use jest.useFakeTimers() instead.`,
  },

  // ── General ──────────────────────────────────────────────────────────────────

  {
    name: 'Git Workflow',
    domain: 'general',
    applicableStacks: [],
    source: 'built-in',
    content: `Commit small, logical units of work; one reason to change per commit.
Write commit messages in imperative mood: "Add login route", not "Added".
Always branch from the latest main; rebase before opening a PR.
Squash fixup commits before merging; keep the public history clean.
Use conventional commits (feat/fix/chore/docs) to enable automated changelogs.
Never force-push to main or shared branches without team coordination.`,
  },

  {
    name: 'Code Review Checklist',
    domain: 'review',
    applicableStacks: [],
    source: 'built-in',
    content: `Verify the change solves the stated problem — read the issue/ticket first.
Check for missing error handling, especially in async paths.
Look for hardcoded secrets, credentials, or environment-specific values.
Confirm new functionality has tests; check edge cases are covered.
Review for clarity: can a future developer understand this without the author?
Flag performance concerns (N+1 queries, unindexed lookups, large payloads).
Ensure any public API changes are documented or have migration guidance.`,
  },

  {
    name: 'Deployment Practices',
    domain: 'devops',
    applicableStacks: [],
    source: 'built-in',
    content: `Run the full test suite in CI before every deployment — never skip.
Use environment-specific config via environment variables, not checked-in files.
Deploy to staging first; run smoke tests before promoting to production.
Use blue/green or rolling deployments to avoid downtime.
Store deployment artefacts immutably; tag Docker images and releases with commit SHA.
Have a documented rollback procedure and test it periodically.`,
  },

  {
    name: 'Debugging Methodology',
    domain: 'debug',
    applicableStacks: [],
    source: 'built-in',
    content: `Reproduce the bug with the smallest possible case before changing any code.
Read the full error message and stack trace top-to-bottom before guessing.
Add structured log statements at decision points rather than console.log dumps.
Check recent git changes (git log -p) — most bugs are introduced, not inherent.
Validate all assumptions with assertions before investigating further down the stack.
Use a debugger with breakpoints instead of print-debugging for complex state.
Document your findings and fix in the commit message to prevent regressions.`,
  },
];

/**
 * Seed all built-in skills into the repository, skipping any that already
 * exist (matched by name). Safe to call multiple times — idempotent.
 *
 * @param {ReturnType<import('../db/repository.js').createRepository>} repo
 * @returns {{ inserted: number, skipped: number }}
 */
export async function seedBuiltInSkills(repo) {
  const existing = repo.listSkills();
  const existingNames = new Set(existing.map((s) => s.name));

  let inserted = 0;
  let skipped = 0;

  for (const skill of BUILT_IN_SKILLS) {
    if (existingNames.has(skill.name)) {
      skipped++;
    } else {
      repo.createSkill(skill);
      inserted++;
    }
  }

  return { inserted, skipped };
}
