# dmbridge

[![version](https://img.shields.io/badge/version-2.0.1-blue)](package.json)
[![release](https://github.com/Nexuist/dmbridge/actions/workflows/release.yml/badge.svg)](https://github.com/Nexuist/dmbridge/actions/workflows/release.yml)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Give your agents one command-line interface for direct messages across social
platforms.

dmbridge supports XChat and Instagram Messaging today, with more platforms to
come. It gives scripts and AI agents a predictable JSON interface for reading
conversations, sending and editing messages, reacting, handling message
requests, and downloading attachments.

## Why this exists

[Two Cents](https://twocents.com) runs a lot of social media accounts. We wanted
one practical way for our agents to handle incoming messages without teaching
every agent a different API, authentication flow, and response format.

So we built dmbridge.

## Vibe coded, proudly

This is a vibe-coded project, built with Codex and GPT-5.6.

That does not mean it is untested. dmbridge has an offline test suite covering
authentication, schemas, pagination, provider fixtures, encryption paths,
mutations, attachments, and failure behavior. It also has an optional live,
read-only test suite that can exercise configured X and Instagram accounts.

You should still review what your agent intends to do. Every mutation supports
`--dry-run`, destructive actions require confirmation, and failures report
whether an automatic retry would be safe.

## What works

- XChat and Instagram Messaging
- Multiple named accounts per platform
- Direct and group conversations where the provider supports them
- Conversation and message-request inboxes
- Read, send, reply, edit, delete, and read-state operations where supported
- Reactions
- Attachment downloads
- JSON output with stable, versioned schemas
- Non-interactive operation for agents and scripts

Provider APIs do change. XChat and Instagram may add restrictions, rename
fields, or change behavior underneath dmbridge. Run `doctor --live` when you
want to verify a configured account against the real provider.

## Install an executable

Download the archive for your operating system and architecture from the
[latest release](https://github.com/Nexuist/dmbridge/releases/latest). Releases
include self-contained executables for macOS, Linux, and Windows on x64 and
ARM64, plus SHA-256 checksums.

On macOS or Linux:

```sh
tar -xzf dmbridge-<version>-<platform>-<architecture>.tar.gz
chmod +x dmbridge-<version>-<platform>-<architecture>
sudo install dmbridge-<version>-<platform>-<architecture> /usr/local/bin/dmbridge
dmbridge version --pretty
```

On Windows, extract the archive and place the `.exe` somewhere on your `PATH`.

If you would rather use Node.js, the release also includes an npm tarball:

```sh
npm install --global ./dmbridge-<version>.tgz
```

## Connect an account

dmbridge stores account configuration and credentials under `~/.dmbridge` by
default. Set `DMBRIDGE_HOME` or pass `--home /absolute/path` to keep them
somewhere else.

The home directory is private to the current user. Credential files are written
with mode `0600`, and secrets are accepted through files or stdin so they do not
need to appear in shell arguments.

### Instagram

Add an Instagram professional account with its access token:

```sh
printf '%s' '{"accessToken":"YOUR_ACCESS_TOKEN"}' |
  dmbridge accounts add instagram --account work --request -
```

### X

X uses OAuth. Start by passing the client configuration registered for your X
application:

```sh
printf '%s' '{"clientID":"YOUR_CLIENT_ID","clientType":"public","clientSecret":null,"redirectURI":"http://localhost/callback"}' |
  dmbridge accounts add x --account work --request -
```

Open the returned `authorizationURL`, approve access, and pass the complete
callback URL back to the same command:

```sh
printf '%s' '{"callbackURL":"http://localhost/callback?code=…&state=…"}' |
  dmbridge accounts add x --account work --request -
```

To decrypt and send XChat messages, store the account's XChat passcode:

```sh
printf '%s' 'YOUR_PASSCODE' |
  dmbridge accounts set-passcode x --account work --secret -
```

If XChat rejects that passcode, dmbridge immediately forgets it instead of
risking repeated failed attempts.

Check either account with:

```sh
dmbridge x doctor --account work --live --pretty
dmbridge instagram doctor --account work --live --pretty
```

## A five-minute agent workflow

The resource commands are shared across providers. Set `PROVIDER` to `x` or
`instagram`, then choose the configured account. These examples use `jq` to
pull opaque IDs out of dmbridge's JSON responses:

```sh
PROVIDER=x
ACCOUNT=work
```

Find the most recent conversation and open it:

```sh
CONVERSATION_ID=$(dmbridge "$PROVIDER" conversations list \
  --account "$ACCOUNT" --limit 1 |
  jq -r '.result.items[0].conversationID')

dmbridge "$PROVIDER" conversations get "$CONVERSATION_ID" \
  --account "$ACCOUNT" --pretty
```

Get its latest message and add a reaction. Preview the mutation first:

```sh
MESSAGE_ID=$(dmbridge "$PROVIDER" messages list "$CONVERSATION_ID" \
  --account "$ACCOUNT" --limit 1 |
  jq -r '.result.items[0].messageID')

dmbridge "$PROVIDER" reactions add "$MESSAGE_ID" \
  --account "$ACCOUNT" --reaction '👍' --dry-run --pretty

dmbridge "$PROVIDER" reactions add "$MESSAGE_ID" \
  --account "$ACCOUNT" --reaction '👍'
```

Send a message of your own, again starting with a dry run:

```sh
printf '%s' '{"type":"text","text":"Thanks — we are on it!"}' |
  dmbridge "$PROVIDER" messages send "$CONVERSATION_ID" \
    --account "$ACCOUNT" --request - --dry-run --pretty

printf '%s' '{"type":"text","text":"Thanks — we are on it!"}' |
  dmbridge "$PROVIDER" messages send "$CONVERSATION_ID" \
    --account "$ACCOUNT" --request -
```

Find an image in the recent history and download it to an explicit destination:

```sh
ATTACHMENT_ID=$(dmbridge "$PROVIDER" messages list "$CONVERSATION_ID" \
  --account "$ACCOUNT" --limit 50 |
  jq -r '[.result.items[].attachments[] | select(.type == "image")][0].attachmentID')

dmbridge "$PROVIDER" attachments download "$ATTACHMENT_ID" \
  --account "$ACCOUNT" \
  --destination-url file:///absolute/path/to/inbox-image.jpg
```

IDs are opaque strings. Keep the exact values dmbridge returns rather than
trying to parse or construct them yourself.

## Help and schemas

The CLI is the command reference:

```sh
dmbridge --help
dmbridge x messages --help
dmbridge instagram conversations --help
```

`doctor` lists every public JSON schema and can return one by name:

```sh
dmbridge x doctor --schema message.send --pretty
dmbridge instagram doctor --schema page.messages --pretty
```

The schemas are defined in [`src/protocol.ts`](src/protocol.ts). Provider
credential shapes live in
[`src/providers/x/credentials.ts`](src/providers/x/credentials.ts) and
[`src/providers/instagram/credentials.ts`](src/providers/instagram/credentials.ts).
Agents should read [`docs/agent-usage.md`](docs/agent-usage.md) before operating
a real account.

## Automation behavior

- Primary JSON results go to stdout.
- Progress, warnings, and diagnostics go to stderr.
- `--no-input` and `--non-interactive` disable prompts but do not authorize an
  action.
- `--yes` only bypasses a specific confirmation.
- Every mutation supports `--dry-run`.
- Timeouts require units, such as `500ms`, `30s`, or `2m`.
- Success exits with code `0`; meaningful failure classes use documented
  nonzero codes.

For unattended calls, a useful baseline is:

```text
--json --no-input --no-color --timeout 30s
```

## Development and tests

The source is TypeScript and requires Node.js 22.12 or newer:

```sh
npm install
npm run check
npm test
npm run test:package
```

With explicit approval and noncritical X and Instagram accounts configured in
the dmbridge home, the live read-only suite can be run with:

```sh
npm run test:live
```

The live suite reads account, conversation, and message data. It does not call
mutation endpoints or open message-request inboxes that may have delivery side
effects.

Standalone executables are built with:

```sh
npm run package:executable
```

Deno is used only as the release compiler. The source, tests, and npm package
remain Node-based.

## License

MIT
