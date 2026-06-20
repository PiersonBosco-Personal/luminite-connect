# luminite-connect

Connect a repo to its [Luminite](https://luminiteapp.com) project for Claude Code. One command wires up the Luminite MCP server, an auth token, the Claude Code hooks, and a project-sync block in your `CLAUDE.md`.

```bash
npx luminite-connect            # connect (no-op if already connected)
npx luminite-connect --rotate   # force a fresh token; revokes the old one
npx luminite-connect --url <u>  # point at a non-default Luminite web app
npx luminite-connect --help
```

Connecting opens your browser to authorize, then writes (to the project root):

- **`CLAUDE.md`** — a marker-delimited (`<!-- LUMINITE:START -->` … `<!-- LUMINITE:END -->`) "Luminite project sync" block carrying the keep-in-sync workflow. Written at the **top** of the file (highest priority) and idempotent (re-running re-places it at the top, never duplicates) and **committed/shared** with your team (not gitignored).
- **`.mcp.json`** — registers the `luminite` MCP server (token referenced via env, never inlined).
- **`.claude/settings.local.json`** — the `LUMINITE_TOKEN` env var plus the `SessionStart` and `Stop` hooks. **Gitignored.**
- **`.claude/hooks/luminite-hook.mjs`** — the zero-dependency hook helper.
- **`.claude/luminite-connect.json`** — local state (token id, project id, MCP/API URLs) for re-runs. **Gitignored.**

## How sync stays current without being asked

The "keep Luminite in sync" instruction is delivered across complementary channels, split by priority:

1. **`CLAUDE.md` block** (highest priority) — the stable workflow rule: start a task → `update_task` to In Progress; finish → `complete_task`; notable decision → `create_note` linked with `task_id`.
2. **`SessionStart` hook** — injects the live project snapshot (`get_session_context`) each session.
3. **Active `Stop` gate** — a loop-safe backstop that nudges **once** when a turn changed code but no task is In Progress. It self-suppresses once a task is In Progress, and fails open on any error (it never traps your session).
4. **MCP server `instructions`** — a zero-touch echo of the workflow that ships with the server.

Per-tool guidance lives in each MCP tool's own description, so `CLAUDE.md` never grows stale as tools are added.

## Development

```bash
node --test   # run the test suite (zero dependencies)
```

## License

MIT
