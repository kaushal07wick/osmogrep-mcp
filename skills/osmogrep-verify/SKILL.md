---
name: osmogrep-verify
description: Reproduce and verify a runtime regression or proposed repair in OsmoGrep sandbox VMs, preserving original tests and exporting replayable evidence. Use for requested runtime verification and concrete suspected regressions.
license: MIT
metadata:
  requirements: Requires the OsmoGrep MCP connection, Node.js 22.18+, Git and a running local OsmoGrep sandbox service with the target repository allowed.
---

Use the calling coding agent for reasoning and repair decisions; OsmoGrep supplies isolated execution and independently checked evidence. A second model run is unnecessary.

## MCP tools

Use the configured `osmogrep` MCP server when available. Its `start` tool takes an absolute `repo` path and a Git `base` reference such as `HEAD`, creates base and candidate VMs and returns a `session` ID. Pass that ID to subsequent tools. The selected repository must have filtered working-tree changes relative to base.

- `context` shows changed paths, source files and original-suite results.
- `read` reads `path` from `revision` (`base` or `candidate`).
- `reproducer` writes an identical new test (`path`, `content`) to both versions. Prefer a root-level file. Updating it resets comparisons.
- `compare` runs a reproduction `command` on both versions, preserving identical test bytes and command before/after repair.
- `write` repairs candidate source (`path`, `content`) after the first comparison. Original tests and execution recipes are protected.
- `command` runs a bounded command in one VM (`revision`, `command`); commands can invalidate earlier evidence.
- `check` reruns original suites and checks test integrity.
- `export` records the actual verdict and produces local evidence; it cannot manufacture passing verification from an agent's prose.
- `close` destroys both VMs while retaining exported evidence. Close when finished or blocked; the server also attempts cleanup on disconnect.

Inspect source before diagnosing. An introduced regression must pass on base and fail on the unmodified candidate; after repair the identical check must pass. Failures on both versions do not establish an introduced regression. An existing bug fixed by the working change may fail on base and pass on candidate.

After repair, compare again, check, then export. A source edit after testing invalidates evidence. Keep original tests and generated reproducers distinguishable. A verified export includes `result.json`, `fix.patch`, `replay.json` and filtered `sources/`; report scope and remaining failures without claiming complete correctness.

## Runtime boundary

The current server is local at `http://127.0.0.1:3001`; its configured backend performs VM execution. Hosted authenticated MCP is not implemented yet. The existing allowed repository root is configured by the console's `OSMOGREP_WORK_ROOT`. If it rejects a project, report the configured boundary; do not widen it or substitute another repository silently. VM sessions expire after 30 minutes and depend on the running console process.

Keep private evidence local unless sharing is authorized. Verification alone does not authorize applying a patch to the host repository, committing, pushing, posting comments or merging. User authorization elsewhere in the session still applies.

## Invocation

In Codex, invoke `$osmogrep-verify` with a repository path and the behavior to investigate. In Claude Code, invoke `/osmogrep-verify` with the same information. If MCP tools are unavailable, report the missing connection; do not execute the repository on the host as a substitute.
