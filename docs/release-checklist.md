# Release checklist

A dmbridge release is ready when all applicable checks below pass.

## Automated gate

```sh
npm ci
npm run check
npm test
npm run test:package
npm run package:npm
npm run package:executable
```

- Command and schema snapshots have no unexplained diff.
- The packed file list contains the compiled CLI, README, license, agent usage
  guide, and package metadata, with no source tests or local credentials.
- The isolated packed-package smoke test can invoke `dmbridge help`,
  `dmbridge version`, and NDJSON output.
- Offline tests cover every mutation path and unknown-outcome failure behavior.

## Contract review

- Help matches the intended public command surface.
- JSON and NDJSON remain parseable and versioned.
- stdout/stderr separation and exit codes match the README.
- Account-add input is an exact four-variant schema: Instagram credential,
  X OAuth client, X callback URL, or X code/state.
- New timestamps are ISO 8601 and numeric units are explicit.
- New mutations support dry-run and expose `--yes` only for confirmation bypass.

## Live read-only gate

With explicit owner approval and configured noncritical default accounts, run:

```sh
npm run test:live
```

This suite may read real account metadata and messages. It must remain
read-only, skip message-request inboxes with delivery side effects, and never be
part of the default or CI test command.

## Artifact

Create the installable executable package:

```sh
npm run package:npm
npm install --global ./dmbridge-<version>.tgz
dmbridge version --pretty
```

The tarball installs `dmbridge` as an executable command and requires Node.js
22.12 or newer.

For a single self-contained executable with no runtime installation:

```sh
npm run package:executable
./artifacts/dmbridge-<version>-<platform>-<architecture> version --pretty
```

This release-only path uses Deno's self-extracting compiler so the XChat and
Juicebox WASM files remain available through the filesystem paths expected by
their SDKs. It does not change the Node/npm development runtime.

## GitHub Release

The tag-triggered `.github/workflows/release.yml` workflow verifies the package,
then builds and smoke-tests native executables on GitHub-hosted macOS, Linux,
and Windows runners for both x64 and ARM64. It publishes those six executables
as `.tar.gz` archives that preserve Unix execute permissions, their SHA-256
files, a consolidated `SHA256SUMS`, and the npm tarball to one GitHub Release.

Before tagging:

1. Set the intended semantic version in `package.json` and synchronize the root
   `package-lock.json` version.
2. Complete the automated, contract, and applicable live read-only gates above.
3. Commit and push a clean release commit.
4. Create and push the exact matching tag, such as `v1.0.0` for package version
   `1.0.0`.

```sh
git tag -a v1.0.0 -m "dmbridge v1.0.0"
git push origin v1.0.0
```

The workflow rejects a tag that does not exactly match `v` plus the version in
`package.json`. Only the final publish job receives `contents: write`; build and
verification jobs remain read-only. Publishing uses the repository-scoped
`GITHUB_TOKEN`, so no personal access token is required.

The generated macOS executables are ad-hoc signed by Deno. Public distribution
without Gatekeeper warnings requires a future Developer ID signing and Apple
notarization step with repository secrets; do not store signing credentials in
the repository.
