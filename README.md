# GitHistory Plus

Git log, file, folder and line history with a commit graph, uncommitted changes, branch and tag comparison and
commit actions, in VS Code and Eclipse Theia.

GitHistory Plus is a maintained, rebuilt successor to [Git History](https://github.com/DonJayamanne/gitHistoryVSCode)
(`donjayamanne.githistory`) by DonJayamanne, which is no longer maintained:

- **Rebuilt on a modern, secure codebase**, with no telemetry and a locked-down history view.
- **A new, faster interface**: a compact, virtualized commit table that adapts to the width of the panel, follows your
  theme and works from the keyboard.
- **Many new features**, from an uncommitted changes row and folder history to branch lookups, issue links and a file
  tree.
- **Long-standing bugs fixed**: dates, symlinked and Windows paths, compare results, crashes, repository discovery.

## Features

**History**

- **History views** for the repository, the active file (following renames), a folder (right-click it in the
  Explorer), or the selected lines.
- **Commit graph** in a dense table with branch and tag badges. Filtered views (a file, a search, an author) draw a
  simple timeline, since lanes can't be drawn when the commits in between are hidden.
- **Uncommitted changes** as a dashed row on top of the history. Its files open as HEAD ↔ working tree diffs, and in
  file or folder history it counts only the changes under that path.
- **Filters**: current, all or one branch; author (including **"Me"**); message, commit hash or file path search
  (`author:`, `path:`, `since:`, `until:`); date range; max count. Authors follow **`.mailmap`**.
- **Fetch** from all remotes, with prune, from the toolbar.
- **Go to HEAD**, and clickable **parent** hashes that jump to the parent commit.
- **Previous / Next** buttons to step through a file's versions in one reused diff tab.

**Commit list and details**

- **Commit details** in a side panel when the view is wide, or under the commit when it is narrow: message, people
  and dates, parents, the branches and tags that contain it, and the changed files with +/− counts.
- Hover a commit to see **which branches and tags contain it**.
- **Issue links**: keys like `ABC-123` in commit messages link to your tracker (`issueLinks` setting).
- Changed files as a **list or a folder tree** (single-child folders merged).
- A click on a file opens a **preview diff**; a double-click or **Open Changes** keeps the tab, as in VS Code.
- In file and line history the tracked file comes first in the details, with the commit's other files folded away.
- **Resizable Author, Date and Hash columns**, and a resizable details panel; all widths are remembered.
- **Merge commits are dimmed**, and a local branch and its remote on the same commit share one badge
  (`main ☁ origin`).

**Compare and act**

- **Compare** any two commits, branches or tags (the Compare… button, or Select for Comparison then Compare with
  Selected). Results appear in the Compare Commits view in the Explorer, with added, deleted, modified and renamed
  files.
- **Compare a file with a branch or tag**: the version in any branch, tag or commit against your working copy.
- **Commit actions**: checkout, cherry-pick, revert, merge, rebase, soft and hard reset, create branch, create and
  remove tag, remove a local or remote branch. Destructive ones ask for confirmation first.
- **Read-only past versions**: files opened at a commit can't be edited by mistake.

**Everywhere**

- A **status bar button** and `ctrl+alt+h` open the repository history; `alt+h` opens the file history.
- **Keyboard**: arrows, Home/End and Page Up/Down move through commits, `c` copies the hash, Shift+F10 opens the
  commit menu, Enter opens a version in file history, `/` or `Ctrl+F` / `Cmd+F` searches, and Escape clears the search
  (a second Escape returns to the list).
- **Themes and accessibility**: light, dark and high-contrast themes, screen-reader labels and visible focus.

## Settings

| Setting                                                | Type                           | Default    | Description                                                                                                         |
| ------------------------------------------------------ | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `gitHistoryPlus.alwaysPromptRepositoryPicker`          | boolean                        | `false`    | Always prompt to pick a repository, even when the active file belongs to one.                                       |
| `gitHistoryPlus.includeRemoteBranches`                 | boolean                        | `false`    | Include remote branches when showing all branches in the history.                                                   |
| `gitHistoryPlus.showEditorTitleMenuBarIcons`           | boolean                        | `true`     | Show the GitHistory Plus icons in the editor title menu bar.                                                        |
| `gitHistoryPlus.editorTitleButtonOpenRepo`             | boolean                        | `false`    | Make the editor title button open the repository history instead of the file history.                               |
| `gitHistoryPlus.pageSize`                              | integer (1–1000)               | `100`      | Number of commits to load per page.                                                                                 |
| `gitHistoryPlus.hideCommitViewExplorer`                | boolean                        | `false`    | Hide the commit details view in the Explorer.                                                                       |
| `gitHistoryPlus.hideCompareCommitViewExplorer`         | boolean                        | `false`    | Hide the compare commits view in the Explorer.                                                                      |
| `gitHistoryPlus.logLevel`                              | string (None, Info, Debug)     | `Info`     | Verbosity of the GitHistory Plus output channel.                                                                    |
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

GitHistory Plus has **no telemetry** and sends nothing anywhere by default. Avatars are **off by default**. If you set
`gitHistoryPlus.avatars` to `github` or `gravatar`, the extension host (not the webview or your browser) contacts that
service: Gravatar receives an MD5 hash of each author email, and GitHub receives the user name taken from
`@users.noreply.github.com` addresses only. Images reach the view as `data:` URIs. The webview and your browser never
contact third parties. Repository text is always rendered as text, and the history view runs under a strict content
security policy.

## Requirements

- VS Code 1.101 or newer, or Eclipse Theia 1.76 or newer.
- `git` on the `PATH` of the machine where the workspace lives. The extension runs where your workspace is, so it works
  with Remote-SSH, WSL and containers. The `git.path` setting is honoured.

## Credits and license

Forked from [Git History](https://github.com/DonJayamanne/gitHistoryVSCode) by DonJayamanne. Released under the MIT
license: Copyright (c) 2015 DonJayamanne, Copyright (c) 2026 Safi-SeidAhmad. See `LICENSE`. Bundled third-party
licenses are in `THIRD_PARTY_NOTICES.md`.
