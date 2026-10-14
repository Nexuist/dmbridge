# dmbridge

[![version](https://img.shields.io/badge/version-2.1.2-blue)](package.json)
[![release](https://github.com/Nexuist/dmbridge/actions/workflows/release.yml/badge.svg)](https://github.com/Nexuist/dmbridge/actions/workflows/release.yml)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Give your agents one command-line interface for direct messages across social
platforms.

dmbridge supports XChat and Instagram Messaging today, with more platforms to
come. It gives scripts and AI agents a predictable JSON interface for reading
conversations, sending and editing messages, reacting, handling message
requests, and downloading attachments.

## Why this exists

[twocents](https://twocents.com) runs a lot of social media accounts. We wanted
one practical way for our agents to handle incoming messages without teaching
every agent a different API, authentication flow, and response format.

So we built dmbridge.

## How it was built

dmbridge was vibe coded with Codex and GPT-5.6 against the real workflows we run
at twocents. The speed came from the model; confidence comes from tests that pin
down the behavior.

The offline suite covers authentication, schemas, pagination, provider fixtures,
encryption paths, mutations, attachments, and failure behavior. An optional
live, read-only suite can exercise configured X and Instagram accounts.

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

Instagram's messaging API requires a professional account and a Meta developer
app. Start with Instagram's instructions for creating a
[Creator account](https://help.instagram.com/2358103564437429) or
[Business account](https://help.instagram.com/502981923235522), then
[register as a Meta developer](https://developers.facebook.com/docs/development/register/),
[create a Meta app](https://developers.facebook.com/docs/development/create-an-app/),
and follow Meta's
[Instagram API setup](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started/)
to get an access token.

From a repository checkout, with `dmbridge` installed, the setup script asks for
the account name, optional dmbridge home, and access token one line at a time.
The token is hidden while you type and passed through a temporary mode-`0600`
file:

```sh
./scripts/connect-ig.sh
```

### X

Create and configure an OAuth 2.0 app using X's
[developer app guide](https://docs.x.com/fundamentals/developer-apps). Add the
exact callback URL you plan to use; for local setup, X recommends
`http://127.0.0.1` rather than `localhost`.

The X setup script asks for the account name, client ID, client type, optional
client secret, and redirect URI one line at a time. It prints the OAuth link,
waits for the callback URL, optionally stores the XChat passcode, and finishes
with a live read-only check:

```sh
./scripts/connect-x.sh
```

If XChat rejects that passcode, dmbridge immediately forgets it instead of
risking repeated failed attempts.

Both scripts are safe to rerun. If an account already exists, dmbridge asks for
explicit confirmation before replacing its authorization. Set `DMBRIDGE_BIN` if
the executable is not named `dmbridge` or is not on your `PATH`:

```sh
DMBRIDGE_BIN=/absolute/path/to/dmbridge ./scripts/connect-x.sh
```

## A five-minute personal X workflow

Suppose a friend just sent a meme to your personal X account.

Open the latest conversation:

```sh
dmbridge x conversations list --account personal --limit 1 --pretty
```

```json
{
  "account": "personal",
  "command": "x conversations list",
  "ok": true,
  "protocolVersion": 1,
  "provider": "x",
  "requestID": "demo-request-1",
  "result": {
    "items": [
      {
        "archived": false,
        "conversationID": "x-conversation-123",
        "lastReadMessageID": "x-message-455",
        "latestMessageAt": "2026-10-14T19:42:11.000Z",
        "latestMessageID": "x-message-456",
        "muted": false,
        "participants": [
          {
            "displayName": "Jamie",
            "userID": "x-user-42",
            "username": "jamie"
          }
        ],
        "protocol": "xchat",
        "title": "Jamie",
        "type": "direct",
        "unread": true,
        "unreadCount": 1
      }
    ],
    "nextCursor": null
  }
}
```

```sh
dmbridge x conversations get x-conversation-123 \
  --account personal --pretty
```

```json
{
  "account": "personal",
  "command": "x conversations get x-conversation-123",
  "ok": true,
  "protocolVersion": 1,
  "provider": "x",
  "requestID": "demo-request-2",
  "result": {
    "archived": false,
    "conversationID": "x-conversation-123",
    "lastReadMessageID": "x-message-455",
    "latestMessageAt": "2026-10-14T19:42:11.000Z",
    "latestMessageID": "x-message-456",
    "muted": false,
    "participants": [
      {
        "displayName": "Jamie",
        "userID": "x-user-42",
        "username": "jamie"
      }
    ],
    "protocol": "xchat",
    "title": "Jamie",
    "type": "direct",
    "unread": true,
    "unreadCount": 1
  }
}
```

Find the newest inbound message with an image:

```sh
dmbridge x messages list x-conversation-123 \
  --account personal --limit 50 --pretty
```

```json
{
  "account": "personal",
  "command": "x messages list x-conversation-123",
  "ok": true,
  "protocolVersion": 1,
  "provider": "x",
  "requestID": "demo-request-3",
  "result": {
    "items": [
      {
        "attachments": [
          {
            "attachmentID": "x-attachment-789",
            "filename": "meme.jpg",
            "mediaType": "image/jpeg",
            "sourceURL": null,
            "type": "image"
          }
        ],
        "conversationID": "x-conversation-123",
        "direction": "inbound",
        "messageID": "x-message-456",
        "providerType": "message",
        "read": false,
        "reactions": [],
        "replyToMessageID": null,
        "senderID": "x-user-42",
        "senderUsername": "jamie",
        "sentAt": "2026-10-14T19:42:11.000Z",
        "text": null,
        "type": "image"
      }
    ],
    "nextCursor": null
  }
}
```

Heart the meme. Preview the mutation, then do it:

```sh
dmbridge x reactions add x-message-456 \
  --account personal --reaction '❤️' --dry-run --pretty
```

```json
{
  "account": "personal",
  "command": "x reactions add x-message-456",
  "ok": true,
  "protocolVersion": 1,
  "provider": "x",
  "requestID": "demo-request-4",
  "result": {
    "account": "personal",
    "dryRun": true,
    "operation": "add",
    "provider": "x",
    "request": { "reaction": "❤️" },
    "target": "x-message-456"
  }
}
```

```sh
dmbridge x reactions add x-message-456 \
  --account personal --reaction '❤️' --pretty
```

```json
{
  "account": "personal",
  "command": "x reactions add x-message-456",
  "ok": true,
  "protocolVersion": 1,
  "provider": "x",
  "requestID": "demo-request-5",
  "result": {
    "confirmed": true,
    "effect": "exact"
  }
}
```

Reply with `sick meme`:

```sh
printf '%s' '{"type":"text","text":"sick meme"}' |
  dmbridge x messages reply x-message-456 \
    --account personal --request - --dry-run --pretty
```

```json
{
  "account": "personal",
  "command": "x messages reply x-message-456",
  "ok": true,
  "protocolVersion": 1,
  "provider": "x",
  "requestID": "demo-request-6",
  "result": {
    "account": "personal",
    "dryRun": true,
    "operation": "reply",
    "provider": "x",
    "request": { "text": "sick meme", "type": "text" },
    "target": "x-message-456"
  }
}
```

```sh
printf '%s' '{"type":"text","text":"sick meme"}' |
  dmbridge x messages reply x-message-456 \
    --account personal --request - --pretty
```

```json
{
  "account": "personal",
  "command": "x messages reply x-message-456",
  "ok": true,
  "protocolVersion": 1,
  "provider": "x",
  "requestID": "demo-request-7",
  "result": {
    "confirmed": true,
    "effect": "exact"
  }
}
```

Download the meme to your Downloads folder:

```sh
dmbridge x attachments download x-attachment-789 \
  --account personal \
  --destination-url "file://$HOME/Downloads/meme.jpg" --pretty
```

```json
{
  "account": "personal",
  "command": "x attachments download x-attachment-789",
  "ok": true,
  "protocolVersion": 1,
  "provider": "x",
  "requestID": "demo-request-8",
  "result": {
    "bytes": 184320,
    "destinationURL": "file:///Users/you/Downloads/meme.jpg",
    "mediaType": "image/jpeg",
    "sha256": "d8e8fca2dc0f896fd7cb4cb0031ba2493a8bdf6d2230c53a8f18b3f4c2e3d7a1"
  }
}
```

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
