# CommitWright

Generate Git commit messages from your changes — straight in VS Code's Source Control panel, powered by your locally installed CLI.

> **Status:** early scaffold. Core logic is being implemented.

## Features

Click the **Generate Commit Message** button (the 💬✨ icon in the Source Control panel) and CommitWright drafts a commit message from your changes, then drops it into the commit input box for you to review and edit.

By default it is smart about *what* to describe: if you have staged changes it uses those; otherwise it falls back to all your changes (including new, untracked files). Lock files are excluded automatically.

## Privacy

Your diff is sent only to the `claude` CLI running locally on your machine. The extension itself never sends anything anywhere.

<!-- TODO: add a short GIF/screenshot here once the feature works. A visual sells the Marketplace page. -->

## Requirements

- The `claude` CLI (Anthropic) installed on your machine. By default CommitWright calls `claude`; set an absolute path in settings if it is not on your `PATH` (common on Windows).
- Git, with at least one repository open in the workspace.

## Extension Settings

A few of the settings this extension contributes:

- `commitwright.cliPath` — path to the CLI executable (default: `claude`).
- `commitwright.model` / `commitwright.effort` — optional model and thinking-effort overrides.
- `commitwright.diffSource` — `auto` (default: staged if any, else all changes), `staged`, or `all`.
- `commitwright.style` — `plain` (default), `scoped`, `conventional`, or `brackets`.
- `commitwright.messageMode` — `subject` (default) or `subjectBody`.
- `commitwright.commitLanguage` — output language; `auto` follows the VS Code display language.

## Known Issues

The generate button lives in the Source Control panel header (or the `…` overflow menu), not inside the commit input box itself — that slot is reserved by VS Code and not available to third-party extensions.

## Release Notes

### 0.0.1

Initial scaffold.

---

Author: **mik8142** · License: MIT
