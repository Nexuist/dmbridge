# AGENTS.md

This file is the source of truth for coding agents working in the dmbridge
repository. For instructions on operating the installed CLI from another
project, use [`docs/agent-usage.md`](docs/agent-usage.md).

## Purpose

dmbridge is a provider-neutral, JSON-first command-line bridge for direct
messages. It exposes XChat and Instagram Messaging through one stable CLI
contract without merging provider inboxes or hiding provider-specific
semantics.

## Setup and verification

- Install dependencies: `npm install`
- Type-check: `npm run check`
- Run the offline test suite: `npm test`
- Exercise the packed executable in an isolated install: `npm run test:package`
- Build, smoke-test, archive, and checksum the standalone executable:
  `npm run package:executable`
- Refresh intentional command and schema snapshots: `npm run contracts:update`
- Run the read-only production smoke suite only with explicit owner approval:
  `npm run test:live`

Do not run live mutations as part of verification. The offline suite owns
mutation coverage through mocks. Do not add a package, runtime dependency,
external service, or credential mechanism without explicit owner approval.

## Architecture and ownership

- `src/commands.ts` owns the public command catalog and generic dispatch.
- `src/protocol.ts` owns public schemas, JSON envelopes, request input parsing,
  and standardized errors.
- `src/auth.ts` owns provider-neutral secure local storage primitives.
- `src/providers/types.ts` owns the provider interface.
- Each provider owns its implementation, credentials, setup flow, state, and
  special semantics below `src/providers/<provider>/`. Keep X-specific behavior
  under `src/providers/x/`.
- `test/snapshots/` freezes the public command and schema contracts. Review the
  diff before accepting a snapshot update.

Do not create parallel command inventories or schema documentation that can
drift from the runtime registry. Generate user-visible discovery from the
registered definitions.

## CLI contract

- Preserve `--help`, `-h`, `--version`, JSON, non-interactive, timeout, color,
  quiet, verbosity, and dry-run behavior across appropriate commands.
- Write primary results only to stdout. Write progress, warnings, and
  diagnostics only to stderr.
- Keep JSON envelopes versioned. Treat a published schema version as immutable;
  bump `SCHEMA_VERSION` for incompatible contract changes.
- Keep ordering deterministic where dmbridge owns it. Use ISO 8601 timestamps
  and explicit unit-bearing names such as `bytes` and `timeoutMs`.
- Accept structured requests and secrets from files or stdin, never secret
  command-line flags.
- Expose `--yes` only where it bypasses a specific confirmation. Never infer
  authorization from `--no-input`.
- Every mutation must support `--dry-run`. A dry run must not modify provider
  state, local state, or destination files.
- Preserve documented exit classes and machine-readable error codes. A timed
  out or failed mutation with `retrySafety: "unsafe"` has an unknown outcome
  and must not be retried automatically.
- Prefer idempotent local operations and report whether an operation changed
  state.

## Credentials and protected data

Never print, commit, snapshot, or transfer credentials, OAuth callback values,
PKCE material, XChat passcodes, decrypted private messages, or the contents of
the user's dmbridge home. Tests must use temporary homes and fabricated data.

Keep credential directories mode `0700` and secret files mode `0600`. Reject
unsafe ownership, permissions, and symlinks rather than weakening validation.
If an XChat passcode is rejected, forget it immediately so unattended calls do
not exhaust finite attempts.

## Packaging and release

Every owner-requested repository change must update the package version using
semantic versioning and keep the root `package-lock.json` version synchronized.
Use a patch bump for backward-compatible fixes or documentation, a minor bump
for backward-compatible features, and a major bump for breaking public changes.

`npm run package:npm` creates and checksums the installable package tarball.
Installing that tarball globally exposes the Node-backed `dmbridge` executable.
`npm run package:executable` uses Deno only as a release compiler and produces,
exercises, archives, and checksums a self-contained platform binary under
ignored `artifacts/`; do not migrate the source, tests, or npm distribution away
from Node without explicit owner approval. Both packaging checks must pass
before calling their artifacts ready. Follow
[`docs/release-checklist.md`](docs/release-checklist.md) for the full release
gate.

GitHub Releases are created only by pushing a tag that exactly matches `v` plus
the `package.json` version. Keep release verification and executable-build jobs
read-only; grant `contents: write` only to the final publishing job. Never place
Apple signing identities, notarization credentials, provider credentials, or
personal access tokens in the workflow or repository.

Keep changes scoped and do not reformat unrelated files. Summarize the checks
actually run and explicitly call out authentication, credential-storage, or
mutation changes.
