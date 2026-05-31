import * as vscode from 'vscode';
import { getActiveRepository, getDiff, truncateDiff } from './git';
import { getConfig } from './config';
import { buildPrompt } from './prompt';
import { buildInvocation, runCli } from './cli';
import { showError } from './errors';
import { registerEntrypoints } from './entrypoints';
import { t } from './i18n';

// CommitWright — генерация Git commit-сообщения из staged-изменений через локальный CLI.
// Поток целиком: diff -> промпт -> CLI -> вставка результата в поле commit-сообщения.

export function activate(context: vscode.ExtensionContext): void {
  // Выставить context-keys точек входа (позиция/видимость) сразу при активации.
  registerEntrypoints(context);

  const disposable = vscode.commands.registerCommand('commitwright.generate', async () => {
    try {
      const repo = getActiveRepository();
      if (!repo) {
        vscode.window.showInformationMessage(t('CommitWright: no Git repository found.'));
        return;
      }

      const cfg = getConfig();
      const diff = await getDiff(repo.rootUri.fsPath, cfg.diffSource);
      if (!diff.trim()) {
        const hint =
          cfg.diffSource === 'staged'
            ? t('CommitWright: nothing staged. Stage changes first, or set diffSource to "all".')
            : t('CommitWright: no changes to describe.');
        vscode.window.showInformationMessage(hint);
        return;
      }

      const prompt = buildPrompt(cfg, truncateDiff(diff));

      const message = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.SourceControl, title: t('Generating commit message…') },
        () => runCli(buildInvocation(cfg), prompt, cfg.timeoutMs),
      );

      // Вставляем в поле ввода Source Control. Не затираем молча правки пользователя:
      // если там уже что-то есть, добавлять — его дело; здесь кладём черновик для ревью.
      repo.inputBox.value = message;
    } catch (err) {
      await showError(err);
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
