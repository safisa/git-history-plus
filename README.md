# Git History Plus

Git log, file, folder and line history with a commit graph, uncommitted changes, branch and tag comparison and
commit actions, in VS Code and Eclipse Theia.

Git History Plus started as a fork of [Git History](https://github.com/DonJayamanne/gitHistoryVSCode)
(`donjayamanne.githistory`) by DonJayamanne, which is no longer maintained. It is more than a modernized copy:

- **Rebuilt from scratch** on a current, secure toolchain: no known vulnerabilities in what it ships (the original's
  dependencies had 234 audit findings), no telemetry, and a locked-down view.
- **A new, faster interface**: a compact, virtualized commit table that adapts to the width of the panel, follows your
  theme and works from the keyboard.
- **Many features the original never had**, from an uncommitted changes row and folder history to branch lookups,
  issue links and a file tree. The full list is below.
- **Long-standing upstream bugs fixed**: dates, symlinked and Windows paths, compare results, parser crashes,
  repository discovery.

## What's new compared to Git History

**History**

- **Uncommitted changes** as a dashed row on top of the history. Its files open as HEAD ↔ working tree diffs, and in
  file or folder history it counts only the changes under that path.
- **Folder history**: right-click a folder in the Explorer for every commit that touched anything under it.
- **Compare a file with a branch or tag**: the version in any branch, tag or commit against your working copy.
- **Search by commit hash or file path**, a **date range** and a **max-count** filter, and **`.mailmap`** support.
- **"Me"** in the author filter, mapped through `.mailmap`.
- **Fetch** from all remotes, with prune, from the toolbar.
- **Go to HEAD**, and clickable **parent** hashes that jump to the parent commit.
- **Previous / Next** buttons to step through a file's versions in one reused diff tab.
- **Compare…** any two branches, tags or commits from the toolbar.

**Commit list and details**

- Hover a commit to see **which branches and tags contain it**; the details list them too.
- **Issue links**: keys like `ABC-123` in commit messages link to your tracker (`issueLinks` setting).
- Changed files as a **list or a folder tree** (single-child folders merged).
- A click on a file opens a **preview diff**; a double-click or **Open Changes** keeps the tab, as in VS Code.
- **Resizable Author, Date and Hash columns**, and a resizable details panel; all widths are remembered.
- **Merge commits are dimmed**, and a local branch and its remote on the same commit share one badge
  (`main ☁ origin`).
- In file and line history the tracked file comes first in the details, with the commit's other files folded away.

**Everywhere**

- A **status bar button** and `ctrl+alt+h` open the repository history; `alt+h` opens the file history.
- **Keyboard**: arrows, Home/End and Page Up/Down move through commits, `c` copies the hash, Shift+F10 opens the
  commit menu, Enter opens a version in file history, `/` or `Ctrl+F` / `Cmd+F` searches, and Escape clears the search
  (a second Escape returns to the list).
- **Eclipse Theia** as well as VS Code (see [Requirements](#requirements)).

## Features

- **History views**: the repository, the active file (following renames), a folder, or the selected lines.
- **Commit graph** in a dense, virtualized table with branch and tag badges. Filtered views (a file, a search, an
  author) draw a simple timeline, since lanes can't be drawn when the commits in between are hidden.
- **Filters**: current, all or one branch; author; message, hash or path search (`author:`, `path:`, `since:`,
  `until:`); date range; max count.
- **Commit details** in a side panel when the view is wide, or under the commit when it is narrow: message, people
  and dates, parents, the branches and tags that contain it, and the changed files with +/− counts.
- **Compare** two commits, branches or tags (the Compare… button, or Select for Comparison then Compare with
  Selected). Results appear in the Compare Commits view in the Explorer, with added, deleted, modified and renamed
  files.
- **Commit actions**: checkout, cherry-pick, revert, merge, rebase, soft and hard reset, create branch, create and
  remove tag, remove a local or remote branch. Destructive ones ask for confirmation in a native dialog.
- **Read-only past versions**: files opened at a commit can't be edited by mistake.
- **Themes and accessibility**: light, dark and high-contrast themes, screen-reader labels and visible focus.

## Settings

| Setting                                                | Type                           | Default    | Description                                                                                                         |
| ------------------------------------------------------ | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `gitHistoryPlus.alwaysPromptRepositoryPicker`          | boolean                        | `false`    | Always prompt to pick a repository, even when the active file belongs to one.                                       |
| `gitHistoryPlus.includeRemoteBranches`                 | boolean                        | `false`    | Include remote branches when showing all branches in the history.                                                   |
| `gitHistoryPlus.showEditorTitleMenuBarIcons`           | boolean                        | `true`     | Show the Git History Plus icons in the editor title menu bar.                                                       |
| `gitHistoryPlus.editorTitleButtonOpenRepo`             | boolean                        | `false`    | Make the editor title button open the repository history instead of the file history.                               |
| `gitHistoryPlus.pageSize`                              | integer (1–1000)               | `100`      | Number of commits to load per page.                                                                                 |
| `gitHistoryPlus.hideCommitViewExplorer`                | boolean                        | `false`    | Hide the commit details view in the Explorer.                                                                       |
| `gitHistoryPlus.hideCompareCommitViewExplorer`         | boolean                        | `false`    | Hide the compare commits view in the Explorer.                                                                      |
| `gitHistoryPlus.logLevel`                              | string (None, Info, Debug)     | `Info`     | Verbosity of the Git History Plus output channel.                                                                   |
| `gitHistoryPlus.sourceCodeProviderIntegrationLocation` | string (Inline, More Actions)  | `Inline`   | Where to show the View History action for SCM Providers.                                                            |
| `gitHistoryPlus.dateFormat`                            | string                         | `relative` | How commit dates are shown. "relative" shows e.g. "3 days ago"; otherwise a date format.                            |
| `gitHistoryPlus.avatars`                               | string (off, github, gravatar) | `off`      | Show author avatars. Avatars are fetched by the extension from the chosen service; "off" makes no network requests. |
| `gitHistoryPlus.defaultMaxCount`                       | integer (≥ 0)                  | `0`        | Maximum number of commits to load in total. 0 means unlimited.                                                      |
| `gitHistoryPlus.dimMergeCommits`                       | boolean                        | `true`     | Show merge commits dimmed in the history, so commits that change code stand out.                                    |
| `gitHistoryPlus.showStatusBarItem`                     | boolean                        | `true`     | Show a status bar button that opens the repository history.                                                         |
| `gitHistoryPlus.issueLinks`                            | array of `{ pattern, url }`    | `[]`       | Link issue keys in commit messages. `url` may use `$0` (the match) and `$1`…`$9` (its groups).                      |

`dateFormat` accepts `relative` (relative for the last 7 days, then the editor language's format), `locale`, `iso`, or
a custom pattern built from `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss`, for example `YYYY-MM-DD HH:mm`.

For example, to link Jira keys:

```json
"gitHistoryPlus.issueLinks": [
  { "pattern": "\\b([A-Z][A-Z0-9]+-\\d+)\\b", "url": "https://jira.example.com/browse/$1" }
]
```

## Privacy

Git History Plus has **no telemetry** and sends nothing anywhere by default. Avatars are **off by default**. If you set
`gitHistoryPlus.avatars` to `github` or `gravatar`, the extension host (not the webview or your browser) contacts
that service: Gravatar receives an MD5 hash of each author email, and GitHub receives the user name taken from `@users.noreply.github.com` addresses only. Images reach the view as `data:` URIs.
The webview and your browser never contact third parties. Repository text is always rendered as text, and the history view runs under a strict content security policy.

## Requirements

- VS Code 1.101.0 or newer (the first release whose extension host runs Node 22), or Eclipse Theia 1.76 or newer.
  Theia 1.76 is a supported target pending the manual acceptance pass (`docs/acceptance-checklist.md`, Theia
  column); until that pass is complete it is not yet verified.
- `git` on the `PATH` of the machine where the workspace lives (the extension runs as a workspace extension, so it
  works with Remote-SSH, WSL and containers). The `git.path` setting is honoured.

Why 1.101.0: this is the first VS Code stable release whose extension host runs Node 22.
Evidence:

- `microsoft/vscode` tag `1.100.0` -> `package.json` `electron: 34.5.1` -> Electron 34.5.1 bundles Node 20.19.0.
- `microsoft/vscode` tag `1.101.0` -> `package.json` `electron: 35.5.1` -> Electron 35.5.1 bundles Node 22.15.1
  (Electron 35.0.0 was the first 35.x, bundling Node 22.14.0).
- Earlier releases are older still (1.98 to 1.100 ship Electron 34 / Node 20; 1.96 to 1.97 ship Electron 32).
- Node versions taken from `releases.electronjs.org/releases.json` and Electron's `DEPS` `node_version`.

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
npm run package           # produces git-history-plus-0.1.0.vsix
```

CI runs on Ubuntu, macOS and Windows with Node 22 and 24. See `docs/acceptance-checklist.md` for the manual acceptance
pass in VS Code and Theia.

### Releasing

Releases go to [Open VSX](https://open-vsx.org) through `.github/workflows/publish.yml`, using Open VSX
[trusted publishing](https://github.com/eclipse-openvsx/openvsx/wiki/Trusted-Publishing): no access token is stored in
the repository.

1. Bump `version` in `package.json`, update `CHANGELOG.md`, and push.
2. Create a GitHub Release whose tag is `v` plus that version (for example `v0.2.0`).
3. Approve the run in the `publish` environment. It checks the tag, runs lint, typecheck, the unit and integration
   tests and the audit, packages the `.vsix` and publishes it.

One-time setup: the first version is published by hand (`npx ovsx publish <file>.vsix -p <token>`) after signing the
Open VSX Publisher Agreement and owning the `safisa` namespace. Then register the trusted publisher on open-vsx.org
(Settings → Trusted Publishers: owner `safisa`, repository `git-history-plus`, workflow `publish.yml`, environment
`publish`), and give the `publish` environment required reviewers in the repository settings.

## Third-party software

The webview bundles React, React DOM, scheduler, TanStack Virtual and the VS Code Codicons font; their licenses and
copyright notices are in `THIRD_PARTY_NOTICES.md`, which ships in the `.vsix`.

## Credits and license

Forked from [Git History](https://github.com/DonJayamanne/gitHistoryVSCode) by DonJayamanne. Released under the MIT
license: Copyright (c) 2015 DonJayamanne, Copyright (c) 2026 Safi-SeidAhmad. See `LICENSE`.
