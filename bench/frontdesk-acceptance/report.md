# Frontdesk acceptance benchmark report

**Pass rate:** 16/20 (80%)
**Gate:** ❌ FAIL — keep default at false; investigate the failures below

| Task | Result | Expected | Got |
|---|---|---|---|
| debug-1 | ✅ | persona=debug, provider.kind=cloud | persona=debug, provider=claude-code(cloud) |
| debug-2 | ✅ | persona=debug, provider.kind=cloud | persona=debug, provider=claude-code(cloud) |
| debug-3 | ✅ | persona=debug, provider.kind=cloud | persona=debug, provider=claude-code(cloud) |
| debug-4 | ✅ | persona=debug, provider.kind=cloud | persona=debug, provider=claude-code(cloud) |
| refactor-1 | ✅ | persona=backend, provider.kind=cloud | persona=backend, provider=claude-code(cloud) |
| refactor-2 | ✅ | persona=backend, provider.kind=cloud | persona=backend, provider=claude-code(cloud) |
| refactor-3 | ❌ | persona=backend, provider.kind=cloud | persona=backend, provider=aider-local(local) — provider kind 'local' ≠ 'cloud' |
| refactor-4 | ✅ | persona=backend, provider.kind=cloud | persona=backend, provider=claude-code(cloud) |
| mechanical-1 | ❌ | persona=backend, provider.kind=local | persona=review, provider=aider-local(local) — persona domain 'review' ≠ 'backend' |
| mechanical-2 | ✅ | persona=backend, provider.kind=local | persona=backend, provider=aider-local(local) |
| mechanical-3 | ❌ | persona=backend, provider.kind=local | persona=review, provider=aider-local(local) — persona domain 'review' ≠ 'backend' |
| mechanical-4 | ✅ | persona=backend, provider.kind=local | persona=backend, provider=aider-local(local) |
| deploy-1 | ✅ | persona=devops, provider.kind=cloud | persona=devops, provider=claude-code(cloud) |
| deploy-2 | ✅ | persona=devops, provider.kind=cloud | persona=devops, provider=claude-code(cloud) |
| frontend-1 | ✅ | persona=frontend, provider.kind=cloud | persona=frontend, provider=claude-code(cloud) |
| frontend-2 | ❌ | persona=frontend, provider.kind=cloud | persona=debug, provider=claude-code(cloud) — persona domain 'debug' ≠ 'frontend' |
| secret-1 | ✅ | provider.kind=local, mustBeLocal | persona=backend, provider=aider-local(local) |
| secret-2 | ✅ | provider.kind=local, mustBeLocal | persona=backend, provider=aider-local(local) |
| privacy-1 | ✅ | provider.kind=local, mustBeLocal | persona=review, provider=aider-local(local) |
| privacy-2 | ✅ | provider.kind=local, mustBeLocal | persona=review, provider=aider-local(local) |

---

Generated at 2026-04-26T13:05:28.625Z