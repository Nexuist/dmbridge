# Using dmbridge from an agent

This guide is for automated agents and scripts operating an installed dmbridge
CLI. Repository contributors should also follow the root `AGENTS.md`.

## Safe default workflow

Start by checking the installed contract and local account names:

```sh
dmbridge version --json --no-input
dmbridge accounts list --json --no-input
dmbridge x doctor --account personal --json --no-input
```

Use `doctor --schema <name>` to discover request and result contracts instead
of guessing fields. `doctor` without `--live` is local-only. Use `--live` only
when the user has authorized access to the configured provider account.

For unattended calls, normally include:

```text
--json --no-input --timeout 30s
```

Use `--quiet` when stderr diagnostics are not wanted. Do not combine `--quiet`
with verbosity flags.

## Parsing results

stdout contains exactly one JSON protocol envelope. stderr contains
only progress, warnings, and diagnostics. Always check both the process exit
code and the structured `ok` field.

JSON output is one protocol-v1 envelope. Retain provider IDs, account names,
cursors, conversation IDs, message IDs, request IDs, and attachment IDs as
opaque strings.

On failure, inspect:

- `error.code` for the specific machine-readable error;
- the process exit code for the broad failure class;
- `error.retrySafety` before deciding whether to retry.

Retry `safe` failures only under the caller's bounded retry policy. Never
automatically retry an `unsafe` or `never` result. An unsafe mutation failure
may mean that the provider accepted the operation before the response was lost.

## Input and secrets

Pass ordinary targets as arguments. Pass structured bodies with
`--request <file>` or `--request -` for stdin. Pass an XChat passcode with
`--secret <file>` or `--secret -`. Never put access tokens, OAuth callback URLs,
authorization codes, client secrets, passcodes, or message bodies in shell
arguments, logs, prompts, or persisted transcripts.

Example read:

```sh
dmbridge x conversations list \
  --account personal --limit 50 --json --no-input --timeout 30s
```

Example body through stdin:

```sh
printf '%s' '{"type":"text","text":"hello"}' |
  dmbridge x messages send CONVERSATION_ID --account personal --request - \
    --dry-run --json --no-input --timeout 30s
```

## Mutations and confirmation

Before a mutation, run the exact command with `--dry-run` and inspect its
provider, account, operation, target, and request. A dry run does not contact a
provider or change local state.

Execute the real mutation only after the user has authorized that exact action
and target. Use `--yes` only when the user has explicitly authorized bypassing
the command's confirmation. `--no-input` is not authorization; destructive
commands without `--yes` fail closed in non-interactive mode.

Never run provider mutations, replace credentials, replace a passcode, remove
an account, acknowledge delivery side effects, overwrite a download, or use a
live account merely to explore behavior. Prefer `help`, local `doctor`, schemas,
dry runs, and offline fixtures.

## Discovery

Use the CLI itself as the current command inventory:

```sh
dmbridge help --json --no-input
dmbridge x messages --help --json --no-input
dmbridge x doctor --schema message.send --json --no-input
dmbridge x doctor --schema accounts.add.request --json --no-input
```

Do not scrape README examples as a command registry. Help and doctor output are
generated from the runtime contract and are the authoritative discovery
surfaces.
