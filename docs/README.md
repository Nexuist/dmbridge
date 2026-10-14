# dmbridge docs

This directory is the self-contained Fumadocs site for dmbridge. It exports a
static site suitable for GitHub Pages.

```sh
npm ci
npm run dev
```

Run `npm run types:check` and `npm run build` before shipping a docs change.
The schema and command reference pages read `../test/snapshots/` during the
build, so those pages always reflect the reviewed CLI contracts.

The `docs` GitHub Actions workflow builds the site while the repository is
private. Once the repository is public, set **Settings → Pages → Source** to
**GitHub Actions**; subsequent pushes to `main` deploy the exported site.
