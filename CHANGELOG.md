# Changelog

## 0.1.0

First release of Git History Plus, a maintained fork of Git History (`donjayamanne.githistory`) 0.6.20.

### Rebuilt

- Fresh toolchain: TypeScript 5 (strict), esbuild, Vitest, ESLint and Prettier. The upstream build stack (webpack 4,
  Babel 6, Storybook 3, Jest 25, React 16, Bootstrap 3, Redux) and its 234 audit findings are gone.
- Runtime dependencies are `react`, `react-dom`, `@tanstack/react-virtual` and `@vscode/codicons`, all bundled into
  the webview. `npm audit --omit=dev` reports 0 vulnerabilities.
- Git is run with `execFile` and argument arrays, never a shell; paths follow `--`.
- The history view runs under a strict CSP (`default-src 'none'`, nonce-only scripts), renders repository data as
  text only, and the extension validates every message from the view (refs and hashes included).
- Destructive actions use the editor's native modal confirmation.
- No telemetry. Avatars are off by default.
- New namespace: commands and settings are `gitHistoryPlus.*`; the content scheme is `git-history-plus`.

### New UI

- Compact, virtualized commit table with a graph, inline branch and tag badges, and keyboard navigation.
- Wide layout shows commit details in a side panel; narrow layout expands the commit in place.
- Theme-aware (light, dark, high contrast), accessible roles and focus.
- File, line, search and author results draw a simple timeline (one line, a dot per commit) instead of the lane
  graph, which can't be drawn when the commits in between are filtered out.
- In file and line history the tracked file is listed first in the details ("This file"), with the commit's other
  files folded away. A click selects a commit; double-click, Enter or "Open Changes" in its menu opens that
  version's diff with previous/next stepping.
- Stepping through versions reuses one diff tab per file history (the next version replaces the previous one in
  place, whatever the preview-editor setting); a pinned tab is kept.
- The history tab and the Commits / Compare Commits views have icons, so they stay visible when docked in a side bar
  (Theia shows only the icon there).
- Past versions open read-only in both VS Code and Theia, served by a read-only file system with an explanatory
  message; binary files (e.g. images) are served as-is so the editor can preview them.

### Fixed

- A history view that was told to refresh before it had loaded could list the whole repository instead of the
  file or folder it was opened for.
- Dates use the editor language, with a `dateFormat` setting (#106, #740, #751).
- Symlinked folders and Windows/remote paths resolve to the right repository (#786, #559).
- The all-branches view refreshes when repository state changes (#734, #735).
- Compare shows added, deleted and renamed files (#670, #746).
- Parser rewrite removes the `reading 'trim'` and file-history webview errors (#713, #684).
- Repository discovery no longer fails to find `.git` (#373).

### Added

- Search by commit hash and by file path.
- Previous / Next version buttons when stepping through a file's history.
- Date range and max-count filter.
- `.mailmap` support (#676).
- Compare... toolbar button to compare any two branches, tags or commits (#739).
- Folder history: right-click a folder in the Explorer for every commit that touched anything under it.
- Compare File with Branch or Tag…: diffs the file as it is in a picked branch, tag or commit against the working
  copy (editor and Explorer context menus, editor title menu, Command Palette).
- Fetch button: fetches all remotes with prune (through the built-in Git extension, so its credential prompts work;
  without it, git runs directly and the progress notification can cancel it) and refreshes the open views of that
  repository.
- "Me" in the author filter: the configured `user.name` / `user.email`, as `.mailmap` maps them.
- `issueLinks` setting: turns issue keys such as `ABC-123` in commit messages into links (http and https only).
- Parent hashes in the commit details link to those commits, and a Go to HEAD button selects the HEAD commit; a
  commit that isn't loaded is found by searching for its hash.
- A local branch and the remote branches of the same name on the same commit share one badge in the list
  (`main ☁ origin`).
- The details panel width is remembered across views and restarts.
- `Ctrl+F` / `Cmd+F` focuses the search box; in it, Escape clears the search and a second Escape returns to the list.
- Merge commits are dimmed in the list (`dimMergeCommits` setting, on by default).
- Uncommitted changes appear as a dashed row on top of the history (not in line history or a filtered search);
  file and folder history show only the changes under that path. Its details list staged, unstaged and untracked
  files, which open as HEAD ↔ working tree diffs.
- Hovering a commit shows the branches and tags that contain it; the commit details list them too.
- The Author, Date and Hash columns can be resized (drag their header's left edge, or arrow keys on it); widths
  are remembered.
- Changed files can be shown as a folder tree, with single-child folders merged; the choice is remembered.
- A click on a changed file opens its diff in a preview tab (the next one replaces it); a double-click, or
  Open Changes in its menu, keeps the tab open, as in VS Code's own lists.
- A status bar button and `ctrl+alt+h` open the repository history (`showStatusBarItem` setting, on by default).
  The extension now activates once startup has finished, so the button is there from the start.
- Settings `dateFormat`, `avatars` and `defaultMaxCount`; changes apply to open panels. With `avatars` on, author
  avatars are fetched by the extension host and shown in the list and the details.
- Runs in Eclipse Theia 1.76 as well as desktop VS Code (checked in a stock Theia 1.76 browser app).

### Removed settings

- `sideBySide`, `showFileHistorySplit` and `avatarCacheExpiration` (replaced by the adaptive layout, file-history mode
  and the `avatars` setting). Old values are not migrated.

### Known gaps (deferred to 0.2)

- There is no settings menu in the toolbar yet; use the `gitHistoryPlus.*` settings.
