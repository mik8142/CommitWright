# Changelog

All notable changes to the CommitWright extension are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Initial release: generate a Git commit message from your changes with your
  locally installed Claude Code CLI (`claude`) and insert it into the Source
  Control commit box.
- Diff sources: `staged`, `all`, or `auto` (staged if any, otherwise all
  changes including untracked files); lock files excluded; oversized diffs
  truncated safely.
- Message styles: `plain` (default), `scoped`, `conventional`, `brackets` —
  subject-only or subject + body.
- Commit language: `auto` (follows the VS Code display language) or any
  language you type; native-form few-shot examples for en, ru, de, fr, es, it,
  pt, ja, ko, tr, zh.
- Seven entry points, each toggleable: Source Control title button (left/right
  position), commit editor button, inline action on the Changes group, slash
  commands in the commit box (`/generate`, `/plain`, `/conventional`, …),
  status bar item, dedicated panel (opt-in), and a keybinding
  (`Ctrl+Alt+G` / `Cmd+Alt+G`).
- One-click pickers: commit language, model, entry-point visibility.
- Prompt customization: extra instructions or a full custom template with
  placeholders (`{$diff}`, `{$lang}`, `{$style}`, `{$tags}`, `{$extra}`,
  `{$files}`).
- Clear, localized error messages (English / Russian UI) with actionable
  buttons — no silent failures.
