# Changelog

## 0.2.0

- Compact 28px log rows and tighter toolbars show more entries at once.
- Give the inspector about 65% of the desktop workspace with larger value text.
- Minimize the sidebar to an icon rail and remember the preference; open project navigation as a drawer on mobile.
- Open the inspector in a full-screen modal while preserving the selected entry, expanded branches, and scroll position. Close with the button or Escape.
- Add Light, Dark, and System themes with persisted preferences, including controls inside the full-screen inspector.
- Preserve keyboard focus and keep copy feedback visible in full-screen mode.
- Extend browser verification to 42 desktop/mobile interaction checks.

## 0.1.0

- Global `logview-local` command with automatic collector startup and shared sessions.
- Expandable capture-time snapshots of console arguments, errors, and special JavaScript types.
- Raw stdout/stderr capture and structured JSON log parsing.
- Project, process, level, and nested-value search filters.
- Pause/resume, follow mode, copy, export, and source links to VS Code.
- Inherited capture for Node child processes and worker threads.
- Sample Node app, integration tests, browser checks, and a global-install package smoke test.

The npm package and global command are named `logview-local`; the public repository is `mk-tdev/logview`.
