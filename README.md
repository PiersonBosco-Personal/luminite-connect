# luminite-connect

One command that connects a code repository to its
**[Luminite](https://github.com/PiersonBosco-Personal/luminite-web-app)** project, so a coding agent
can read and write the project's tasks, decisions, and memory while it works.

```bash
npx luminite-connect
```

Zero runtime dependencies. Node 18+. Tests run on the built-in `node:test` runner.

---

## The problem it solves

Pointing an agent at a project tracker is normally a manual chore: register an MCP server, mint a
token, keep it out of git, write instructions telling the agent to actually use it, and repeat for
every repo and every teammate. `luminite-connect` collapses that into one command that is safe to
re-run.

## What it does

Walks up from the working directory to the repository root, opens a browser to authorize, then
writes:

| Path | Purpose | Committed? |
|---|---|---|
| `CLAUDE.md` | A marker-delimited "Luminite project sync" block at the top of the file — the workflow rules the agent follows | **Yes** — meant to be shared |
| `.mcp.json` | Registers the `luminite` MCP server; the token is referenced by env var, never inlined | **Yes** |
| `.claude/hooks/luminite-hook.mjs` | The zero-dependency hook helper | **Yes** |
| `.claude/commands/luminite/ask.md` | A `/luminite:ask` command for querying project memory — static and secret-free, so every teammate gets it | **Yes** |
| `.claude/settings.local.json` | `LUMINITE_TOKEN` plus the `SessionStart` and `Stop` hook wiring | Gitignored |
| `.claude/luminite-connect.json` | Local state — token id, project id, URLs — so re-runs are idempotent | Gitignored |
| `.claude/luminite-thread-cursor.json` | Tracks which commits have already been harvested | Gitignored |

The split is deliberate: anything static and secret-free is committed so a teammate who clones the
repo inherits it, while anything personal or connection-specific is ignored.

Re-running is a no-op if the repo is already connected. The `CLAUDE.md` block is re-placed at the
top rather than duplicated.

```bash
npx luminite-connect --rotate         # fresh token; revokes the old one
npx luminite-connect --url <url>      # non-default Luminite instance
npx luminite-connect --token <token>  # skip the browser flow
npx luminite-connect --help
```

## Keeping sync current without being asked

The "keep Luminite up to date" instruction is delivered through five channels, deliberately layered
so no single one has to carry it:

1. **The `CLAUDE.md` block** — the stable workflow: start a task → move it to In Progress; finish →
   complete it; settle a decision → log it with the reasoning.
2. **The `SessionStart` hook** — injects a live project snapshot at the top of every session, so the
   agent opens with current state instead of stale assumptions.
3. **The `Stop` hook** — a loop-safe backstop that nudges *once* when a turn changed code but no task
   is In Progress. It self-suppresses as soon as one is, and fails open on any error so it can never
   trap a session.
4. **Commit harvesting** — the same `Stop` hook reads new commits from the watched repos and writes
   them into the project thread, advancing a cursor only past commits it successfully sent.
5. **The MCP server's own `instructions`** — a zero-touch echo that ships with the server.

Per-tool guidance lives in each MCP tool's description, so `CLAUDE.md` doesn't go stale as tools are
added.

## Development

```bash
node --test
```

## License

MIT

---

Built by **[Pierson Bosco](https://github.com/PiersonBosco-Personal)**.
