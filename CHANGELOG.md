# Changelog

## 1.0.0

First stable release. Commands and settings are unchanged.

- The history view opens and refreshes faster on large repositories: a refresh reloads the commits you had scrolled
  through in one go instead of page by page.

## 0.1.1

- Renamed to **GitHistory Plus** (`safisa.githistory-plus`). Commands and settings are unchanged.

## 0.1.0

First release of GitHistory Plus, a maintained, rebuilt successor to Git History (`donjayamanne.githistory`) 0.6.20.

### Rebuilt

- A modern, secure codebase with no known vulnerabilities in what it ships.
- No telemetry. Avatars are off by default.
- The history view runs under a strict content security policy and shows repository data as text only.
- Destructive actions ask for confirmation in a native dialog.
- Commands and settings are `gitHistoryPlus.*`.

### New UI

- Compact, virtualized commit table with a graph, inline branch and tag badges, and keyboard navigation.
- Wide layout shows commit details in a side panel; narrow layout expands the commit in place.
- Theme-aware (light, dark, high contrast), accessible roles and focus.
- File, line, search and author results draw a simple timeline (one line, a dot per commit) instead of the lane
  graph, which can't be drawn when the commits in between are filtered out.
- In file and line history the tracked file is listed first in the details ("This file"), with the commit's other
  files folded away. A click selects a commit; double-click, Enter or "Open Changes" in its menu opens that
  version's diff with previous/next stepping.
- Stepping through versions reuses one diff tab per file history; a pinned tab is kept.
- The history tab and the Commits / Compare Commits views have icons, so they stay recognizable when docked in a side
  bar.
- Past versions open read-only; binary files such as images open in the editor's preview.

### Fixed

Issues reported against the original Git History:

- Dates use the editor language, with a `dateFormat` setting
  ([#106](https://github.com/DonJayamanne/gitHistoryVSCode/issues/106),
  [#740](https://github.com/DonJayamanne/gitHistoryVSCode/issues/740),
  [#751](https://github.com/DonJayamanne/gitHistoryVSCode/issues/751)).
- Symlinked folders and Windows/remote paths resolve to the right repository
  ([#786](https://github.com/DonJayamanne/gitHistoryVSCode/issues/786),
  [#559](https://github.com/DonJayamanne/gitHistoryVSCode/issues/559)).
- The all-branches view refreshes when repository state changes
  ([#734](https://github.com/DonJayamanne/gitHistoryVSCode/issues/734),
  [#735](https://github.com/DonJayamanne/gitHistoryVSCode/issues/735)).
- Compare shows added, deleted and renamed files
  ([#670](https://github.com/DonJayamanne/gitHistoryVSCode/issues/670),
  [#746](https://github.com/DonJayamanne/gitHistoryVSCode/issues/746)).
- No more `reading 'trim'` and file-history view errors
  ([#713](https://github.com/DonJayamanne/gitHistoryVSCode/issues/713),
  [#684](https://github.com/DonJayamanne/gitHistoryVSCode/issues/684)).
- Repository discovery no longer fails to find `.git`
  ([#373](https://github.com/DonJayamanne/gitHistoryVSCode/issues/373)).

### Added

- Search by commit hash and by file path.
- Previous / Next version buttons when stepping through a file's history.
- Date range and max-count filter.
- `.mailmap` support ([#676](https://github.com/DonJayamanne/gitHistoryVSCode/issues/676)).
- Compare… toolbar button to compare any two branches, tags or commits
  ([#739](https://github.com/DonJayamanne/gitHistoryVSCode/issues/739)).
- Folder history: right-click a folder in the Explorer for every commit that touched anything under it.
- Compare File with Branch or Tag…: diffs the file as it is in a picked branch, tag or commit against the working
  copy (editor and Explorer context menus, editor title menu, Command Palette).
- Fetch button: fetches all remotes with prune and refreshes the open views of that repository.
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
- Settings `dateFormat`, `avatars` and `defaultMaxCount`; changes apply to open panels. With `avatars` on, author
  avatars are shown in the list and the details.
- Runs in Eclipse Theia 1.76 as well as desktop VS Code.

### Removed settings

- `sideBySide`, `showFileHistorySplit` and `avatarCacheExpiration` (replaced by the adaptive layout, file-history mode
  and the `avatars` setting). Old values are not migrated.
