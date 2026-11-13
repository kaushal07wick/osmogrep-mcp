# OsmoGrep MCP

Give Codex and Claude Code isolated execution tools for reproducing runtime bugs, repairing candidate code and exporting replayable evidence.

The coding agent handles reasoning. OsmoGrep controls the base/candidate workspaces, executes checks and records the result. This connector does not start a second model session.

**Developer preview:** requires a running OsmoGrep sandbox service on `http://127.0.0.1:3001` and a repository allowed by that service's `OSMOGREP_WORK_ROOT`. This repository contains the MCP connector and skill, not the sandbox backend. It does not yet connect to a hosted authenticated MCP endpoint. The installed sandbox backend may use local Lima or configured E2B execution; cloud credentials stay on the backend.

## Install

Requires Node.js 22.18+ and the client CLI you want to connect.

```sh
git clone https://github.com/kaushal07wick/osmogrep-mcp.git
cd osmogrep-mcp
node scripts/install.mjs codex
# Or:
node scripts/install.mjs claude
```

The installer registers a user-scoped stdio MCP server and copies the `osmogrep-verify` skill to your client's skill directory. It uses the current checkout path: keep this directory in place. Client registration uses each client's own CLI and permissions. An existing Claude server with this name may need to be reviewed/removed before reinstalling.

Start a new client session, then ask:

```text
# Codex
$osmogrep-verify Investigate the runtime regression in /absolute/path/to/my-repo.

# Claude Code
/osmogrep-verify Investigate the runtime regression in /absolute/path/to/my-repo.
```

The repository needs working-tree changes relative to a Git base such as `HEAD`. Starting verification creates two VMs and runs the existing suites. Use a repository-specific recipe when automatic test detection is insufficient. No VM is started merely by installing or discovering tools.

For manual registration, see [Codex configuration](examples/codex.toml) and [Claude MCP configuration](examples/claude.mcp.json). Large sessions may need Codex's `tool_timeout_sec = 900`; for Claude Code set `MCP_TOOL_TIMEOUT=900000` in the shell that launches Claude. Registration does not disable approval prompts.

## Tools

| Tool | Purpose |
| --- | --- |
| `start` | Capture a pinned Git base and filtered working source into separate sandbox workspaces. |
| `context` | Inspect changed paths, available files and initial test results. |
| `read` | Read a source file inside either workspace. |
| `reproducer` | Add an identical new test to both versions. |
| `compare` | Execute the same reproducer and command against both versions. |
| `write` | Repair candidate source after the first comparison. |
| `command` | Run a bounded command inside one VM. |
| `check` | Rerun the original suites and check test integrity. |
| `export` | Export observed results, patch and replay inputs. |
| `close` | Destroy the session VMs while retaining local evidence. |

All tools after `start` take its returned `session` ID. A single session has a bounded tool budget; `export` and `close` remain available for cleanup. The legacy `--session /path/session.json` mode is retained for a caller that already owns a verification session.

## Evidence

An introduced regression passes the reproducer on base and fails on the original working candidate. A repair must make the identical check pass while preserving original tests. A successful export includes:

- `result.json`: observed comparisons, original-suite outcomes and limitations.
- `fix.patch`: proposed changes, including the generated regression test.
- `replay.json` and filtered `sources/`: inputs for isolated replay.
- `index.html`: a local report.

Replay an exported version in a fresh sandbox:

```sh
node cli/replay.mjs --bundle /path/to/export --revision fixed
```

Use `base` or `working` for the other captured versions. The same local runtime service is required.

Exports are private local files under `.runtime/verifications/` and are excluded from Git. Nothing automatically commits, pushes, posts a GitHub comment or merges. Close the session when done; the connector attempts cleanup on disconnect, and the backend enforces the VM lifetime.

## Limits

- Local loopback service only; hosted MCP authentication is pending.
- Sessions currently depend on one running OsmoGrep service and expire after 30 minutes.
- Original-test discovery recognizes supported test paths and is bounded to 100 files / 4 MB. Unsupported or incomplete verification remains unverified.
- Generated reproducers need meaningful assertions. A passing command does not establish exhaustive correctness or a tamper-proof attestation.
- Repository filters exclude recognized secrets, but exported source and logs can still be private. Share only deliberately selected artifacts.
- The caller's configured VM provider can incur resource usage; installation and unit tests do not allocate VMs.

## Development

```sh
npm test
```

No npm dependencies are required. Tests cover the MCP handshake, argument/session boundaries, original-test protection, differential proof checks, stale evidence and replay integrity. They do not boot a VM or call a model API.

Originally extracted from OsmoGrep's local verification prototype. The standalone connector is the install target for coding-agent integrations; it is separate from the Rust terminal application and the hosted PR-review worker.

MIT licensed. Client references: [Codex MCP](https://developers.openai.com/codex/mcp/), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Claude Code skills](https://code.claude.com/docs/en/skills).
