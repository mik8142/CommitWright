# CommitWright

Generate Git commit messages from your staged changes — straight in VS Code's Source Control panel, powered by your locally installed CLI.

> **Status:** early scaffold. Core logic is being implemented.

## Features

Click the **Generate Commit Message** button (the 💬✨ icon in the Source Control panel) and CommitWright drafts a commit message from your staged diff, then drops it into the commit input box for you to review and edit.

<!-- TODO: add a short GIF/screenshot here once the feature works. A visual sells the Marketplace page. -->

## Requirements

- The `claude` CLI (Anthropic) installed on your machine. By default CommitWright calls `claude`; set an absolute path in settings if it is not on your `PATH` (common on Windows).
- Git, with at least one repository open in the workspace.

## Extension Settings

This extension contributes the following settings:

- `commitwright.cliPath` — path to the CLI executable (default: `claude`).
- `commitwright.model` — optional model override passed to the CLI.
- `commitwright.diffSource` — `staged` (default) or `all` tracked changes.

## Known Issues

The generate button lives in the Source Control panel header (or the `…` overflow menu), not inside the commit input box itself — that slot is reserved by VS Code and not available to third-party extensions.

## Release Notes

### 0.0.1

Initial scaffold.

---

Author: **mik8142** · License: MIT
