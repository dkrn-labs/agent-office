# Observability — health, metrics, and logs

agent-office runs as a single Node process. There's no metrics
collector, no log shipper, no tracing backend baked in — by design.
Instead, the process exposes the primitives operators (and Docker)
need to wire it into whatever they already run.

## `GET /api/_health`

Single endpoint, both liveness and readiness.

- **200 OK** — process is up, DB pings.
- **503 Service Unavailable** — DB unreachable. The response body
  carries the exception message under `data.dbError`.

Response shape:

```json
{
  "data": {
    "status": "ok",
    "uptime": 1234,
    "version": "0.1.0",
    "db": "reachable",
    "dataDir": "/Users/you/.agent-office"
  },
  "error": null,
  "meta": {}
}
```

The Docker P6 image will bind a `healthcheck:` to this in
`docker-compose.yml`:

```yaml
healthcheck:
  test: ["CMD", "curl", "-fsS", "http://localhost:3334/api/_health"]
  interval: 10s
  timeout: 3s
  retries: 5
```

## `GET /api/_metrics`

Two formats. Default is JSON for the dashboard's own use:

```json
{
  "data": {
    "sessions": { "live": 2, "byProvider": { "claude-code": 2 } },
    "frontdesk": { "today": 7, "fallbackRate7d": 0.04 },
    "savings": { "savedDollarsToday": 0.12, "savedTokens7d": 38421 },
    "abtop": { "reachable": true, "lastTickEpoch": 1745683200 },
    "watchers": { "claude": { "sessionsTracked": 2 }, "codex": { "sessionsTracked": 0 }, "gemini": { "sessionsTracked": 0 } }
  }
}
```

For Prometheus, add `?format=prometheus`:

```bash
curl -s http://localhost:3334/api/_metrics?format=prometheus
# HELP agent_office_sessions_live Live sessions across all providers
# TYPE agent_office_sessions_live gauge
agent_office_sessions_live 2
agent_office_sessions_by_provider{provider="claude-code"} 2
# … etc
```

Wire that path into your scrape config (Prometheus, vmagent, OTel
collector) like any other static target.

## Logs

Structured JSON one line at a time on stdout, via [pino]. Every line
includes a UTC ISO timestamp, level, optional module name, message,
and arbitrary structured fields:

```json
{"level":"info","ts":"2026-04-26T14:00:00.000Z","module":"abtop-bridge","msg":"snapshot updated","sessions":2}
```

### Secret redaction

The logger scrubs known secret-shaped substrings (Stripe `sk_test_`/
`sk_live_`, Anthropic `sk-ant-`, OpenAI `sk-proj-`/`sk-openai-`,
GitHub `gh[psorau]_`, AWS `AKIA…`) from both the message string and
nested meta values before writing. This applies to *every* log call,
not just abtop output. If you find a key shape that's leaking, add
its regex to `SECRET_PATTERNS` in `src/core/logger.js` and the abtop
parser at `src/telemetry/abtop-parser.js` (they share the rule set
intentionally).

### Levels

`LOG_LEVEL=debug node bin/agent-office.js start` enables debug
output. Default is `info`. `error` and `warn` always emit.

### Rotation

agent-office does not rotate logs itself. Two paths:

1. **Docker (recommended for non-dev use).** `docker logs --tail 200
   -f agent-office`. Compose's logging driver handles size caps; a
   reasonable default is `json-file` with `max-size: 10m, max-file: 3`,
   set in `docker-compose.yml`.
2. **Direct stdout.** Pipe to `logrotate`-friendly tooling — `node
   bin/agent-office.js start | rotatelogs -n 5 ~/.agent-office/logs/ao.log 10M`,
   or hand off to systemd-journald, or a sidecar like Vector / Filebeat
   pointed at the process. Don't redirect to a single growing file
   without rotation; agent-office's metrics watchers tick once per
   second and the file will fill up.

If the process detects it's writing to a redirected file >10 MB
without explicit rotation configured (env var `LOG_ROTATE_PATH`), it
prints one warning at startup. No behavior change — just a flag so
you don't get surprised.
