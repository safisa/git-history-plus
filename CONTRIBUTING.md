# Contributing

## Development

Use Node 22 (`.nvmrc`).

```sh
npm ci
npm run build             # bundle extension and webview into dist/
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration  # needs a display; downloads a VS Code build
npm run audit:prod
npm run package           # produces githistory-plus-<version>.vsix
```

CI runs on Ubuntu, macOS and Windows with Node 22 and 24. See `docs/acceptance-checklist.md` for the manual acceptance
pass in VS Code and Theia, including the Theia 1.76 check (a stock Theia 1.76 browser app with the built-in Git
extension). Theia applications that customize the workbench may need their own check.

### Why VS Code 1.101.0

It is the first VS Code stable release whose extension host runs Node 22.

- `microsoft/vscode` tag `1.100.0` -> `package.json` `electron: 34.5.1` -> Electron 34.5.1 bundles Node 20.19.0.
- `microsoft/vscode` tag `1.101.0` -> `package.json` `electron: 35.5.1` -> Electron 35.5.1 bundles Node 22.15.1
  (Electron 35.0.0 was the first 35.x, bundling Node 22.14.0).
- Earlier releases are older still (1.98 to 1.100 ship Electron 34 / Node 20; 1.96 to 1.97 ship Electron 32).
- Node versions taken from `releases.electronjs.org/releases.json` and Electron's `DEPS` `node_version`.

## Releasing

Releases go to the [VS Code Marketplace](https://marketplace.visualstudio.com) and [Open VSX](https://open-vsx.org)
through `.github/workflows/publish.yml`, using each store's trusted publishing (GitHub's OIDC token is exchanged for a
short-lived credential), so no access token is stored in the repository.

`README.md` and `CHANGELOG.md` are shown on both store pages, so keep them user-facing; anything for contributors
belongs here. `vsce` turns `#123` into a link to an issue of this repository, so refer to the original Git History's
issues with full links.

1. Bump `version` in `package.json`, update `CHANGELOG.md`, and push.
2. Create a GitHub Release whose tag is `v` plus that version (for example `v0.2.0`).
3. The workflow checks the tag, runs lint, typecheck, the unit and integration tests and the audit, and packages the
   `.vsix` once. Approve the two publish jobs (Marketplace, Open VSX) in the `publish` environment; each store gets the
   same `.vsix`, and a failed job can be re-run on its own.

One-time setup (both registrations: owner `safisa`, repository `git-history-plus`, workflow `publish.yml`, environment
`publish`):

- **VS Code Marketplace**: create the `safisa` publisher at
  [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) with a Microsoft account, then add
  a policy under the publisher's **Trusted Publishing**
  ([docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)).
- **Open VSX**: sign the Publisher Agreement and own the `safisa` namespace; publish the first version by hand
  (`npx ovsx publish <file>.vsix -p <token>`), then register the trusted publisher under Settings → Trusted Publishers
  ([docs](https://github.com/eclipse-openvsx/openvsx/wiki/Trusted-Publishing)). Then set the repository variable
  `PUBLISH_OPEN_VSX` to `true`; until then the Open VSX job is skipped.
- **GitHub**: create the `publish` environment with required reviewers.

## Third-party software

The webview bundles React, React DOM, scheduler, TanStack Virtual and the VS Code Codicons font; their licenses and
copyright notices are in `THIRD_PARTY_NOTICES.md`, which ships in the `.vsix`.
