# Provider History Hooks

This repo can ingest provider-neutral project history through:

- `POST /api/history/ingest`
- script: `scripts/provider-history-hook.js`

The script is intentionally non-blocking. If ingestion fails, it logs to stderr
and returns success so the provider session is not interrupted.

## Requirements

Run `agent-office` locally on the default port or set:

```bash
export AGENT_OFFICE_BASE_URL=http://127.0.0.1:3333
```

## Claude Code

Use the `Stop` hook because Claude officially includes `last_assistant_message`
on that event.

Example `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/dehakuran/Projects/agent-office/scripts/provider-history-hook.js --provider claude-code"
          }
        ]
      }
    ]
  }
}
```

## Gemini CLI

Use the `AfterAgent` hook because Gemini officially exposes `prompt` and
`prompt_response` there.

Example `~/.gemini/settings.json`:

```json
{
  "hooks": {
    "AfterAgent": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/dehakuran/Projects/agent-office/scripts/provider-history-hook.js --provider gemini-cli"
          }
        ]
      }
    ]
  }
}
```

## Codex

Codex does not currently expose a Claude/Gemini-style general hook system.
The closest available mechanism is `notify`, which fires after a completed turn
with a small JSON event payload.

Example `~/.codex/config.toml`:

```toml
notify = ["node", "/Users/dehakuran/Projects/agent-office/scripts/provider-history-hook.js", "--provider", "codex", "--notify-json-arg"]
```

This is best-effort only. The payload is not rich enough to capture the final
assistant response text the way Claude `Stop` and Gemini `AfterAgent` can.
