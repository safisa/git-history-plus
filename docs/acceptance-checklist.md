# Git History Plus 0.1.0: acceptance checklist

How to use this:

- Run the **VS Code (macOS)** column after `code --install-extension githistory-plus-0.1.0.vsix`.
- Run the **Theia** column in a Theia 1.76+ application with the `.vsix` extracted into its `plugins/` folder (for
  example `unzip githistory-plus-0.1.0.vsix -d plugins/safisa.githistory-plus/`). Do not point `theiaPlugins` at a
  local `.vsix`: `theia download:plugins` only fetches http(s) URLs, so a `file:` entry is not supported.
- Items marked `(auto: <file>)` are already proven by an automated test, which does not replace the manual check for
  anything visual. Items with no marker are **needs human**: a person must click through them in the real UI.
- Test repo: any repo with merges, a rename, tags, a remote and a branch named `<svg/onload=alert(1)>`.

Each item has two boxes: `VS Code (macOS)` then `Theia`.

## Theia 1.76 check (2026-11-02)

Done in a stock Theia 1.76.0 browser app (core, editor, filesystem, monaco, navigator, plugin-ext-vscode, scm,
terminal, workspace and others, with the built-in `vscode.git` 1.95.3), driving Chromium through Playwright, with the
`.vsix` extracted into `plugins/`. Everything below worked:

- The status bar button, `ctrl+alt+h`, `alt+h` and the editor title buttons open the repository or file history.
- Explorer right-click: View File History and Compare File with Branch or Tag… on a file, View Folder History on a
  folder. File history follows a rename; the folder history lists only commits under the folder.
- The commit table renders with the graph (merge lanes), branch, remote and tag badges, `main ☁ origin` folding,
  dimmed merges, the dashed uncommitted changes row, and the `<svg/onload=alert(1)>` branch name as plain text.
- Details: parent links, the branches and tags containing the commit (also in the hover card), the file list and
  the tree toggle.
- A click on a changed file opens a preview diff that the next click replaces; a double-click keeps it. Uncommitted
  files open as HEAD ↔ working tree diffs; a past version opens with Previous / Next and refuses edits ("This is a
  past version from git history and can't be edited.").
- `Cmd+F` focuses the history's search box (not Theia's find); Escape returns to the list. Fetch goes through the
  built-in Git extension.

Not covered there: destructive commit actions and their dialogs, the Compare Commits view, avatars, and a history
tab docked in a narrow side bar. Theia itself logs "INVALID tab" errors from its tab sync when a preview tab is
replaced; they do not come from this extension. A webview in Theia is served from `<uuid>.webview.<host>`, so start
Theia with a host name that resolves for subdomains (`localhost`, not `127.0.0.1`).

| #   | Item                                                                      | VS Code (macOS) | Theia  |
| --- | ------------------------------------------------------------------------- | --------------- | ------ |
| A   | **Install and activation**                                                |                 |        |
| A1  | `.vsix` installs; extension id is `safisa.githistory-plus`               | [ ]             | [ ]    |
| A2  | Activates from any command alone, all commands registered (auto: test/integration/commands.test.ts) | [ ] | [ ] |
| A3  | No telemetry or network traffic with default settings (check devtools/network) | [ ]        | [ ]    |
| B   | **Job 1: file history (G2.1)**                                            |                 |        |
| B1  | Editor title button opens history for the active file                     | [ ]             | [ ]    |
| B2  | Explorer / editor / editor-tab context menu "View File History"           | [ ]             | [ ]    |
| B3  | `alt+h` opens file history from editor and Explorer                       | [ ]             | [ ]    |
| B4  | Renames are followed (`--follow`) (auto: test/unit/git/logArgs.test.ts)   | [ ]             | [ ]    |
| B5  | Command accepts bare Uri, `{resourceUri}` and no argument (auto: test/integration/commands.test.ts) | [ ] | [ ] |
| C   | **Job 2: line history (G2.2)**                                            |                 |        |
| C1  | Select lines, "View Line History" shows only commits touching them (auto: test/integration/commands.test.ts for opening) | [ ] | [ ] |
| C2  | A different selection opens a separate tab (auto: test/integration/commands.test.ts) | [ ] | [ ] |
| D   | **Job 3: commit log and graph (G2.3)**                                    |                 |        |
| D1  | Repo history opens from SCM title button (Inline and More Actions settings) | [ ]           | [ ]    |
| D2  | Graph lanes, merges and octopus merges draw correctly (auto: test/unit/git/graph.test.ts for lane data) | [ ] | [ ] |
| D3  | Branch and tag badges inline on the message                               | [ ]             | [ ]    |
| D4  | Scrolling loads more pages smoothly (virtualized list)                    | [ ]             | [ ]    |
| D5  | History tab shows its icon, also when dragged into the left/right side bar (auto: test/unit/history/historyPanel.test.ts for the icon) | [ ] | [ ] |
| D6  | Diffs of past versions can't be typed into; a "can't be edited" message shows (auto: test/integration/security.test.ts for VS Code) | [ ] | [ ] |
| D7  | File/line history and filtered searches show a one-line timeline, not a staircase of lanes (auto: test/unit/git/gitService.test.ts) | [ ] | [ ] |
| D8  | File history: details list "This file" first, other files folded; a click only selects; double-click, Enter or "Open Changes" (row menu and details "…" menu) opens that version's diff (auto: test/unit/webview/fileHistory.test.tsx) | [ ] | [ ] |
| D9  | Previous/next and opening other versions reuse one diff tab per file; a pinned tab is kept (auto: test/integration/security.test.ts, test/unit/historyTab.test.ts) | [ ] | [ ] |
| D5  | Branch picker: current / all / specific branch                            | [ ]             | [ ]    |
| D6  | Author filter, search box, `/` focuses search, arrow keys and Enter work  | [ ]             | [ ]    |
| D7  | Skeleton shown while the first page loads                                 | [ ]             | [ ]    |
| D8  | Folder with no repo shows the warning (auto: test/integration/commands.test.ts) | [ ]       | [ ]    |
| E   | **Job 4: comparing (G2.4)**                                               |                 |        |
| E1  | Select for comparison, then Compare with selected fills the Compare Commits tree (auto: test/unit/commands/compare.test.ts) | [ ] | [ ] |
| E2  | Compare toolbar button: pick branches, tags or a hash for ref A and B (auto: test/unit/commands/compare.test.ts) | [ ] | [ ] |
| E3  | Compare tree: files-only and folder view toggles; clicking a file opens its diff (auto: test/unit/views/compareTree.test.ts) | [ ] | [ ] |
| E4  | Commit tree in Explorer shows the selected commit's files                 | [ ]             | [ ]    |
| F   | **Job 5: commit actions (G2.5)** (each confirmed action uses a native modal) |              |        |
| F1  | checkout (hash detaches; ref checks out; a remote badge creates or switches to the local tracking branch, never detaches), modal (auto: test/unit/history/actions.test.ts) | [ ] | [ ] |
| F2  | cherry-pick, no modal (auto: test/unit/history/actions.test.ts)           | [ ]             | [ ]    |
| F3  | revert, modal (auto: test/unit/history/actions.test.ts)                   | [ ]             | [ ]    |
| F4  | merge, modal (auto: test/unit/history/actions.test.ts)                    | [ ]             | [ ]    |
| F5  | rebase, modal (auto: test/unit/history/actions.test.ts)                   | [ ]             | [ ]    |
| F6  | reset soft, modal (auto: test/unit/history/actions.test.ts)               | [ ]             | [ ]    |
| F7  | reset hard, modal says it discards all uncommitted changes (auto: test/unit/history/actions.test.ts) | [ ] | [ ] |
| F8  | create branch: input box, name validation, offer to check out (auto: test/unit/history/actions.test.ts) | [ ] | [ ] |
| F9  | create tag: input box and validation (auto: test/unit/history/actions.test.ts) | [ ]        | [ ]    |
| F10 | remove tag, modal (auto: test/unit/history/actions.test.ts)               | [ ]             | [ ]    |
| F11 | remove local branch, modal; unmerged branch asks a second time for `-D` (auto: test/unit/history/actions.test.ts) | [ ] | [ ] |
| F12 | remove remote branch (x on the remote badge), modal (auto: test/unit/history/actions.test.ts) | [ ] | [ ] |
| F13 | Cancelling any modal changes nothing; git errors show as a message (auto: test/unit/history/actions.test.ts) | [ ] | [ ] |
| G   | **Files in a commit**                                                     |                 |        |
| G1  | Click a file: diff against first parent                                   | [ ]             | [ ]    |
| G2  | Context menu: view file at commit, compare with working copy, compare with previous, select for comparison | [ ] | [ ] |
| G3  | Copy hash from button and keyboard                                        | [ ]             | [ ]    |
| H   | **Layouts and themes**                                                    |                 |        |
| H1  | Wide layout (>= ~700px): details in right-hand side panel (auto: test/unit/webview/layout.test.tsx for the switch) | [ ] | [ ] |
| H2  | Narrow layout: columns collapse, selection expands in place (auto: test/unit/webview/layout.test.tsx for the switch) | [ ] | [ ] |
| H3  | Narrow Theia tab stays usable                                             | [ ]             | [ ]    |
| H4  | Light theme, wide                                                         | [ ]             | [ ]    |
| H5  | Light theme, narrow                                                       | [ ]             | [ ]    |
| H6  | Dark theme, wide                                                          | [ ]             | [ ]    |
| H7  | Dark theme, narrow                                                        | [ ]             | [ ]    |
| H8  | High-contrast theme, wide                                                 | [ ]             | [ ]    |
| H9  | High-contrast theme, narrow                                               | [ ]             | [ ]    |
| H10 | Visible focus ring; status shown by letters, not colour alone             | [ ]             | [ ]    |
| I   | **Section 6 bugs**                                                        |                 |        |
| I1  | Dates: relative within 7 days, then locale; `dateFormat` locale/iso/custom pattern (auto: test/unit/shared/dateFormat.test.ts) | [ ] | [ ] |
| I2  | Symlinked folder resolves to the repo and file history loads its commits (#786) (auto: test/integration/commands.test.ts, "a file-history panel answers its first log with the file's commits", fixture under the symlinked temp dir on macOS; test/unit/commands/history.test.ts) | [ ] | [ ] |
| I3  | Remote / Windows paths (#559): best-effort smoke, does not block 0.1.0 (auto, Windows CI only: test/unit/git/repoLocator.test.ts) | [ ] | [ ] |
| I4  | All-branches view refreshes after a branch is deleted or created (#734, #735) (auto, branch-created case: test/integration/commands.test.ts) | [ ] | [ ] |
| I5  | Compare shows added, deleted, modified and renamed files (#670, #746) (auto: test/unit/git/diffParser.test.ts) | [ ] | [ ] |
| I6  | No "reading 'trim'" error; file history opens without a webview error (#713, #684) (auto: test/unit/git/logParser.test.ts) | [ ] | [ ] |
| I7  | Repo found without a manual setup (#373) (auto: test/unit/git/repoLocator.test.ts) | [ ] | [ ] |
| J   | **Section 7 features**                                                    |                 |        |
| J1  | Search by hash prefix (4-40 hex) jumps to the commit (auto: test/unit/git/gitService.test.ts "returns exactHash for a hash prefix"; test/unit/webview/store.test.ts "selects the exact hash match returned by a search") | [ ] | [ ] |
| J2  | Search by file path filters via `-- <pathspec>` (auto: test/unit/git/logArgs.test.ts) | [ ] | [ ] |
| J3  | Previous / Next version buttons in a file-history diff (auto: test/unit/commands/fileVersions.test.ts) | [ ] | [ ] |
| J4  | Date range and max-count filter (last N, since, until) (auto: test/unit/git/logArgs.test.ts) | [ ] | [ ] |
| J5  | `.mailmap` names shown and used by the author filter (auto: test/unit/git/gitService.test.ts) | [ ] | [ ] |
| J6  | Right-click a folder in the Explorer: "View Folder History" lists the commits under it; double-click opens nothing (auto: test/integration/commands.test.ts, test/unit/commands/history.test.ts) | [ ] | [ ] |
| J7  | Right-click in an editor: "Compare File with Branch or Tag…", pick a tag; diff titled `<file> (<tag> ↔ workspace)`, left side read-only (auto: test/unit/commands/compare.test.ts) | [ ] | [ ] |
| J8  | Fetch button: progress notification, then remote branches update in every open view of the repo; a remote needing credentials prompts (VS Code) or fails with a notice; clicking an issue link opens it once (auto: test/unit/git/fetch.test.ts) | [ ] | [ ] |
| J9  | Author filter lists "Me" (your `user.email`) right after "Any author" and filters by it (auto: test/unit/webview/tier1.test.tsx) | [ ] | [ ] |
| J10 | With `issueLinks` set, `ABC-123` in a subject/body is a link that opens the tracker after the host's confirmation (auto: test/unit/webview/tier1.test.tsx) | [ ] | [ ] |
| J11 | Details show Parent(s); clicking one selects it (a merge's second parent too); Go to HEAD selects the HEAD commit (auto: test/unit/webview/tier1.test.tsx) | [ ] | [ ] |
| J12 | `main` and `origin/main` on the same commit show one badge `main ☁ origin`; its tooltip names both (auto: test/unit/webview/quickWins.test.tsx) | [ ] | [ ] |
| J13 | Resize the details panel, close and reopen the history (and restart): the width is kept (auto: test/unit/webview/quickWins.test.tsx, test/unit/history/historyPanel.test.ts) | [ ] | [ ] |
| J14 | `Ctrl+F` / `Cmd+F` in the history focuses search, not the host's find; Escape clears it, a second Escape returns to the list (auto: test/unit/webview/quickWins.test.tsx) | [ ] | [ ] |
| J15 | Merge commits are dimmed; with `dimMergeCommits` off they are not (auto: test/unit/webview/quickWins.test.tsx) | [ ] | [ ] |
| J16 | Status bar history button and `ctrl+alt+h` open the repository history; `showStatusBarItem` off hides the button (auto: test/unit/statusBar.test.ts) | [ ] | [ ] |
| J17 | Drag the left edge of the Author/Date/Hash header (or focus it and use arrows): the column resizes; widths survive reopening (auto: test/unit/webview/viewFeatures.test.tsx) | [ ] | [ ] |
| J18 | The toggle in the details (tree icon in list view, list icon in tree view) shows files as folders (`src/git` merged), folds with click/Left/Right, and is remembered (auto: test/unit/webview/viewFeatures.test.tsx) | [ ] | [ ] |
| J19 | Resting the pointer on a commit shows the branches and tags that contain it; the details list them (auto: test/unit/webview/viewFeatures.test.tsx, test/unit/history/requestHandler.test.ts) | [ ] | [ ] |
| J20 | Edit a file: a dashed "Uncommitted changes" row appears on top within a second; its files open HEAD ↔ working tree diffs (editable right side); commit and it disappears; file history shows it only for that file (auto: test/unit/git/worktree.test.ts) | [ ] | [ ] |
| J21 | Click a changed file: its diff opens in a preview (italic) tab that the next click replaces; double-click or "Open Changes" keeps it (auto: test/unit/webview/DetailsPanel.test.tsx, test/unit/history/requestHandler.test.ts) | [ ] | [ ] |
| K   | **Security and privacy**                                                  |                 |        |
| K1  | Branch `<svg/onload=alert(1)>` renders as text, no script runs; CSP intact (auto: test/integration/security.test.ts) | [ ] | [ ] |
| K2  | Forged webview action with `--upload-pack=x` is dropped (auto: test/integration/security.test.ts) | [ ] | [ ] |
| K3  | Avatars `off`: no requests and no images; `github` / `gravatar`: fetched by the extension host only and shown as `data:` images (16px in rows, 32px in details); the view ignores any non-`data:image/` URI; changing the setting applies to open panels (auto: test/unit/avatars.test.ts, test/unit/webview/avatars.test.tsx) | [ ] | [ ] |
| K4  | `npm run audit:prod` reports 0 vulnerabilities (CI)                       | [ ]             | [ ]    |
| L   | **Theia-only checks (Theia column only)**                                 |                 |        |
| L1  | Right-click a file in the file explorer: file history opens for that file | n/a             | [ ]    |
| L2  | Editor title button, SCM title button and `alt+h` all work                | n/a             | [ ]    |
| L3  | With `donjayamanne.githistory` removed, nothing is lost                   | n/a             | [ ]    |
