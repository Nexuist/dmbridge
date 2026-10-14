# dmbridge

`dmbridge` is a standalone TypeScript CLI for reading and managing direct
messages through provider APIs. JSON is the default output, NDJSON is available
for collections, and stdout never contains progress or diagnostics, so commands
compose cleanly with `jq` and streaming consumers.

The project is provider-neutral without pretending providers have identical
semantics. You always select one provider and one account; there is deliberately
no unified inbox.

## Status

Version 0.5 consolidates setup under `accounts`, folds capabilities and schema
discovery into `doctor`, and nests message requests under `conversations`.
The automation contract remains JSON/NDJSON-first with explicit timeouts,
documented exit classes, confirmation controls, and mutation dry runs.

The initial provider adapters target:

- XChat only on X. Legacy X Direct Messages are intentionally unsupported.
- Instagram Messaging for eligible professional accounts.
- Multiple named accounts for each provider.
- Direct and group conversations when the provider supports them.
- Lossless representation of known and unknown message/attachment types.
- Conversation unread state, message and reaction mutations, capabilities, and
  versioned JSON Schemas for requests, resources, pages, results, and envelopes.

Mutation code is covered by offline mocks. Do not point mutation commands at an
important account until you have reviewed a `--dry-run` result and intentionally
chosen to perform the operation.

## Install

```sh
npm install
npm run build
npm link
```

Node.js 22.12 or newer is supported. Runtime state defaults to `~/.dmbridge` and
can be changed with `DMBRIDGE_HOME` or `--home`.

`npm run package:npm` creates an installable tarball and its SHA-256 checksum.
Installing that tarball globally creates the `dmbridge` executable command
while retaining Node.js as its runtime:

```sh
npm run package:npm
npm install --global ./dmbridge-0.5.0.tgz
dmbridge version --pretty
```

To build a single self-contained executable that does not require Node.js on
the destination machine, install Deno 2.9.5 or newer on the build machine and
run:

```sh
npm run package:executable
./artifacts/dmbridge-0.5.0-macos-arm64 version --pretty
```

The source, tests, and npm package remain Node-based. Deno is used only as a
release compiler. Its self-extracting format preserves the real filesystem
paths expected by the XChat and Juicebox WASM SDKs; the first run extracts the
embedded runtime files to Deno's application cache.

Pushing a tag that exactly matches `v` plus the `package.json` version starts
the GitHub Release workflow. It verifies the package and publishes `.tar.gz`
executables for macOS, Linux, and Windows on x64 and ARM64, plus SHA-256 files,
a consolidated checksum manifest, and the installable npm tarball. See
`docs/release-checklist.md` for the release procedure and signing limitations.

## Output contract

JSON is the default. `--json` and `--output json` select it explicitly. Every
JSON invocation writes exactly one protocol-v1 envelope to stdout, including
failures:

Success:

```json
{"account":"personal","command":"x conversations list","ok":true,"protocolVersion":1,"provider":"x","requestID":"…","result":{"items":[],"nextCursor":null}}
```

Failure:

```json
{"account":"personal","command":"x conversations list","error":{"code":"provider.requestFailed","details":{},"message":"…","retrySafety":"safe"},"ok":false,"protocolVersion":1,"provider":"x","requestID":"…"}
```

Use `--ndjson` or `--output ndjson` for a versioned stream. Collection results
emit one `item` record per value followed by a `summary` record. Scalar results
emit one `result` record, and failures emit one `error` record. Every line carries
the protocol version and complete command context:

```json
{"account":null,"collection":"commands","command":"help","index":0,"ok":true,"protocolVersion":1,"provider":null,"recordType":"item","requestID":"…","result":"dmbridge accounts list [provider]"}
{"account":null,"collection":"commands","command":"help","index":1,"ok":true,"protocolVersion":1,"provider":null,"recordType":"item","requestID":"…","result":"dmbridge version"}
```

`dmbridge <provider> doctor --schema stream.record` returns the JSON Schema for
NDJSON lines. Schema version 4 also contains the protocol-v1 success and error
envelope schemas.
Object keys are serialized canonically. Local inventories and derived resource
sets are sorted; provider pages retain their documented provider order.

stdout is reserved for primary JSON or NDJSON results. Progress, warnings, and
human-readable diagnostics go only to stderr and can be controlled with
`--quiet`, `-v` / `--verbose`, or
`--verbosity quiet|normal|verbose|debug`. `--no-color` is supported; structured
output never contains ANSI color escapes. A caller can rely on the process exit
code and still parse stdout. Mutation transport failures use
`retrySafety: "unsafe"` because the provider may have accepted a request before
the connection failed.

### Exit codes

| Code | Failure class |
| ---: | --- |
| 0 | success |
| 1 | unexpected internal failure |
| 2 | invalid command, option, or input |
| 3 | authentication, account selection, or configuration |
| 4 | operation unsupported by the selected provider |
| 5 | provider or network failure |
| 6 | configured timeout exceeded |
| 7 | resource or destination conflict |
| 8 | destructive operation was not confirmed |

Error envelopes remain the more specific machine-readable contract; exit codes
are intentionally broad failure classes.

## Global automation controls

`-h` and `--help` work at the root and at command groups. `-V`, `--version`, and
`version` return the package, protocol, and schema versions. These global flags
are accepted before or after command words:

```sh
dmbridge --help
dmbridge x messages --help
dmbridge x --version
dmbridge accounts list x --output ndjson
dmbridge x doctor --timeout 30s --verbose
```

Timeouts require an explicit `ms`, `s`, or `m` unit and may range from `1ms` to
`10m`. The selected timeout replaces the command's normal network timeout,
including attachment transfers.

`--no-input` and `--non-interactive` disable confirmation prompts; they do not
disable data read from stdin. A destructive command then fails with exit code 8
unless `--yes` is present. `--yes` is exposed only on commands that may need to
bypass a destructive or replacement confirmation. It is not a general-purpose
success override.

Command targets and simple values are accepted as arguments. Structured request
bodies and secrets are accepted from an explicit file or from stdin with `-`.
The CLI never prompts for request bodies or secrets and never accepts secrets as
command-line values.

All mutation commands accept `--dry-run`. A dry run validates local selection,
arguments, and supplied request data where available, returns the planned
operation in the normal output contract, and performs no provider, local-state,
or destination-file mutation. Local default selection and account removal are
idempotent; repeated account removal reports
`"removed": false`. Remote message mutations retain the provider's idempotency
semantics, so callers must treat an `unsafe` retry result as outcome-unknown.

All public timestamps are ISO 8601 strings. Durations and limits name their
units, and byte counts use the `bytes` field.

## Accounts and local state

The CLI creates these paths itself:

```text
~/.dmbridge/
├── config.json
├── auth/
│   ├── instagram/<account>/credentials.json
│   └── x/<account>/
│       ├── credentials.json
│       └── xchat-passcode
├── state/
└── tmp/
```

Directories are mode `0700`; credentials and passcodes are mode `0600`.
Symlinked or incorrectly owned credential paths are rejected. There is no
message cache. `state` is reserved for short-lived protocol state such as OAuth
PKCE exchanges, and `tmp` is reserved for atomic operations.

Secrets are accepted only through a file or stdin—not command-line flags, shell
history, or JSON output.

Add Instagram with an access token:

```sh
printf '%s' '{"accessToken":"…"}' |
  dmbridge accounts add instagram --account personal --request - | jq
```

Account request objects use the documented v0.5 field names exactly; legacy
import aliases and nested credential envelopes are not accepted.

Add X with one command used in two phases. First provide the OAuth client
configuration:

```sh
printf '%s' '{"clientID":"…","clientType":"public","clientSecret":null,"redirectURI":"http://localhost/callback"}' |
  dmbridge accounts add x --account personal --request - | jq
```

The result contains `authorizationURL`. Open it, authorize the account, then
feed the resulting callback URL to the same command:

```sh
printf '%s' '{"callbackURL":"http://localhost/callback?code=…&state=…"}' |
  dmbridge accounts add x --account personal --request - | jq
```

`redirectURI` must be an absolute callback URL registered for that X OAuth
client. `{ "code": "…", "state": "…" }` may be supplied instead of the full
callback URL. The OAuth client configuration and PKCE verifier are kept only in
the mode-`0600` pending state until completion.

The OAuth flow requests the scopes needed for the complete XChat surface.
Commands that contact X automatically refresh tokens shortly before expiry and
atomically persist rotated access and refresh tokens. Rejected or unavailable
refresh credentials return `auth.reauthorizationRequired` with instructions to
run `accounts add x` again. Expired OAuth PKCE state is removed when a new
authorization begins.

Store the XChat passcode once:

```sh
printf '%s' '2580' |
  dmbridge accounts set-passcode x --account personal --secret - | jq
```

The passcode is not required for the conversation list. X returns that metadata
immediately after OAuth authorization. It is required only when dmbridge must
unlock the account keys to decrypt or encrypt conversation events or media.

For unlock, dmbridge uses the short-lived Juicebox realm tokens returned in the
fresh X public-key response. They stay in memory and are never written to
`~/.dmbridge`. No separate realm-token service is required. A configured
`realmTokenIssuerURL` remains supported as a fallback for nonstandard account
configurations; dmbridge calls it with the X OAuth bearer token and `realm_id`
query parameter and accepts either plain text or `{ "token": "…" }`.

If Juicebox reports that the stored passcode is wrong, dmbridge deletes it and
refuses to try it again. This prevents unattended calls from exhausting the
account's finite passcode attempts without retaining a rejected secret. Run
`accounts set-passcode x` to store a replacement.

## Command surface

General and discovery:

```text
dmbridge help
dmbridge <provider> doctor [--account <name>] [--live] [--schema <name>]
```

`doctor` performs no message mutation. Without `--live` it inspects local account
selection, expiry, scopes, capabilities, and XChat passcode state. With `--live`
it also verifies provider authentication and returns structured pass/warn/fail
checks plus `readReady` and `mutationReady` booleans. Its `contracts` field lists
every schema-v4 contract. `--schema <name>` includes one selected JSON Schema in
the same result, so separate `schema` and `capabilities` command families are
unnecessary.

Accounts:

```text
dmbridge accounts list [x|instagram]
dmbridge accounts add <provider> --account <name> --request <file|->
dmbridge accounts default <provider> --account <name>
dmbridge accounts remove <provider> --account <name> [--yes]
dmbridge accounts set-passcode x --account <name> --secret <file|->
```

Conversations:

```text
dmbridge <provider> conversations list [--account <name>] [--limit N]
  [--cursor C] [--unread]
dmbridge <provider> conversations get <conversationID> [--account <name>]
```

Conversation results include their complete `participants` array.

Message requests:

```text
dmbridge <provider> conversations requests list [--limit N] [--cursor C]
  [--category priority|hidden|requests]
dmbridge <provider> conversations requests get <conversationID>
  [--acknowledge-delivery]
dmbridge <provider> conversations requests messages <conversationID> [--limit N]
  [--cursor C] [--acknowledge-delivery]
dmbridge <provider> conversations requests accept <conversationID>
  [--request <file|->] [--dry-run]
dmbridge <provider> conversations requests decline <conversationID>
  [--dry-run] [--yes]
```

There is no public `--protocol` filter. The provider already determines the
protocol: `x` means XChat and `instagram` means Instagram Messaging. Request
inboxes are nested under `conversations` instead of also being exposed through a
duplicate folder filter.

X categories map `priority` to X's Priority request tab and `hidden` to its
Hidden tab. X request listing is metadata-only, but request detail and message
reads mark the returned messages delivered; dmbridge rejects those commands
unless `--acknowledge-delivery` is present. X accepts requests without a body
and supports decline by deleting the pending request for the authenticated
account. X request detail returns only its newest batch and does not expose a
cursor; `requests messages` reports `hasMoreMessages` so callers can detect
that older messages remain unavailable until the request is accepted.

Instagram uses the `requests` category. The official API may omit request
conversations inactive for more than 30 days. Instagram has no separate
accept-without-reply operation, so `requests accept` requires `--request` and
accepts by sending that reply. The official API does not expose decline, and
dmbridge returns a structured unsupported-operation error for it.

Messages:

```text
dmbridge <provider> messages list <conversationID> [--limit N] [--cursor C]
dmbridge <provider> messages get <messageID>
dmbridge <provider> messages send <conversationID> --request <file|->
dmbridge <provider> messages reply <messageID> --request <file|->
dmbridge <provider> messages edit <messageID> --request <file|->
dmbridge <provider> messages delete <messageID> [--yes]
dmbridge <provider> messages read <messageID>
dmbridge <provider> messages unread <messageID>
```

Reactions and attachment downloads:

```text
dmbridge <provider> reactions list <messageID>
dmbridge <provider> reactions add <messageID> --reaction <emoji>
dmbridge <provider> reactions remove <messageID> --reaction <emoji>
dmbridge <provider> attachments download <attachmentID> \
  --destination-url file:///absolute/path [--overwrite] [--dry-run]
```

Message results include their complete `attachments` array.

Commands that replace an existing authorization or passcode also require
interactive confirmation or `--yes`. Request decline and message delete use the
same rule. `--dry-run` never requires confirmation.

Example send request:

```json
{
  "type": "text",
  "text": "hello"
}
```

Provider IDs and message IDs are opaque. Do not parse or construct them in
calling applications; retain the value returned by dmbridge.

## Provider semantics

| Capability | XChat | Instagram |
| --- | --- | --- |
| Multiple accounts | yes | yes |
| Direct conversations | yes | yes |
| Group conversations | yes | no official adapter support |
| Conversation listing before decryption | yes | not applicable |
| Unread state | exact boolean; count may be unavailable | API-dependent |
| Mark read | conversation-level | conversation-level |
| Mark unread | conversation-level | unavailable |
| Send/reply | encrypted text | text and URL-backed supported media |
| Edit/delete | yes | unavailable |
| React/unreact | yes | yes |
| Attachment download | decrypted to explicit `file://` destination | explicit `file://` destination |
| Request categories | Priority and Hidden | Requests |
| Request detail read effect | marks returned messages delivered | no documented delivery mutation |
| Accept request | explicit accept | reply required |
| Decline request | deletes pending request for self | unavailable |

`messages read <messageID>` intentionally accepts an individual message ID on
both providers. The provider operation itself advances the corresponding
conversation's read state; the result reports `effect: "conversation"` so a
caller does not mistake it for an isolated per-message bit.

## Development

Provider-specific implementation is owned by its provider module. X OAuth,
credentials, passcode and PKCE state, diagnostics, schemas, encryption, and API
behavior live under `src/providers/x`; the rest of the CLI delegates through
provider definitions and generic secure-store primitives. The central schema
registry retains only the imports needed to compose the public versioned
contract.

```sh
npm run check
npm test
npm run test:package
npm run package:executable
npm run test:live
```

The offline suite uses temporary homes, mocked HTTP, and a mocked XChat SDK. It
covers credential permissions, default-account selection, passcode rejection,
the combined OAuth link/callback flow, PKCE cleanup, automatic token rotation,
actionable reauthorization errors, schemas, doctor, pagination, groups, empty
pages, XChat request categories,
delivery acknowledgment, detail decryption, accept and decline request shapes,
Instagram request-folder listing and reply-to-accept behavior,
Instagram media/share/story/unknown attachment fixtures and downloads, every
implemented XChat and Instagram mutation path, and unknown-outcome mutation
network failures. It does not access production social accounts.

`npm run test:live` is a separate, explicit production smoke suite under
`test/live`. (`npm run test:readonly` remains an alias.) It
assumes authenticated default X and Instagram accounts exist in `~/.dmbridge`
and exercises live doctor/auth, conversation pages, conversation detail,
participants, and decrypted message pages. It never calls mutation endpoints or
either provider's message-request inbox.

## License

MIT
